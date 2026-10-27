import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import YAML from 'yaml';

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

  test('a header bare scalar is typeset like any other prose value', () => {
    const input = '---\ntitle: Хроники Амбера - лучшие\n---\nАмбер';
    const out = microtypo(input, { input: { format: 'frontmatter' } });

    assert.equal(out, `---\ntitle: Хроники Амбера\u{00A0}— лучшие\n---\nАмбер`);
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

  test('a flow header key keeps a colon that separates nothing', () => {
    const input = '---\nmeta: {foo:Корвин - принц, foo:bar: "Арден - лес"}\n---\nРэндом - Блейз';
    const typeset = (selector) =>
      microtypo(input, { input: { format: 'frontmatter', ...selector } });

    assert.equal(
      typeset({}),
      `---\nmeta: {foo:Корвин - принц, foo:bar: "Арден${NBSP}— лес"}\n---\nРэндом${NBSP}— Блейз`
    );
    assert.equal(
      typeset({ exclude: ['/meta/foo:bar'] }),
      `---\nmeta: {foo:Корвин - принц, foo:bar: "Арден - лес"}\n---\nРэндом${NBSP}— Блейз`
    );
  });

  test('header sequence paths run through their key and the item mapping', () => {
    const input =
      '---\ntags:\n- "Корвин - принц"\nitems:\n  - nested:\n      title: "Арден - лес"\n    slug: "Рэндом - брат"\n---\nТекст';
    const typeset = (selector) =>
      microtypo(input, { input: { format: 'frontmatter', ...selector } });

    assert.equal(
      typeset({ exclude: ['/tags/0', '/items/0/slug'] }),
      `---\ntags:\n- "Корвин - принц"\nitems:\n  - nested:\n      title: "Арден${NBSP}— лес"\n    slug: "Рэндом - брат"\n---\nТекст`
    );
    assert.equal(
      typeset({ fields: ['tags.0', 'items.0.slug'] }),
      `---\ntags:\n- "Корвин${NBSP}— принц"\nitems:\n  - nested:\n      title: "Арден - лес"\n    slug: "Рэндом${NBSP}— брат"\n---\nТекст`
    );
  });

  test('a header key is named past its anchor or tag', () => {
    const input = '---\n&a title: "Корвин - принц"\n!!str slug: "Арден - лес"\n---\nТекст';

    assert.equal(
      microtypo(input, { input: { format: 'frontmatter', exclude: ['/title', 'slug'] } }),
      input
    );
    assert.equal(
      microtypo(input, { input: { format: 'frontmatter', fields: ['title'] } }),
      `---\n&a title: "Корвин${NBSP}— принц"\n!!str slug: "Арден - лес"\n---\nТекст`
    );
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

const header = (yaml, selector) =>
  microtypo(`---\n${yaml}\n---\nАмбер`, { input: { format: 'frontmatter', ...selector } });

// The header is YAML like any other, and a selector reaches a value there exactly as it would in a
// document of its own.
describe('a YAML header addresses its values as YAML does', () => {
  const NEXT = 'next: "Эрик - король"';
  const NEXT_TYPESET = `next: "Эрик${NBSP}— король"`;

  test('a value under a key with a non-string tag is kept', () => {
    for (const [yaml, pointer] of [
      [`!!int 0x10: "Корвин - принц"\n${NEXT}`, '/16'],
      [`{!!bool TRUE: "Корвин - принц", ${NEXT}}`, '/true'],
      [`? !!float 1.0\n: "Корвин - принц"\n${NEXT}`, '/1']
    ]) {
      const kept = `---\n${yaml.replace(NEXT, NEXT_TYPESET)}\n---\nАмбер`;

      assert.equal(header(yaml, { exclude: [pointer] }), kept);
      assert.equal(header(yaml, { fields: [pointer] }), `---\n${yaml}\n---\nАмбер`);
    }

    assert.equal(
      header('!!str 0x10: "Корвин - принц"', { fields: ['/0x10'] }),
      `---\n!!str 0x10: "Корвин${NBSP}— принц"\n---\nАмбер`
    );
  });

  test('a key whose name the scanner cannot tell is not the empty key', () => {
    const many = Array.from({ length: 9 }, (_, i) => `/nothing${i}`);

    for (const [yaml, pointer] of [
      [`? !!int |-\n  0x10\n: "Корвин - принц"\n${NEXT}`, '/16'],
      [`? &a\n  !!int\n  >-\n    0x10\n: "Корвин - принц"\n${NEXT}`, '/16'],
      [`? !!null\n: "Корвин - принц"\n${NEXT}`, '/null'],
      [`{ !!null : "Корвин - принц", ${NEXT} }`, '/null']
    ]) {
      const kept = `---\n${yaml.replace(NEXT, NEXT_TYPESET)}\n---\nАмбер`;

      assert.equal(header(yaml, {}), kept.replace('Корвин - принц', `Корвин${NBSP}— принц`));
      assert.equal(header(yaml, { exclude: [pointer] }), kept);
      assert.equal(header(yaml, { exclude: [...many, '/'] }), kept);
      assert.equal(header(yaml, { fields: ['/'] }), `---\n${yaml}\n---\nАмбер`);
      assert.equal(header(yaml, { fields: [...many, '/'] }), `---\n${yaml}\n---\nАмбер`);
    }

    for (const yaml of [`"": "Корвин - принц"\n${NEXT}`, `{ !!str : "Корвин - принц", ${NEXT} }`]) {
      const typeset = `---\n${yaml.replace('Корвин - принц', `Корвин${NBSP}— принц`)}\n---\nАмбер`;

      assert.equal(header(yaml, { fields: ['/'] }), typeset);
      assert.equal(header(yaml, { fields: [...many, '/'] }), typeset);
    }
  });

  test('a property on its own line keeps the indentless sequence under its key', () => {
    const yaml = `title:\n  &a\n- "Корвин - принц"\n${NEXT}`;
    const kept = `---\n${yaml.replace(NEXT, NEXT_TYPESET)}\n---\nАмбер`;

    assert.equal(header(yaml, { exclude: ['/title/0'] }), kept);
    assert.equal(header(yaml, { fields: ['/next'] }), kept);
    assert.equal(header(yaml, { fields: ['/0'] }), `---\n${yaml}\n---\nАмбер`);
  });

  test('an explicit key below its property names its entry', () => {
    const yaml = `? &a\n  title\n: "Корвин - принц"\n${NEXT}`;

    assert.equal(
      header(yaml, { exclude: ['/title'] }),
      `---\n${yaml.replace(NEXT, NEXT_TYPESET)}\n---\nАмбер`
    );
    assert.equal(
      header(yaml, { fields: ['/title'] }),
      `---\n${yaml.replace('"Корвин - принц"', `"Корвин${NBSP}— принц"`)}\n---\nАмбер`
    );
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

// LF, CRLF and a CR of its own each end a line, YAML §5.4 and CommonMark §2.1, so each splits the
// header from the body the same way. The header keeps the line endings it was written with.
const ENDINGS = { LF: '\n', CRLF: '\r\n', CR: '\r' };
const ending = (src, nl) => src.replaceAll('\n', nl);
const typeset = (src, selector) =>
  microtypo(src, { input: { format: 'frontmatter', ...selector } });

describe('every line ending splits the header from the body', () => {
  const HEAD =
    '---\n"title": "Корвин - принц"\n\'slug x\': "Арден - лес"\nnext: Эрик - король\n---\n';
  const BODY = 'Тело - "текст"';
  const BODY_TYPESET = `Тело${NBSP}— «текст»`;

  test('a selector reaches the same values, and the rest is kept', () => {
    for (const [selector, title, slug, next] of [
      [{ exclude: ['title'] }, false, true, true],
      [{ exclude: ['/slug x', 'next'] }, true, false, false],
      [{ fields: ['/slug x'] }, false, true, false],
      [{ fields: ['title', 'next'] }, true, false, true]
    ]) {
      const head = HEAD.replace('Корвин - принц', title ? `Корвин${NBSP}— принц` : 'Корвин - принц')
        .replace('Арден - лес', slug ? `Арден${NBSP}— лес` : 'Арден - лес')
        .replace('Эрик - король', next ? `Эрик${NBSP}— король` : 'Эрик - король');

      for (const [name, nl] of Object.entries(ENDINGS)) {
        const out = typeset(ending(HEAD, nl) + BODY, selector);

        assert.equal(out, ending(head, nl) + BODY_TYPESET, `${name} ${JSON.stringify(selector)}`);
      }
    }
  });

  // The reference parser refuses a CR of its own, so what the header means is read once its line
  // endings are LF.
  test('the header means what its LF reading means', () => {
    const lfOut = typeset(HEAD + BODY, { exclude: ['title'] });
    const lfHeader = YAML.parse(splitFrontmatter(lfOut).header);

    for (const nl of Object.values(ENDINGS)) {
      const out = typeset(ending(HEAD, nl) + BODY, { exclude: ['title'] });

      assert.deepEqual(YAML.parse(splitFrontmatter(out).header.replace(/\r\n?/g, '\n')), lfHeader);
    }

    assert.deepEqual(lfHeader, {
      title: 'Корвин - принц',
      'slug x': `Арден${NBSP}— лес`,
      next: `Эрик${NBSP}— король`
    });
  });

  test('delimiter lines, a "..." close and a BOM stay byte-exact', () => {
    for (const nl of Object.values(ENDINGS)) {
      for (const src of [
        `---\ntitle: "Корвин - принц"\n...\n${BODY}`,
        `\u{FEFF}---\ntitle: "Корвин - принц"\n---\n${BODY}`,
        `---\n---\n${BODY}`
      ]) {
        const expected = ending(src.replace('Корвин - принц', `Корвин${NBSP}— принц`), nl).replace(
          BODY,
          BODY_TYPESET
        );

        assert.equal(typeset(ending(src, nl)), expected, JSON.stringify(ending(src, nl)));
      }
    }
  });

  test('code in the body stays protected with the line endings it was written with', () => {
    const code = '```\nКод - "x"\n```';

    for (const nl of Object.values(ENDINGS)) {
      const out = typeset(ending(`---\ntitle: x\n---\n${code}\n${BODY}`, nl));

      assert.ok(out.startsWith(ending(`---\ntitle: x\n---\n${code}`, nl)), JSON.stringify(out));
      assert.ok(out.endsWith(BODY_TYPESET), JSON.stringify(out));
    }
  });

  test('a CR splits the parts as LF does', () => {
    assert.deepEqual(splitFrontmatter('---\ra: 1\r---\rТело'), {
      open: '---',
      header: 'a: 1\r',
      close: '---',
      body: 'Тело',
      headerStart: 4,
      bodyStart: 13
    });
    assert.equal(splitFrontmatter('---\ra: 1\r\n---\nТело').body, 'Тело');
    assert.equal(splitFrontmatter('---\ra: "Корвин - Эрик"\rАмбер')?.malformed, true);
    assert.equal(splitFrontmatter('---x\ra: 1\r---\rТело'), null);
    assert.throws(() => typeset('---\ra: "Корвин - Эрик"\rАмбер'), MicroTypoInputError);
  });
});
