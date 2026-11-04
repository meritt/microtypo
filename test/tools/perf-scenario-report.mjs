#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PROFILE = join(import.meta.dirname, 'perf-profile.mjs');

function loadRows(argv) {
  const stdout = execFileSync(process.execPath, [PROFILE, ...argv, '--json'], {
    encoding: 'utf8'
  });

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rankRows(rows) {
  return rows
    .filter((row) => row.mode === 'full-instance' || row.mode === 'functional')
    .toSorted((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority.localeCompare(b.priority);
      }

      return b.medianMs - a.medianMs;
    });
}

function print(rows) {
  console.log('# MicroTypo Scenario Performance Report');
  console.log('');
  console.log('| Priority | Workload | Mode | Median ms | P95 ms | Scenario | Tags |');
  console.log('| --- | --- | --- | ---: | ---: | --- | --- |');

  for (const row of rankRows(rows)) {
    console.log(
      `| ${row.priority} | \`${row.workload}\` | \`${row.mode}\` | ${row.medianMs} | ${row.p95Ms} | ${row.scenario} | ${row.tags.join(', ')} |`
    );
  }
}

try {
  print(loadRows(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
