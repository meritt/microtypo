#!/usr/bin/env node
// Invariant fuzzer: documents generated from a grammar of Russian prose, run through the engine and
// checked against what must hold for every input. A broken invariant is shrunk to a minimal case
// and printed with the seed that reproduces it.
//
//   pnpm fuzz [--seed S] [--cases N] [--format F] [--keep-going] [--summary F] [--jobs N]
//   pnpm fuzz --case K --seed S
//   pnpm fuzz --coverage [--cases N] [--seed S] [--jobs N]
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';

import { RULE_IDS } from './fuzz/coverage.mjs';
import { FORMATS } from './fuzz/documents.mjs';
import { NAMES } from './fuzz/invariants.mjs';
import { createPool } from './fuzz/pool.mjs';
import { createSession } from './fuzz/session.mjs';
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
    jobs: integer('jobs', values.jobs, 1)
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
  const describe = ({ violation, kase, index, blame }) => {
    const { out, again } = session.check(kase);

    return {
      lines: [
        `━━ ${NAMES[violation.invariant]}`,
        `виновник: ${blame.length > 0 ? blame.join(' + ') : 'не определён'}`,
        `seed ${seed}, случай ${index}: pnpm fuzz --seed ${seed} --case ${index}`,
        `формат: ${kase.format}`,
        `конфиг: ${JSON.stringify(kase.config)}`,
        ...(violation.detail ? [`суть: ${violation.detail}`] : []),
        `ввод ${JSON.stringify(kase.text)}`,
        block(kase.text),
        ...(out === undefined
          ? []
          : ['вывод 1:', block(out), 'вывод 2:', block(again ?? '(второй проход бросил ошибку)')])
      ].join('\n'),
      out,
      again
    };
  };

  return describe;
}

async function runCase(opts) {
  const session = await createSession({ seed: opts.seed, format: opts.format });
  const describe = createReporter(session, opts.seed);
  const kase = session.caseAt(opts.only);
  const { violations } = session.check(kase);

  console.log(`формат: ${kase.format}\nконфиг: ${JSON.stringify(kase.config)}`);
  console.log(`ввод ${JSON.stringify(kase.text)}`);

  if (violations.length === 0) {
    console.log('нарушений нет');
    return 0;
  }

  for (const violation of violations) {
    const { group, finding } = session.examine(opts.only, violation);

    console.log(`\n■ ${group}\n${describe(finding).lines}`);
  }

  return 1;
}

// Stops at the lowest-numbered case with a violation, whatever order the workers finish in.
async function runFirst(opts, pool, started) {
  const ranges = blocks(opts.cases);
  const results = [];
  const window = opts.jobs * 4;

  for (let i = 0; i < ranges.length; i++) {
    while (results.length < Math.min(ranges.length, i + window)) {
      results.push(pool.run('scan', ...ranges[results.length]));
    }

    const found = await results[i];

    if (found.length > 0) {
      await pool.close();

      const session = await createSession({ seed: opts.seed, format: opts.format });
      const { index, violations } = found[0];
      const { finding } = session.examine(index, violations[0]);

      console.log(createReporter(session, opts.seed)(finding).lines);
      console.log(`\n${index + 1} случаев за ${seconds(started)} с`);
      return 1;
    }
  }

  await pool.close();
  console.log(`${opts.cases} случаев за ${seconds(started)} с, нарушений нет`);
  return 0;
}

// Three passes keep the result independent of how the workers share the cases: they check every
// case, the main thread picks in case order the occurrences to shrink, they shrink those, and the
// main thread assigns every occurrence to a group in case order again.
async function runAll(opts, pool, started) {
  const tick = progress('случаев', opts.cases);
  const scans = await Promise.all(
    blocks(opts.cases).map(([from, to]) =>
      pool.run('scan', from, to).then((found) => {
        tick(to - from);
        return found;
      })
    )
  );

  const seen = new Map();
  const occurrences = [];
  const tasks = [];

  for (const { index, violations } of scans.flat()) {
    for (const violation of violations) {
      const print = `${violation.invariant}\u{0}${violation.fingerprint}`;
      const count = (seen.get(print) ?? 0) + 1;

      seen.set(print, count);
      occurrences.push({ print, task: examined(count) ? tasks.length : null });

      if (examined(count)) {
        tasks.push([index, violation]);
      }
    }
  }

  const tock = progress('разобрано нарушений', tasks.length);
  const results = await Promise.all(
    tasks.map(([index, violation]) =>
      pool.run('examine', index, violation).then((result) => {
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
  const session = await createSession({ seed: opts.seed, format: opts.format });
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

  if (opts.summary !== null) {
    writeFileSync(
      opts.summary,
      `${JSON.stringify(
        {
          seed: opts.seed,
          cases: opts.cases,
          format: opts.format,
          violations: occurrences.length,
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

  if (opts.only !== null) {
    return runCase(opts);
  }

  const started = performance.now();
  const pool = createPool(opts.jobs, {
    seed: opts.seed,
    format: opts.format,
    coverage: opts.coverage
  });

  if (opts.coverage) {
    return runCoverage(opts, pool, started);
  }

  return opts.keepGoing ? runAll(opts, pool, started) : runFirst(opts, pool, started);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 2;
}
