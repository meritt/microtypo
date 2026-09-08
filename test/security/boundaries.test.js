import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineRuleGroup } from '../../src/define-rule.js';
import { microtypo, MicroTypo } from '../../src/index.js';

describe('ctx sandbox', () => {
  test('findByTagName does not expose raw tag or attribute content', () => {
    const seen = [];
    const typo = new MicroTypo();
    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'probe',
        rules: [
          {
            id: 'probe',
            handler: (ctx) => {
              for (const p of ctx.tags.findByTagName(() => true)) {
                seen.push(p);
              }

              return ctx.text;
            }
          }
        ]
      }),
      { name: 'probe', position: 'after:text' }
    );

    typo.process('<b class="kozyr">x</b> <a href="http://amber.example/PATH">y</a>', {
      html: true
    });

    assert.ok(seen.length > 0, 'probe never ran');
    for (const p of seen) {
      assert.equal(p.value, undefined, `raw value leaked: ${JSON.stringify(p)}`);
      const dump = JSON.stringify(p);
      assert.ok(!dump.includes('amber.example'), `href leaked: ${dump}`);
      assert.ok(!dump.includes('kozyr'), `attribute leaked: ${dump}`);
    }
  });

  test('findByTagName predicate sees tag names but not raw attributes', () => {
    const typo = new MicroTypo();
    let seen = '';

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'probe',
        rules: [
          {
            id: 'p',
            handler(ctx) {
              ctx.tags.findByTagName?.((n) => {
                seen += `|${n}`;

                return false;
              });

              return ctx.text;
            }
          }
        ]
      }),
      { name: 'probe', position: 'after:text' }
    );

    typo.process('<a href="http://amber.example/PATH?trump=abc">y</a>');

    assert.ok(seen.includes('|a'), `predicate never observed a tag name: ${seen}`);
    assert.ok(!seen.includes('amber.example') && !seen.includes('trump='), seen);
  });

  test('custom group cannot reach ctx.engine', () => {
    const typo = new MicroTypo();
    let leaked = null;

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'snoop',
        rules: [
          {
            id: 'r',
            pattern: /MARK/g,
            replacement: (_, ctx) => {
              leaked = ctx.engine;

              return 'X';
            }
          }
        ]
      }),
      { name: 'snoop' }
    );

    typo.process('Корвин MARK');
    assert.equal(leaked, undefined, 'ctx.engine should not be exposed');
  });

  test('ctx.tags exposes only findByTagName', () => {
    const typo = new MicroTypo();
    let captured = null;

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'snoop',
        rules: [
          {
            id: 'r',
            pattern: /MARK/g,
            replacement: (_, ctx) => {
              captured = ctx.tags;

              return 'X';
            }
          }
        ]
      }),
      { name: 'snoop' }
    );

    typo.process('Амбер MARK');
    assert.deepEqual(Object.keys(captured), ['findByTagName']);
  });
});

describe('custom rules', () => {
  test('handler-style rule with no pattern gets ctx and mutates text', () => {
    const typo = new MicroTypo({ presets: false });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'shout',
        rules: [
          {
            id: 'shout',
            handler: (ctx) => {
              ctx.text = ctx.text.toUpperCase();
            }
          }
        ]
      }),
      { name: 'shout' }
    );

    assert.equal(typo.process('corwin'), 'CORWIN');
  });

  test('onCycleLimit hook snapshot is stable mid-process', () => {
    const typo = new MicroTypo({ presets: false });
    const calls = [];
    typo.onCycleLimit = () => calls.push('original');

    // A rule swaps onCycleLimit mid-process; the snapshot must ignore the swap this call.
    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'swapper',
        rules: [
          {
            id: 'swap',
            pattern: /MARK/g,
            replacement: (_, _ctx) => {
              typo.onCycleLimit = () => calls.push('hijacked');

              return 'X';
            }
          },
          {
            id: 'flip',
            cycled: true,
            pattern: /[AB]/g,
            replacement: (m) => (m[0] === 'A' ? 'B' : 'A')
          }
        ]
      }),
      { name: 'swapper' }
    );

    typo.process('MARK AB');
    assert.ok(!calls.includes('hijacked'), `hook hijacked: ${calls}`);
  });
});

// ctx.tag escapes attribute values but writes the element and attribute names as given, so those are
// the two openings a rule group could use to emit markup nobody escaped.
const invalidName = (e) => e.code === 'ERR_MICROTYPO_CONFIG';

