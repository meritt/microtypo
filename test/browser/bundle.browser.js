import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { buildBrowser } from '../../scripts/build-browser.mjs';
import * as main from '../../src/index.js';

let dir;
let bundle;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'microtypo-browser-'));
  const file = join(dir, 'microtypo.browser.js');

  await buildBrowser(file);
  bundle = await import(pathToFileURL(file).href);
});

after(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the bundle typesets the corpus exactly as the sources do', async () => {
  const cases = JSON.parse(
    await readFile(new URL('../fixtures/corpus.json', import.meta.url), 'utf8')
  );

  for (const c of cases) {
    for (const extra of [{}, { render: { hanging: 'class' } }]) {
      const config = { html: true, ...c.params, ...extra, entities: c.params?.entities ?? true };

      assert.equal(
        new bundle.MicroTypo(config).process(c.text),
        new main.MicroTypo(config).process(c.text),
        c.title
      );
    }
  }
});

test('the bundle typesets every format and option as the sources do', async () => {
  const fixtures = new URL('../fixtures/big-text/', import.meta.url);
  const texts = [
    'Корвин сказал: "Амбер \u{E000} - тут" http://amber.example/x и т.д.',
    '{"title":"Амбер - лучший"}'
  ];

  const names = await readdir(fixtures);

  for (const name of names.filter((f) => f.endsWith('.input.txt'))) {
    texts.push(await readFile(new URL(name, fixtures), 'utf8'));
  }

  const configs = [
    {},
    { html: true, entities: true },
    { input: 'html', html: true },
    { input: 'markdown' },
    { input: 'json' }
  ];

  for (const config of configs) {
    for (const text of texts) {
      const run = (lib) => {
        try {
          return lib.process(text, { changes: true });
        } catch (error) {
          return error.code;
        }
      };

      assert.deepEqual(run(new bundle.MicroTypo(config)), run(new main.MicroTypo(config)));
    }
  }
});
