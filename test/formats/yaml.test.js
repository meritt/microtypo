import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import YAML from 'yaml';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { flowScalarSafe, plainScalarSafe, scanYaml } from '../../src/input/yaml.js';

const NBSP = '\u{00A0}';

// The engine is never its own oracle: a real parser says what the document means, before and after.
const parse = (text) => YAML.parse(text);

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

  test('a bare scalar carrying prose is typeset', () => {
    assert.equal(
      microtypo('title: Корвин - принц Амбера', { input: { format: 'yaml' } }),
      `title: Корвин${NBSP}— принц Амбера`
    );
  });

  // The type is decided before the run: a scalar YAML resolves to anything but a string is data,
  // and triads or the time rule would rewrite it into a different type.
  test('a bare scalar that is not a string is left alone', () => {
    for (const src of [
      'n: 100644',
      'd: 2001-12-14',
      't: 190:20:30',
      'ts: 2001-12-14 21:59:43.10 -5',
      'v: 1.2.3',
      'h: 0x1f',
      'e: 1e5',
      'b: no',
      'z: ~',
      'i: .inf'
    ]) {
      assert.equal(microtypo(src, { input: { format: 'yaml' } }), src, src);
    }
  });

  // Everything more-indented after `?` is the key, block scalar included, and a key stays byte-exact.
  test('an explicit key is not typeset, its value is', () => {
    const src = '? |\n  Многострочный\n  ключ -- Лабиринт...\n: "Значение -- Амбер"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.ok(
      out.startsWith('? |\n  Многострочный\n  ключ -- Лабиринт...\n'),
      `key was typeset: ${JSON.stringify(out)}`
    );
    assert.ok(out.endsWith(`: "Значение${NBSP}— Амбер"`), JSON.stringify(out));
  });

  test('a plain explicit key is not typeset either', () => {
    const src = '? Корвин - принц\n: Рэндом - брат';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `? Корвин - принц\n: Рэндом${NBSP}— брат`
    );
  });

  // A `-` in front says nothing about what stands behind it, so the `?` has to be read after the
  // whole marker prefix.
  test('an explicit key behind a sequence marker keeps its whole subtree', () => {
    for (const [src, expected] of [
      [
        '- ? |\n      Корвин - принц\n  : "Арден - лес"',
        `- ? |\n      Корвин - принц\n  : "Арден${NBSP}— лес"`
      ],
      [
        '- - ? |\n        Корвин - принц\n    : "Арден - лес"',
        `- - ? |\n        Корвин - принц\n    : "Арден${NBSP}— лес"`
      ],
      [
        '- ?\n    ["Корвин - принц"]\n  : "Арден - лес"',
        `- ?\n    ["Корвин - принц"]\n  : "Арден${NBSP}— лес"`
      ],
      [
        '- ? {имя: "Корвин - принц"}\n  : "Арден - лес"',
        `- ? {имя: "Корвин - принц"}\n  : "Арден${NBSP}— лес"`
      ],
      [
        '- ? Корвин - принц\n  : "Арден - лес"\n- "Рэбма - город"',
        `- ? Корвин - принц\n  : "Арден${NBSP}— лес"\n- "Рэбма${NBSP}— город"`
      ]
    ]) {
      assert.equal(microtypo(src, { input: { format: 'yaml' } }), expected, src);
    }
  });

  test('an anchored or continued bare scalar stays byte-verbatim', () => {
    for (const src of ['a: &x Корвин - принц', 'a: *x', 'a: Корвин - принц\n  и брат его Рэндом']) {
      const out = microtypo(src, { input: { format: 'yaml' } });

      assert.ok(out.startsWith(src.split('\n')[0]), `first line moved: ${JSON.stringify(out)}`);
    }
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

  test('a block scalar is typeset line by line, indentation untouched', () => {
    const src = 'desc: |\n  Корвин - принц\n  Эрик - король';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `desc: |\n  Корвин${NBSP}— принц\n  Эрик${NBSP}— король`
    );
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

  test('a bare sequence item is typeset and consumes its index', () => {
    const src = 'items:\n  - Корвин - тень\n  - "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `items:\n  - Корвин${NBSP}— тень\n  - "Эрик${NBSP}— король"`);

    const spans = scanYaml(src).filter((s) => !s.isKey);
    assert.equal(spans.length, 2);
    assert.equal(spans[1].path, 'items.1');
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

  // The body is one string, so text that looks like YAML inside it is prose and is typeset as prose.
  test('a bare sequence-item block scalar typesets, and so does the next item', () => {
    const src = 'items:\n  - |\n    имя: "Корвин - принц"\n  - "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(out, `items:\n  - |\n    имя: «Корвин${NBSP}— принц»\n  - "Эрик${NBSP}— король"`);
  });

  // The header, the indentation and the blank lines are the block's structure; only the text of a
  // content line is ever inside a span.
  test('block scalar structure survives every header form', () => {
    for (const [src, expected] of [
      ['a: |-\n  Корвин - принц\n', `a: |-\n  Корвин${NBSP}— принц\n`],
      ['a: |+\n  Корвин - принц\n\n', `a: |+\n  Корвин${NBSP}— принц\n\n`],
      ['a: |2\n   Корвин - принц\n', `a: |2\n   Корвин${NBSP}— принц\n`],
      ['a: |\n  Корвин\n\n  Эрик - брат\n', `a: |\n  Корвин\n\n  Эрик${NBSP}— брат\n`],
      ['a: |\n  Корвин\n    глубже - тут\n', `a: |\n  Корвин\n    глубже${NBSP}— тут\n`],
      // The anchor stands in front of the header; the header behind it is still a header.
      ['a: &x |\n  Корвин - принц\n', `a: &x |\n  Корвин${NBSP}— принц\n`],
      ['a: !!str |\n  Корвин - принц\n', `a: !!str |\n  Корвин${NBSP}— принц\n`]
    ]) {
      assert.equal(microtypo(src, { input: 'yaml' }), expected, src);
    }
  });

  test('a bare folded block scalar typesets', () => {
    const src = '- >\n  "меч - клинок" Грейсвандир';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `- >\n  «меч${NBSP}— клинок» Грейсвандир`
    );
  });

  test('a block scalar item followed by a later mapping value: both typeset', () => {
    const src = 'desc:\n  - |\n    "Корвин - принц" тень\ntitle: "Эрик - король"';
    const out = microtypo(src, { input: { format: 'yaml' } });

    assert.equal(
      out,
      `desc:\n  - |\n    «Корвин${NBSP}— принц» тень\ntitle: "Эрик${NBSP}— король"`
    );
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

// A sequence element may be a mapping written without its braces, and its key is a key: a later
// consumer looks the field up by that string, so only the `:` behind the scalar says which it is.
describe('a compact mapping inside a flow sequence', () => {
  const yaml = { input: { format: 'yaml' } };

  test('the key stays byte-exact and only the value is typeset', () => {
    const src = '[ "Корвин - принц": "Арден - лес" ]';
    const out = microtypo(src, yaml);

    assert.equal(out, `[ "Корвин - принц": "Арден${NBSP}— лес" ]`);
    assert.deepEqual(Object.keys(parse(out)[0]), Object.keys(parse(src)[0]));
    assert.equal(parse(out)[0]['Корвин - принц'], `Арден${NBSP}— лес`);
  });

  test('a key colon on the next line is still a key colon', () => {
    const src = '{ "Корвин - принц"\n: "Арден - лес" }';
    const out = microtypo(src, yaml);

    assert.equal(out, `{ "Корвин - принц"\n: "Арден${NBSP}— лес" }`);
    assert.deepEqual(Object.keys(parse(out)), Object.keys(parse(src)));
  });

  test('every pair of a multi-pair sequence keeps its key', () => {
    const src = '[ "Первый - ключ": "Первое - значение", "Второй - ключ": "Второе - значение" ]';
    const out = microtypo(src, yaml);

    assert.equal(
      out,
      `[ "Первый - ключ": "Первое${NBSP}— значение", "Второй - ключ": "Второе${NBSP}— значение" ]`
    );
    assert.deepEqual(parse(out).map(Object.keys), parse(src).map(Object.keys));
  });

  test('a collection under a compact key keeps the key too', () => {
    const src = '[ "Корвин - принц": ["Арден - лес"] ]';

    assert.equal(microtypo(src, yaml), `[ "Корвин - принц": ["Арден${NBSP}— лес"] ]`);
  });

  test('the value is addressed by index and then by key', () => {
    const src = '[ "Корвин - принц": "Арден - лес" ]';

    assert.equal(
      new MicroTypo({ input: { format: 'yaml', fields: ['0.Корвин - принц'] } }).process(src),
      `[ "Корвин - принц": "Арден${NBSP}— лес" ]`
    );
    assert.equal(
      new MicroTypo({ input: { format: 'yaml', exclude: ['0.Корвин - принц'] } }).process(src),
      src
    );
  });
});

// A plain scalar folds onto the more-indented lines under it and is one value. This scan reads a
// line at a time, so it declines the whole scalar rather than only its first line.
describe('a plain scalar spread over lines', () => {
  const yaml = { input: { format: 'yaml' } };

  test('the continuation is not a value of its own', () => {
    const src = 'a: Корвин - принц\n  Арден - лес';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { a: 'Корвин - принц Арден - лес' });
  });

  test('every line of the scalar is declined, and the next key is not', () => {
    const src = 'a: Корвин - принц\n  Арден - лес\n  Рэбма - море\nb: "Амбер - город"';

    assert.equal(
      microtypo(src, yaml),
      `a: Корвин - принц\n  Арден - лес\n  Рэбма - море\nb: "Амбер${NBSP}— город"`
    );
  });

  test('a sequence item that folds is declined whole', () => {
    const src = 'items:\n  - Корвин - принц\n    Арден - лес\n  - "Амбер - город"';

    assert.equal(
      microtypo(src, yaml),
      `items:\n  - Корвин - принц\n    Арден - лес\n  - "Амбер${NBSP}— город"`
    );
  });

  test('a folded scalar inside a flow collection is declined whole', () => {
    const src = '{k: Корвин - принц\n  Арден - лес}';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { k: 'Корвин - принц Арден - лес' });
  });

  test('a scalar on one line is still typeset', () => {
    const src = 'a: Корвин - принц\n\nb: "Амбер - город"';

    assert.equal(microtypo(src, yaml), `a: Корвин${NBSP}— принц\n\nb: "Амбер${NBSP}— город"`);
  });

  test('a block scalar still typesets every line of its content', () => {
    const src = 'a: |\n  Корвин - принц\n  Арден - лес';

    assert.equal(microtypo(src, yaml), `a: |\n  Корвин${NBSP}— принц\n  Арден${NBSP}— лес`);
  });

  // A plain scalar carries a blank line through as a line break, so the lines after one are still
  // the same value; and a scalar opened by an anchor is the same scalar, indicator or not.
  test('a blank line does not end the scalar', () => {
    const src = 'a: Корвин - принц\n\n  Арден - лес';

    assert.equal(microtypo(src, yaml), src);
    assert.equal(parse(src).a, 'Корвин - принц\nАрден - лес');
  });

  test('an anchored scalar is declined whole, continuation included', () => {
    const src = 'a: &x Корвин - принц\n  Арден - лес';

    assert.equal(microtypo(src, yaml), src);
  });
});

// A property settles a node's type, so the node keeps its bytes — except a block scalar, whose
// content is literal text whatever stands in front of it. The style is what decides, and where the
// property is written on a line of its own the style stands on the next line.
describe('a node property does not change what its style may do', () => {
  const PROPS = ['&a', '!!str', '&a !!str', '&a # note', '!!str # note'];
  const STYLES = [
    ['literal', (ind) => `|\n${ind}  Арден - лес`],
    ['folded', (ind) => `>\n${ind}  Арден - лес`],
    ['literal-strip', (ind) => `|-\n${ind}  Арден - лес`],
    ['plain', () => 'Арден - лес'],
    ['quoted', () => '"Арден - лес"']
  ];

  for (const prop of PROPS) {
    for (const [styleName, node] of STYLES) {
      for (const [place, src] of [
        ['inline', `title: ${prop} ${node('')}`],
        ['below', `title: ${prop}\n  ${node('  ')}`],
        ['alone', `title:\n  ${prop}\n    ${node('    ')}`]
      ]) {
        const doc = YAML.parseDocument(src);
        const type = doc.contents?.items?.[0]?.value?.type;

        if (typeof YAML.parse(src)?.title !== 'string') {
          continue;
        }

        // The parser, not the shape this loop meant to write: a comment behind the property
        // swallows a block header standing on the same line, and that row is a plain scalar.
        const isBlock = type === 'BLOCK_LITERAL' || type === 'BLOCK_FOLDED';

        test(`${place} ${prop} ${styleName} (${type})`, () => {
          const out = microtypo(src, { input: 'yaml' });

          if (isBlock) {
            assert.equal(out, src.replace('Арден - лес', `Арден${NBSP}— лес`));
          } else {
            assert.equal(out, src);
          }
        });
      }
    }
  }
});

// The node a lone property introduces is what the run waits for, and neither a comment nor a second
// property is that node. Where the property is written on a line of its own, the node may share that
// line's indent, so the run has to count it as inside.
describe('a property waits for the node and shares its indent', () => {
  test('a comment does not answer for the node', () => {
    assert.equal(
      microtypo('title: &a\n  # comment - guard\n  |\n    Арден - лес', { input: 'yaml' }),
      `title: &a\n  # comment - guard\n  |\n    Арден${NBSP}— лес`
    );
  });

  test('a second property does not answer either', () => {
    assert.equal(
      microtypo('title: &a\n  !!str |\n    Арден - лес', { input: 'yaml' }),
      `title: &a\n  !!str |\n    Арден${NBSP}— лес`
    );
    assert.equal(
      microtypo('title: !!str\n  &a\n  |\n    Арден - лес', { input: 'yaml' }),
      `title: !!str\n  &a\n  |\n    Арден${NBSP}— лес`
    );
  });

  test('a node at the property indent still belongs to it', () => {
    const src = 'title:\n  &a\n  Арден - лес';

    assert.equal(microtypo(src, { input: 'yaml' }), src);
    assert.equal(
      microtypo('title:\n  &a\n  Арден - лес\ncopy: *a', { input: 'yaml' }),
      'title:\n  &a\n  Арден - лес\ncopy: *a'
    );
  });

  // A finished run leaves nothing behind: an equal-indent allowance outliving its own run hands the
  // next explicit key a continuation and swallows the `:` of its own pair.
  test('the next run does not inherit the last one', () => {
    assert.equal(
      microtypo('anchor:\n  &a\n  Дворкин\n? title\n: "Арден - лес"', { input: 'yaml' }),
      `anchor:\n  &a\n  Дворкин\n? title\n: "Арден${NBSP}— лес"`
    );
  });

  // A property behind a `-` stands past the marker, not at the line's own indent, so the next item
  // of the sequence is a node of its own rather than a continuation of the first.
  test('a property behind a marker does not claim the next item', () => {
    assert.equal(
      microtypo('- &a\n- "Арден - лес"', { input: 'yaml' }),
      `- &a\n- "Арден${NBSP}— лес"`
    );
    assert.equal(microtypo('- &a\n  Арден - лес', { input: 'yaml' }), '- &a\n  Арден - лес');
  });

  // A comment stands at whatever column its author chose and belongs to no node, so it neither ends
  // a run nor continues one.
  test('a comment at column zero does not end the property run', () => {
    const src = 'title: &a\n# comment - guard\n  Арден - лес';

    assert.equal(microtypo(src, { input: 'yaml' }), src);
  });

  // The control: a sibling key outside the property's own indent still ends the run.
  test('a sibling key ends the run', () => {
    assert.equal(
      microtypo('title:\n  &a\n  Арден - лес\nnote: "Рэбма - море"', { input: 'yaml' }),
      `title:\n  &a\n  Арден - лес\nnote: "Рэбма${NBSP}— море"`
    );
  });
});

// A comment is not part of the key it stands behind, and a `#` glued to the text is. Sliced whole
// up to the `:`, an entry is named after its own comment.
describe('a plain flow key stops at its comment', () => {
  for (const [src, name] of [
    ['{? title # comment\n  : "Арден - лес"}', 'title'],
    ['{title # comment\n  : "Арден - лес"}', 'title'],
    ['{? title # c1 # c2\n  : "Арден - лес"}', 'title'],
    ['[? title # comment\n  : "Арден - лес"]', 'title'],
    ['{? a#b\n  : "Арден - лес"}', 'a#b'],
    // YAML separates with four ASCII characters and no others, so a non-breaking space before the
    // comment is part of the name and `trimEnd` would take it away with them.
    [`{? title${NBSP} # comment - guard\n  : "Арден - лес"}`, `title${NBSP}`],
    [`{? title\u{202F} # note\n  : "Арден - лес"}`, 'title\u{202F}']
  ]) {
    test(JSON.stringify(src), () => {
      const real = [...(YAML.parse(src, { mapAsMap: true }).keys?.() ?? [])][0];

      assert.equal(microtypo(src, { input: { format: 'yaml', exclude: [name] } }), src);
      assert.notEqual(
        microtypo(src, { input: { format: 'yaml', fields: [name] } }),
        src,
        `the real name is ${JSON.stringify(real ?? name)}`
      );
    });
  }
});

// A selector addresses an entry by the name the document gives it, so the fold that spells that
// name out of a multiline quoted key has to produce the parser's answer and no other: white space
// before the closing quote is content, and a `\` escaping a space is not one escaping the break.
describe('a multiline quoted key is named what the parser names it', () => {
  const BODIES = [
    'ti\n  tle',
    'ti\n  tle ',
    'ti \n  tle',
    'ti  \n  tle ',
    'ti\\ \n  tle',
    'ti\\\\ \n  tle',
    'ti\\ \\ \n  tle',
    'ti\\\n  tle',
    'ti\\\\\n  tle',
    'ti\\\\\\\n  tle',
    'ti\\t\n  tle',
    'a \n  b \n  c ',
    'a\\ \n  b\\ \n  c ',
    'ti\n  tle\t',
    'a \\\n  b',
    'a\\\n  \\ b',
    'a\n  \\ b',
    'a\r\n  b',
    'a \r\n  b ',
    'a\\\r\n  b',
    ' a\n  b',
    'x\\\\ \n  y\\ \n  z ',
    'ti\n  tle\n  ',
    'ti\n  ',
    'a\n  b\n   ',
    'ti\\\n  ',
    // A blank line inside is a line break, not a space: k breaks fold to k−1 of them, and an escaped
    // first break takes itself out of that run.
    'ti\n\n  tle',
    'ti\n\n\n  tle',
    'ti\\\n\n  tle',
    'a\n  b\n\n  c',
    'ti \n\n  tle'
  ];

  for (const body of BODIES) {
    test(`? "${JSON.stringify(body).slice(1, -1)}"`, () => {
      const src = `? "${body}"\n: "Арден - лес"`;
      const realKey = [...YAML.parse(src, { mapAsMap: true }).keys()][0];

      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: [realKey] } }),
        `? "${body}"\n: "Арден${NBSP}— лес"`,
        'the real name selects the value'
      );
      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: [`${realKey}~decoy`] } }),
        src,
        'no other name does'
      );
    });
  }

  // The same key inside a flow collection, where a fold living at one reader only would leave the
  // key carrying its own line break and its indentation.
  for (const body of ['ti\n  tle', 'ti\n  tle ', 'ti\\ \n  tle', 'a\n  b\n  c', 'ti\\\n  tle']) {
    test(`a flow-collection key folds the same way: ${JSON.stringify(body)}`, () => {
      const src = `outer: {"${body}": "Арден - лес"}`;
      const realKey = [...YAML.parse(src, { mapAsMap: true }).get('outer').keys()][0];

      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: [`outer.${realKey}`] } }),
        `outer: {"${body}": "Арден${NBSP}— лес"}`
      );
      assert.equal(
        microtypo(src, { input: { format: 'yaml', exclude: [`outer.${realKey}`] } }),
        src
      );
    });
  }

  // The fold is one left-to-right pass per line, so a run of backslashes costs the run and not its
  // square.
  test('a long run of escaped breaks stays linear', () => {
    const source = `? "${`${'\\'.repeat(3)}\n  `.repeat(2560)}x"\n: "value"`;
    const started = performance.now();

    assert.equal(microtypo(source, { input: 'yaml', maxProcessingMs: 0 }), source);
    assert.ok(performance.now() - started < 25, 'fold re-read the accumulated tail');
  });
});