const tagging = (tag, attributes) => {
  const typo = new MicroTypo({ html: true, render: { paragraphs: false }, presets: false });

  typo.registerRuleGroup(
    defineRuleGroup({
      title: 'tagger',
      rules: [{ id: 'tagger', handler: (ctx) => ctx.tag('Корвин', tag, attributes) }]
    }),
    { name: 'tagger' }
  );

  return () => typo.process('x');
};

describe('ctx.tag names are markup, not data', () => {
  test('an element name carrying an attribute is rejected', () => {
    assert.throws(tagging('span onload=alert(1)', {}), invalidName);
  });

  for (const name of ['', ' ', 'sp an', 'a>', '<a', 'a"b', '1span', '-span', 'a\nb']) {
    test(`element name ${JSON.stringify(name)} is rejected`, () => {
      assert.throws(tagging(name, {}), invalidName);
    });
  }

  test('an attribute name carrying another attribute is rejected', () => {
    assert.throws(tagging('span', { 'onload=alert(1) x': 'y' }), invalidName);
  });

  for (const name of ['a b', 'a"', 'a>', '1a', '']) {
    test(`attribute name ${JSON.stringify(name)} is rejected`, () => {
      assert.throws(tagging('span', { [name]: 'y' }), invalidName);
    });
  }

  test('the names the built-in rules use are accepted', () => {
    for (const tag of ['span', 'a', 'small', 'sup', 'sub', 'nobr']) {
      assert.doesNotThrow(tagging(tag, {}));
    }

    for (const name of ['href', 'style', 'title', 'data-x', 'aria-label']) {
      assert.doesNotThrow(tagging('span', { [name]: 'y' }));
    }
  });

  test('an attribute value is still escaped, not rejected', () => {
    const out = tagging('span', { title: '" onload="alert(1)' })();

    assert.ok(out.includes('title="&quot; onload=&quot;alert(1)"'), out);
  });

  // A rule group is well-formed or it is not; whether this call happens to emit a tag is a separate
  // question, so the refusal must not depend on html or on the destination.
  for (const [label, config, input] of [
    ['html:false', { html: false }, 'x'],
    ['xml', { html: true, input: 'xml' }, '<a>x</a>'],
    ['a structured value', { html: true, input: 'json' }, '{"a":"x"}']
  ]) {
    test(`a bad name is rejected under ${label} too`, () => {
      const typo = new MicroTypo({ render: { paragraphs: false }, presets: false, ...config });

      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'tagger',
          rules: [{ id: 'r', handler: (ctx) => ctx.tag('Корвин', 'span onload=alert(1)', {}) }]
        }),
        { name: 'tagger' }
      );

      assert.throws(() => typo.process(input), invalidName);
    });
  }
});

