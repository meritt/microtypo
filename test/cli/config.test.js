import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfigFile } from '../../src/cli/config.js';
import { CliUsageError } from '../../src/cli/errors.js';

test('explicit path loads and parses JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'cfg.json'), JSON.stringify({ entities: true }));
  assert.deepEqual(await loadConfigFile('cfg.json', dir), { entities: true });
});

test('auto-discovers .microtyporc.json walking up from cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, '.microtyporc.json'), JSON.stringify({ input: 'markdown' }));
  const nested = join(dir, 'a', 'b');
  await mkdir(nested, { recursive: true });
  assert.deepEqual(await loadConfigFile(undefined, nested), { input: 'markdown' });
});

test('no config file returns an empty object', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-empty-'));
  assert.deepEqual(await loadConfigFile(undefined, dir), {});
});

test('invalid JSON throws CliUsageError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'bad.json'), '{ not json');
  await assert.rejects(() => loadConfigFile('bad.json', dir), CliUsageError);
});

test('a config file that holds no object throws CliUsageError', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-shape-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    ['[]', 'an array'],
    ['true', 'boolean'],
    ['42', 'number']
  ];

  for (const [raw, got] of cases) {
    const path = join(dir, 'cfg.json');
    await writeFile(path, raw);
    await assert.rejects(
      () => loadConfigFile('cfg.json', dir),
      new CliUsageError(`config file must hold an object, got ${got}: ${path}`)
    );
  }
});

test('a null config file stays an empty config', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-null-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'cfg.json'), 'null');
  assert.equal(await loadConfigFile('cfg.json', dir), null);
});

test('missing explicit path throws CliUsageError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await assert.rejects(() => loadConfigFile('nope.json', dir), CliUsageError);
});
