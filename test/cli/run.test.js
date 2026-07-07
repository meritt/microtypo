import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { HELP } from '../../src/cli/help.js';
import { run } from '../../src/cli/run.js';

function collector() {
  const chunks = [];
  return {
    isTTY: false,
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    }
  };
}

function stdinFrom(value) {
  const stream = Readable.from([value]);
  stream.isTTY = false;
  return stream;
}

test('stdin to stdout: basic typeset', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run([], {
    stdin: stdinFrom('"Корвин" -- Эрик'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /«Корвин»/);
  assert.match(stdout.text(), /—/);
});

test('--entities emits named entities', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--entities'], {
    stdin: stdinFrom('"Амбер"'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /&laquo;/);
});

test('invalid config exits 2 with a stderr message', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--input', 'chaos'], {
    stdin: stdinFrom('Амбер'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 2);
  assert.match(stderr.text(), /error:/);
});

test('--input markdown protects fenced code while typesetting the rest', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--input', 'markdown'], {
    stdin: stdinFrom('"Корвин"\n\n```\n"Эрик"\n```\n'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /«Корвин»/);
  assert.match(stdout.text(), /```\n"Эрик"\n```/);
});

test('--html / --no-html toggle markup emission', async () => {
  const stdoutOn = collector();
  const stderrOn = collector();
  const codeOn = await run(['--html', '--render', 'paragraphs=true'], {
    stdin: stdinFrom('Корвин идёт в Амбер\n\nЭрик держит трон'),
    stdout: stdoutOn,
    stderr: stderrOn,
    cwd: process.cwd()
  });
  assert.equal(codeOn, 0);
  assert.match(stdoutOn.text(), /<p>/);

  const stdoutOff = collector();
  const stderrOff = collector();
  const codeOff = await run(['--no-html', '--render', 'paragraphs=true'], {
    stdin: stdinFrom('Корвин идёт в Амбер\n\nЭрик держит трон'),
    stdout: stdoutOff,
    stderr: stderrOff,
    cwd: process.cwd()
  });
  assert.equal(codeOff, 0);
  assert.doesNotMatch(stdoutOff.text(), /<p>/);
});

test('full flag set round-trips through parse and mergeConfig without config error', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(
    [
      '--html',
      '--entities',
      '--input',
      'text',
      '--rule',
      'quote.nested=false',
      '--render',
      'nowrap=span',
      '--max-input',
      '50000',
      '--max-ms',
      '2000'
    ],
    { stdin: stdinFrom('"Корвин" -- Эрик'), stdout, stderr, cwd: process.cwd() }
  );
  assert.equal(code, 0);
  assert.equal(stderr.text(), '');
  assert.match(stdout.text(), /&laquo;/);
});

test('oversized input exits 1', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--max-input', '3'], {
    stdin: stdinFrom('Корвин идёт в Амбер'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 1);
});

test('single file to stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'in.txt'), '"Амбер"');
  const stdout = collector();
  const stderr = collector();
  const code = await run(['in.txt'], { stdin: stdinFrom(''), stdout, stderr, cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout.text(), /«Амбер»/);
});

test('--write rewrites the file in place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'in.txt'), '"Амбер"');
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write', 'in.txt'], { stdin: stdinFrom(''), stdout, stderr, cwd: dir });
  assert.equal(code, 0);
  assert.match(await readFile(join(dir, 'in.txt'), 'utf8'), /«Амбер»/);
});

test('--write combined with --output-file exits 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'in.txt'), '"Амбер"');
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write', '--output-file', 'out.txt', 'in.txt'], {
    stdin: stdinFrom(''),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 2);
});

test('multiple files without --write exits 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'a.txt'), 'Корвин');
  await writeFile(join(dir, 'b.txt'), 'Эрик');
  const stdout = collector();
  const stderr = collector();
  const code = await run(['a.txt', 'b.txt'], { stdin: stdinFrom(''), stdout, stderr, cwd: dir });
  assert.equal(code, 2);
});

test('--help prints usage and exits 0', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--help'], { stdin: stdinFrom(''), stdout, stderr, cwd: process.cwd() });
  assert.equal(code, 0);
  assert.equal(stdout.text(), HELP);
});

test('--output-file writes stdin result to a file, nothing to stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--output-file', 'out.txt'], {
    stdin: stdinFrom('"Амбер"'),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 0);
  assert.equal(stdout.text(), '');
  assert.match(await readFile(join(dir, 'out.txt'), 'utf8'), /«Амбер»/);
});

