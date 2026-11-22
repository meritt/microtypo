#!/usr/bin/env node
// Invariant fuzzer: documents generated from a grammar of Russian prose, run through the engine and
// checked against what must hold for every input. A broken invariant is shrunk to a minimal case
// and printed with the seed that reproduces it.
//
//   pnpm fuzz [--seed S] [--cases N] [--format F] [--keep-going] [--summary F] [--jobs N]
//             [--case-timeout S]
//   pnpm fuzz --case K --seed S [--case-timeout S]
//   pnpm fuzz --coverage [--cases N] [--seed S] [--jobs N]
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';

import { RULE_IDS } from './fuzz/coverage.mjs';
import { FORMATS } from './fuzz/documents.mjs';
import { NAMES, silence } from './fuzz/invariants.mjs';
import { createPool } from './fuzz/pool.mjs';
import { createSession, groupOf } from './fuzz/session.mjs';
import { visible } from './visible.mjs';

const USAGE = `Usage: pnpm fuzz [options]

  --seed <n>        seed of the run (default: random, printed first)
  --cases <n>       number of generated cases (default: 10000)
  --format <f>      one format only: ${FORMATS.join(', ')}
  --keep-going      collect every distinct violation, grouped by the rule to blame
  --summary <file>  with --keep-going: write the groups as JSON, to compare runs on one seed
  --case <k>        run case k of the seed alone and print it
  --coverage        count, per rule, the cases whose output changes when the rule is switched off
  --jobs <n>        worker threads (default: ${availableParallelism()}); the result does not depend on it
  --case-timeout <s>
                    seconds a worker may spend on one case (default: 10); a case it gives no answer
                    on breaks the invariant «движок отвечает», and the worker is replaced
`;

// Further occurrences of a violation already on the list are counted; only this many are shrunk.
const EXAMPLES_PER_GROUP = 2;
// Cases a worker takes at a time.
const BLOCK = 200;
// A rule exercised fewer times than this per 100 000 cases cannot be checked by the fuzzer.
const COVERAGE_FLOOR = 30;

// A fingerprint seen before is most likely the same defect: only a sample of its later occurrences
// pays for finding the rule to blame, enough to catch two defects sharing one.
const examined = (n) => n <= 10 || (n & (n - 1)) === 0;

function integer(name, value, min = 0) {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n < min) {
    throw new Error(`--${name} expects an integer of at least ${min}, got ${value}`);
  }

  return n;
}

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: {
      seed: { type: 'string' },
      cases: { type: 'string', default: '10000' },
      format: { type: 'string' },
      'keep-going': { type: 'boolean', default: false },
      summary: { type: 'string' },
      case: { type: 'string' },
      coverage: { type: 'boolean', default: false },
      jobs: { type: 'string', default: String(availableParallelism()) },
      'case-timeout': { type: 'string', default: '10' },
      help: { type: 'boolean', default: false }
    }
  });

  if (values.format !== undefined && !FORMATS.includes(values.format)) {
    throw new Error(`--format expects one of ${FORMATS.join(', ')}, got ${values.format}`);
  }

  if (values.summary !== undefined && !values['keep-going']) {
    throw new Error('--summary needs --keep-going');
  }

  return {
    help: values.help,
    seed:
      values.seed === undefined
        ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
        : integer('seed', values.seed) >>> 0,
    cases: integer('cases', values.cases),
    format: values.format ?? null,
    keepGoing: values['keep-going'],
    summary: values.summary ?? null,
    only: values.case === undefined ? null : integer('case', values.case),
    coverage: values.coverage,
    jobs: integer('jobs', values.jobs, 1),
    caseTimeout: integer('case-timeout', values['case-timeout'], 1)
  };
}

const workerData = (opts) => ({ seed: opts.seed, format: opts.format, coverage: opts.coverage });

const poolFor = (opts, size) => createPool(size, workerData(opts), opts.caseTimeout * 1000);

// A case the engine gives no answer on is a violation of its own. Its worker is replaced, and the
// other cases of the block are scanned again: what the old worker found went with it.
async function scanBlock(pool, session, opts, from, to) {
  if (from >= to) {
    return [];
  }

  try {
    return await pool.run('scan', from, to);
  } catch (error) {
    if (error.stalled === undefined) {
      throw error;
    }

    const at = error.stalled;

    return [
      ...(await scanBlock(pool, session, opts, from, at)),
      { index: at, violations: [silence(session.caseAt(at).format, opts.caseTimeout)] },
      ...(await scanBlock(pool, session, opts, at + 1, to))
    ];
  }
}

// A hang is shrunk from this thread, each smaller case tried on a worker under the same limit: the
// thread that runs a hanging case goes with it. Other violations are shrunk on a worker, and one
// whose shrinking hangs is reported as it was found.
function examiner(pool, session) {
  const stalls = async (kase) => {
    try {
      await pool.run('probe', kase);
      return false;
    } catch (error) {
      if (error.stalled === undefined) {
        throw error;
      }

      return true;
    }
  };

  return async (index, violation) => {
    if (violation.invariant === 'responds') {
      let hangs = 0;

      return session.examine(index, violation, async (kase) => {
        const stalled = await stalls(kase);

        if (stalled) {
          hangs += 1;
          console.error(`… случай ${index}: зависаний при сжатии ${hangs}`);
        }

        return stalled;
      });
    }

    try {
      return await pool.run('examine', index, violation);
    } catch (error) {
      if (error.stalled === undefined) {
        throw error;
      }

      return {
        group: groupOf(violation, []),
        finding: { violation, kase: session.caseOf(index, violation), index, blame: [] }
      };
    }
  };
}

