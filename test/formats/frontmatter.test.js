import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo } from '../../src/index.js';
import { splitFrontmatter } from '../../src/input/frontmatter.js';

const NBSP = '\u{00A0}';

describe('frontmatter input: YAML/TOML header + Markdown body', () => {
  test('YAML header + Markdown body: header value typeset, delimiters verbatim, body typeset', () => {
    const input = '---\ntitle: "Хроники Амбера - лучшие"\n---\n\nКорвин помнит Амбер - всегда.';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(
      out,
      `---\ntitle: "Хроники Амбера${NBSP}— лучшие"\n---\nКорвин помнит Амбер${NBSP}— всегда.`
    );
  });

  test('TOML header (+++): header value typeset, body quotes converted to angle quotes', () => {
    const input = '+++\ntitle = "Corwin - Amber"\n+++\n\nКорвин "в Амбере"';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `+++\ntitle = "Corwin${NBSP}— Amber"\n+++\nКорвин «в${NBSP}Амбере»`);
  });

  test('header bare scalar is SKIPPED (YAML safety): byte-verbatim, body still typeset', () => {
    const input = '---\ntitle: Хроники Амбера - лучшие\n---\nАмбер';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, '---\ntitle: Хроники Амбера - лучшие\n---\nАмбер');
  });

  test('body code fence is protected (Markdown safe-blocks registered), header value typeset', () => {
    const input = '---\na: "x"\n---\n```\nКозыри - Отражения\n```\nАмбер - вечен';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `---\na: "x"\n---\n\`\`\`\nКозыри - Отражения\n\`\`\`\nАмбер${NBSP}— вечен`);
  });

  test('fields restricts typesetting to the selected header path', () => {
    const input = '---\ntitle: "Корвин - Эрик"\nslug: "corwin - amber"\n---\nБенедикт - Джерард';
    const out = microtypo(input, { input: { format: 'frontmatter', fields: ['title'] } });

    assert.equal(
      out,
      `---\ntitle: "Корвин${NBSP}— Эрик"\nslug: "corwin - amber"\n---\nБенедикт${NBSP}— Джерард`
    );
  });

  test('exclude removes a header path from typesetting', () => {
    const input = '---\ntitle: "Корвин - Эрик"\nslug: "corwin - amber"\n---\nБенедикт - Джерард';
    const out = microtypo(input, { input: { format: 'frontmatter', exclude: ['slug'] } });

    assert.equal(
      out,
      `---\ntitle: "Корвин${NBSP}— Эрик"\nslug: "corwin - amber"\n---\nБенедикт${NBSP}— Джерард`
    );
  });

  test('json pointer selector targets a nested header path unambiguously', () => {
    const input =
      '---\nprofile:\n  name: "Оберон - Дворкин"\nbio: "Корвин - Эрик"\n---\nБенедикт - Джерард';
    const out = microtypo(input, { input: { format: 'frontmatter', fields: ['/profile/name'] } });

    assert.equal(
      out,
      `---\nprofile:\n  name: "Оберон${NBSP}— Дворкин"\nbio: "Корвин - Эрик"\n---\nБенедикт${NBSP}— Джерард`
    );
  });

  test('no leading frontmatter block: whole document is typeset as a Markdown body', () => {
    const input = 'Корвин идёт Тенями - домой';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `Корвин идёт Тенями${NBSP}— домой`);
    assert.equal(splitFrontmatter(input), null);
  });

  test('YAML close delimiter "..." works like "---"', () => {
    const input = '---\na: "Корвин - Эрик"\n...\nРэндом - Блейз';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `---\na: "Корвин${NBSP}— Эрик"\n...\nРэндом${NBSP}— Блейз`);
  });

  test('delimiters and inter-delimiter newlines stay byte-exact, including CRLF line endings', () => {
    const input = '---\r\ntitle: "Корвин - Эрик"\r\n---\r\n\r\nРэндом - Блейз';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `---\r\ntitle: "Корвин${NBSP}— Эрик"\r\n---\r\nРэндом${NBSP}— Блейз`);
  });

  test('a leading UTF-8 BOM is detected and preserved verbatim in the output', () => {
    const input = '\u{FEFF}---\ntitle: "Корвин - Эрик"\n---\nРэндом - Блейз';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `\u{FEFF}---\ntitle: "Корвин${NBSP}— Эрик"\n---\nРэндом${NBSP}— Блейз`);
  });
});

describe('splitFrontmatter: leading-block detection', () => {
  test('open delimiter not on line 1 returns null (absent, not malformed)', () => {
    assert.equal(splitFrontmatter('\n---\na: 1\n---\n'), null);
  });

  test('no matching close line is reported malformed, not absent', () => {
    assert.equal(splitFrontmatter('---\na: "Корвин - Эрик"\nАмбер без короля')?.malformed, true);
  });

  test('open delimiter as the entire input (no room for a close line) is malformed', () => {
    assert.equal(splitFrontmatter('---')?.malformed, true);
  });

  test('plain text with no delimiter returns null', () => {
    assert.equal(splitFrontmatter('дорога в Амбер'), null);
  });

  test('a "+++" open is only closed by "+++", not "---" or "...": malformed, not absent', () => {
    assert.equal(splitFrontmatter('+++\na = 1\n---\nАмбер')?.malformed, true);
  });

  test('parts reassemble the original source byte-exactly', () => {
    const input = '---\ntitle: "Корвин - Эрик"\n---\n\nРэндом - Блейз';
    const fm = splitFrontmatter(input);

    const rebuilt =
      input.slice(0, fm.headerStart) +
      fm.header +
      input.slice(fm.headerStart + fm.header.length, fm.bodyStart) +
      fm.body;

    assert.equal(rebuilt, input);
  });
});

describe('malformed frontmatter is rejected, not silently reparsed as Markdown', () => {
  test('opener present but no matching close line throws', () => {
    assert.throws(
      () =>
        microtypo('---\ntitle: "Корвин - Эрик"\nРэндом - Блейз', {
          input: { format: 'frontmatter' }
        }),
      MicroTypoInputError
    );
  });

  test('"+++" opener closed only by "---" (wrong close token) throws', () => {
    assert.throws(
      () => microtypo('+++\na = "Корвин - Эрик"\n---\nАмбер', { input: { format: 'frontmatter' } }),
      MicroTypoInputError
    );
  });

  test('opener as the entire input (no room for a close line) throws', () => {
    assert.throws(
      () => microtypo('---', { input: { format: 'frontmatter' } }),
      MicroTypoInputError
    );
  });

  test('no opener at all is NOT malformed: processed as a plain Markdown body', () => {
    assert.doesNotThrow(() => microtypo('Корвин идёт домой', { input: { format: 'frontmatter' } }));
  });
});
