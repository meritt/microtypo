import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtempDisposable, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI = join(import.meta.dirname, '../../src/cli/index.js');
const run = (cwd, args, input = '') =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf8' });

test('extension inference protects Markdown code and JSON keys; explicit formats take precedence', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await writeFile(join(dir.path, 'draft.md'), '`"код"` и "Амбер"\r\n');
  await writeFile(join(dir.path, 'data.json'), '{"a - b":"Корвин - Эрик"}\n');
  assert.equal(run(dir.path, ['draft.md']).stdout, '`"код"` и\u00A0«Амбер»\r\n');
  assert.equal(run(dir.path, ['data.json']).stdout, '{"a - b":"Корвин\u00A0— Эрик"}\n');
  assert.equal(run(dir.path, ['--input', 'text', 'draft.md']).stdout, '`«код»` и\u00A0«Амбер»\r\n');
  const stdin = run(dir.path, ['--stdin-filepath', 'virtual.md'], '`"код"` и "Амбер"\r\n');
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, '`"код"` и\u00A0«Амбер»\r\n');
  assert.equal(run(dir.path, ['--stdin-filepath', 'virtual.md', 'draft.md']).status, 2);
});

test('path overrides resolve from the config directory, merge in order, and yield to flags', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await mkdir(join(dir.path, 'content/nested'), { recursive: true });
  await writeFile(
    join(dir.path, '.microtyporc.json'),
    JSON.stringify({
      input: { placeholders: 'all' },
      overrides: [
        { files: 'content/**/*.md', options: { rules: { 'quote.*': false } } },
        {
          files: ['content/nested/*.md'],
          exclude: '**/skip.md',
          options: { rules: { 'quote.*': true } }
        }
      ]
    })
  );
  const cwd = join(dir.path, 'content/nested');
  const text = '`"код"` "Амбер" %s\n';
  assert.equal(run(cwd, ['--stdin-filepath', 'post.md'], text).stdout, '`"код"` «Амбер» %s\n');
  assert.equal(run(cwd, ['--stdin-filepath', 'skip.md'], text).stdout, text);
  assert.equal(
    run(cwd, ['--stdin-filepath', 'post.md', '--rule', 'quote.*=false'], text).stdout,
    text
  );
});

test('native traversal and glob diagnostics are sorted, deduplicated and respect ordered ignore negation', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await mkdir(join(dir.path, 'content/nested'), { recursive: true });
  await mkdir(join(dir.path, 'content/ignored'), { recursive: true });
  for (const path of ['b.md', 'a.md', 'nested/c.md', 'ignored/no.md', 'ignored/yes.md']) {
    await writeFile(join(dir.path, 'content', path), '"Амбер"\n');
  }
  await writeFile(join(dir.path, 'content/image.bin'), '\0"Амбер"');
  await writeFile(
    join(dir.path, '.microtypoignore'),
    '# subset\nignored/\n!content/ignored/yes.md\ncontent/nested/*\n'
  );
  const result = run(dir.path, ['--check', 'content', 'content/**/*.md', 'content/a.md']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stdout,
    'content/a.md:1:1\ncontent/a.md:1:7\ncontent/b.md:1:1\ncontent/b.md:1:7\ncontent/ignored/yes.md:1:1\ncontent/ignored/yes.md:1:7\n'
  );
  assert.equal(await readFile(join(dir.path, 'content/a.md'), 'utf8'), '"Амбер"\n');
  const written = run(dir.path, ['--write', 'content/**/*.md']);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(await readFile(join(dir.path, 'content/ignored/no.md'), 'utf8'), '"Амбер"\n');
  assert.equal(await readFile(join(dir.path, 'content/ignored/yes.md'), 'utf8'), '«Амбер»\n');
  assert.equal(run(dir.path, ['--check', 'missing-*.md']).status, 2);
});

