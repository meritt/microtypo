import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const CLI = join(import.meta.dirname, '../../src/cli/index.js');

function run(args, input) {
  const pending = promisify(execFile)(process.execPath, [CLI, ...args]);
  pending.child.stdin.end(input);
  return pending;
}

test('smoke: pipes stdin through the binary', async () => {
  const { stdout } = await run([], '"Корвин" -- Эрик');
  assert.match(stdout, /«Корвин»/);
  assert.match(stdout, /—/);
});