// What a value may claim below itself is bounded by the node it belongs to, and inside a sequence
// item that node is not the `-`: `- body: |` puts the block scalar under a mapping that starts two
// columns in, and a sibling key at that column is not part of it.
describe('a sequence item bounds its values by the node they belong to', () => {
  const yaml = { input: { format: 'yaml' } };

  test('a block scalar does not swallow the field beside it', () => {
    const src = '- body: |\n    Арден - лес\n  Корвин - принц: "Амбер - город"';

    assert.equal(
      microtypo(src, yaml),
      `- body: |\n    Арден${NBSP}— лес\n  Корвин - принц: "Амбер${NBSP}— город"`
    );
    assert.deepEqual(Object.keys(parse(src)[0]), Object.keys(parse(microtypo(src, yaml))[0]));
  });

  test('a bare block scalar item still typesets its own lines', () => {
    const src = 'items:\n  - |\n    Корвин - принц\n  - "Эрик - король"';

    assert.equal(
      microtypo(src, yaml),
      `items:\n  - |\n    Корвин${NBSP}— принц\n  - "Эрик${NBSP}— король"`
    );
  });

  // A compact sequence writes its nesting along one line, and every marker there is a level: read
  // one marker per line, `- body` becomes a key of the outer item and the node is measured from the
  // outer column.
  test('a compact nested sequence bounds its value by the node the last marker opens', () => {
    const src = '- - body: |\n      Арден - лес\n    Корвин - принц: "Амбер - город"';

    assert.equal(
      microtypo(src, yaml),
      `- - body: |\n      Арден${NBSP}— лес\n    Корвин - принц: "Амбер${NBSP}— город"`
    );
    assert.deepEqual(Object.keys(parse(src)[0][0]), Object.keys(parse(microtypo(src, yaml))[0][0]));
  });

  test('a bare block scalar in a compact sequence is bounded by its own marker', () => {
    const src = '- - |\n    Арден - лес\n  - Корвин - принц';

    assert.equal(microtypo(src, yaml), `- - |\n    Арден${NBSP}— лес\n  - Корвин${NBSP}— принц`);
  });

  test('each marker of a compact sequence is one index of the path', () => {
    const src = '- - a: "Арден - лес"\n  - b: "Амбер - город"\n- - c: "Хаос - двор"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml', fields: ['/0/1/b'] } }),
      `- - a: "Арден - лес"\n  - b: "Амбер${NBSP}— город"\n- - c: "Хаос - двор"`
    );
  });

  // A flow collection and an anchored scalar do not fold onto the lines below them, so neither may
  // claim the field beside it.
  test('a flow value does not skip the field beside it', () => {
    const src = '- name: [foo]\n  title: "Арден - лес"';

    assert.equal(microtypo(src, yaml), `- name: [foo]\n  title: "Арден${NBSP}— лес"`);
  });

  test('an anchored value does not skip the field beside it', () => {
    const src = '- name: &x foo\n  title: "Арден - лес"';

    assert.equal(microtypo(src, yaml), `- name: &x foo\n  title: "Арден${NBSP}— лес"`);
  });
});

