import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { compactStats, measure, median, percentile } from './perf/measure.mjs';
import { WORKLOADS } from './perf/workloads.mjs';

test('perf measure helpers compute stable descriptive stats', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);

  const result = compactStats(
    measure({
      fn: () => 1 + 1,
      warmup: 1,
      iterations: 2,
      samples: 2
    })
  );

  assert.equal(result.iterations, 2);
  assert.equal(result.samples, 2);
  assert.equal(typeof result.medianMs, 'number');
});

test('perf workloads are named, non-empty, and Amber-lore based', () => {
  const names = new Set();

  for (const workload of WORKLOADS) {
    assert.equal(typeof workload.name, 'string');
    assert.ok(workload.name.length > 0);
    assert.ok(!names.has(workload.name), `duplicate workload ${workload.name}`);
    names.add(workload.name);
    assert.equal(typeof workload.text, 'string');
    assert.ok(workload.text.length > 0);
    assert.equal(typeof workload.config, 'object');
    assert.match(workload.text, /Амбер|Корвин|Оберон|Рэндом|Бенедикт|Дворкин|Арден|Тень/);
  }
});

test('perf workloads declare scenario priority metadata', () => {
  const priorities = new Set();

  for (const workload of WORKLOADS) {
    assert.match(workload.priority, /^P[0-4]$/u, workload.name);
    assert.equal(typeof workload.scenario, 'string', workload.name);
    assert.ok(workload.scenario.length > 0, workload.name);
    assert.ok(Array.isArray(workload.tags), workload.name);
    assert.ok(workload.tags.length > 0, workload.name);
    assert.ok(workload.tags.every((tag) => typeof tag === 'string' && tag.length > 0));
    priorities.add(workload.priority);
  }

  assert.deepEqual([...priorities].toSorted(), ['P0', 'P1', 'P2', 'P3', 'P4']);
});

test('perf workloads include product-order input and output pairs', () => {
  const byName = new Map(WORKLOADS.map((workload) => [workload.name, workload]));

  for (const name of [
    'markdown-prose-original',
    'markdown-prose-html',
    'html-article-original',
    'html-article-rendered',
    'yaml-frontmatter-original',
    'xml-preserve-rendered'
  ]) {
    assert.ok(byName.has(name), name);
  }

  assert.ok(byName.get('markdown-prose-original').tags.includes('original-format'));
  assert.ok(byName.get('markdown-prose-html').tags.includes('html-output'));
  assert.ok(byName.get('html-article-original').tags.includes('original-format'));
  assert.ok(byName.get('html-article-rendered').tags.includes('html-output'));
});

test('perf profile CLI emits parseable JSON lines', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      'test/tools/perf-profile.mjs',
      '--json',
      '--profile',
      'groups',
      '--workload',
      'text-short',
      '--iterations',
      '2',
      '--samples',
      '2',
      '--warmup',
      '1'
    ],
    { encoding: 'utf8' }
  );

  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.ok(rows.length > 3);
  assert.ok(rows.some((row) => row.mode === 'full-instance'));
  assert.ok(rows.some((row) => row.mode === 'group:quote'));
  assert.ok(rows.every((row) => row.workload === 'text-short'));
  assert.ok(rows.every((row) => typeof row.medianMs === 'number'));
});

test('perf profile CLI filters by scenario priority', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      'test/tools/perf-profile.mjs',
      '--json',
      '--profile',
      'summary',
      '--priority',
      'P0',
      '--iterations',
      '2',
      '--samples',
      '2',
      '--warmup',
      '1'
    ],
    { encoding: 'utf8' }
  );

  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.priority === 'P0'));
  assert.ok(rows.every((row) => typeof row.scenario === 'string'));
  assert.ok(
    rows.every(
      (row) =>
        Array.isArray(row.tags) &&
        row.tags.length > 0 &&
        row.tags.every((tag) => typeof tag === 'string')
    )
  );
  assert.ok(rows.some((row) => row.workload === 'text-short'));
  assert.ok(rows.some((row) => row.workload === 'text-medium'));
});

test('perf scenario report ranks profile rows', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      'test/tools/perf-scenario-report.mjs',
      '--profile',
      'summary',
      '--priority',
      'P0',
      '--iterations',
      '2',
      '--samples',
      '2',
      '--warmup',
      '1'
    ],
    { encoding: 'utf8' }
  );

  assert.match(stdout, /^# MicroTypo Scenario Performance Report/mu);
  assert.match(stdout, /\| Priority \| Workload \| Mode \| Median ms \|/u);
  assert.match(stdout, /\| P0 \| `text-/u);
  assert.doesNotMatch(stdout, /`protect-only`/u);
});

test('perf scenario report forces JSON when forwarded args request table output', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      'test/tools/perf-scenario-report.mjs',
      '--profile',
      'summary',
      '--priority',
      'P0',
      '--iterations',
      '1',
      '--samples',
      '1',
      '--warmup',
      '1',
      '--table'
    ],
    { encoding: 'utf8' }
  );

  assert.match(stdout, /^# MicroTypo Scenario Performance Report/mu);
  assert.match(stdout, /\| Priority \| Workload \| Mode \| Median ms \|/u);
  assert.match(stdout, /\| P0 \| `text-/u);
});

test('perf profile CLI reports empty workload and priority intersection', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'test/tools/perf-profile.mjs',
          '--profile',
          'summary',
          '--workload',
          'text-short',
          '--priority',
          'P1',
          '--iterations',
          '1',
          '--samples',
          '1',
          '--warmup',
          '1'
        ],
        { encoding: 'utf8' }
      ),
    (err) => err.stderr === 'No workloads match filters: workload=text-short, priority=P1\n'
  );
});

test('perf profile CLI reports empty scanner priority filter', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'test/tools/perf-profile.mjs',
          '--profile',
          'scanners',
          '--priority',
          'P0',
          '--iterations',
          '1',
          '--samples',
          '1',
          '--warmup',
          '1'
        ],
        { encoding: 'utf8' }
      ),
    (err) => err.stderr === 'No scanner profiles match filters: priority=P0\n'
  );
});

test('perf profile CLI emits scanner rows', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      'test/tools/perf-profile.mjs',
      '--json',
      '--profile',
      'scanners',
      '--iterations',
      '2',
      '--samples',
      '2',
      '--warmup',
      '1'
    ],
    { encoding: 'utf8' }
  );

  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.ok(rows.some((row) => row.profile === 'scanners' && row.name === 'xml.validate'));
  assert.ok(rows.every((row) => typeof row.medianMs === 'number'));
});