test('a directory walk takes markup documents only, and a mask names data and text files', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  const data = {
    'package.json': '{"engines": {"node": ">=26.13.1"}}\n',
    'pnpm-lock.yaml': 'integrity: sha512-35e5\n',
    'requirements.txt': 'yaml>=6.0\n'
  };
  for (const [name, content] of Object.entries(data)) {
    await writeFile(join(dir.path, name), content);
  }
  for (const name of ['a.md', 'b.mdx', 'c.html']) {
    await writeFile(join(dir.path, name), '"Амбер"\n');
  }
  const written = run(dir.path, ['--write', '.']);
  assert.equal(written.status, 0, written.stderr);
  for (const [name, content] of Object.entries(data)) {
    assert.equal(await readFile(join(dir.path, name), 'utf8'), content, name);
  }
  for (const name of ['a.md', 'b.mdx', 'c.html']) {
    assert.equal(await readFile(join(dir.path, name), 'utf8'), '«Амбер»\n', name);
  }
  assert.equal(run(dir.path, ['--check', '*.json']).stdout, 'package.json:1:23\n');
});

test('a walk and a mask pass over a linked file, and a named link is followed', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await mkdir(join(dir.path, 'repo/docs'), { recursive: true });
  await mkdir(join(dir.path, 'elsewhere'), { recursive: true });
  const victim = join(dir.path, 'outside.md');
  await writeFile(victim, 'TOKEN="abc" - да\n');
  await writeFile(join(dir.path, 'repo/docs/intro.md'), '"Амбер"\n');
  await symlink(victim, join(dir.path, 'repo/docs/notes.md'));
  const elsewhere = join(dir.path, 'elsewhere');
  for (const args of [
    ['--write', '../repo'],
    ['--write', '../repo/**/*.md']
  ]) {
    const result = run(elsewhere, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(victim, 'utf8'), 'TOKEN="abc" - да\n', args.join(' '));
  }
  assert.equal(await readFile(join(dir.path, 'repo/docs/intro.md'), 'utf8'), '«Амбер»\n');
  assert.equal(run(join(dir.path, 'repo'), ['--diff', 'docs']).stdout, '');
  assert.equal(run(join(dir.path, 'repo'), ['docs/notes.md']).stdout, 'TOKEN="abc" — да\n');
});

test('invalid overrides fail before a batch writes any file', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await writeFile(join(dir.path, 'a.md'), '"Амбер"');
  for (const overrides of [
    true,
    [{}],
    [{ files: '*.md', options: { bogus: true } }],
    [{ files: 4, options: {} }]
  ]) {
    await writeFile(join(dir.path, '.microtyporc.json'), JSON.stringify({ overrides }));
    assert.equal(run(dir.path, ['--write', 'a.md']).status, 2);
    assert.equal(await readFile(join(dir.path, 'a.md'), 'utf8'), '"Амбер"');
  }
});

test('ignore directory suffix excludes directories rather than same-named files, including stdin paths', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await mkdir(join(dir.path, 'drafts'), { recursive: true });
  await writeFile(join(dir.path, 'drafts/a.md'), '"Амбер"');
  await writeFile(join(dir.path, 'keep.md'), '"Амбер"');
  await writeFile(join(dir.path, '.microtypoignore'), 'drafts/\nkeep.md/\n');
  assert.equal(run(dir.path, ['--check', 'keep.md']).status, 1);
  const stdin = run(dir.path, ['--stdin-filepath', 'drafts/virtual.md', '--explain'], '"Амбер"');
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, '"Амбер"');
  assert.deepEqual(JSON.parse(stdin.stderr), { file: 'drafts/virtual.md', trace: [] });
  for (const pattern of ['!', 'foo\\ bar', '{a,b}', '@(x)']) {
    await writeFile(join(dir.path, '.microtypoignore'), pattern);
    assert.equal(run(dir.path, ['--check', 'keep.md']).status, 2);
  }
});

test('per-path input limits are checked for the whole batch before writing and flags can override them', async () => {
  await using dir = await mkdtempDisposable(join(tmpdir(), 'microtypo-paths-'));
  await writeFile(join(dir.path, 'a.md'), '"Амбер"');
  await writeFile(join(dir.path, 'b.md'), '"Амбер"');
  await writeFile(
    join(dir.path, '.microtyporc.json'),
    JSON.stringify({ overrides: [{ files: 'b.md', options: { maxInputLength: 1 } }] })
  );
  assert.equal(run(dir.path, ['--write', 'a.md', 'b.md']).status, 1);
  assert.equal(await readFile(join(dir.path, 'a.md'), 'utf8'), '"Амбер"');
  const result = run(dir.path, ['--write', '--max-input', '100', 'a.md', 'b.md']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(dir.path, 'a.md'), 'utf8'), '«Амбер»');
  assert.equal(await readFile(join(dir.path, 'b.md'), 'utf8'), '«Амбер»');
});