describe('reentrancy', () => {
  test('ctx.engineSettings mutation does not cross calls', () => {
    const typo = new MicroTypo({ html: true });
    typo.registerRuleGroup(
      {
        title: 'evil',
        rules: [
          {
            id: 'pwn',
            handler(ctx) {
              // `nobr` would flip the nowrap `<span>` to a `<nobr>`, so a cross-call leak surfaces in
              // the next output.
              ctx.engineSettings.nowrap = 'nobr';

              return ctx.text;
            }
          }
        ]
      },
      { name: 'evil' }
    );

    typo.process('Оберон правит Амбером');
    const second = typo.process('и т. д.');

    assert.ok(second.includes('white-space:nowrap'));
    assert.ok(!second.includes('<nobr>'));
    assert.equal(typo.process('и т. д.'), second);
  });

  test('recursive same-instance process() throws instead of corrupting vaults', () => {
    const typo = new MicroTypo();
    typo.registerRuleGroup(
      {
        title: 'reenter',
        rules: [
          {
            id: 'r',
            handler(ctx) {
              typo.process('<pre>INNER</pre>');

              return ctx.text;
            }
          }
        ]
      },
      { name: 'reenter', position: 'after:quote' }
    );

    assert.throws(
      () => typo.process('Козыри <pre>OUTER</pre> тень'),
      (e) => e.code?.startsWith('ERR_MICROTYPO')
    );
  });

  test('a thrown error clears the reentrancy guard for the next call', () => {
    // Wide budget margin so the fast second call can't flake against the first's overrun.
    const typo = new MicroTypo({ maxProcessingMs: 100 });
    let calls = 0;

    typo.registerRuleGroup(
      {
        title: 'slow',
        rules: [
          {
            id: 's',
            handler(ctx) {
              calls += 1;

              if (calls === 1) {
                const end = performance.now() + 250;

                while (performance.now() < end) {
                  /* busy-wait */
                }
              }

              return ctx.text;
            }
          }
        ]
      },
      { name: 'slow' }
    );

    assert.throws(
      () => typo.process('a'),
      (e) => e.code?.startsWith('ERR_MICROTYPO')
    );
    assert.doesNotThrow(() => typo.process('b'));
  });

  test('concurrent process() on same instance returns correct results', async () => {
    const typo = new MicroTypo({ render: { paragraphs: false } });
    const inputs = Array.from({ length: 20 }, (_, i) => `Тень N${i} с "отражением"`);
    const results = await Promise.all(inputs.map((t) => Promise.resolve(typo.process(t))));

    for (const [i, r] of results.entries()) {
      assert.ok(r.includes(`N${i}`), `index lost at ${i}: ${r}`);
      assert.ok(r.includes('«отражением»'), `quote lost at ${i}: ${r}`);
    }
  });

  // Sharing one instance is the documented way to use the engine in a loop, so the shared instance
  // must answer exactly as a fresh one would — across formats, and whatever ran before.
  test('a shared instance matches a fresh one over interleaved inputs', () => {
    const inputs = [
      'Корвин - принц "Амбера".',
      'Смотри https://amber.io/a?b=1&c=2 и пиши corwin@amber.io.',
      '<code>a - b</code> и текст "тут" - вот.',
      'Цена 100 руб. Отряд 12345 бойцов.',
      '«Внешние «внутренние» кавычки» и 5" дюймов.',
      'Первый абзац.\n\nВторой - абзац.',
      'Текст <notg>сырой "текст"</notg> ещё "раз".'
    ];

    for (const config of [
      { html: true, render: { paragraphs: false } },
      { html: false },
      { html: true, entities: true, render: { paragraphs: false } },
      { input: 'markdown' }
    ]) {
      const shared = new MicroTypo(config);

      for (let round = 0; round < inputs.length * 4; round += 1) {
        const source = inputs[(round * 3 + 1) % inputs.length];

        assert.equal(
          shared.process(source),
          new MicroTypo(config).process(source),
          `shared instance drifted on ${JSON.stringify(source)}`
        );
      }
    }
  });

  test('a placeholder from one call cannot surface in the next', () => {
    const typo = new MicroTypo({ html: true, render: { paragraphs: false } });
    const withUrl = typo.process('Смотри https://amber.io/pattern тут.');
    const plain = typo.process('Обычный текст без ссылок.');

    assert.doesNotMatch(plain, /[\u{E000}\u{E001}\u{E100}\u{E101}]/u);
    assert.ok(!plain.includes('amber.io'), plain);
    assert.equal(typo.process('Смотри https://amber.io/pattern тут.'), withUrl);
  });
});

// maxInputLength is raised per test because these crafted inputs exceed the 30K default.
function isCapacityError(err) {
  return err.code?.startsWith('ERR_MICROTYPO') && err.details?.reason === 'capacity';
}

describe('vault capacity', () => {
  test('SafeTags vault throws a typed capacity error beyond 100000 entries', () => {
    // SafeTags dedupes by content, so the open and close have to differ — an attribute on the open —
    // or one entry is reused.
    let text = '';
    for (let i = 0; i < 50_001; i++) {
      text += `<x${i} d="1">y</x${i}>`;
    }
    const typo = new MicroTypo({ maxInputLength: text.length + 10 });
    assert.throws(
      () => typo.process(text),
      (err) => isCapacityError(err) && /Vault 'T' exceeded 100000 entries/.test(err.message)
    );
  });

  // SafeSequences dedupes by content like the tag vault, so the cap counts distinct sequences: one
  // address repeated is one entry, and the addresses below have to differ to reach the ceiling.
  test('SafeSequences throws a typed capacity error beyond 100000 emails', () => {
    const text = Array.from({ length: 100_001 }, (_, i) => `a${i}@b.co`).join(' ');
    const typo = new MicroTypo({ maxInputLength: text.length + 10 });
    assert.throws(
      () => typo.process(text),
      (err) => isCapacityError(err) && err.message === 'SafeSequences: too many emails in input'
    );
  });

  test('one address repeated is one vault entry', () => {
    const text = 'a@b.co '.repeat(100_001);
    const typo = new MicroTypo({ maxInputLength: text.length + 10 });

    assert.doesNotThrow(() => typo.process(text));
  });

  test('SafeSequences throws a typed capacity error beyond 100000 tokens', () => {
    const text = Array.from(
      { length: 100_001 },
      (_, i) => `01234567-89ab-cdef-0123-${String(i).padStart(12, '0')}`
    ).join(' ');
    const typo = new MicroTypo({ maxInputLength: text.length + 10 });
    assert.throws(
      () => typo.process(text),
      (err) => isCapacityError(err) && err.message === 'SafeSequences: too many tokens in input'
    );
  });

  test('URL vault throws a typed capacity error on entry overflow', () => {
    const typo = new MicroTypo({ presets: false, maxInputLength: 5_000_000 });
    const text = Array.from({ length: 100_500 }, (_, i) => `http://e${i}.org`).join(' ');
    assert.throws(
      () => typo.process(text),
      (err) => err.code?.startsWith('ERR_MICROTYPO')
    );
  });
});

