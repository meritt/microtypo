import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPOSITORY = join(import.meta.dirname, '../..');
const SCRIPT = join(REPOSITORY, 'scripts/ship-package.sh');
const NAME = '@meritt/microtypo';
const VERSION = '9.9.9';
const SPEC = `${NAME}@${VERSION}`;
const FOREIGN = `sha512-${createHash('sha512').update('Тень').digest('base64')}`;

const packument = (held) => ({
  name: NAME,
  'dist-tags': { latest: VERSION },
  versions: {
    [VERSION]: {
      name: NAME,
      version: VERSION,
      dist: { integrity: held, tarball: `http://127.0.0.1/${VERSION}.tgz` }
    }
  }
});

async function startRegistry({ held = null, lag = 0, refuse = false }) {
  const state = { document: held === null ? null : packument(held), lag, puts: 0 };
  const server = createServer((request, response) => {
    const chunks = [];
    const send = (status, body) =>
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method === 'PUT') {
        state.puts += 1;
        if (refuse) {
          send(403, { error: 'denied' });
          return;
        }
        const { _attachments, ...document } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        state.document = document;
        send(201, { ok: Object.keys(_attachments).length === 1 });
        return;
      }
      if (state.document === null || (state.puts > 0 && state.lag-- > 0)) {
        send(404, { error: 'not found' });
        return;
      }
      send(200, state.document);
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

describe('shipping the package', () => {
  let root;
  let tarball;
  let integrity;
  let environment;
  let sparseCheckout;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'microtypo-ship-'));
    const home = join(root, 'home');
    const source = join(root, 'source');
    sparseCheckout = join(root, 'checkout');
    await mkdir(home);
    await mkdir(source);
    await mkdir(sparseCheckout);
    await copyFile(join(REPOSITORY, 'package.json'), join(sparseCheckout, 'package.json'));
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: NAME, version: VERSION }));
    await writeFile(join(source, 'index.js'), 'export {};\n');
    environment = {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_STATE_HOME: join(home, 'state'),
      CI: 'true'
    };
    await run('pnpm', ['pack', '--pack-destination', root], { cwd: source, env: environment });
    tarball = join(root, `meritt-microtypo-${VERSION}.tgz`);
    integrity = `sha512-${createHash('sha512')
      .update(await readFile(tarball))
      .digest('base64')}`;
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function ship(url, ...flags) {
    try {
      await run('bash', [SCRIPT, tarball, ...flags], {
        cwd: sparseCheckout,
        env: {
          ...environment,
          REGISTRY: url,
          SPEC,
          PNPM_CONFIG__AUTH: JSON.stringify({ [url]: { '@meritt': { authToken: 'stub' } } })
        }
      });
      return 0;
    } catch (error) {
      return error.code;
    }
  }

  for (const [name, setup, flags, code, puts] of [
    ['a first release uploads once', () => ({}), [], 0, 1],
    ['a registry that shows the upload late is waited for', () => ({ lag: 1 }), [], 0, 1],
    ['the same bytes already published are left alone', () => ({ held: integrity }), [], 0, 0],
    ['other bytes under the version fail the release', () => ({ held: FOREIGN }), [], 1, 0],
    ['a refused upload fails the release', () => ({ refuse: true }), [], 1, 1],
    ['a dry run from the sparse checkout uploads nothing', () => ({}), ['--dry-run'], 0, 0]
  ]) {
    test(name, async (t) => {
      const { server, state, url } = await startRegistry(setup());
      t.after(() => server.close());

      assert.equal(await ship(url, ...flags), code);
      assert.equal(state.puts, puts);
    });
  }
});
