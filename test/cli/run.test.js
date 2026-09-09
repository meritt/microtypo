import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

// The rename target is a directory, so `rename()` fails EISDIR after the temp write: no stray temp
// file, and a non-zero exit.
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

// The engine trims, so without the filter putting it back every --write would drop the file's
// final newline and every rewrite would show up as a diff.
test('a trailing newline on stdin survives to stdout', async () => {
  const stdout = collector();
  const code = await run([], {
    stdin: stdinFrom('"Корвин" -- Эрик\n'),
    stdout,
    stderr: collector(),
    cwd: process.cwd()
  });

  assert.equal(code, 0);
  assert.ok(stdout.text().endsWith('Эрик\n'), JSON.stringify(stdout.text()));
});

test('a CRLF terminator survives as CRLF', async () => {
  const stdout = collector();
  const code = await run([], {
    stdin: stdinFrom('"Корвин" -- Эрик\r\n'),
    stdout,
    stderr: collector(),
    cwd: process.cwd()
  });

  assert.equal(code, 0);
  assert.ok(stdout.text().endsWith('Эрик\r\n'), JSON.stringify(stdout.text()));
});

// The terminator agrees with the body rather than with the input: the pipeline has already rewritten
// the interior endings, so a document whose other lines end in LF must not end in a lone CRLF.
test('a multi-line CRLF document ends the way its own lines do', async () => {
  const stdout = collector();
  const code = await run([], {
    stdin: stdinFrom('"Корвин" -- Эрик\r\nАрден -- лес\r\n'),
    stdout,
    stderr: collector(),
    cwd: process.cwd()
  });

  assert.equal(code, 0);
  assert.ok(!stdout.text().includes('\r'), JSON.stringify(stdout.text()));
  assert.ok(stdout.text().endsWith('лес\n'), JSON.stringify(stdout.text()));
});

// Protected content keeps the endings it was written with, so a document whose every newline is
// still part of a CRLF ends in one too — the terminator follows the body, not the line count.
test('a document whose protected content keeps CRLF ends in CRLF', async () => {
  const stdout = collector();
  const code = await run([], {
    stdin: stdinFrom('<pre>Корвин\r\nЭрик</pre>\r\n'),
    stdout,
    stderr: collector(),
    cwd: process.cwd()
  });

  assert.equal(code, 0);
  assert.equal(stdout.text(), '<pre>Корвин\r\nЭрик</pre>\r\n');
});

test('input without a final newline gains none', async () => {
  const stdout = collector();
  const code = await run([], {
    stdin: stdinFrom('"Корвин" -- Эрик'),
    stdout,
    stderr: collector(),
    cwd: process.cwd()
  });

  assert.equal(code, 0);
  assert.ok(!stdout.text().endsWith('\n'), JSON.stringify(stdout.text()));
});

test('--write keeps the file final newline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'microtypo-eol-'));
  const file = join(dir, 'post.md');
  await writeFile(file, '"Корвин" -- Эрик\n', 'utf8');

  const code = await run(['--write', file], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr: collector(),
    cwd: dir
  });

  assert.equal(code, 0);

  const written = await readFile(file, 'utf8');
  assert.ok(written.endsWith('\n'), JSON.stringify(written));
  assert.ok(written.includes('«Корвин»'), written);
});

// The rewrite replaces a directory entry, so both of these would otherwise succeed and surprise:
// a symlink would become a plain file, and a read-only file would be rewritten anyway.
test('--write follows a symlink and rewrites its target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const target = join(dir, 'real.md');
  const link = join(dir, 'link.md');
  await writeFile(target, 'Корвин - принц\n', 'utf8');
  await symlink(target, link);

  const code = await run(['--write', link], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr: collector(),
    cwd: dir
  });

  assert.equal(code, 0);

  const entry = await lstat(link);
  assert.ok(entry.isSymbolicLink(), 'the link was replaced by a plain file');
  assert.equal(await readlink(link), target);
  assert.equal(await readFile(target, 'utf8'), 'Корвин\u{00A0}— принц\n');
});