describe('vault reset', () => {
  test('addSafeTag block list survives across two process() calls', () => {
    const typo = new MicroTypo({ render: { paragraphs: false }, rules: { 'hanging.*': false } });
    typo.addSafeTag('mywidget');
    const text = '<mywidget>"Грейсвандир" не тронут</mywidget> вокруг "Амбер"';

    const first = typo.process(text);
    assert.ok(first.includes('"Грейсвандир"'), `widget content untouched: ${first}`);
    assert.ok(first.includes('«Амбер»'), `outside quotes converted: ${first}`);

    const second = typo.process(text);
    assert.equal(second, first, 'second call must reproduce identical output');
    assert.ok(second.includes('"Грейсвандир"'), `widget content still untouched: ${second}`);
  });

  test('reused instance produces identical output on repeated calls', () => {
    const typo = new MicroTypo();
    const text =
      'Ступай на https://amber.example/a и зри «Козырь» — тире, письмо corwin@amber.example';

    const outputs = Array.from({ length: 5 }, () => typo.process(text));

    for (const out of outputs) {
      assert.equal(out, outputs[0], 'every call on the same instance must match');
    }
  });

  test('placeholder ids restart each call so a forged prior-call id is not substituted', () => {
    const typo = new MicroTypo();
    typo.process('Visit http://oberon-secret.example');
    // The second call's ids restart at 0, so the forged `A0` must resolve to this call's URL rather
    // than the previous one.
    const out = typo.process('check http://corwin.xyz/A0SAFESEQNUM0ID end');
    assert.ok(!out.includes('oberon-secret'), `cross-call leak: ${out}`);
  });
});

// `render.prefix` goes raw into a class value, so both entry points reject anything that would break
// out of the attribute.
describe('render prefix', () => {
  test('render.prefix cannot break out of the class attribute', () => {
    assert.throws(
      () =>
        microtypo('«x»', {
          html: true,
          rules: { 'hanging.quote': true },
          render: { hanging: 'class', prefix: 'x" onclick="alert(1) ' }
        }),
      /prefix/i
    );
  });

  test('render.prefix rejects "<", ">", "&", and whitespace', () => {
    for (const bad of ['x<y', 'x>y', 'x&y', 'x y']) {
      assert.throws(() => new MicroTypo({ render: { prefix: bad } }), /prefix/i);
    }
  });

  test('a safe render.prefix works', () => {
    const out = microtypo('«x»', {
      html: true,
      rules: { 'hanging.quote': true },
      render: { hanging: 'class', prefix: 'amber_' }
    });
    assert.match(out, /class="amber_oa_oquote/);
  });

  test('setPrefix rejects non-CSS-token prefixes', () => {
    const typo = new MicroTypo({ html: true });
    assert.throws(() => typo.setPrefix('x" onclick="'), /prefix/i);
  });

  test('setPrefix(true) maps to the built-in prefix', () => {
    const typo = new MicroTypo({ html: true, rules: { 'hanging.quote': true } });
    typo.setPrefix(true).setLayout('class');
    const out = typo.process('«x»');
    assert.match(out, /class="mt_oa_oquote/);
  });

  test('setPrefix accepts a plain CSS-token prefix', () => {
    const typo = new MicroTypo({ html: true });
    assert.doesNotThrow(() => typo.setPrefix('amber_'));
  });
});

describe('unicode input', () => {
  test('precomposed й (U+0439) survives unchanged', () => {
    const out = microtypo('мой', { render: { paragraphs: false } });
    assert.ok(out.includes('мой'), `Got: ${out}`);
  });

  test('decomposed й (и + U+0306) survives without crash', () => {
    const decomposed = 'мой';
    assert.doesNotThrow(() => microtypo(decomposed));
  });

  test('UTF-8 BOM at input start is handled', () => {
    const out = microtypo('﻿текст', { render: { paragraphs: false } });
    assert.ok(out.includes('текст'), `Got: ${out}`);
  });
});