const block = (text) =>
  visible(text)
    .split('\n')
    .map((line) => `  │ ${line}`)
    .join('\n');

function seconds(started) {
  return ((performance.now() - started) / 1000).toFixed(1);
}

function blocks(cases) {
  const list = [];

  for (let from = 0; from < cases; from += BLOCK) {
    list.push([from, Math.min(cases, from + BLOCK)]);
  }

  return list;
}

function progress(label, total) {
  let done = 0;
  let shown = 0;
  const started = performance.now();

  return (n) => {
    done += n;

    if (done - shown >= 10000 || done === total) {
      shown = done;
      console.error(`… ${label} ${done} из ${total}, ${seconds(started)} с`);
    }
  };
}

function createReporter(session, seed) {
  // A case the engine does not answer on is not run again here: this thread would wait with it.
  const describe = ({ violation, kase, index, blame }) => {
    const transparent = violation.invariant === 'transparent';
    const { out, again } =
      violation.invariant === 'responds'
        ? {}
        : session.check(kase, transparent ? 'transparent' : null);
    const [first, second] = transparent
      ? ['со снятой разметкой:', 'без разметки:']
      : ['вывод 1:', 'вывод 2:'];

    return {
      lines: [
        `━━ ${NAMES[violation.invariant]}`,
        `виновник: ${blame.length > 0 ? blame.join(' + ') : 'не определён'}`,
        `seed ${seed}, случай ${index}${kase.transparent ? ' (проза с разметкой)' : ''}: pnpm fuzz --seed ${seed} --case ${index}`,
        `формат: ${kase.format}`,
        `конфиг: ${JSON.stringify(kase.config)}`,
        ...(violation.detail ? [`суть: ${violation.detail}`] : []),
        `ввод ${JSON.stringify(kase.text)}`,
        block(kase.text),
        ...(out === undefined
          ? []
          : [first, block(out), second, block(again ?? '(второй проход бросил ошибку)')])
      ].join('\n'),
      out,
      again
    };
  };

  return describe;
}

// The case is checked and shrunk on a worker, so a hang is reported rather than waited on.
async function runCase(opts, session) {
  const describe = createReporter(session, opts.seed);
  const kase = session.caseAt(opts.only);
  await using pool = poolFor(opts, 1);

  const prose = session.proseAt(opts.only);

  console.log(`формат: ${kase.format}\nконфиг: ${JSON.stringify(kase.config)}`);
  console.log(`ввод ${JSON.stringify(kase.text)}`);

  if (prose !== null) {
    console.log(`проза с разметкой (${prose.format}, ${JSON.stringify(prose.config)}):`);
    console.log(`ввод ${JSON.stringify(prose.text)}`);
  }

  const found = await scanBlock(pool, session, opts, opts.only, opts.only + 1);

  if (found.length === 0) {
    console.log('нарушений нет');
    return 0;
  }

  const examine = examiner(pool, session);

  for (const violation of found[0].violations) {
    const { group, finding } = await examine(opts.only, violation);

    console.log(`\n■ ${group}\n${describe(finding).lines}`);
  }

  return 1;
}

// Stops at the lowest-numbered case with a violation, whatever order the workers finish in.
async function runFirst(opts, pool, session, started) {
  const ranges = blocks(opts.cases);
  const results = [];
  const window = opts.jobs * 4;

  for (let i = 0; i < ranges.length; i++) {
    while (results.length < Math.min(ranges.length, i + window)) {
      results.push(scanBlock(pool, session, opts, ...ranges[results.length]));
    }

    const found = await results[i];

    if (found.length > 0) {
      const { index, violations } = found[0];
      const { finding } = await examiner(pool, session)(index, violations[0]);

      await pool.close();
      console.log(createReporter(session, opts.seed)(finding).lines);
      console.log(`\n${index + 1} случаев за ${seconds(started)} с`);
      return 1;
    }
  }

  console.log(`${opts.cases} случаев за ${seconds(started)} с, нарушений нет`);
  return 0;
}

