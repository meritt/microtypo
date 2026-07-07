import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { scanToml } from '../../src/input/toml.js';

const NBSP = '\u{00A0}';

const literals = (src) =>
  scanToml(src).map((s) => ({
    text: src.slice(s.start, s.end),
    isKey: s.isKey,
    eligible: s.eligible,
    path: s.path
  }));

describe('TOML quoted-string values', () => {
  test('eligible values are typeset, keys and structure stay byte-verbatim', () => {
    const src = 'title = "Хроники Амбера - истинный мир"\nslug = "amber-chronicles"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `title = "Хроники Амбера${NBSP}— истинный мир"\nslug = "amber-chronicles"`);
  });

  test('literal string: interior typeset, backslash content preserved verbatim', () => {
    const out = microtypo("note = 'Тень C:\\\\x - y'", { input: { format: 'toml' } });

    assert.equal(out, `note = 'Тень C:\\\\x${NBSP}— y'`);
  });

  test('basic string carrying an escape is ineligible: byte-verbatim, not typeset', () => {
    const src = 'a = "Амбер\\nТень - x"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, src);
  });

  test('quoted keys are never typeset even when they contain a spaced dash', () => {
    const out = microtypo('"a - b" = "x - y"', { input: { format: 'toml' } });

    assert.equal(out, `"a - b" = "x${NBSP}— y"`);
  });

  test('comment line is byte-verbatim, the following value is still typeset', () => {
    const out = microtypo('# Амбер - Тень\nk = "x - y"', { input: { format: 'toml' } });

    assert.equal(out, `# Амбер - Тень\nk = "x${NBSP}— y"`);
  });

  test('hash and equals inside a value stay put; only the dash is typeset', () => {
    const out = microtypo('k = "a # b = c - d"', { input: { format: 'toml' } });

    assert.equal(out, `k = "a # b = c${NBSP}— d"`);
  });

  test('table header is verbatim, value typeset, path is table.key', () => {
    const src = '[server]\nname = "Амбер - Колвир"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `[server]\nname = "Амбер${NBSP}— Колвир"`);

    const values = scanToml(src).filter((span) => !span.isKey);
    assert.equal(values.length, 1);
    assert.equal(values[0].path, 'server.name');
    assert.equal(values[0].eligible, true);
  });

  test('fields and exclude select which paths get typeset', () => {
    const src = '[server]\nname = "Амбер - Колвир"\nslug = "amber-way - x"';
    const want = `[server]\nname = "Амбер${NBSP}— Колвир"\nslug = "amber-way - x"`;

    assert.equal(microtypo(src, { input: { format: 'toml', fields: ['server.name'] } }), want);
    assert.equal(microtypo(src, { input: { format: 'toml', exclude: ['slug'] } }), want);
  });

  test('numbers, booleans and dates stay untouched; string delimiters intact', () => {
    const src = 'n = 42\nb = true\nd = 2024-01-01\ns = "Корвин - Рэндом"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `n = 42\nb = true\nd = 2024-01-01\ns = "Корвин${NBSP}— Рэндом"`);
  });

  test('apostrophe-bearing comment in a multi-line inline array: no throw, array skipped whole', () => {
    const src = "a = [ # Corwin's\n  1\n]";
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, src);
  });

  test('inline array with a string value plus a comment: no throw, array skipped whole', () => {
    const src = 'a = [ "Амбер - Тень", # Козырь\n "Корвин" ]';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, src);
    assert.equal(scanToml(src).length, 0);
  });

  test('quote-bearing comment in a multi-line inline table: no throw, table skipped whole', () => {
    const src = 'a = { x = 1, # Corwin\'s "card"\n y = 2 }';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, src);
  });

  test('html:true does not break the quoted scalar', () => {
    const out = microtypo('title = "Козырь http://amber.example"', {
      input: { format: 'toml' },
      html: true
    });

    assert.ok(!out.includes('<a '), out);
  });

  test('fields selects only the first array-of-tables entry by its indexed path', () => {
    const src = '[[posts]]\ntitle = "Корвин - Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"';

    const values = scanToml(src).filter((span) => !span.isKey);
    assert.deepEqual(
      values.map((s) => s.path),
      ['posts.0.title', 'posts.1.title']
    );

    const out = microtypo(src, { input: { format: 'toml', fields: ['posts.0.title'] } });
    assert.equal(
      out,
      `[[posts]]\ntitle = "Корвин${NBSP}— Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"`
    );
  });

  test('exclude drops only the second array-of-tables entry by its indexed path', () => {
    const src = '[[posts]]\ntitle = "Корвин - Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"';

    const out = microtypo(src, { input: { format: 'toml', exclude: ['posts.1.title'] } });
    assert.equal(
      out,
      `[[posts]]\ntitle = "Корвин${NBSP}— Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"`
    );
  });

  test('json pointer selector targets one array-of-tables entry unambiguously', () => {
    const src = '[[posts]]\ntitle = "Корвин - Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"';

    const out = microtypo(src, { input: { format: 'toml', fields: ['/posts/0/title'] } });
    assert.equal(
      out,
      `[[posts]]\ntitle = "Корвин${NBSP}— Эрик"\n[[posts]]\ntitle = "Рэндом - Блейз"`
    );
  });

  test('a MicroTypo instance typesets a value like the one-shot call', () => {
    const src = '[server]\nname = "Амбер - Колвир"';
    const cfg = { input: { format: 'toml' } };
    const typo = new MicroTypo(cfg);

    assert.equal(typo.process(src), `[server]\nname = "Амбер${NBSP}— Колвир"`);
    assert.equal(typo.process(src), microtypo(src, cfg));
  });
});

