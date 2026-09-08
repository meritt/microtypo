import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

let pkg;
let shipped;
let cacheDir;

before(async () => {
  pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  cacheDir = await mkdtemp(join(tmpdir(), 'microtypo-pack-'));
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    env: { ...process.env, npm_config_cache: cacheDir }
  });
  const [{ files }] = JSON.parse(stdout);
  shipped = new Set(files.map((f) => f.path));
});

after(async () => {
  if (cacheDir) {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('the bin and exports entry points ship in the tarball', () => {
  const targets = [pkg.bin.microtypo, ...Object.values(pkg.exports)];
  for (const target of targets) {
    const path = target.replace(/^\.\//, '');
    assert.ok(shipped.has(path), `${target} is an entry point but missing from the tarball`);
  }
});

test('every api/*.md page linked from the README exists in the repo', async () => {
  const readme = await readFile(new URL('../../readme.md', import.meta.url), 'utf8');
  const linked = [
    ...new Set([...readme.matchAll(/\]\((api\/[\w.-]+\.md)(?:#[\w-]*)?\)/g)].map((m) => m[1]))
  ];

  assert.ok(linked.length > 0, 'expected the README to link at least one api/*.md file');
  // The api docs are not shipped, and npm rewrites the readme's relative links to the repo, so each
  // one has to exist on disk.
  for (const doc of linked) {
    await assert.doesNotReject(
      readFile(new URL(`../../${doc}`, import.meta.url), 'utf8'),
      `${doc} is linked from readme.md but missing from the repo`
    );
  }
});

test('only the docs on the package.json allowlist ship', () => {
  const allowedDocs = new Set(pkg.files.filter((f) => f.startsWith('api/')));
  for (const path of shipped) {
    if (path.startsWith('api/')) {
      assert.ok(allowedDocs.has(path), `unexpected doc shipped: ${path}`);
    }
  }
});

test('no dated report leaks into the tarball', () => {
  const dated = [...shipped].filter((f) => /\/\d{4}-\d{2}-\d{2}-/.test(f));
  assert.deepEqual(dated, [], `dated report leaked into the tarball: ${dated.join(', ')}`);
});
