import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';

const RESERVED = ['\u{E000}', '\u{E001}', '\u{E100}', '\u{E101}'];
const NBSP = '\u{00A0}';

// An ordinary private-use character: what a reserved one in the input must behave like.
const ORDINARY = '\u{F000}';

const SAMPLES = [
  'Иконка # и "текст" - тут',
  '<p>Глиф # в <code>"коде" - #</code> и <a href="/x#y">ссылке</a></p>',
  'Адрес http://example.com/#/path и почта #user@example.com',
  '# - начало, конец - #',
  '«#» и "#"'
];

const CONFIGS = [
  {},
  { html: true },
  { html: true, entities: true },
  { input: { format: 'html' }, html: true },
  { input: { format: 'markdown' } }
];

describe('reserved characters in the input', () => {
  test('come back where the input had them, typeset as any private-use character', () => {
    for (const config of CONFIGS) {
      const typo = new MicroTypo(config);

      for (const sample of SAMPLES) {
        for (const reserved of RESERVED) {
          const expected = typo
            .process(sample.replaceAll('#', ORDINARY))
            .replaceAll(ORDINARY, reserved);

          assert.equal(
            typo.process(sample.replaceAll('#', reserved)),
            expected,
            `${JSON.stringify(config)} ${JSON.stringify(sample)} U+${reserved.codePointAt(0).toString(16)}`
          );
        }
      }
    }
  });

  test('a text made of nothing but reserved characters is returned unchanged', () => {
    const text = RESERVED.join('');

    assert.equal(microtypo(text), text);
    assert.equal(microtypo(text, { html: true }), `<p>${text}</p>`);
  });

  test('several reserved characters together keep their order and identity', () => {
    const text = `Корвин ${RESERVED[1]}${RESERVED[0]} - ${RESERVED[3]}${RESERVED[2]} Амбер`;

    assert.equal(
      microtypo(text),
      `Корвин ${RESERVED[1]}${RESERVED[0]}${NBSP}— ${RESERVED[3]}${RESERVED[2]} Амбер`
    );
  });

  test('a reserved character decoded from a JSON escape is kept', () => {
    const out = microtypo('{"a":"\\uE000 - тут"}', { input: { format: 'json' } });

    assert.equal(JSON.parse(out).a, `${RESERVED[0]}${NBSP}— тут`);
  });

  test('structured values keep them too, where one look at the document decides', () => {
    const cases = [
      ['yaml', `title: "Иконка ${RESERVED[0]} - тут"\n`],
      // A forged block placeholder next to a vaulted block: unescaped, it restores to `секрет`.
      ['yaml', `title: "<code>секрет</code> ${RESERVED[0]}B0${RESERVED[1]} - тут"\n`],
      ['toml', `title = "Иконка ${RESERVED[2]} - тут"\n`],
      ['toml', `title = "<code>секрет</code> ${RESERVED[0]}B0${RESERVED[1]} - тут"\n`],
      ['frontmatter', `---\ntitle: "${RESERVED[1]} - тут"\n---\nТекст ${RESERVED[3]} - тут\n`],
      ['xml', `<p>Иконка ${RESERVED[0]} - тут</p>`]
    ];

    for (const [format, text] of cases) {
      const typo = new MicroTypo({ input: format });
      const expected = typo
        .process(text.replaceAll(/[\u{E000}\u{E001}\u{E100}\u{E101}]/gu, ORDINARY))
        .replaceAll(ORDINARY, () => '#');
      const actual = typo.process(text).replaceAll(/[\u{E000}\u{E001}\u{E100}\u{E101}]/gu, '#');

      assert.equal(actual, expected, format);
      assert.notEqual(typo.process(text), text, `${format} was not typeset`);
    }
  });

  // Only JSON decodes its escapes into the value it typesets; every other format typesets the bytes
  // as written, which is why one look at the document is enough there.
  test('an escaped reserved character outside JSON stays the text it was written as', () => {
    const cases = [
      ['yaml', 'title: "\\uE000B0\\uE001 <code>секрет</code>"\n'],
      ['toml', 'title = "\\uE000B0\\uE001 <code>секрет</code>"\n'],
      ['xml', '<p>&#xE000;B0&#xE001; <code>секрет</code></p>'],
      ['html', '<p>&#57344;B0&#57345; <code>секрет</code></p>'],
      ['markdown', '&#xE000;B0&#xE001; `секрет`']
    ];

    for (const [format, text] of cases) {
      for (const html of [false, true]) {
        const out = new MicroTypo({ input: format, html }).process(text);

        assert.equal(out.match(/секрет/g).length, 1, `${format} html=${html}: ${out}`);
        assert.ok(out.includes('B0'), `${format} html=${html}: ${out}`);
      }
    }
  });

  test('ordinary private-use characters of the input are never taken for a substitute', () => {
    const text = `\u{E002}\u{E003}${RESERVED[0]}\u{E004} - x`;

    assert.equal(microtypo(text), `\u{E002}\u{E003}${RESERVED[0]}\u{E004}${NBSP}— x`);
  });

  test('an input with no free private-use character left is refused', () => {
    let all = '';

    for (let code = 0xe000; code <= 0xf8ff; code++) {
      all += String.fromCodePoint(code);
    }

    assert.throws(
      () => microtypo(all),
      (error) => error instanceof MicroTypoInputError && /private-use/.test(error.message)
    );
  });
});
