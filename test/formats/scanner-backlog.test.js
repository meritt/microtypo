import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

test('CommonMark kind-6 tags interrupt a reference definition paragraph', () => {
  const typo = new MicroTypo({ input: 'markdown' });
  for (const tag of ['search', 'basefont', 'iframe', 'title', 'track', 'p']) {
    assert.equal(
      typo.process(`[Корвин - принц\n<${tag}>\nдальше]: /url`),
      `[Корвин\u{00A0}— принц\n<${tag}>\nдальше]: /url`
    );
  }
  for (const tag of ['span', 'searching', 'divinity']) {
    const source = `[Корвин - принц\n<${tag}>\nдальше]: /url`;
    assert.equal(typo.process(source), source);
  }
});

test('a slash immediately after pre opens a kind-7 block without interrupting prose', () => {
  const typo = new MicroTypo({
    input: 'markdown',
    html: true,
    render: { paragraphs: true, breakline: false }
  });
  assert.equal(
    typo.process('<pre/>\nКорвин - принц\n\nАмбер - город'),
    '<pre/>\nКорвин\u{00A0}— принц\n\n<p>Амбер\u{00A0}— город</p>'
  );
  assert.equal(
    typo.process('Текст\n<pre/>\nКорвин - принц'),
    '<p>Текст\n<pre/>\nКорвин\u{00A0}— принц</p>'
  );
  assert.equal(typo.process('<pre />\nКорвин - принц'), '<pre />\nКорвин - принц');
});

test('reference label length includes spaces before normalization', () => {
  const typo = new MicroTypo({ input: 'markdown' });
  const short = `я${' '.repeat(994)}- да`;
  assert.equal(typo.process(`[${short}]: /url\n\n[${short}]`), `[${short}]: /url\n\n[${short}]`);
  const long = `я${' '.repeat(995)}- да`;
  assert.equal(
    typo.process(`[${long}]: /url\n\n[${long}]`),
    '[я\u{00A0}— да]: /url\n\n[я\u{00A0}— да]'
  );
});

test('a raw HTML block stops where its quote or list container ends', () => {
  for (const prefix of ['> ', '- ', '> - ', '- > ']) {
    for (const tag of ['pre', 'script', 'style', 'textarea']) {
      const typo = new MicroTypo({ input: 'markdown' });
      assert.equal(
        typo.process(`${prefix}<${tag}>\n\nКорвин - принц\n</${tag}>`),
        `${prefix}<${tag}>\n\nКорвин\u{00A0}— принц\n</${tag}>`
      );
    }
  }
  const typo = new MicroTypo({ input: 'markdown' });
  assert.equal(
    typo.process('> <pre>\n> Корвин - принц\n> </pre>'),
    '> <pre>\n> Корвин - принц\n> </pre>'
  );
});

test('reference labels allow 999 characters and reject 1000 before whitespace folding', () => {
  const typo = new MicroTypo({ input: 'markdown', maxInputLength: 100_000 });
  for (const [padding, length] of [
    ['я', 994],
    ['😀', 994]
  ]) {
    for (const extra of [0, 1]) {
      const label = `${padding.repeat(length + extra)} - да`;
      const source = `[${label}]: /url\n\n[${label}]`;
      const expected =
        extra === 0
          ? source
          : `[${padding.repeat(length + extra)}\u{00A0}— да]: /url\n\n[${padding.repeat(length + extra)}\u{00A0}— да]`;
      assert.equal(typo.process(source), expected);
    }
  }
});

test('an overlong second reference label stays ordinary text', () => {
  const typo = new MicroTypo({ input: 'markdown' });
  const label = `${'я'.repeat(995)} - да`;
  assert.equal(typo.process(`[текст][${label}]`), `[текст][${'я'.repeat(995)}\u{00A0}— да]`);
  assert.equal(typo.process('[текст][метка - да]'), '[текст][метка - да]');
});

test('multiline label limits count content spaces and exclude actual quote markers', () => {
  const typo = new MicroTypo({ input: 'markdown' });
  const label = `Корвин\n${' '.repeat(1000)}- принц`;
  const definition = `[${label}]: /url\n\n[Корвин - принц]`;
  assert.ok(typo.process(definition).endsWith('[Корвин\u{00A0}— принц]'));
  const use = typo.process(`[ссылка][Корвин - принц\n${' '.repeat(1000)}хвост]`);
  assert.ok(use.startsWith('[ссылка][Корвин\u{00A0}— принц'), 'an overlong second label is prose');
  const quoted = `> [${'я'.repeat(988)}\n> принц - да]: /url\n>\n> [${'я'.repeat(988)} принц - да]`;
  assert.equal(typo.process(quoted), quoted);
});