test('--output-file follows a symlink and rewrites its target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const target = join(dir, 'real.md');
  const link = join(dir, 'link.md');
  await writeFile(target, 'старое\n', 'utf8');
  await symlink(target, link);

  const code = await run(['-o', link], {
    stdin: stdinFrom('Корвин - принц\n'),
    stdout: collector(),
    stderr: collector(),
    cwd: dir
  });

  assert.equal(code, 0);

  const entry = await lstat(link);
  assert.ok(entry.isSymbolicLink(), 'the link was replaced by a plain file');
  assert.equal(await readFile(target, 'utf8'), 'Корвин\u{00A0}— принц\n');
});

test('--write refuses a read-only file instead of replacing it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const file = join(dir, 'ro.md');
  await writeFile(file, 'Корвин - принц\n', 'utf8');
  await chmod(file, 0o444);

  const stderr = collector();
  const code = await run(['--write', file], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: dir
  });

  assert.equal(code, 1);
  assert.match(stderr.text(), /error:/);
  assert.equal(await readFile(file, 'utf8'), 'Корвин - принц\n');
  await chmod(file, 0o644);
});

test('a read-only file later in the batch leaves every earlier file untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const first = join(dir, 'a.md');
  const second = join(dir, 'b.md');
  await writeFile(first, 'Корвин - принц\n', 'utf8');
  await writeFile(second, 'Рэндом - брат\n', 'utf8');
  await chmod(second, 0o444);

  const code = await run(['--write', first, second], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr: collector(),
    cwd: dir
  });

  assert.equal(code, 1);
  assert.equal(await readFile(first, 'utf8'), 'Корвин - принц\n');
  assert.equal(await readFile(second, 'utf8'), 'Рэндом - брат\n');
  await chmod(second, 0o644);
});

// A temp name carrying the whole basename plus a suffix can push a name a filesystem accepts past
// its length limit, so a perfectly writable file fails with ENAMETOOLONG — and in a batch it fails
// there, after earlier files have already been replaced.
test('a target with a name at the filesystem limit is rewritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const long = `${'a'.repeat(236)}.md`;
  await writeFile(join(dir, long), 'Корвин - принц\n', 'utf8');

  const stderr = collector();
  const code = await run(['--write', long], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: dir
  });

  assert.equal(code, 0, stderr.text());
  assert.match(await readFile(join(dir, long), 'utf8'), /Корвин\u{00A0}— принц/u);
  assert.deepEqual(await readdir(dir), [long]);
});

// The rename needs the directory, not the file, so a writable file in a locked directory would pass
// a file-only guard and only fail once the batch was already writing.
test('a locked directory stops the batch before any file is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const first = join(dir, 'a.md');
  const second = join(dir, 'b.md');
  await writeFile(first, 'Корвин - принц\n', 'utf8');
  await writeFile(second, 'Рэндом - брат\n', 'utf8');
  await chmod(dir, 0o555);

  const code = await run(['--write', first, second], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr: collector(),
    cwd: dir
  });

  await chmod(dir, 0o755);

  assert.equal(code, 1);
  assert.equal(await readFile(first, 'utf8'), 'Корвин - принц\n');
  assert.equal(await readFile(second, 'utf8'), 'Рэндом - брат\n');
});

test('a symlink whose target was deleted is a usage error, not a raw fs message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-'));
  const gone = join(dir, 'gone.md');
  const link = join(dir, 'link.md');
  await writeFile(gone, 'Корвин\n', 'utf8');
  await symlink(gone, link);
  await unlink(gone);

  const stderr = collector();
  const code = await run(['--write', link], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: dir
  });

  assert.equal(code, 2);
  assert.match(stderr.text(), /symlink target does not exist/);
});