// The skip walks on line by line rather than jumping to the nearest delimiter, which may be standing
// inside a comment.
describe('a folded flow scalar is skipped without entering a comment', () => {
  const yaml = { input: { format: 'yaml' } };

  test('a comma inside a comment on a continuation line is not a separator', () => {
    const src = 'a: [foo\n bar # , "Корвин - принц"\n , baz]';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { a: ['foo bar', 'baz'] });
  });

  test('a brace inside a comment does not reject the document', () => {
    const src = 'a: [foo\n # }\n ]';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { a: ['foo'] });
  });
});

// Where a mapping is waiting for its key, whatever comes next is that key — the `:` behind it is
// not what makes it one. YAML lets the value be omitted, and lets a comment or a line break stand
// between the key and its colon, so a lookahead would decide from evidence that need not be there.
describe('a flow mapping key is a key before its colon is seen', () => {
  const yaml = { input: { format: 'yaml' } };

  test('a key with no value at all stays byte-exact', () => {
    const src = '{ "Корвин - принц" }';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { 'Корвин - принц': null });
  });

  test('a comment between the key and its colon does not make the key prose', () => {
    const src = '{ "Корвин - принц" # заметка\n: "Арден - лес" }';

    assert.equal(microtypo(src, yaml), `{ "Корвин - принц" # заметка\n: "Арден${NBSP}— лес" }`);
  });

  test('a collection standing where a key belongs is a key whole', () => {
    const src = '{ ["Корвин - принц"]: "Арден - лес" }';

    assert.equal(microtypo(src, yaml), `{ ["Корвин - принц"]: "Арден${NBSP}— лес" }`);
  });

  // A sequence element cannot say whether it is a key until its closer is behind it and a `:`
  // follows, so what was recorded inside it is taken back then rather than guessed at going in.
  test('a collection standing where a compact key belongs is a key whole', () => {
    const src = '[["Корвин - принц"]: "Арден - лес"]';

    assert.equal(microtypo(src, yaml), `[["Корвин - принц"]: "Арден${NBSP}— лес"]`);
  });

  test('a mapping used as a key protects its whole subtree', () => {
    const src = '[{"Корвин - принц": ["Арден - лес"]}: "Амбер - город"]';

    assert.equal(
      microtypo(src, yaml),
      `[{"Корвин - принц": ["Арден - лес"]}: "Амбер${NBSP}— город"]`
    );
  });

  // YAML allows a space in front of the separator and only the `:` ends a key, so the tokenizer —
  // which stops at that space just as readily — cannot be what closes one.
  test('a space before the colon still ends the key', () => {
    const src = 'a: {title : "Арден - лес"}';

    assert.equal(microtypo(src, yaml), `a: {title : "Арден${NBSP}— лес"}`);
  });

  test('a spaced multi-word key does not turn its subtree into a key', () => {
    const src = 'a: {full name : {text: "Арден - лес"}}';

    assert.equal(microtypo(src, yaml), `a: {full name : {text: "Арден${NBSP}— лес"}}`);
  });

  test('a multi-word plain key names the entry it opens', () => {
    const src = 'a: {full name: "Арден - лес"}';

    assert.equal(
      microtypo(src, { input: { format: 'yaml', exclude: ['/a/full name'] } }),
      src,
      'exclude on the real field did nothing'
    );
    assert.equal(
      microtypo(src, { input: { format: 'yaml', fields: ['/a/full name'] } }),
      `a: {full name: "Арден${NBSP}— лес"}`
    );
  });
});