describe('TOML well-formedness guards', () => {
  test('empty dotted key segment is rejected', () => {
    assert.throws(
      () => microtypo('a..b = "x"', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('missing key is rejected', () => {
    assert.throws(() => microtypo('= "x"', { input: { format: 'toml' } }), MicroTypoInputError);
  });

  test('unclosed table header is rejected', () => {
    assert.throws(
      () => microtypo('[server\nname = "x - y"', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('unclosed array-of-tables header is rejected', () => {
    assert.throws(
      () => microtypo('[[posts\ntitle = "x - y"', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('trailing tokens after a quoted value are rejected', () => {
    assert.throws(
      () => microtypo('a = "x - y" Хаос', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('trailing tokens after an inline array value are rejected', () => {
    assert.throws(
      () => microtypo('a = [1, 2] Хаос', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('a well-formed table header plus trailing comment is accepted', () => {
    const src = '[server] # Колвир\nname = "Амбер - Отражение"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `[server] # Колвир\nname = "Амбер${NBSP}— Отражение"`);
  });
});

describe('scanToml spans', () => {
  test('multiline basic string is skipped whole: no span emitted', () => {
    assert.deepEqual(literals('a = """Корвин - Эрик"""'), []);
  });

  test('multiline literal string is skipped whole: no span emitted', () => {
    assert.deepEqual(literals("a = '''Корвин - Эрик'''"), []);
  });

  test('inline array is skipped whole: no span for a string nested inside it', () => {
    assert.deepEqual(literals('arr = [1, 2, "Корвин - Эрик"]'), []);
  });

  test('inline table is skipped whole, a brace inside a nested string is tolerated, scan resumes next line', () => {
    const src = 't = { a = "x } y" }\nk = "Корвин - Рэндом"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин - Рэндом"', isKey: false, eligible: true, path: 'k' }
    ]);
  });

  test('hash and equals inside a value are consumed atomically as one span', () => {
    const src = 'k = "a # b = c - d"';

    assert.deepEqual(literals(src), [
      { text: '"a # b = c - d"', isKey: false, eligible: true, path: 'k' }
    ]);
  });

  test('dotted key path is joined with dots', () => {
    assert.deepEqual(literals('a.b.c = "x"'), [
      { text: '"x"', isKey: false, eligible: true, path: 'a.b.c' }
    ]);
  });

  test('quoted key segment emits its own key span and joins its raw text into the path', () => {
    const src = 'a."b c".d = "val"';

    assert.deepEqual(literals(src), [
      { text: '"b c"', isKey: true, eligible: true, path: 'a.b c.d' },
      { text: '"val"', isKey: false, eligible: true, path: 'a.b c.d' }
    ]);
  });

  test('table header path prefixes subsequent key paths', () => {
    assert.deepEqual(literals('[a.b]\nc = "x"'), [
      { text: '"x"', isKey: false, eligible: true, path: 'a.b.c' }
    ]);
  });

  test('basic string with a backslash escape is ineligible', () => {
    const src = 's = "Амбер\\nТень"';

    assert.deepEqual(literals(src), [
      { text: '"Амбер\\nТень"', isKey: false, eligible: false, path: 's' }
    ]);
  });

  test('repeated array-of-tables header indexes each entry', () => {
    const src = '[[arr]]\nname = "x"\n[[arr]]\nname = "y"';

    assert.deepEqual(literals(src), [
      { text: '"x"', isKey: false, eligible: true, path: 'arr.0.name' },
      { text: '"y"', isKey: false, eligible: true, path: 'arr.1.name' }
    ]);
  });

  test('a third array-of-tables occurrence continues the index', () => {
    const src = '[[arr]]\na = "x"\n[[arr]]\na = "y"\n[[arr]]\na = "z"';

    assert.deepEqual(
      literals(src).map((s) => s.path),
      ['arr.0.a', 'arr.1.a', 'arr.2.a']
    );
  });

  test('distinct array-of-tables headers each start their own index at 0', () => {
    const src = '[[posts]]\na = "x"\n[[people]]\nb = "y"\n[[posts]]\nc = "z"';

    assert.deepEqual(
      literals(src).map((s) => s.path),
      ['posts.0.a', 'people.0.b', 'posts.1.c']
    );
  });

  test('quoted key segment with a unicode escape decodes into the path', () => {
    const src = 'a."b\\u0063d" = "val"';

    assert.deepEqual(literals(src), [
      { text: '"b\\u0063d"', isKey: true, eligible: false, path: 'a.bcd' },
      { text: '"val"', isKey: false, eligible: true, path: 'a.bcd' }
    ]);
  });

  test('literal key segment has no escape processing: raw text is the path', () => {
    const src = 'a.\'b\\u0063d\' = "val"';

    assert.deepEqual(literals(src), [
      { text: "'b\\u0063d'", isKey: true, eligible: true, path: 'a.b\\u0063d' },
      { text: '"val"', isKey: false, eligible: true, path: 'a.b\\u0063d' }
    ]);
  });

  test('key with an escape outside the JSON subset falls back to its raw text', () => {
    const src = '"a\\ec" = "val"';

    assert.deepEqual(literals(src), [
      { text: '"a\\ec"', isKey: true, eligible: false, path: 'a\\ec' },
      { text: '"val"', isKey: false, eligible: true, path: 'a\\ec' }
    ]);
  });

  test('unterminated basic string throws', () => {
    assert.throws(() => scanToml('a = "Корвин'), MicroTypoInputError);
  });

  test('unterminated literal string throws', () => {
    assert.throws(() => scanToml("a = 'Корвин"), MicroTypoInputError);
  });

  test('unterminated multiline string throws', () => {
    assert.throws(() => scanToml('a = """Корвин'), MicroTypoInputError);
  });
});
