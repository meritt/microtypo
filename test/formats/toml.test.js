import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parse } from 'smol-toml';

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

  test('inline array with a string value plus a comment: values typeset, comment verbatim', () => {
    const src = 'a = [ "Амбер - Тень", # Козырь\n "Корвин" ]';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `a = [ "Амбер${NBSP}— Тень", # Козырь\n "Корвин" ]`);
    assert.equal(scanToml(src).length, 2);
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

  // A header names a path through the tables already open, so a leading segment that names an array
  // of tables means that array's current element: resolved against the document root, these paths
  // name tables no pointer to the document can reach.
  test('a header under an array of tables carries its element index', () => {
    const src = '[[posts]]\n[posts.meta]\ntitle = "Корвин - Эрик"';

    assert.deepEqual(parse(src).posts[0].meta, { title: 'Корвин - Эрик' });
    assert.equal(
      microtypo(src, { input: { format: 'toml', fields: ['/posts/0/meta/title'] } }),
      `[[posts]]\n[posts.meta]\ntitle = "Корвин${NBSP}— Эрик"`
    );
  });

  test('a new parent element starts the arrays nested under it over', () => {
    const src =
      '[[posts]]\n[[posts.tags]]\nname = "Арден - лес"\n[[posts]]\n[[posts.tags]]\nname = "Рэбма - город"';

    assert.deepEqual(parse(src).posts[1].tags[0], { name: 'Рэбма - город' });
    assert.equal(
      microtypo(src, { input: { format: 'toml', fields: ['/posts/1/tags/0/name'] } }),
      `[[posts]]\n[[posts.tags]]\nname = "Арден - лес"\n[[posts]]\n[[posts.tags]]\nname = "Рэбма${NBSP}— город"`
    );
  });

  // `[["a.b"]]` is one segment and `[[a.b]]` is two — different arrays, which counting by their
  // dot-joined paths would give one counter. No separator exists that a quoted TOML key cannot itself
  // contain, so the identity has to be the segment list.
  test('a quoted header and a dotted one number their elements apart', () => {
    const src = '[["a.b"]]\nx = "Корвин - Эрик"\n[[a.b]]\nx = "Рэндом - Блейз"';

    assert.equal(
      microtypo(src, { input: { format: 'toml', fields: ['/a/b/0/x'] } }),
      `[["a.b"]]\nx = "Корвин - Эрик"\n[[a.b]]\nx = "Рэндом${NBSP}— Блейз"`
    );

    const swapped = '[[a.b]]\nx = "Корвин - Эрик"\n[["a.b"]]\nx = "Рэндом - Блейз"';

    assert.equal(
      microtypo(swapped, { input: { format: 'toml', fields: ['/a/b/0/x'] } }),
      `[[a.b]]\nx = "Корвин${NBSP}— Эрик"\n[["a.b"]]\nx = "Рэндом - Блейз"`
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

  test('a collection where an inline-table key belongs leaves the document alone', () => {
    const src = 'a = {[1]}';

    assert.equal(microtypo(src, { input: { format: 'toml' } }), src);
  });

  test('a well-formed table header plus trailing comment is accepted', () => {
    const src = '[server] # Колвир\nname = "Амбер - Отражение"';
    const out = microtypo(src, { input: { format: 'toml' } });

    assert.equal(out, `[server] # Колвир\nname = "Амбер${NBSP}— Отражение"`);
  });
});

describe('scanToml spans', () => {
  test('a multiline basic string without a backslash is a span', () => {
    assert.deepEqual(literals('a = """Корвин - Эрик"""'), [
      { text: '"""Корвин - Эрик"""', isKey: false, eligible: true, path: 'a' }
    ]);
  });

  test('a multiline basic string with an escape is not eligible', () => {
    assert.deepEqual(literals('a = """Корвин \\t Эрик"""'), [
      { text: '"""Корвин \\t Эрик"""', isKey: false, eligible: false, path: 'a' }
    ]);
  });

  test('a multiline literal string is always eligible: it has no escapes', () => {
    assert.deepEqual(literals("a = '''Корвин \\t Эрик'''"), [
      { text: "'''Корвин \\t Эрик'''", isKey: false, eligible: true, path: 'a' }
    ]);
  });

  test('an inline array element carries its index in the path', () => {
    assert.deepEqual(literals('arr = [1, 2, "Корвин - Эрик"]'), [
      { text: '"Корвин - Эрик"', isKey: false, eligible: true, path: 'arr.2' }
    ]);
  });

  test('an inline table value carries its key, and a brace inside a string is tolerated', () => {
    const src = 't = { a = "x } y" }\nk = "Корвин - Рэндом"';

    assert.deepEqual(literals(src), [
      { text: '"x } y"', isKey: false, eligible: true, path: 't.a' },
      { text: '"Корвин - Рэндом"', isKey: false, eligible: true, path: 'k' }
    ]);
  });

  test('a nested inline table inside an array indexes then keys', () => {
    assert.deepEqual(literals('a = [{ n = "x" }, "y"]'), [
      { text: '"x"', isKey: false, eligible: true, path: 'a.0.n' },
      { text: '"y"', isKey: false, eligible: true, path: 'a.1' }
    ]);
  });

  test('a multi-line string inside an array is typeset', () => {
    const src = 'a = ["""\nКорвин - раз\n"""]';

    assert.equal(
      microtypo(src, { input: { format: 'toml' } }),
      `a = ["""\nКорвин${NBSP}— раз\n"""]`
    );
  });

  // The three-character delimiter is what may not appear in the result; one or two quotes inside a
  // basic multi-line string are legal TOML and must survive.
  test('quotes inside a multi-line string are kept, a full delimiter refuses the splice', () => {
    assert.equal(
      microtypo('a = """Он крикнул: ""Стой!"" - и тень замерла."""', { input: 'toml' }),
      `a = """Он${NBSP}крикнул: «„Стой!“»${NBSP}— и${NBSP}тень замерла."""`
    );

    const escaped = 'a = """Печать: \\"""Амбер\\""" - указ."""';
    assert.equal(microtypo(escaped, { input: 'toml' }), escaped);
  });

  test('fields select a single array element', () => {
    assert.equal(
      microtypo('a = ["Корвин - раз", "Рэндом - два"]', {
        input: { format: 'toml', fields: ['a.0'] }
      }),
      `a = ["Корвин${NBSP}— раз", "Рэндом - два"]`
    );
  });

  test('a quoted key inside an inline table stays verbatim', () => {
    assert.equal(
      microtypo('a = { "к - люч" = "Корвин - раз" }', { input: { format: 'toml' } }),
      `a = { "к - люч" = "Корвин${NBSP}— раз" }`
    );
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

  test('key with an escape TOML does not have falls back to its raw text', () => {
    const src = '"a\\qc" = "val"';

    assert.deepEqual(literals(src), [
      { text: '"a\\qc"', isKey: true, eligible: false, path: 'a\\qc' },
      { text: '"val"', isKey: false, eligible: true, path: 'a\\qc' }
    ]);
  });

  // The three escapes TOML has and JSON does not make `JSON.parse` throw, and a key that comes back
  // as its own source text names no field a selector can reach. `smol-toml` is the oracle for what
  // each of them means.
  test('a key spelled with a TOML-only escape names the field it decodes to', () => {
    for (const [src, key] of [
      ['"\\U00000074itle" = "Корвин - принц"', 'title'],
      ['"\\x74itle" = "Корвин - принц"', 'title'],
      ['"tit\\u006ce" = "Корвин - принц"', 'title']
    ]) {
      assert.deepEqual(Object.keys(parse(src)), [key], src);
      assert.equal(
        microtypo(src, { input: { format: 'toml', exclude: [key] } }),
        src,
        `exclude did not reach ${key}`
      );
    }
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

  // Silently swallowing the opener would drop every later value from the scan without a word.
  test('unterminated inline array throws instead of skipping the rest of the document', () => {
    assert.throws(
      () => scanToml('trumps = [1, 2\ntitle = "Корвин - принц Амбера"'),
      MicroTypoInputError
    );
    assert.throws(
      () => microtypo('trumps = [1, 2\ntitle = "Корвин - принц"', { input: { format: 'toml' } }),
      MicroTypoInputError
    );
  });

  test('unterminated inline table throws', () => {
    assert.throws(() => scanToml('court = { king = "Оберон"'), MicroTypoInputError);
  });

  test('closed inline collection still typesets the values after it', () => {
    const out = microtypo('trumps = [1, 2]\ntitle = "Корвин - принц"', {
      input: { format: 'toml' }
    });
    assert.equal(out, `trumps = [1, 2]\ntitle = "Корвин${NBSP}— принц"`);
  });

  // A TOML literal string has no escape mechanism at all, so a scalar whose typeset form carries its
  // own wrapping quote can only be left alone.
  test('a scalar that would close its own quote stays verbatim', () => {
    const src = 'roles = ["Ребма”, “admin", "чтец"]';

    assert.equal(microtypo(src, { input: 'toml' }), src);
  });

  test('a literal string keeps its apostrophe and its neighbour still typesets', () => {
    const out = microtypo("path = ['Арден’ лес', 'Ребма - глубина']", { input: 'toml' });

    assert.equal(out, `path = ['Арден’ лес', 'Ребма${NBSP}— глубина']`);
  });

  // Protect-or-reject admits one answer per malformation, and `a = [ 1` and `a = [ 1 }` are the same
  // document spelled two ways.
  describe('an inline collection closes with the bracket it opened', () => {
    for (const src of [
      'a = [ 1 }',
      'a = { x = 1 ]',
      'a = [ "Корвин - принц" }',
      'a = [ [1, 2} ]'
    ]) {
      test(`${src} is rejected`, () => {
        assert.throws(() => microtypo(src, { input: 'toml' }), MicroTypoInputError);
      });
    }

    test('a matched pair is still read', () => {
      assert.equal(
        microtypo('a = [ { x = "Корвин - принц" } ]', { input: 'toml' }),
        `a = [ { x = "Корвин${NBSP}— принц" } ]`
      );
    });
  });
});
