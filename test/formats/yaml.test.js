import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo } from '../../src/index.js';
import { scanYaml } from '../../src/input/yaml.js';

const NBSP = '\u{00A0}';

const literals = (src) =>
  scanYaml(src).map((s) => ({
    text: src.slice(s.start, s.end),
    isKey: s.isKey,
    eligible: s.eligible,
    path: s.path
  }));

describe('YAML typesetting', () => {
  test('quoted values typeset; keys and structure stay verbatim', () => {
    const out = microtypo('title: "Корвин - принц Амбера"\nslug: "korvin-amber"', {
      input: { format: 'yaml' }
    });

    assert.equal(out, `title: "Корвин${NBSP}— принц Амбера"\nslug: "korvin-amber"`);
  });

  test('a bare scalar is skipped, byte-verbatim', () => {
    const src = 'title: Корвин - принц Амбера';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('a single-quoted value is typeset', () => {
    const out = microtypo("t: 'Арден - тропа'", { input: { format: 'yaml' } });

    assert.equal(out, `t: 'Арден${NBSP}— тропа'`);
  });

  test('a single-quoted value with a doubled-quote escape is ineligible', () => {
    const src = "t: 'Корвин'' - тень'";

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('a double-quoted value with a backslash escape is ineligible', () => {
    const src = 't: "Амбер\\nтень - Хаос"';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('keys are never typeset even when quoted and convertible', () => {
    const out = microtypo('"Арден - лес": "Корвин - принц"', { input: { format: 'yaml' } });

    assert.equal(out, `"Арден - лес": "Корвин${NBSP}— принц"`);
  });

  test('sequence items typeset with indexed paths', () => {
    const src = 'items:\n  - "Эрик - король"\n  - "Рэндом"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `items:\n  - "Эрик${NBSP}— король"\n  - "Рэндом"`);

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans.length, 2);
    assert.equal(spans[0].path, 'items.0');
    assert.equal(spans[1].path, 'items.1');
  });

  test('a trailing comment stays verbatim while the value is typeset', () => {
    const out = microtypo('k: "Блейз - огонь"  # Фиона - тень', { input: { format: 'yaml' } });

    assert.equal(out, `k: "Блейз${NBSP}— огонь"  # Фиона - тень`);
  });

  test('a block scalar is skipped whole, byte-verbatim', () => {
    const src = 'desc: |\n  Корвин - принц\n  Эрик - король';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('an unclosed quote is re-scanned forward as one skipped scalar', () => {
    const src = 't: "Оберон - король\nu: "Кейн - принц"';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
    assert.equal(scanYaml(src).length, 0);
  });

  test('a multi-line single-quoted scalar stays verbatim', () => {
    const src = 'a: \'Колвир\nb: "меч - клинок"\'';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
    assert.equal(scanYaml(src).length, 0);
  });

  test('a multi-line double-quoted scalar stays verbatim', () => {
    const src = 'a: "Колвир\nb: \'меч - клинок\'"';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
    assert.equal(scanYaml(src).length, 0);
  });

  test('a three-line single-quoted scalar stays verbatim across all lines', () => {
    const src = 'a: \'Колвир\nБенедикт: "ложь - тень"\nконец\'';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
    assert.equal(scanYaml(src).length, 0);
  });

  test('a single-line quoted value after a multi-line scalar still typesets', () => {
    const src = "a: 'Колвир\nгора - вершина'\nb: 'Арден - лес'";
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `a: 'Колвир\nгора - вершина'\nb: 'Арден${NBSP}— лес'`);

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].path, 'b');
  });

  test('an unterminated multi-line quote skips to EOF, no throw', () => {
    const src = "a: 'Колвир\nb: Арден\nc: Оберон";

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
    assert.equal(scanYaml(src).length, 0);
  });

  test('a bare sequence item is skipped but still consumes an index', () => {
    const src = 'items:\n  - Корвин - тень\n  - "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `items:\n  - Корвин - тень\n  - "Эрик${NBSP}— король"`);

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].path, 'items.1');
  });

  test('dedent back to a sibling key resolves the correct path', () => {
    const src = 'a:\n  b: "Корвин - принц"\nc: "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `a:\n  b: "Корвин${NBSP}— принц"\nc: "Эрик${NBSP}— король"`);

    const [bSpan, cSpan] = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(bSpan.path, 'a.b');
    assert.equal(cSpan.path, 'c');
  });

  test('a document marker resets the path for the next document', () => {
    const src = '---\ntitle: "Корвин - принц"\n---\nslug: "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `---\ntitle: "Корвин${NBSP}— принц"\n---\nslug: "Эрик${NBSP}— король"`);

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans[0].path, 'title');
    assert.equal(spans[1].path, 'slug');
  });

  test('a root scalar on the same line as "---" is typeset', () => {
    const out = microtypo('--- "Корвин - принц"', { input: { format: 'yaml' } });

    assert.equal(out, `--- "Корвин${NBSP}— принц"`);
  });

  test('exclude matches an escaped key by its decoded logical path', () => {
    const src = '"a\\u0062": "Корвин - принц"';

    const out = microtypo(src, { input: { format: 'yaml', exclude: ['ab'] } });
    assert.equal(out, src);
  });

  test('CRLF line endings are handled like LF', () => {
    const src = 'title: "Корвин - принц"\r\nslug: "Рэндом"\r\n';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `title: "Корвин${NBSP}— принц"\r\nslug: "Рэндом"\r\n`);
  });

  test('fields and exclude select which paths get typeset', () => {
    const src = 'title: "Корвин - принц"\nslug: "korvin - amber"';

    const byFields = microtypo(src, { input: { format: 'yaml', fields: ['title'] } });
    assert.equal(byFields, `title: "Корвин${NBSP}— принц"\nslug: "korvin - amber"`);

    const byExclude = microtypo(src, { input: { format: 'yaml', exclude: ['slug'] } });
    assert.equal(byExclude, `title: "Корвин${NBSP}— принц"\nslug: "korvin - amber"`);
  });

  test('json pointer selector targets a nested yaml path unambiguously', () => {
    const src = 'profile:\n  name: "Оберон - Дворкин"\nbio: "Корвин - Эрик"';

    const out = microtypo(src, { input: { format: 'yaml', fields: ['/profile/name'] } });
    assert.equal(out, `profile:\n  name: "Оберон${NBSP}— Дворкин"\nbio: "Корвин - Эрик"`);
  });

  test('a bare sequence-item block scalar is skipped; the next item typesets', () => {
    const src = 'items:\n  - |\n    имя: "Корвин - принц"\n  - "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `items:\n  - |\n    имя: "Корвин - принц"\n  - "Эрик${NBSP}— король"`);
    assert.ok(out.includes('имя: "Корвин - принц"'), 'block body stays verbatim');
    assert.ok(!out.slice(0, out.indexOf('Эрик')).includes('—'), 'no em dash before the 2nd item');
  });

  test('a bare folded block scalar is skipped whole, byte-verbatim', () => {
    const src = '- >\n  "меч - клинок" Грейсвандир';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('a block scalar item followed by a later mapping value: value still typesets', () => {
    const src = 'desc:\n  - |\n    "Корвин - принц" тень\ntitle: "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `desc:\n  - |\n    "Корвин - принц" тень\ntitle: "Эрик${NBSP}— король"`);
  });

  test('html mode does not break the quoted scalar', () => {
    const out = microtypo('title: "см. http://simonenko.xyz"', {
      input: { format: 'yaml' },
      html: true
    });

    assert.ok(!out.includes('<a '), out);
    assert.ok(!/title: "[^"]*"[^\n]*"/.test(out), 'no unescaped inner quote');
  });

  test('list-of-objects: a sibling key resolves to the item base path', () => {
    const src = 'posts:\n  - title: "Корвин - принц"\n    slug: "Эрик - король"';

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans.length, 2);
    assert.equal(spans[0].path, 'posts.0.title');
    assert.equal(spans[1].path, 'posts.0.slug');

    const outDefault = microtypo(src, { input: { format: 'yaml' } });
    assert.equal(
      outDefault,
      `posts:\n  - title: "Корвин${NBSP}— принц"\n    slug: "Эрик${NBSP}— король"`
    );

    const outExcluded = microtypo(src, {
      input: { format: 'yaml', exclude: ['posts.0.slug'] }
    });
    assert.equal(
      outExcluded,
      `posts:\n  - title: "Корвин${NBSP}— принц"\n    slug: "Эрик - король"`
    );
  });
});

