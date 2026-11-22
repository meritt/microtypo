import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MicroTypo } from '../../src/index.js';

const CLI = join(import.meta.dirname, '../../src/cli/index.js');
const run = (args, input = '', cwd = process.cwd()) =>
  spawnSync(process.execPath, [CLI, ...args], {
    input,
    cwd,
    encoding: 'utf8',
    maxBuffer: 20_000_000
  });

test('CLI accepts its 5M default while library retains 30K and explicit limits win', () => {
  const text = 'x'.repeat(30_001);
  assert.throws(() => new MicroTypo().process(text), { code: 'ERR_MICROTYPO_INPUT' });
  const accepted = run([], text);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, text);
  assert.equal(run(['--max-input', '30000'], text).status, 1);
  assert.equal(run(['--set', 'presets=false'], 'x'.repeat(5_000_001)).status, 1);
});

test('check lists each input-coordinate edit, exits 1 for changes and never rewrites files', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-cli-'));
  const text = 'Текст\n"Амбер"\n';
  await writeFile(join(dir.path, 'draft.md'), text);
  const result = run(['--check', 'draft.md'], '', dir.path);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, 'draft.md:2:1\ndraft.md:2:7\n');
  assert.equal(await readFile(join(dir.path, 'draft.md'), 'utf8'), text);
  assert.equal(run(['--check'], 'Амбер\n', dir.path).status, 0);
  for (const flags of [
    ['--check', '--write', 'draft.md'],
    ['--diff', '--check'],
    ['--diff', '-o', 'out']
  ]) {
    assert.equal(run(flags, text, dir.path).status, 2);
  }
});

test('diff emits an applicable unified patch and keeps the final newline distinction', () => {
  const result = run(['--diff'], '"Амбер"');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    '--- a/<stdin>\n+++ b/<stdin>\n@@ -1,1 +1,1 @@\n-"Амбер"\n\\ No newline at end of file\n+«Амбер»\n\\ No newline at end of file\n'
  );
  assert.equal(run(['--diff'], 'Амбер\n').stdout, '');
});

test('explain keeps normal output and writes deterministic rule diagnostics to stderr', () => {
  const result = run(['--explain'], '"Амбер"');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '«Амбер»');
  const explanation = JSON.parse(result.stderr);
  assert.equal(explanation.file, '<stdin>');
  assert.ok(explanation.trace.some(({ rule, count }) => rule === 'quote.open' && count === 1));
  assert.equal(run(['--explain'], 'Амбер').stderr, '{"file":"<stdin>","trace":[]}\n');
});

test('unified diff applies to a path containing spaces and preserves mixed line endings', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-cli-'));
  const filename = 'Черновик текста.md';
  await writeFile(join(dir.path, filename), '"Амбер"\r\n"Тень"');
  const result = run(['--diff', filename], '', dir.path);
  assert.equal(result.status, 0, result.stderr);
  const applied = spawnSync('/usr/bin/patch', ['-p1', '--batch'], {
    cwd: dir.path,
    input: result.stdout,
    encoding: 'utf8'
  });
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.equal(await readFile(join(dir.path, filename), 'utf8'), '«Амбер»\r\n«Тень»');
});

test('unified diff quotes control characters in paths using Git patch syntax', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-cli-'));
  const filename = 'tab\tnewline\nquote"slash\\.md';
  await writeFile(join(dir.path, filename), '"Амбер"\n');
  const result = run(['--diff', filename], '', dir.path);
  assert.equal(result.status, 0, result.stderr);
  const applied = spawnSync('git', ['apply', '-p1'], {
    cwd: dir.path,
    input: result.stdout,
    encoding: 'utf8'
  });
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.equal(await readFile(join(dir.path, filename), 'utf8'), '«Амбер»\n');
});