// A comment is not content, and inside a flow collection it is also not a separator: the commas and
// brackets standing in one drive no structure.
describe('a comment inside a flow collection', () => {
  const yaml = { input: { format: 'yaml' } };

  test('a comma inside a comment does not start a value', () => {
    const src = 'a: [foo, # комментарий , Арден - лес, Амбер - город\n baz]';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { a: ['foo', 'baz'] });
  });

  test('a bracket inside a comment does not close the collection', () => {
    const src = 'a: [foo, # Арден - лес]\n baz]';

    assert.equal(microtypo(src, yaml), src);
    assert.deepEqual(parse(src), { a: ['foo', 'baz'] });
  });

  test('the value after a comment is still typeset', () => {
    const src = 'a: [ # Арден - лес\n "Амбер - город" ]';

    assert.equal(microtypo(src, yaml), `a: [ # Арден - лес\n "Амбер${NBSP}— город" ]`);
  });

  test('a comment behind a value leaves the value typeset and itself verbatim', () => {
    const src = 'a: ["Амбер - город" # Арден - лес\n ]';

    assert.equal(microtypo(src, yaml), `a: ["Амбер${NBSP}— город" # Арден - лес\n ]`);
  });

  test('a hash with no space in front of it is part of the scalar, not a comment', () => {
    const src = 'a: [Амбер#нет, "Хаос - тень"]';

    assert.equal(microtypo(src, yaml), `a: [Амбер#нет, "Хаос${NBSP}— тень"]`);
  });

  test('a collection that never closes past a comment is still rejected', () => {
    assert.throws(() => microtypo('a: [foo, # Арден - лес', yaml), MicroTypoInputError);
  });
});