// Three passes keep the result independent of how the workers share the cases: they check every
// case, the main thread picks in case order the occurrences to shrink, they shrink those, and the
// main thread assigns every occurrence to a group in case order again.
async function runAll(opts, pool, session, started) {
  const tick = progress('случаев', opts.cases);
  const scans = await Promise.all(
    blocks(opts.cases).map(([from, to]) =>
      scanBlock(pool, session, opts, from, to).then((found) => {
        tick(to - from);
        return found;
      })
    )
  );

  const seen = new Map();
  const occurrences = [];
  const tasks = [];
  const tally = Object.fromEntries(Object.keys(NAMES).map((invariant) => [invariant, 0]));

  for (const { index, violations } of scans.flat()) {
    for (const violation of violations) {
      const print = `${violation.invariant}\u{0}${violation.fingerprint}`;
      const count = (seen.get(print) ?? 0) + 1;

      tally[violation.invariant] += 1;
      seen.set(print, count);
      occurrences.push({ print, task: examined(count) ? tasks.length : null });

      if (examined(count)) {
        tasks.push([index, violation]);
      }
    }
  }

  const tock = progress('разобрано нарушений', tasks.length);
  const examine = examiner(pool, session);
  const results = await Promise.all(
    tasks.map(([index, violation]) =>
      examine(index, violation).then((result) => {
        tock(1);
        return result;
      })
    )
  );

  await pool.close();

  const groups = new Map();
  const lastGroup = new Map();

  for (const { print, task } of occurrences) {
    const group = task === null ? lastGroup.get(print) : results[task].group;
    const entry = groups.get(group) ?? { count: 0, findings: [] };

    groups.set(group, entry);
    lastGroup.set(print, group);
    entry.count += 1;

    if (task !== null && entry.findings.length < EXAMPLES_PER_GROUP) {
      entry.findings.push(results[task].finding);
    }
  }

  const elapsed = seconds(started);
  const rate = Math.round(opts.cases / Math.max(Number(elapsed), 0.001));
  const describe = createReporter(session, opts.seed);
  const summary = [];

  for (const [group, entry] of [...groups].toSorted(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n■ ${group} — ${entry.count} раз`);

    entry.findings.forEach((finding, n) => {
      const { lines, out, again } = describe(finding);

      console.log(lines);

      if (n === 0) {
        const { violation, kase, index, blame } = finding;

        summary.push({
          group,
          invariant: violation.invariant,
          kind: violation.kind ?? null,
          blame,
          count: entry.count,
          example: {
            index,
            format: kase.format,
            config: kase.config,
            text: kase.text,
            detail: violation.detail ?? null,
            out: out ?? null,
            again: again ?? null
          }
        });
      }
    });
  }

  console.log(
    `\n${opts.cases} случаев за ${elapsed} с (${rate} в секунду, потоков ${opts.jobs}), ` +
      `нарушений ${occurrences.length}, групп ${groups.size}`
  );

  for (const [invariant, name] of Object.entries(NAMES)) {
    console.log(`  ${name}: ${tally[invariant]}`);
  }

  if (opts.summary !== null) {
    writeFileSync(
      opts.summary,
      `${JSON.stringify(
        {
          seed: opts.seed,
          cases: opts.cases,
          format: opts.format,
          violations: occurrences.length,
          invariants: tally,
          groups: summary
        },
        null,
        2
      )}\n`
    );
  }

  return occurrences.length === 0 ? 0 : 1;
}

async function runCoverage(opts, pool, started) {
  const tick = progress('случаев', opts.cases);
  const parts = await Promise.all(
    blocks(opts.cases).map(([from, to]) =>
      pool.run('cover', from, to).then((part) => {
        tick(to - from);
        return part;
      })
    )
  );

  await pool.close();

  const counts = new Map(RULE_IDS.map((rule) => [rule, 0]));
  let counted = 0;

  for (const part of parts) {
    counted += part.counted;

    for (const [rule, n] of Object.entries(part.counts)) {
      counts.set(rule, counts.get(rule) + n);
    }
  }

  const floor = Math.ceil((COVERAGE_FLOOR * opts.cases) / 100000);
  const rows = [...counts].toSorted(([a, x], [b, y]) => x - y || a.localeCompare(b));
  const width = Math.max(...RULE_IDS.map((rule) => rule.length));
  const low = rows.filter(([, n]) => n < floor);

  console.log(`${'правило'.padEnd(width)}  случаев  на 100 000`);

  for (const [rule, n] of rows) {
    const per = ((n * 100000) / Math.max(opts.cases, 1)).toFixed(0);

    console.log(
      `${rule.padEnd(width)}  ${String(n).padStart(7)}  ${per.padStart(10)}${n < floor ? '  мало' : ''}`
    );
  }

  const verdict = low.length === 0 ? 'все правила выше' : `ниже ${low.length} из ${rows.length}`;

  console.log(
    `\n${opts.cases} случаев (${opts.cases - counted} не в счёт: ошибка или разный вывод двух ` +
      `прогонов) за ${seconds(started)} с, потоков ${opts.jobs}; порог ${floor}: ${verdict}`
  );

  return low.length === 0 ? 0 : 1;
}

async function main() {
  const opts = readOptions(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  console.log(`seed ${opts.seed}`);

  const session = opts.coverage
    ? null
    : await createSession({ seed: opts.seed, format: opts.format });

  if (opts.only !== null) {
    return runCase(opts, session);
  }

  const started = performance.now();
  await using pool = poolFor(opts, opts.jobs);

  if (opts.coverage) {
    return await runCoverage(opts, pool, started);
  }

  return await (opts.keepGoing
    ? runAll(opts, pool, session, started)
    : runFirst(opts, pool, session, started));
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 2;
}
