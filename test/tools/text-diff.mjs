// Runs the real-text set through two revisions of the engine and prints what changed between them.
//   node test/tools/text-diff.mjs <refA> <refB>     (WORKTREE = the working tree's src/)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, styleText } from 'node:util';

import { visible } from './visible.mjs';

const ROOT = join(import.meta.dirname, '../..');
const TEXTS = join(ROOT, 'test/fixtures/real');
const WORKTREE = 'WORKTREE';
const CONTEXT = 1;
const COLOR = { '-': 'red', '+': 'green' };

const FORMAT_BY_EXT = {
  '.html': 'html',
  '.json': 'json',
  '.md': 'markdown',
  '.toml': 'toml',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml'
};

const PROSE_CONFIGS = [
  ['по умолчанию', {}],
  ['html', { html: true }],
  ['entities', { entities: true }]
];

const { values, positionals: args } = parseArgs({
  allowPositionals: true,
  options: { help: { type: 'boolean', default: false } }
});

if (args.length !== 2 || values.help) {
  console.log('usage: node test/tools/text-diff.mjs <refA> <refB>   (WORKTREE = рабочее дерево)');
  process.exit(values.help ? 0 : 2);
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

// `git show` per file instead of an archive or a worktree: the snapshot is only what the engine
// needs, and nothing about the repository's own state changes.
function resolve(ref) {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).toString().trim();
  } catch {
    console.error(`text-diff: ревизия «${ref}» не найдена`);
    process.exit(2);
  }
}

function checkout(ref, into) {
  const rev = resolve(ref);
  const files = git('ls-tree', '-r', '--name-only', rev, 'src')
    .toString()
    .split('\n')
    .filter(Boolean);

  for (const file of files) {
    const target = join(into, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git('show', `${rev}:${file}`));
  }

  writeFileSync(join(into, 'package.json'), '{"type":"module"}\n');

  return { label: `${ref} (${rev.slice(0, 7)})`, entry: join(into, 'src/index.js') };
}

async function engine(ref, temp) {
  if (ref === WORKTREE) {
    const { MicroTypo } = await import(pathToFileURL(join(ROOT, 'src/index.js')));

    return { label: WORKTREE, MicroTypo };
  }

  const into = join(temp, ref.replaceAll(/[^\w.-]/g, '_'));
  const { label, entry } = checkout(ref, into);

  const { MicroTypo } = await import(pathToFileURL(entry));

  return { label, MicroTypo };
}

function runs(file) {
  const text = readFileSync(join(TEXTS, file), 'utf8');
  const ext = extname(file);

  if (ext === '.txt') {
    return PROSE_CONFIGS.map(([name, config]) => ({ name, config, text }));
  }

  const format =
    ext === '.md' && /^(?:---|\+\+\+)\r?\n/.test(text) ? 'frontmatter' : FORMAT_BY_EXT[ext];

  if (format === undefined) {
    return [];
  }

  // Markup formats are run again with HTML output on, where the rules that only work there fire.
  let extra = [];

  if (format === 'html') {
    extra = [
      ['html, html', { html: true }],
      ['html, html, entities', { html: true, entities: true }]
    ];
  } else if (ext === '.md') {
    extra = [[`${format}, html`, { html: true }]];
  }

  return [[format, {}], ...extra].map(([name, config]) => ({
    name,
    config: { input: format, ...config },
    text
  }));
}

function outcome(MicroTypo, { config, text }) {
  try {
    return new MicroTypo(config).process(text);
  } catch (error) {
    return `!! ${error.code ?? error.name}: ${error.message}`;
  }
}

// Plain LCS over lines: the outputs come from one input, so they are short and nearly aligned.
function lineDiff(a, b) {
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ sign: ' ', line: a[i], at: i + 1 });
      i += 1;
      j += 1;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push({ sign: '-', line: a[i], at: i + 1 });
      i += 1;
    } else {
      ops.push({ sign: '+', line: b[j], at: j + 1 });
      j += 1;
    }
  }

  return ops;
}

function hunks(ops) {
  const keep = ops.map(() => false);

  ops.forEach((op, index) => {
    if (op.sign !== ' ') {
      for (
        let k = Math.max(0, index - CONTEXT);
        k <= Math.min(ops.length - 1, index + CONTEXT);
        k += 1
      ) {
        keep[k] = true;
      }
    }
  });

  const out = [];

  ops.forEach((op, index) => {
    if (!keep[index]) {
      return;
    }

    if (index > 0 && !keep[index - 1] && out.length > 0) {
      out.push(styleText('dim', '  ...'));
    }

    const line = `${op.sign} ${String(op.at).padStart(4)}  ${visible(op.line)}`;
    out.push(COLOR[op.sign] ? styleText(COLOR[op.sign], line) : line);
  });

  return out;
}

const temp = mkdtempSync(join(tmpdir(), 'microtypo-text-diff-'));

try {
  const [left, right] = [await engine(args[0], temp), await engine(args[1], temp)];
  const files = readdirSync(TEXTS).toSorted();
  let total = 0;
  let changedRuns = 0;
  const changedFiles = new Set();
  let removed = 0;
  let added = 0;

  for (const file of files) {
    for (const run of runs(file)) {
      total += 1;
      const before = outcome(left.MicroTypo, run);
      const after = outcome(right.MicroTypo, run);

      if (before === after) {
        continue;
      }

      changedRuns += 1;
      changedFiles.add(file);
      const ops = lineDiff(before.split('\n'), after.split('\n'));
      removed += ops.filter((op) => op.sign === '-').length;
      added += ops.filter((op) => op.sign === '+').length;

      console.log(styleText('bold', `\n=== ${file} [${run.name}]`));
      console.log(hunks(ops).join('\n'));
    }
  }

  if (changedRuns === 0) {
    console.log(
      `без изменений: ${left.label} → ${right.label}, ${files.length} текстов, ${total} прогонов`
    );
  } else {
    console.log(
      `\n${left.label} → ${right.label}: изменились ${changedFiles.size} из ${files.length} текстов, ` +
        `${changedRuns} из ${total} прогонов, строк −${removed} +${added}`
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
