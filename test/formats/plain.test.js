import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const config = { html: false, input: { format: 'plain' } };

test('an unclosed angle expression never hides the following plain prose', () => {
  assert.equal(microtypo('если a<b, то "c" - d', config), 'если a<b, то\u{00A0}«c»\u{00A0}— d');
});

for (const [open, close] of [
  ['<code>', '</code>'],
  ['<script>', '</script>'],
  ['<!-- ', ' -->'],
  ['<notg>', '</notg>']
]) {
  test(`plain text reads ${open} literally`, () => {
    assert.equal(
      microtypo(`${open}Корвин - принц${close}`, config),
      `${open}Корвин\u{00A0}— принц${close}`
    );
  });
}

test('plain input still permits the arrow typography rule', () => {
  assert.equal(microtypo('Назад <- сюда', config), 'Назад ← сюда');
});

test('plain input reads angle text even when HTML options are supplied', () => {
  assert.equal(
    microtypo('<code>Корвин - принц</code>', {
      ...config,
      html: true,
      render: { paragraphs: false, breakline: false }
    }),
    '<code>Корвин\u{00A0}— принц</code>'
  );
});

test('HTML and text retain their existing protective reading', () => {
  for (const format of ['html', 'text']) {
    const source = '<code>Корвин - принц</code>';
    assert.equal(microtypo(source, { html: false, input: { format } }), source);
  }
});

test('explicit custom blocks still protect plain source', () => {
  const typo = new MicroTypo(config);
  typo.addSafeBlock({ id: 'custom', open: 'BEGIN', close: 'END' });
  assert.equal(typo.process('BEGINКорвин - принцEND'), 'BEGINКорвин - принцEND');
});

test('plain always returns glyphs with HTML, render and entities options', () => {
  const source = '"Корвин" - принц\nЭрик - король';
  const expected = '«Корвин»\u{00A0}— принц\nЭрик\u{00A0}— король';
  for (const options of [
    { html: true },
    { html: 'on', entities: true, render: { paragraphs: true, breakline: true, autolink: true } },
    { html: 1, entities: 'on', render: { hanging: 'style', nowrap: 'span' } }
  ]) {
    const typo = new MicroTypo({ input: 'plain', ...options });
    assert.equal(typo.process('Текст'), 'Текст');
    const once = typo.process(source);
    assert.equal(once, expected);
    assert.equal(typo.process(once), once);
  }
});

test('text and HTML still create stable paragraphs when HTML output is enabled', () => {
  for (const input of ['text', 'html']) {
    const typo = new MicroTypo({ input, html: true });
    const once = typo.process('Текст');
    assert.equal(once, '<p>Текст</p>');
    assert.equal(typo.process(once), once);
  }
});
