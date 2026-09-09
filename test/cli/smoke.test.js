import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/index.js', import.meta.url));

// `util.promisify(execFile)` with the `input` option hangs on this toolchain (Node 24-26,
// arm64/darwin), so the child's stdin is written directly instead.
function run(args, input) {
  return new Promise((resolveRun, reject) => {
    const child = execFile(process.execPath, [CLI, ...args], (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
      } else {
        resolveRun({ stdout, stderr });
      }
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

test('smoke: pipes stdin through the binary', async () => {
  const { stdout } = await run([], '"Корвин" -- Эрик');
  assert.match(stdout, /«Корвин»/);
  assert.match(stdout, /—/);
});

test('smoke: --version prints a semver line', async () => {
  const { stdout } = await run(['--version']);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});