test('--write with no file arguments exits 2', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write'], {
    stdin: stdinFrom('x'),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 2);
  assert.match(stderr.text(), /--write requires file arguments/);
});

test('--output-file with multiple files (no --write) exits 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'a.txt'), 'Корвин');
  await writeFile(join(dir, 'b.txt'), 'Эрик');
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--output-file', 'out.txt', 'a.txt', 'b.txt'], {
    stdin: stdinFrom(''),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 2);
  assert.match(stderr.text(), /multiple files require --write/);
});

test('batch --write leaves every file unchanged when a later one exceeds --max-input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'a.txt'), '"Корвин"');
  await writeFile(join(dir, 'b.txt'), 'x'.repeat(50));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write', '--max-input', '10', 'a.txt', 'b.txt'], {
    stdin: stdinFrom(''),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 1);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), '"Корвин"');
  assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'x'.repeat(50));
});

test('batch --write leaves every file unchanged when a later one fails to process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'a.txt'), '"Корвин"');
  await writeFile(join(dir, 'b.txt'), 'y'.repeat(40));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write', '--max-input', '30', 'a.txt', 'b.txt'], {
    stdin: stdinFrom(''),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 1);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), '"Корвин"');
  assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'y'.repeat(40));
});

test('--write preserves the file mode across the atomic rename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const path = join(dir, 'in.txt');
  await writeFile(path, '"Амбер"');
  await chmod(path, 0o640);
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--write', 'in.txt'], { stdin: stdinFrom(''), stdout, stderr, cwd: dir });
  assert.equal(code, 0);
  const info = await stat(path);
  assert.equal(info.mode & 0o777, 0o640);
  assert.match(await readFile(path, 'utf8'), /«Амбер»/);
});

test('--output-file writes atomically (no stray temp file left behind)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--output-file', 'out.txt'], {
    stdin: stdinFrom('"Амбер"'),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 0);
  assert.deepEqual(await readdir(dir), ['out.txt']);
  assert.match(await readFile(join(dir, 'out.txt'), 'utf8'), /«Амбер»/);
});

// Preserves the existing file's mode, not the default creation mode (0o666 & ~umask).
test('--output-file overwriting an existing file preserves its mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const path = join(dir, 'out.txt');
  await writeFile(path, 'старый Арден');
  await chmod(path, 0o600);
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--output-file', 'out.txt'], {
    stdin: stdinFrom('"Амбер"'),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 0);
  const info = await stat(path);
  assert.equal(info.mode & 0o777, 0o600);
  assert.match(await readFile(path, 'utf8'), /«Амбер»/);
});

// The rename target is a directory, so rename() fails EISDIR after the temp write: no stray temp file, non-zero exit.
test('a write-phase failure leaves no stray .tmp file and exits non-zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await mkdir(join(dir, 'out.txt'));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--output-file', 'out.txt'], {
    stdin: stdinFrom('"Амбер"'),
    stdout,
    stderr,
    cwd: dir
  });
  assert.notEqual(code, 0);
  const entries = await readdir(dir);
  assert.ok(
    !entries.some((name) => name.endsWith('.tmp')),
    `stray temp file left behind: ${entries.join(', ')}`
  );
});

test('an oversized file is rejected without reading it into memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  await writeFile(join(dir, 'huge.txt'), 'z'.repeat(1000));
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--max-input', '10', 'huge.txt'], {
    stdin: stdinFrom(''),
    stdout,
    stderr,
    cwd: dir
  });
  assert.equal(code, 1);
  assert.match(stderr.text(), /error:/);
});

test('oversized stdin is rejected without buffering the whole stream', async () => {
  const stdout = collector();
  const stderr = collector();
  const code = await run(['--max-input', '10'], {
    stdin: stdinFrom('z'.repeat(1000)),
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 1);
});

test('stdin reading stops well before the source is fully drained', async () => {
  let produced = 0;
  async function* chunks() {
    for (let i = 0; i < 1000; i++) {
      produced++;
      yield 'z'.repeat(100);
    }
  }
  const stream = Readable.from(chunks());
  stream.isTTY = false;

  const stdout = collector();
  const stderr = collector();
  const code = await run(['--max-input', '10'], {
    stdin: stream,
    stdout,
    stderr,
    cwd: process.cwd()
  });
  assert.equal(code, 1);
  assert.ok(
    produced < 1000,
    `stream was fully drained (${produced} chunks) instead of stopping early`
  );
});
