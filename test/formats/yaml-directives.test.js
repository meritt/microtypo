import assert from 'node:assert/strict';
import { test } from 'node:test';

import YAML from 'yaml';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';

test('YAML empty keys address null separately from quoted empty strings', () => {
  for (const [source, path] of [
    ['?\n: Корвин - принц', '/null'],
    [': Корвин - принц', '/null'],
    ['{ : Корвин - принц }', '/null'],
    ['[ ? : Корвин - принц ]', '/0/null'],
    ['"": Корвин - принц', '/'],
    ['{ "": Корвин - принц }', '/']
  ]) {
    const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
    assert.equal(
      new MicroTypo({ input: { format: 'yaml', fields: [path] } }).process(source),
      expected
    );
    assert.equal(
      new MicroTypo({ input: { format: 'yaml', exclude: [path] } }).process(source),
      source
    );
    const other = path === '/' ? '/null' : '/';
    assert.equal(
      new MicroTypo({ input: { format: 'yaml', fields: [other] } }).process(source),
      source
    );
    const parsed = YAML.parse(source, { mapAsMap: true });
    const mapping = Array.isArray(parsed) ? parsed[0] : parsed;
    assert.deepEqual([...mapping.keys()], [path === '/' ? '' : null]);
  }
});

test('YAML TAG directives resolve block and flow key tags', () => {
  for (const prefix of ['!e!', '!!', '!']) {
    const tag = prefix === '!' ? '!str' : `${prefix}str`;
    for (const key of [
      `${tag} 0x10: Корвин - принц`,
      `{ ${tag} "0x10": Корвин - принц }`,
      `[ ${tag} 0x10: Корвин - принц ]`,
      `? ${tag}\n  0x10\n: Корвин - принц`
    ]) {
      const source = `%TAG ${prefix} tag:yaml.org,2002:\n---\n${key}\n`;
      const path = key.startsWith('[') ? '/0/0x10' : '/0x10';
      assert.equal(
        new MicroTypo({ input: { format: 'yaml', fields: [path] } }).process(source),
        source.replace('Корвин - принц', 'Корвин\u{00A0}— принц')
      );
      assert.equal(
        new MicroTypo({ input: { format: 'yaml', exclude: [path] } }).process(source),
        source
      );
      assert.equal(YAML.parse(source)[key.startsWith('[') ? 0 : '0x10'] !== undefined, true);
    }
  }
});

test('YAML tag handle overrides stay document-local and reset between calls', () => {
  const typo = new MicroTypo({ input: { format: 'yaml', fields: ['/0x10'] } });
  const first = '%TAG !! tag:example.com,2026:\n---\n!!str 0x10: Корвин - принц\n';
  const second = '---\n!!str 0x10: Амбер - город\n';
  assert.equal(
    typo.process(`${first}${second}`),
    `${first}${second.replace('Амбер - город', 'Амбер\u{00A0}— город')}`
  );
  assert.equal(typo.process(second), second.replace('Амбер - город', 'Амбер\u{00A0}— город'));
});

test('YAML rejects a duplicate tag handle in one directive block', () => {
  const typo = new MicroTypo({ input: 'yaml' });
  assert.throws(
    () =>
      typo.process('%TAG !e! tag:yaml.org,2002:\n%TAG !e! tag:example.com,2026:\n---\nx: текст'),
    MicroTypoInputError
  );
  assert.equal(typo.process('x: Корвин - принц'), 'x: Корвин\u{00A0}— принц');
});

test('YAML TAG prefixes decode URI escapes and preserve tagged value bodies', () => {
  const typo = new MicroTypo({ input: { format: 'yaml', fields: ['/0x10'] } });
  const source = '%TAG !e! tag:yaml.org,2002:%73\n---\n!e!tr 0x10: Корвин - принц\n';
  assert.equal(typo.process(source), source.replace('Корвин - принц', 'Корвин\u{00A0}— принц'));
  const tagged = '%TAG !e! tag:yaml.org,2002:\n---\nx: !e!str Корвин - принц\n';
  assert.equal(new MicroTypo({ input: 'yaml' }).process(tagged), tagged);
  assert.throws(() => typo.process('%TAG !e!\n---\nx: текст'), MicroTypoInputError);
  assert.throws(() => typo.process('%TAG !e! tag:%XX\n---\n!e!str x: текст'), MicroTypoInputError);
});