// Every target problem leaves as a usage error with exit 2, a missing parent directory included: the
// raw ENOENT of a `realpath` the caller never made carries the exit code for an internal failure.
test('a target under a directory that does not exist is a usage error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'microtypo-cli-'));
  const source = join(dir, 'letter.txt');
  await writeFile(source, 'Корвин вернулся в Амбер');

  const stderr = collector();
  const code = await run(['--output-file', join('nowhere', 'out.txt'), source], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: dir
  });

  assert.equal(code, 2);
  assert.match(stderr.text(), /does not exist/);
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

// Following a link is how a path the caller named inside the working directory reaches anywhere on
// the disk, so an untrusted checkout could aim a rewrite at any file the user owns.
async function hostileTree(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(root, 'repo');
  const outside = join(root, 'outside');
  await mkdir(join(repo, 'docs'), { recursive: true });
  await mkdir(outside, { recursive: true });
  const victim = join(outside, 'keys');
  await writeFile(victim, 'Оберон - король\n', 'utf8');

  return { repo, victim };
}

test('--write refuses a symlink that leaves the working directory', async () => {
  const { repo, victim } = await hostileTree('tg-out-');
  await writeFile(join(repo, 'docs', 'intro.md'), 'Амбер - вечен\n', 'utf8');
  await symlink(victim, join(repo, 'docs', 'notes.md'));

  const stderr = collector();
  const code = await run(['--write', 'docs/intro.md', 'docs/notes.md'], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: repo
  });

  assert.equal(code, 2);
  assert.match(stderr.text(), /outside the working directory/);
  assert.equal(await readFile(victim, 'utf8'), 'Оберон - король\n');
  assert.equal(await readFile(join(repo, 'docs', 'intro.md'), 'utf8'), 'Амбер - вечен\n');
});

test('--write refuses a link on a directory above the file', async () => {
  const { repo, victim } = await hostileTree('tg-outdir-');
  await symlink(dirname(victim), join(repo, 'shadow'));

  const stderr = collector();
  const code = await run(['--write', 'shadow/keys'], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr,
    cwd: repo
  });

  assert.equal(code, 2);
  assert.match(stderr.text(), /outside the working directory/);
  assert.equal(await readFile(victim, 'utf8'), 'Оберон - король\n');
});

test('--output-file refuses a planted link that leaves the working directory', async () => {
  const { repo, victim } = await hostileTree('tg-outfile-');
  await symlink(victim, join(repo, 'out.html'));

  const stderr = collector();
  const code = await run(['--output-file', 'out.html'], {
    stdin: stdinFrom('Корвин - принц\n'),
    stdout: collector(),
    stderr,
    cwd: repo
  });

  assert.equal(code, 2);
  assert.match(stderr.text(), /outside the working directory/);
  assert.equal(await readFile(victim, 'utf8'), 'Оберон - король\n');
});

// A path the caller named outside the tree was never redirected, and reading is not a rewrite.
test('a target named outside the working directory still writes', async () => {
  const { repo, victim } = await hostileTree('tg-named-');

  const code = await run(['--write', victim], {
    stdin: stdinFrom(''),
    stdout: collector(),
    stderr: collector(),
    cwd: repo
  });

  assert.equal(code, 0);
  assert.equal(await readFile(victim, 'utf8'), 'Оберон\u{00A0}— король\n');
});

test('reading through a link that leaves the working directory still works', async () => {
  const { repo, victim } = await hostileTree('tg-read-');
  await symlink(victim, join(repo, 'link.md'));

  const stdout = collector();
  const code = await run(['link.md'], {
    stdin: stdinFrom(''),
    stdout,
    stderr: collector(),
    cwd: repo
  });

  assert.equal(code, 0);
  assert.equal(stdout.text(), 'Оберон\u{00A0}— король\n');
  assert.equal(await readFile(victim, 'utf8'), 'Оберон - король\n');
});