describe('YAML well-formedness', () => {
  test('an unclosed flow sequence is rejected', () => {
    assert.throws(
      () => microtypo('a: "Корвин"\nb: [', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('an unclosed flow mapping is rejected', () => {
    assert.throws(
      () => microtypo('a: "Корвин"\nb: {', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('an unclosed flow sequence as a bare sequence item is rejected', () => {
    assert.throws(
      () => microtypo('items:\n  - [', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('a closed flow collection is not rejected and stays verbatim', () => {
    const src = 'a: [1, 2]\nb: "Корвин - принц"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `a: [1, 2]\nb: "Корвин${NBSP}— принц"`
    );
  });

  test('a closed multi-line flow collection is not rejected', () => {
    const src = 'a: [\n  1,\n  2\n]\nb: "Корвин - принц"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `a: [\n  1,\n  2\n]\nb: "Корвин${NBSP}— принц"`
    );
  });

  test('a bracket inside a quoted string does not miscount depth', () => {
    const src = 'a: [1, "тень]свет", 2]\nb: "Корвин - принц"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `a: [1, "тень]свет", 2]\nb: "Корвин${NBSP}— принц"`
    );
  });

  test('a flow collection unclosed after a bracketed string is rejected', () => {
    assert.throws(
      () => microtypo('a: [1, "тень]свет"', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('trailing tokens after a quoted mapping value are rejected', () => {
    assert.throws(
      () => microtypo('k: "Корвин - принц" Грейсвандир', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('trailing tokens after a bare quoted sequence item are rejected', () => {
    assert.throws(
      () => microtypo('items:\n  - "Корвин - принц" Грейсвандир', { input: { format: 'yaml' } }),
      MicroTypoInputError
    );
  });

  test('an unquoted apostrophe inside a flow collection is not rejected', () => {
    const src = "a: [Corwin's, Amber]";

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('a flow collection mixing single- and double-quoted strings still closes', () => {
    const src = `a: ['меч', "щит"]\nb: "Корвин - принц"`;

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `a: ['меч', "щит"]\nb: "Корвин${NBSP}— принц"`
    );
  });

  test('a genuinely unclosed flow sequence is still rejected', () => {
    assert.throws(() => microtypo('a: [', { input: { format: 'yaml' } }), MicroTypoInputError);
  });
});

describe('scanYaml', () => {
  test('quoted key and value classify as isKey true and false', () => {
    const src = '"Арден - лес": "Корвин - принц"';

    assert.deepEqual(literals(src), [
      { text: '"Арден - лес"', isKey: true, eligible: true, path: 'Арден - лес' },
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: 'Арден - лес' }
    ]);
  });

  test('a quoted key with a bare value spans only the key', () => {
    const src = '"Оберон": Корвин из тени';

    assert.deepEqual(literals(src), [
      { text: '"Оберон"', isKey: true, eligible: true, path: 'Оберон' }
    ]);
  });

  test('a bare key and bare value emit no span', () => {
    const src = 'title: Корвин - тень';

    assert.deepEqual(literals(src), []);
  });

  test('a literal block scalar is skipped whole', () => {
    const src = 'desc: |\n  Корвин - принц\n  Эрик - король';

    assert.deepEqual(literals(src), []);
  });

  test('a folded block scalar is skipped whole', () => {
    const src = 'desc: >\n  Корвин - принц\n  Эрик - король';

    assert.deepEqual(literals(src), []);
  });

  test('a bare sequence-item block scalar is skipped', () => {
    const src = '- |\n  Корвин - принц';

    assert.deepEqual(literals(src), []);
  });

  test('a sequence-item block scalar consumes its index', () => {
    const src = 'items:\n  - |\n    Корвин - принц\n  - "Эрик - король"';

    assert.deepEqual(literals(src), [
      { text: '"Эрик - король"', isKey: false, eligible: true, path: 'items.1' }
    ]);
  });

  test('sequence items are indexed under the mapping key path', () => {
    const src = 'items:\n  - "Корвин"\n  - "Эрик"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин"', isKey: false, eligible: true, path: 'items.0' },
      { text: '"Эрик"', isKey: false, eligible: true, path: 'items.1' }
    ]);
  });

  test('list-of-objects nests each key under item index and key', () => {
    const src = 'posts:\n  - title: "Корвин"\n    slug: "Эрик"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин"', isKey: false, eligible: true, path: 'posts.0.title' },
      { text: '"Эрик"', isKey: false, eligible: true, path: 'posts.0.slug' }
    ]);
  });

  test('a single-quoted value with a doubled-quote escape is ineligible', () => {
    const src = "t: 'Эрик'' тень'";

    assert.deepEqual(literals(src), [
      { text: "'Эрик'' тень'", isKey: false, eligible: false, path: 't' }
    ]);
  });

  test('a double-quoted value with a backslash escape is ineligible', () => {
    const src = 't: "Амбер\\nтень"';

    assert.deepEqual(literals(src), [
      { text: '"Амбер\\nтень"', isKey: false, eligible: false, path: 't' }
    ]);
  });

  test('a full-line comment produces no span and leaves the next line alone', () => {
    const src = '# Корвин - принц\nk: "Эрик"';

    assert.deepEqual(literals(src), [{ text: '"Эрик"', isKey: false, eligible: true, path: 'k' }]);
  });

  test('a trailing comment does not extend the value span past the closing quote', () => {
    const src = 'k: "Корвин - принц"  # Эрик - король';

    assert.deepEqual(literals(src), [
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: 'k' }
    ]);
  });

  test('a bare item with "://" is not misread as a nested key', () => {
    const src = 'items:\n  - http://simonenko.xyz\n  - "Корвин - принц"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: 'items.1' }
    ]);
  });

  test('a quoted scalar on the "---" marker line is scanned at root', () => {
    const src = '--- "Корвин - принц"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: '' }
    ]);
  });

  test('a quoted scalar on the "..." end-marker line is scanned at root', () => {
    const src = '... "Корвин - принц"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: '' }
    ]);
  });

  test('"---" alone on its line is unaffected', () => {
    const src = '---\ntitle: "Корвин"';

    assert.deepEqual(literals(src), [
      { text: '"Корвин"', isKey: false, eligible: true, path: 'title' }
    ]);
  });

  test('"--- # comment" has no value to scan', () => {
    const src = '--- # Корвин - принц\ntitle: "Эрик"';

    assert.deepEqual(literals(src), [
      { text: '"Эрик"', isKey: false, eligible: true, path: 'title' }
    ]);
  });

  test('an escaped quoted key decodes into the dot-path', () => {
    const src = '"a\\u0062": "Корвин"';

    assert.deepEqual(literals(src), [
      { text: '"a\\u0062"', isKey: true, eligible: false, path: 'ab' },
      { text: '"Корвин"', isKey: false, eligible: true, path: 'ab' }
    ]);
  });

  test("a single-quoted key's doubled-quote escape decodes into the dot-path", () => {
    const src = "'Corwin''s': \"Amber\"";

    assert.deepEqual(literals(src), [
      { text: "'Corwin''s'", isKey: true, eligible: false, path: "Corwin's" },
      { text: '"Amber"', isKey: false, eligible: true, path: "Corwin's" }
    ]);
  });

  test('a key with an unsupported escape falls back to its raw text', () => {
    const src = '"a\\0b": "Корвин"';

    assert.deepEqual(literals(src), [
      { text: '"a\\0b"', isKey: true, eligible: false, path: 'a\\0b' },
      { text: '"Корвин"', isKey: false, eligible: true, path: 'a\\0b' }
    ]);
  });
});
