import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { scanJson } from '../../src/input/json.js';

const NBSP = '\u{00A0}';

describe('JSON input: node selection', () => {
  test('typesets every value, keeps keys byte-identical, output re-parses', () => {
    const src = '{"title":"Корвин - принц Амбера","slug":"corwin-amber"}';
    const out = microtypo(src, { input: { format: 'json' } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.title, `Корвин${NBSP}— принц Амбера`);
    assert.equal(parsed.slug, 'corwin-amber');
    assert.ok(out.includes('"title"'), 'key "title" must stay byte-identical');
    assert.ok(out.includes('"slug"'), 'key "slug" must stay byte-identical');
  });

  test('never typesets keys even when the key looks like typesettable content', () => {
    const src = '{"a - b":"x - y"}';
    const out = microtypo(src, { input: { format: 'json' } });
    const parsed = JSON.parse(out);

    assert.ok(out.includes('"a - b"'), 'raw key must survive untouched');
    assert.equal(Object.keys(parsed)[0], 'a - b');
    assert.equal(parsed['a - b'], `x${NBSP}— y`);
  });

  test('exclude removes a path from typesetting, others still typeset', () => {
    const src = '{"title":"Корвин - принц Амбера","slug":"corwin-amber"}';
    const out = microtypo(src, { input: { format: 'json', exclude: ['slug'] } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.slug, 'corwin-amber');
    assert.equal(parsed.title, `Корвин${NBSP}— принц Амбера`);
  });

  test('fields restricts typesetting to only the listed paths', () => {
    const src = '{"title":"Корвин - принц Амбера","slug":"corwin-amber"}';
    const out = microtypo(src, { input: { format: 'json', fields: ['title'] } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.title, `Корвин${NBSP}— принц Амбера`);
    assert.equal(parsed.slug, 'corwin-amber');
  });

  test('bare-key field pattern matches at any depth via *', () => {
    const src = '{"posts":[{"body":"a - b"},{"body":"c"}]}';
    const out = microtypo(src, { input: { format: 'json', fields: ['posts.*.body'] } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.posts[0].body, `a${NBSP}— b`);
    assert.equal(parsed.posts[1].body, 'c');
  });

  test('json pointer selector targets nested path unambiguously, not the literal dotted key', () => {
    const src = '{"profile.name":"Корвин - Эрик","profile":{"name":"Оберон - Дворкин"}}';
    const out = microtypo(src, { input: { format: 'json', fields: ['/profile/name'] } });
    const p = JSON.parse(out);

    assert.equal(p['profile.name'], 'Корвин - Эрик');
    assert.equal(p.profile.name, `Оберон${NBSP}— Дворкин`);
  });

  test('json pointer selector supports * as a single-segment wildcard', () => {
    const src = '{"posts":[{"body":"a - b"},{"body":"c"}]}';
    const out = microtypo(src, { input: { format: 'json', fields: ['/posts/*/body'] } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.posts[0].body, `a${NBSP}— b`);
    assert.equal(parsed.posts[1].body, 'c');
  });

  test('json pointer selector works with exclude too', () => {
    const src = '{"profile.name":"Корвин - Эрик","profile":{"name":"Оберон - Дворкин"}}';
    const out = microtypo(src, { input: { format: 'json', exclude: ['/profile/name'] } });
    const p = JSON.parse(out);

    assert.equal(p.profile.name, 'Оберон - Дворкин');
    assert.equal(p['profile.name'], `Корвин${NBSP}— Эрик`);
  });

  test('large selector sets are bucketed by tail and keep wildcard selectors working', () => {
    const src =
      '{"items":[{"title":"Корвин - Рэндом","body":"Оберон - Дворкин","note":"Амбер - Рэбма"}]}';
    const misses = Array.from({ length: 9 }, (_, i) => `items.*.shadow${i}`);
    const out = microtypo(src, {
      input: {
        format: 'json',
        fields: [...misses, 'items.*.title', '/items/*/title', '/items/*/body', 'items.0.*'],
        exclude: [...misses, 'items.*.note', '/items/*/note']
      }
    });
    const parsed = JSON.parse(out);

    assert.equal(parsed.items[0].title, `Корвин${NBSP}— Рэндом`);
    assert.equal(parsed.items[0].body, `Оберон${NBSP}— Дворкин`);
    assert.equal(parsed.items[0].note, 'Амбер - Рэбма');
  });

  test('typesets and re-escapes escaped quotes inside a value', () => {
    const src = '{"q":"он молвил \\"Амбер\\""}';
    const out = microtypo(src, { input: { format: 'json' } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.q, `он${NBSP}молвил «Амбер»`);
  });

  test('leaves numbers, booleans and null untouched and preserves document whitespace', () => {
    const src = '{\n  "n": 42,\n  "b": true,\n  "z": null,\n  "s": "Амбер"\n}';
    const out = microtypo(src, { input: { format: 'json' } });
    const parsed = JSON.parse(out);

    assert.equal(parsed.n, 42);
    assert.equal(parsed.b, true);
    assert.equal(parsed.z, null);
    assert.ok(out.startsWith('{\n  "n": 42,\n  "b": true,\n  "z": null,\n  "s":'));
  });

  test('keeps JSON values data-safe under entities and html', () => {
    for (const cfg of [{ entities: true }, { html: true }]) {
      const out = microtypo('{"t":"\\"Амбер\\" — истинный"}', {
        input: { format: 'json' },
        ...cfg
      });
      const v = JSON.parse(out).t;

      assert.equal(v, `«Амбер»${NBSP}— истинный`);
      assert.ok(!/[<&]/.test(v.replace(/[«»—]/g, '')), v);
    }
  });

  test('throws on malformed JSON', () => {
    assert.throws(() => microtypo('{"a":"Амбер', { input: { format: 'json' } }));
  });

  test('throws typed error on a scan-balanced but parse-invalid value', () => {
    // Scanner balances by escape count without validating the escape: `\z` scans closed, JSON.parse rejects.
    assert.throws(
      () => microtypo('{"a":"\\z"}', { input: { format: 'json' } }),
      MicroTypoInputError
    );
  });

  test('default text path still trims and typesets non-JSON input', () => {
    const typo = new MicroTypo();
    assert.equal(typo.process('Это "Амбер" -- истина.'), `Это «Амбер»${NBSP}— истина.`);
  });

  describe('whole-document JSON validation', () => {
    for (const bad of ['{"a":"x - y",}', '{"a":"x - y"} Амбер', '{"a":"x" "b":"y"}']) {
      test(`rejects invalid JSON: ${bad}`, () => {
        assert.throws(() => microtypo(bad, { input: { format: 'json' } }), MicroTypoInputError);
      });
    }

    test('accepted JSON output re-parses', () => {
      const out = microtypo('{"a":"x - y"}', { input: { format: 'json' } });
      assert.doesNotThrow(() => JSON.parse(out));
    });
  });
});

describe('JSON input: value edge whitespace is preserved', () => {
  test('preserves a trailing space in a value', () => {
    const out = microtypo('{"a":"x "}', { input: { format: 'json' } });

    assert.equal(out, '{"a":"x "}');
    assert.equal(JSON.parse(out).a, 'x ');
  });

  test('preserves a leading space in a value', () => {
    const out = microtypo('{"a":" x"}', { input: { format: 'json' } });

    assert.equal(out, '{"a":" x"}');
    assert.equal(JSON.parse(out).a, ' x');
  });

  test('preserves a trailing tab in a value', () => {
    const out = microtypo('{"a":"x\\t"}', { input: { format: 'json' } });

    assert.equal(out, '{"a":"x\\t"}');
    assert.equal(JSON.parse(out).a, 'x\t');
  });

  test('preserves both-edge padding and typesets the interior', () => {
    const src = '{"a":"  Корвин - Эрик  "}';
    const out = microtypo(src, { input: { format: 'json' } });

    assert.equal(out, `{"a":"  Корвин${NBSP}— Эрик  "}`);
    assert.equal(JSON.parse(out).a, `  Корвин${NBSP}— Эрик  `);
  });

  test('keeps an all-whitespace value byte-identical', () => {
    const out = microtypo('{"a":"   "}', { input: { format: 'json' } });

    assert.equal(out, '{"a":"   "}');
    assert.equal(JSON.parse(out).a, '   ');
  });

  test('keeps an empty value byte-identical', () => {
    const out = microtypo('{"a":""}', { input: { format: 'json' } });

    assert.equal(out, '{"a":""}');
    assert.equal(JSON.parse(out).a, '');
  });

  test('still collapses interior whitespace, preserving only the edges', () => {
    const out = microtypo('{"a":"x   y"}', { input: { format: 'json' } });

    assert.equal(out, '{"a":"x y"}');
    assert.equal(JSON.parse(out).a, 'x y');
  });
});

describe('scanJson', () => {
  test('classifies keys, values and paths across object, nested object and array', () => {
    const src = '{"title":"Корвин","meta":{"id":"x"},"tags":["a","b"]}';
    const spans = scanJson(src);
    const literals = spans.map((s) => ({
      text: src.slice(s.start, s.end),
      isKey: s.isKey,
      path: s.path
    }));

    assert.deepEqual(literals, [
      { text: '"title"', isKey: true, path: '' },
      { text: '"Корвин"', isKey: false, path: 'title' },
      { text: '"meta"', isKey: true, path: '' },
      { text: '"id"', isKey: true, path: 'meta' },
      { text: '"x"', isKey: false, path: 'meta.id' },
      { text: '"tags"', isKey: true, path: '' },
      { text: '"a"', isKey: false, path: 'tags.0' },
      { text: '"b"', isKey: false, path: 'tags.1' }
    ]);
  });

  test('does not end a string early on an escaped quote', () => {
    const src = '{"a":"он \\"Амбер\\""}';
    const spans = scanJson(src);
    const value = spans.find((s) => !s.isKey);

    assert.equal(src.slice(value.start, value.end), '"он \\"Амбер\\""');
    assert.equal(value.path, 'a');
  });

  test('gives a bare string document the empty path', () => {
    const src = '"Амбер"';
    const spans = scanJson(src);

    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0], { start: 0, end: 7, isKey: false, path: '', segments: [] });
    assert.equal(src.slice(spans[0].start, spans[0].end), '"Амбер"');
  });

  test('dot-joins nested array-of-object paths with the array index', () => {
    const src = '{"p":[{"b":"x"}]}';
    const spans = scanJson(src);
    const value = spans.find((s) => !s.isKey && src.slice(s.start, s.end) === '"x"');

    assert.equal(value.path, 'p.0.b');
  });

  test('throws on an unterminated string', () => {
    assert.throws(() => scanJson('{"a":"Амбер'), MicroTypoInputError);
  });

  test('throws on an unbalanced closing bracket', () => {
    assert.throws(() => scanJson('}'), MicroTypoInputError);
  });

  test('throws on an unclosed object', () => {
    assert.throws(() => scanJson('{"a":"b"'), MicroTypoInputError);
  });
});

describe('JSON key/value escape errors', () => {
  test('rejects an invalid escape in a key', () => {
    assert.throws(() => microtypo('{"\\x": "Амбер"}', { input: 'json' }), MicroTypoInputError);
  });

  test('rejects an invalid escape in a value', () => {
    assert.throws(() => microtypo('{"k": "\\x"}', { input: 'json' }), MicroTypoInputError);
  });
});
