#!/usr/bin/env node
// Compares two snapshots written by `perf-profile.mjs --json`:
//   node test/tools/perf-compare.mjs <before.json> <after.json> [--threshold 10] [--floor 0.05]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const USAGE = `Usage: node test/tools/perf-compare.mjs <before.json> <after.json> [options]

Options:
  --threshold <percent>  slowdown that fails the comparison (default: 10)
  --floor <ms>           rows faster than this in both snapshots are timer noise, never a failure
                         (default: 0.05)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    threshold: { type: 'string', default: '10' },
    floor: { type: 'string', default: '0.05' },
    help: { type: 'boolean', default: false }
  }
});

if (values.help || positionals.length !== 2) {
  process.stdout.write(USAGE);
  process.exit(values.help ? 0 : 2);
}

const threshold = Number(values.threshold);
const floor = Number(values.floor);

if (!(threshold >= 0) || !(floor >= 0)) {
  console.error('perf-compare: --threshold and --floor take non-negative numbers');
  process.exit(2);
}

// A scanner row has no mode; its scanner name takes that column.
const keyOf = (row) => `${row.workload}\u{0}${row.mode ?? row.name}`;

function load(file) {
  const rows = new Map();

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    const row = JSON.parse(line);

    rows.set(keyOf(row), row);
  }

  return rows;
}

const before = load(positionals[0]);
const after = load(positionals[1]);
const limit = 1 + threshold / 100;
const table = [['workload', 'mode', 'before', 'after', 'ratio', '']];
let worse = 0;

for (const [key, a] of before) {
  const b = after.get(key);
  const [workload, mode] = key.split('\u{0}');

  if (b === undefined) {
    table.push([workload, mode, a.medianMs.toFixed(3), '—', '—', 'нет во втором']);
    continue;
  }

  const ratio = b.medianMs / a.medianMs;
  const noise = a.medianMs < floor && b.medianMs < floor;
  const flag = ratio > limit ? (noise ? 'шум' : 'хуже') : '';

  if (flag === 'хуже') {
    worse += 1;
  }

  table.push([
    workload,
    mode,
    a.medianMs.toFixed(3),
    b.medianMs.toFixed(3),
    `${ratio.toFixed(2)}×`,
    flag
  ]);
}

for (const [key, b] of after) {
  if (!before.has(key)) {
    const [workload, mode] = key.split('\u{0}');

    table.push([workload, mode, '—', b.medianMs.toFixed(3), '—', 'нет в первом']);
  }
}

const widths = table[0].map((_, column) => Math.max(...table.map((row) => row[column].length)));
const numeric = new Set([2, 3, 4]);

for (const row of table) {
  console.log(
    row
      .map((cell, column) =>
        numeric.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])
      )
      .join('  ')
      .trimEnd()
  );
}

console.log(
  worse === 0
    ? `\nпорог ${threshold}%: медленнее не стало (${before.size} строк, медиана в мс)`
    : `\nпорог ${threshold}%: медленнее ${worse} из ${before.size} строк`
);

process.exitCode = worse === 0 ? 0 : 1;
