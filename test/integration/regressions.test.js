import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const FLAT = { render: { paragraphs: false } };

describe('structural tokens survive typesetting', () => {
  test('ISO date 2024-01-01 preserved (no dash conversion)', () => {
    const out = microtypo('Возвращение: 2024-01-01.', FLAT);
    assert.ok(out.includes('2024-01-01'), `Got: ${out}`);
    assert.ok(!out.includes('−'), `Got: ${out}`);
    assert.ok(!out.includes('–'), `Got: ${out}`);
  });

  test('phone 8-800-555-35-35 preserved', () => {
    const out = microtypo('Звоните в Амбер 8-800-555-35-35', FLAT);
    assert.ok(out.includes('8-800-555-35-35'), `Got: ${out}`);
    assert.ok(!out.includes('−'), `Got: ${out}`);
    assert.ok(!out.includes('–'), `Got: ${out}`);
  });

  test('inline number range 100-150 → en-dash 100–150', () => {
    const out = microtypo('от 100-150 всадников', FLAT);
    assert.ok(out.includes('100–150'), `Got: ${out}`);
  });
});

test('double-hyphen converts to mdash', () => {
  const out = microtypo('Амбер -- столица', FLAT);
  assert.ok(out.includes('—'), `Got: ${out}`);
  assert.ok(!out.includes('--'), `Got: ${out}`);
});

test('space before ! is removed', () => {
  const out = microtypo('Корвин !', FLAT);
  assert.equal(out, 'Корвин!');
});

describe('abbreviations bind to their neighbours', () => {
  test('до н. э. wrapped in a nowrap span', () => {
    const out = microtypo('Оберон правил в III веке до н. э.', {
      html: true,
      render: { paragraphs: false }
    });

    assert.ok(out.includes('<span style="white-space:nowrap;">'), `Got: ${out}`);
    assert.ok(out.includes('э.</span>'), `Got: ${out}`);
  });

  test('г-н Бенедикт binds the abbreviation to the name with nbsp', () => {
    const out = microtypo('Г-н Бенедикт', FLAT);
    assert.ok(out.includes('Г-н\u{00A0}'), `Got: ${out}`);
  });
});

test('render.hanging=both produces both style and class', () => {
  const typo = new MicroTypo({
    html: true,
    render: { hanging: 'both' },
    rules: { 'hanging.*': true }
  });

  const out = typo.process('путь «Амбер» лежит');
  assert.ok(out.includes('style="margin'), `style missing: ${out}`);
  assert.ok(out.includes('class="oa_'), `class missing: ${out}`);
});

// Asserted here so a future corpus re-bake cannot silence these cross-test regressions.
describe('quote regressions from cross-test snapshot', () => {
  test('REG-1: opening « where a closer is expected is corrected', () => {
    const out = microtypo('Корвин «всякие« знаки', { html: true, render: { paragraphs: false } });
    assert.equal(out, 'Корвин «всякие» знаки');
    assert.ok(!/всякие«/u.test(out), `stray opener survived: ${out}`);
  });

  test('REG-2: closing " after a tag does not flip to « or eat the space', () => {
    const out = microtypo('радио "<a href="http://amber.example">голос Ардена</a>" ддддд', {
      html: true,
      render: { paragraphs: false }
    });
    assert.ok(out.includes(`</a>${'»'}`), `Got: ${out}`);
    assert.ok(!out.includes('</a>ддддд'), `space consumed: ${out}`);
  });
});

describe('a leading byte-order mark', () => {
  const BOM = '\u{FEFF}';

  test('stays first, and the rest is typeset as without it', () => {
    for (const [options, src] of [
      [{}, 'Текст - тире'],
      [{ input: 'html' }, '  <p>Текст - тире</p>'],
      [{ html: true }, 'Текст - "тире"\n\nЕщё'],
      [{ input: 'markdown' }, '# Заголовок - тире\n\n- пункт - тире'],
      [{ input: 'frontmatter' }, '---\na: "Текст - тире"\n---\nТекст - тире'],
      [{ input: 'json' }, '{"a":"Текст - тире"}'],
      [{ input: 'yaml' }, 'a: Текст - тире'],
      [{ input: 'toml' }, 'a = "Текст - тире"'],
      [{ input: 'xml' }, '<a>Текст - тире</a>']
    ]) {
      assert.equal(microtypo(BOM + src, options), BOM + microtypo(src, options), src);
    }
  });

  test('text and html keep it', () => {
    for (const options of [{}, { input: 'html' }]) {
      assert.equal(microtypo(`${BOM}Текст - тире`, options), `${BOM}Текст\u{00A0}— тире`);
    }
  });
});

// The quote cases a client reported against 0.3.1, inputs and expectations as they wrote them.
describe('Yamb: a following block does not change a finished paragraph', () => {
  const config = { input: 'html', html: false };

  for (const { id, source, expected } of [
    {
      id: 'quote-code',
      source: '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<p><code>"x" -- a  b</code></p>',
      expected: '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<p><code>"x" -- a  b</code></p>'
    },
    {
      id: 'quote-caption',
      source:
        '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>',
      expected:
        '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<figure><img src="/x"><figcaption>«Подпись»</figcaption></figure>'
    },
    {
      id: 'quote-trailing-newline',
      source: '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n',
      expected: '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>'
    }
  ]) {
    test(id, () => {
      assert.equal(new MicroTypo(config).process(source), expected);
    });
  }
});