// Protect-or-reject admits one answer per malformation, and `[ 1` and `[ 1 }` are the same document
// spelled two ways.
describe('a flow collection closes with the bracket it opened', () => {
  const yaml = { input: { format: 'yaml' } };

  for (const src of ['a: [ 1 }', 'a: { x: 1 ]', 'a: [ "Корвин - принц" }', 'a: [ [1, 2} ]']) {
    test(`${src} is rejected`, () => {
      assert.throws(() => microtypo(src, yaml), MicroTypoInputError);
    });
  }

  test('a matched pair is still read', () => {
    assert.equal(
      microtypo('a: [ {x: "Корвин - принц"} ]', yaml),
      `a: [ {x: "Корвин${NBSP}— принц"} ]`
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

  // The point is that the apostrophe does not open a quoted scalar and send the scan past the true
  // close. It is still an apostrophe, so it is still typeset as one.
  test('an unquoted apostrophe inside a flow collection is not rejected', () => {
    assert.equal(
      microtypo("a: [Corwin's, Amber]", { input: { format: 'yaml' } }),
      'a: [Corwin’s, Amber]'
    );
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

  // A flow collection is consumed whole, so its interior is never walked as YAML lines: the
  // comma after an element is punctuation, not trailing content. Its quoted scalars are values
  // all the same, and each is typeset in place.
  test('a multi-line flow sequence with a comma after an element is accepted', () => {
    const src = 'trumps: [\n  "Корвин - принц",\n  "Рэндом - принц"\n]\nb: "Оберон - король"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `trumps: [\n  "Корвин${NBSP}— принц",\n  "Рэндом${NBSP}— принц"\n]\nb: "Оберон${NBSP}— король"`
    );
  });

  test('a multi-line flow collection typesets like its single-line form', () => {
    const options = { input: { format: 'yaml' } };

    assert.equal(
      microtypo('trumps: [\n  "Корвин - принц"\n]', options),
      `trumps: [\n  "Корвин${NBSP}— принц"\n]`
    );
    assert.equal(
      microtypo('trumps: ["Корвин - принц"]', options),
      `trumps: ["Корвин${NBSP}— принц"]`
    );
  });

  test('a multi-line flow mapping typesets its values', () => {
    assert.equal(
      microtypo('court: {\n  king: "Оберон - отец"\n}', { input: { format: 'yaml' } }),
      `court: {\n  king: "Оберон${NBSP}— отец"\n}`
    );
  });

  test('a scalar that itself spans lines is not eligible', () => {
    const src = 'trumps: [\n  "Корвин -\n  принц"\n]';

    assert.equal(microtypo(src, { input: { format: 'yaml' } }), src);
  });

  test('flow spans carry indexed and keyed paths', () => {
    assert.deepEqual(literals('trumps: [\n  "Корвин - принц",\n  1\n]'), [
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: 'trumps.0' }
    ]);

    assert.deepEqual(literals('court: { king: "Оберон" }'), [
      { text: '"Оберон"', isKey: false, eligible: true, path: 'court.king' }
    ]);
  });

  test('fields select a single flow element', () => {
    assert.equal(
      microtypo('tags: ["Корвин - раз", "Рэндом - два"]', {
        input: { format: 'yaml', fields: ['tags.0'] }
      }),
      `tags: ["Корвин${NBSP}— раз", "Рэндом - два"]`
    );
  });

  test('a quoted key inside a flow mapping stays verbatim', () => {
    assert.equal(
      microtypo('a: { "к - люч": "Корвин - раз" }', { input: { format: 'yaml' } }),
      `a: { "к - люч": "Корвин${NBSP}— раз" }`
    );
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

  test('a quoted key and a bare value each carry their own span', () => {
    const src = '"Оберон": Корвин из тени';

    assert.deepEqual(literals(src), [
      { text: '"Оберон"', isKey: true, eligible: true, path: 'Оберон' },
      { text: 'Корвин из тени', isKey: false, eligible: true, path: 'Оберон' }
    ]);
  });

  test('a bare key stays out of the span, the bare value does not', () => {
    assert.deepEqual(literals('title: Корвин - тень'), [
      { text: 'Корвин - тень', isKey: false, eligible: true, path: 'title' }
    ]);
  });

  // The value stops at the comment, and at the spaces in front of it.
  test('a trailing comment is outside the value span', () => {
    assert.deepEqual(literals('title: Корвин - тень  # заметка Дворкина'), [
      { text: 'Корвин - тень', isKey: false, eligible: true, path: 'title' }
    ]);
  });

  // One span per content line, starting past the indentation: the indent is what ends the block, so
  // a span that never covers it cannot move the boundary.
  test('a literal block scalar yields one span per content line', () => {
    const src = 'desc: |\n  Корвин - принц\n  Эрик - король';

    assert.deepEqual(literals(src), [
      { text: 'Корвин - принц', isKey: false, eligible: true, path: 'desc' },
      { text: 'Эрик - король', isKey: false, eligible: true, path: 'desc' }
    ]);
  });

  test('a folded block scalar yields the same spans', () => {
    const src = 'desc: >\n  Корвин - принц\n  Эрик - король';

    assert.deepEqual(literals(src), [
      { text: 'Корвин - принц', isKey: false, eligible: true, path: 'desc' },
      { text: 'Эрик - король', isKey: false, eligible: true, path: 'desc' }
    ]);
  });

  test('a blank line inside a block scalar carries no span', () => {
    const src = 'desc: |\n  Корвин\n\n  Эрик';

    assert.deepEqual(literals(src), [
      { text: 'Корвин', isKey: false, eligible: true, path: 'desc' },
      { text: 'Эрик', isKey: false, eligible: true, path: 'desc' }
    ]);
  });

  test('a bare sequence-item block scalar carries the item path', () => {
    const src = '- |\n  Корвин - принц';

    assert.deepEqual(literals(src), [
      { text: 'Корвин - принц', isKey: false, eligible: true, path: '0' }
    ]);
  });

  test('a sequence-item block scalar consumes its index', () => {
    const src = 'items:\n  - |\n    Корвин - принц\n  - "Эрик - король"';

    assert.deepEqual(literals(src), [
      { text: 'Корвин - принц', isKey: false, eligible: true, path: 'items.0' },
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

  // A flow scalar ends at `,`, `]` or `}`, never at a space: `Корвин - принц` is one value, and the
  // word tokenizer that finds mapping keys cannot see that.
  test('a plain scalar inside a flow collection is typeset whole', () => {
    assert.equal(
      microtypo('a: [Корвин - принц, Рэндом]', { input: { format: 'yaml' } }),
      `a: [Корвин${NBSP}— принц, Рэндом]`
    );
    assert.equal(
      microtypo('a: {имя: Корвин - принц}', { input: { format: 'yaml' } }),
      `a: {имя: Корвин${NBSP}— принц}`
    );
  });

  test('a flow key stays byte-exact and a non-string flow value is left alone', () => {
    for (const src of ['a: {Корвин - принц: 1}', 'a: [100644, 2001-12-14, no]', 'a: {n: 100644}']) {
      assert.equal(microtypo(src, { input: { format: 'yaml' } }), src, src);
    }
  });

  test('a flow scalar folding onto the next line is left whole', () => {
    const src = 'a: [Корвин - принц\n  и брат, Рэндом]';

    assert.ok(
      microtypo(src, { input: { format: 'yaml' } }).includes('Корвин - принц'),
      'folded scalar was typeset'
    );
  });

  test('a bare item with "://" is not misread as a nested key', () => {
    const src = 'items:\n  - http://simonenko.xyz\n  - "Корвин - принц"';

    assert.deepEqual(literals(src), [
      { text: 'http://simonenko.xyz', isKey: false, eligible: true, path: 'items.0' },
      { text: '"Корвин - принц"', isKey: false, eligible: true, path: 'items.1' }
    ]);

    // The URL is vaulted before any rule runs, so its own span has nothing left to typeset.
    assert.equal(
      microtypo(src, { input: { format: 'yaml' } }),
      `items:\n  - http://simonenko.xyz\n  - "Корвин${NBSP}— принц"`
    );
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

  // `\0` is YAML's own escape for NUL and names the field `a b`, which JSON's decoder does not
  // have and would fall back on the raw spelling for.
  test('a key spelled with a YAML escape names the field it decodes to', () => {
    const src = '"a\\0b": "Корвин"';

    assert.deepEqual(literals(src), [
      { text: '"a\\0b"', isKey: true, eligible: false, path: 'a b' },
      { text: '"Корвин"', isKey: false, eligible: true, path: 'a b' }
    ]);
  });

  // An escape no decoder knows is one YAML itself rejects, so there is no field name to decode to
  // and guessing would name the field something the document never spelled.
  test('a key with an escape YAML does not have keeps its raw text', () => {
    const src = '"a\\qb": "Корвин"';

    assert.deepEqual(literals(src), [
      { text: '"a\\qb"', isKey: true, eligible: false, path: 'a\\qb' },
      { text: '"Корвин"', isKey: false, eligible: true, path: 'a\\qb' }
    ]);
  });

  // Every spelling of one field is that field: `"\x74itle"` is `title`, and an `exclude` naming it
  // has to bite whichever spelling the document used.
  test('escape spellings of a key select the same field', () => {
    for (const spelling of ['title', '\\x74itle', '\\u0074itle', '\\U00000074itle', 't\\x69tle']) {
      const src = `"${spelling}": "Корвин - принц"`;
      const out = microtypo(src, { input: { format: 'yaml', exclude: ['title'] } });

      assert.equal(out, src, `exclude did not reach ${spelling}`);
    }
  });

  // Glyph folding turns a typographic `”` into ASCII `"`, so re-wrapping the typeset scalar would
  // close it early and hand the rest of the value to a parser as structure.
  test('a scalar that would close its own quote stays verbatim', () => {
    const src = 'cfg: {name: "Ребма”, isAdmin: “true", note: "Арден"}';

    assert.equal(microtypo(src, { input: 'yaml' }), src);
  });

  test('one unsplittable scalar does not stop its neighbour in the same sequence', () => {
    const out = microtypo('tags: ["Тень”", "Амбер - вечен"]', { input: 'yaml' });

    assert.equal(out, `tags: ["Тень”", "Амбер${NBSP}— вечен"]`);
  });

  // `findKeyColon` knows nothing about flow syntax, so a line opening with `{` would hand it the
  // colon inside the mapping: `{ключ` becomes a key, the closing brace becomes trailing junk, and a
  // list of objects is rejected outright.
  test('a flow mapping as a sequence entry typesets instead of throwing', () => {
    const out = microtypo('дворы:\n  - {имя: "Корвин - принц"}\n  - {имя: "Рэндом - брат"}\n', {
      input: 'yaml'
    });

    assert.equal(
      out,
      `дворы:\n  - {имя: "Корвин${NBSP}— принц"}\n  - {имя: "Рэндом${NBSP}— брат"}\n`
    );
  });

  test('a flow sequence as a sequence entry still typesets', () => {
    const out = microtypo('дворы:\n  - ["Корвин - принц"]\n', { input: 'yaml' });

    assert.equal(out, `дворы:\n  - ["Корвин${NBSP}— принц"]\n`);
  });

  // A complex key is still a key, so its content stays byte-for-byte — but it has to be recognised
  // as a node first, or `findKeyColon` reads a colon from inside the flow mapping and splits the
  // line there.
  test('an explicit key holding a flow mapping typesets its value', () => {
    const out = microtypo('? {name: "Дворкин"}\n: "Ключ - отображение"\n', { input: 'yaml' });

    assert.equal(out, `? {name: "Дворкин"}\n: "Ключ${NBSP}— отображение"\n`);
  });

  test('an explicit key holding a flow sequence keeps its own content verbatim', () => {
    const out = microtypo('? [ "Корвин - принц", "Эрик" ]\n: "Ключ - братья"\n', {
      input: 'yaml'
    });

    assert.ok(out.includes('"Корвин - принц"'), `key was typeset: ${out}`);
    assert.ok(out.includes(`"Ключ${NBSP}— братья"`), out);
  });

  // `? title` names its entry exactly as `title:` does: the `?` says where the key ends, not that
  // the key stopped being a string.
  test('an explicit key that spells a string names its entry', () => {
    for (const src of [
      '? title\n: "Корвин - принц"',
      '? "title"\n: "Корвин - принц"',
      '? \'title\'\n: "Корвин - принц"',
      '- ? title\n  : "Корвин - принц"'
    ]) {
      const yaml = (extra) => microtypo(src, { input: { format: 'yaml', ...extra } });

      assert.match(yaml({}), /Корвин\u{00A0}— принц/u, `not typeset by default: ${src}`);
      assert.equal(yaml({ exclude: ['title'] }), src, `exclude did not reach: ${src}`);
      assert.match(yaml({ fields: ['title'] }), /Корвин\u{00A0}— принц/u, `fields missed: ${src}`);
    }
  });

  // An explicit entry may have no value at all, so the `:` that would give its key away is allowed
  // to be missing and cannot be what recognises one.
  test('an explicit flow key with no value stays verbatim', () => {
    const src = 'items: [?\n  ["Корвин - принц"], "Арден - лес"]';
    const out = microtypo(src, { input: 'yaml' });

    assert.equal(out, `items: [?\n  ["Корвин - принц"], "Арден${NBSP}— лес"]`);
    assert.deepEqual(parse(out).items[1], 'Арден\u{00A0}— лес');
  });

  // A collection standing where a key belongs is a key at every depth, the top of the document
  // included: the key of an implicit block mapping is the one shape with nothing around it to name.
  test('a collection key of an implicit block mapping stays verbatim', () => {
    for (const src of [
      '["Корвин - принц"]: "Арден - лес"',
      '{"Корвин - принц": 1}: "Арден - лес"',
      'герб:\n  ["Корвин - принц"]: "Арден - лес"'
    ]) {
      const out = microtypo(src, { input: 'yaml' });

      assert.ok(out.includes('["Корвин - принц"]') || out.includes('{"Корвин - принц": 1}'), out);
      assert.ok(out.includes(`"Арден${NBSP}— лес"`), `value was not typeset: ${out}`);
      assert.deepEqual(
        [...YAML.parse(out, { mapAsMap: true }).keys()],
        [...YAML.parse(src, { mapAsMap: true }).keys()]
      );
    }
  });

  // The name an explicit key spells belongs to the entry that `?` line opened; left standing, it is
  // picked up by whatever entry comes next.
  test('an explicit key name does not outlive its own entry', () => {
    const out = microtypo('? title\n"other": "Арден - лес"\n: "Корвин - принц"', {
      input: { format: 'yaml', exclude: ['title'] }
    });

    assert.equal(out, `? title\n"other": "Арден${NBSP}— лес"\n: "Корвин${NBSP}— принц"`);
  });

  test('an explicit key name does not cross a document boundary', () => {
    const out = microtypo('? title\n---\n: "Корвин - принц"', {
      input: { format: 'yaml', exclude: ['title'] }
    });

    assert.equal(out, `? title\n---\n: "Корвин${NBSP}— принц"`);
  });

  // A comment behind an explicit key is not part of it, and is no reason to refuse the name.
  test('a comment does not take the name of an explicit key', () => {
    for (const src of ['? "title" # c\n: "Корвин - принц"', '? title\n  # c\n: "Корвин - принц"']) {
      const out = microtypo(src, { input: { format: 'yaml', exclude: ['title'] } });

      assert.ok(out.includes('"Корвин - принц"'), `exclude did not reach: ${JSON.stringify(out)}`);
    }
  });

  // An anchor or a tag is no part of the node behind it: read as content, `&x [1]` is one plain
  // scalar running to the first `]`, and the collection's own closer is counted against a frame
  // nothing opened.
  test('a property before a flow collection does not hide its structure', () => {
    const out = microtypo('{a: &x [1], b: "Арден - лес"}', { input: 'yaml' });

    assert.equal(out, `{a: &x [1], b: "Арден${NBSP}— лес"}`);
    assert.deepEqual(parse(out), { a: [1], b: 'Арден\u{00A0}— лес' });
  });

  test('a node behind a property keeps its own bytes', () => {
    for (const src of [
      'a: &x [1, "Арден - лес"]\nb: "Корвин - принц"',
      '{a: !!str "Арден - лес", b: "Корвин - принц"}',
      '{a: [&x "Арден - лес"], b: "Корвин - принц"}'
    ]) {
      const out = microtypo(src, { input: 'yaml' });

      assert.ok(out.includes('"Арден - лес"'), `tagged node was typeset: ${out}`);
      assert.ok(out.includes(`"Корвин${NBSP}— принц"`), `neighbour was not typeset: ${out}`);
    }
  });

  // Protect-or-reject admits one answer for both spellings, anchor or no anchor.
  test('an unterminated collection behind a property is still rejected', () => {
    assert.throws(
      () => microtypo('a: &x [1, 2\nb: "Корвин - принц"', { input: 'yaml' }),
      MicroTypoInputError
    );
  });

  // An anchor name is `ns-char` minus the flow delimiters, so a colon and a quote are part of it:
  // ended at the tokenizer's wider set, `&a:b` names the anchor `&a` and the alias pointing at it
  // stops resolving.
  test('a property name keeps every character the grammar gives it', () => {
    for (const src of [
      '[&a:b Арден - лес, *a:b]',
      `[&a'b Арден - лес, *a'b]`,
      '[!!str:x Арден - лес]'
    ]) {
      assert.equal(microtypo(src, { input: 'yaml' }), src);
    }

    assert.deepEqual(parse(microtypo('[&a:b Арден - лес, *a:b]', { input: 'yaml' })), [
      'Арден - лес',
      'Арден - лес'
    ]);
  });

  // A node whose type a property settled keeps every byte of it, not just its first word.
  test('a property protects the whole scalar behind it', () => {
    for (const src of ['[&a Арден - лес]', '[!!str Арден - лес]', '{a: &x Арден - лес}']) {
      assert.equal(microtypo(src, { input: 'yaml' }), src);
    }
  });

  // A property standing alone on its line belongs to the node written under it, and a collection
  // behind one is still a collection: read past only in the value branch, `!!map {x: …}` splits at
  // the colon inside the mapping.
  test('a property carries to the node on the line below it', () => {
    assert.equal(
      microtypo('a:\n  !!map {x: "fixed"}\nb: "Арден - лес"', { input: 'yaml' }),
      `a:\n  !!map {x: "fixed"}\nb: "Арден${NBSP}— лес"`
    );
    assert.equal(
      microtypo('title: &a\n  "Арден - лес"\nb: "Корвин - принц"', { input: 'yaml' }),
      `title: &a\n  "Арден - лес"\nb: "Корвин${NBSP}— принц"`
    );
  });

  // The quoted reader has already recorded the name, so the colon behind it names nothing new and
  // must not overwrite it with the empty key.
  test('the colon of an explicit entry does not erase a key already read', () => {
    const src = '[? "title": "Арден - лес"]';

    assert.equal(microtypo(src, { input: { format: 'yaml', exclude: ['title'] } }), src);
    assert.equal(
      microtypo(src, { input: { format: 'yaml', fields: ['0.title'] } }),
      `[? "title": "Арден${NBSP}— лес"]`
    );
  });

  // A double-quoted key may run over more than one line: the break folds to a space, and a `\` in
  // front of it takes even that away, so one line alone spells no name.
  test('a quoted key folded over lines names the field it folds to', () => {
    for (const [src, key] of [
      ['? "ti\\\n  tle"\n: "Корвин - принц"', 'title'],
      ['? "ti\n  tle"\n: "Корвин - принц"', 'ti tle'],
      ['? \'ti\n  tle\'\n: "Корвин - принц"', 'ti tle']
    ]) {
      assert.deepEqual([...YAML.parse(src, { mapAsMap: true }).keys()], [key], src);
      assert.equal(microtypo(src, { input: { format: 'yaml', exclude: [key] } }), src);
    }
  });

  test('a sequence item does not inherit the explicit key of the item above', () => {
    const src = '- ? title\n- : "Арден - лес"';

    assert.equal(
      microtypo(src, { input: { format: 'yaml', exclude: ['title'] } }),
      `- ? title\n- : "Арден${NBSP}— лес"`
    );
  });

  // Three shapes a flow collection is allowed to take, in each of which the parser reads an ordinary
  // string value, so each is prose to typeset.
  test('a flow entry with an unusual shape still has its value typeset', () => {
    for (const [src, out] of [
      ['{: "Арден - лес"}', `{: "Арден${NBSP}— лес"}`],
      ['[title: "Арден - лес"]', `[title: "Арден${NBSP}— лес"]`],
      ['[Арден - лес\n]', `[Арден${NBSP}— лес\n]`]
    ]) {
      assert.equal(microtypo(src, { input: 'yaml' }), out);
      assert.deepEqual(YAML.parse(microtypo(src, { input: 'yaml' })), YAML.parse(out));
    }
  });

  test('a compact single-pair sequence entry is addressed by index and key', () => {
    const src = '[title: "Арден - лес", "Корвин - принц"]';

    assert.equal(
      microtypo(src, { input: { format: 'yaml', exclude: ['0.title'] } }),
      `[title: "Арден - лес", "Корвин${NBSP}— принц"]`
    );
  });

  // A `:` separates only where whitespace or a delimiter follows it, so neither of these is a key.
  test('a colon inside a flow scalar stays content', () => {
    for (const src of ['[http://arden.io/путь - сюда]', '[Смена 8:00 - утро]']) {
      const out = microtypo(src, { input: 'yaml' });

      assert.ok(out.includes(`${NBSP}—`), out);
      assert.deepEqual(parse(out).length, 1);
    }
  });

  // A key that is not one string on one line spells no name a path can carry, so its value stays
  // addressed by an empty segment rather than by a name the document never wrote.
  test('an explicit key that spells no string names nothing', () => {
    for (const src of [
      '? |\n  title\n: "Корвин - принц"',
      '? [title]\n: "Корвин - принц"',
      '? title\n  ещё\n: "Корвин - принц"'
    ]) {
      const out = microtypo(src, { input: { format: 'yaml', exclude: ['title'] } });

      assert.match(out, /Корвин\u{00A0}— принц/u, `exclude should not have reached: ${src}`);
    }
  });

  // Whatever YAML lets stand between a key and its `:` must not change which bytes are the key, so
  // the lookahead that takes a collection back as one has to know a comment is not content.
  test('a separator before the colon does not change which bytes are the key', () => {
    for (const separator of [
      ' ',
      '\n  ',
      ' # comment\n  ',
      ' # one\n  # two\n  ',
      '\t# comment\n  ',
      '\n  # comment\n  ',
      ' #comment\n  '
    ]) {
      const src = `items: [?\n  ["Корвин - принц"]${separator}: "Арден - лес"]`;
      const out = microtypo(src, { input: 'yaml' });

      assert.ok(out.includes('["Корвин - принц"]'), `key was typeset: ${JSON.stringify(out)}`);
      assert.ok(out.includes(`"Арден${NBSP}— лес"`), `value was not typeset: ${out}`);
    }
  });

  // A key names its container, so its span stops short of its own position: setting `frame.key`
  // before reading the chain makes a flow-mapping key report a path that includes itself.
  //
  // The guard states what the scanner promises, not what the current rule set happens to do: a flow
  // plain scalar that gained a comma or a bracket would hand the rest of the value to the parser as
  // structure. The block-context guard cannot ask this, because there both are ordinary text.
  test('the flow guard refuses a result that would end the scalar', () => {
    assert.equal(flowScalarSafe('Корвин — принц Амбера'), true);
    assert.equal(plainScalarSafe('Корвин, принц Амбера'), true);

    for (const typed of ['Корвин, принц', 'Корвин [принц]', 'Корвин {принц}']) {
      assert.equal(flowScalarSafe(typed), false, `${typed} was accepted in flow context`);
    }
  });

  test('a key span names its container, not itself', () => {
    const src = 'герб: {"имя": "Дворкин", "город": "Амбер"}\n';
    const spans = scanYaml(src).map((span) => ({
      text: src.slice(span.start, span.end),
      isKey: span.isKey,
      path: span.path
    }));

    assert.deepEqual(spans, [
      { text: '"имя"', isKey: true, path: 'герб' },
      { text: '"Дворкин"', isKey: false, path: 'герб.имя' },
      { text: '"город"', isKey: true, path: 'герб' },
      { text: '"Амбер"', isKey: false, path: 'герб.город' }
    ]);
  });
});

// The name of a key is what the author wrote, and a Unicode space is a character of it rather than
// padding around it.
describe('a key keeps every significant space of its own name', () => {
  const SPACES = ['\u{00A0}', '\u{2007}', '\u{202F}', '\u{2060}', '\u{FEFF}'];

  test('an implicit block mapping key is addressed by the name it was written with', () => {
    for (const space of SPACES) {
      const src = `title${space}: "Арден - лес"`;

      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: ['/title'] } }),
        src,
        `decoy pointer selected the value for ${space.codePointAt(0).toString(16)}`
      );
      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: [`/title${space}`] } }),
        `title${space}: "Арден${NBSP}— лес"`,
        `the real pointer missed the value for ${space.codePointAt(0).toString(16)}`
      );
    }
  });

  test('a compact flow-sequence mapping key is addressed the same way', () => {
    for (const space of SPACES) {
      const src = `[title${space}: "Арден - лес"]`;

      assert.equal(microtypo(src, { input: { format: 'yaml', fields: ['/0/title'] } }), src);
      assert.equal(
        microtypo(src, { input: { format: 'yaml', fields: [`/0/title${space}`] } }),
        `[title${space}: "Арден${NBSP}— лес"]`
      );
    }
  });
});

// A comment stands where its author put it and belongs to no node, so it neither ends the wait for
// one nor becomes the content of one that has already started.
describe('a comment beside a block scalar', () => {
  test('an outdented comment after a block scalar is not the block content', () => {
    const source = 'body: |\n  Дворкин\n# Корвин - принц';

    assert.equal(microtypo(source, { input: 'yaml' }), source);
    assert.equal(YAML.parse(microtypo(source, { input: 'yaml' })).body, 'Дворкин\n');
  });

  test('a comment indented into the block is its literal text and is typeset', () => {
    const out = microtypo('body: |\n  Дворкин\n  # Корвин - принц', { input: 'yaml' });

    assert.equal(out, `body: |\n  Дворкин\n  # Корвин${NBSP}— принц`);
    assert.equal(YAML.parse(out).body, `Дворкин\n# Корвин${NBSP}— принц\n`);
  });

  test('a comment between a property and its node still does not end the wait', () => {
    const source = 'title: &a\n# comment - guard\n  Арден - лес';

    assert.equal(microtypo(source, { input: 'yaml' }), source);
  });

  test('an outdented comment leaves the field under it to be typeset', () => {
    const out = microtypo('body: |\n  Дворкин\n# Корвин - принц\nname: Рэндом - брат', {
      input: 'yaml'
    });

    assert.ok(out.includes('# Корвин - принц'), out);
    assert.ok(out.includes(`name: Рэндом${NBSP}— брат`), out);
  });

  // The header's own column is not where the block's content begins: the header may name the column
  // outright, and otherwise the first non-empty line does. Bounded by the header instead, a comment
  // standing between the two was read as one more line of the block and typeset.
  test('a comment deeper than the header but shallower than the content stays outside', () => {
    for (const header of ['|', '>', '|-', '|+']) {
      const source = `body: ${header}\n  Дворкин\n # Корвин - принц`;

      assert.equal(microtypo(source, { input: 'yaml' }), source, header);
    }
  });

  test('an indentation indicator says where the content begins', () => {
    const source = 'body: |4\n    Дворкин\n   # Корвин - принц';

    assert.equal(microtypo(source, { input: 'yaml' }), source);
    assert.equal(YAML.parse(microtypo(source, { input: 'yaml' })).body, 'Дворкин\n');
  });

  test('a line at the indicated column is content and is typeset', () => {
    const out = microtypo('body: |4\n    Дворкин - мудрец\n', { input: 'yaml' });

    assert.equal(out, `body: |4\n    Дворкин${NBSP}— мудрец\n`);
    assert.equal(YAML.parse(out).body, `Дворкин${NBSP}— мудрец\n`);
  });
});

// An anchor or a tag settles the whole node, and a comment written inside it belongs to no part of
// it. Read as the end of the node, the comment gave up the protection of everything under it.
const guarded = (source) => assert.equal(microtypo(source, { input: 'yaml' }), source);

describe('a comment inside a node a property settled', () => {
  test('a comment after the first entry does not end an anchored mapping', () => {
    guarded('root: &a\n  first: Дворкин\n# comment - guard\n  second: "Арден - лес"\ncopy: *a');
  });

  test('nor an anchored sequence', () => {
    guarded('root: &a\n  - Дворкин\n# comment - guard\n  - "Арден - лес"\ncopy: *a');
  });

  test('nor one a tag settled', () => {
    guarded('root: !!map\n  first: Дворкин\n# comment - guard\n  second: "Арден - лес"\n');
  });

  test('nor one written with CRLF line endings', () => {
    guarded(
      'root: &a\r\n  first: Дворкин\r\n# comment - guard\r\n  second: "Арден - лес"\r\ncopy: *a'
    );
  });

  test('the node beside the collection is still typeset after it', () => {
    const source =
      'root: &a\n  first: Дворкин\n# guard\n  second: "Арден - лес"\nname: Рэндом - брат';
    const out = microtypo(source, { input: 'yaml' });

    assert.ok(out.includes('"Арден - лес"'), out);
    assert.ok(out.includes(`name: Рэндом${NBSP}— брат`), out);
    assert.deepEqual(parse(out).root, parse(source).root);
  });

  // Only an empty line may stand between the parts of a plain scalar (YAML 1.2.2 §7.3.3), so a
  // comment under one ends it however deeply it is indented — the scalar above is one line long and
  // there is nothing folded onto for it to break.
  test('an indented comment does not make a plain scalar multi-line', () => {
    for (const column of ['', ' ', '  ', '   ']) {
      const source = `a: Дворкин - мудрец\n${column}# Корвин - принц\n`;
      const out = microtypo(source, { input: 'yaml' });

      assert.equal(out, `a: Дворкин${NBSP}— мудрец\n${column}# Корвин - принц\n`, column);
      assert.equal(parse(out).a, `Дворкин${NBSP}— мудрец`);
    }
  });

  test('a real folded plain scalar is still left whole', () => {
    const source = 'a: Дворкин - мудрец\n   и чародей Амбера\n';

    assert.equal(microtypo(source, { input: 'yaml' }), source);
  });
});
