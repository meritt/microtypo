import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { F, featureMask } from '../../src/lib/rule-features.js';
import { DEFAULT_GROUPS } from '../../src/rules/registry.js';

for (const rule of ['other.split_triads', 'quote.around_link']) {
  test(`${rule}: scalar filtering retains printf vault capacity checks`, () => {
    const typo = new MicroTypo({
      input: { format: 'json', placeholders: 'printf' },
      maxInputLength: 5_000_000,
      maxProcessingMs: 0,
      rules: {
        ...Object.fromEntries(DEFAULT_GROUPS.map(([name]) => [name, false])),
        [rule]: true
      }
    });
    const placeholders = Array.from(
      { length: 100_001 },
      (_, i) => `a%${(i % 9999) + 1}$${Math.floor(i / 9999) + 1}s`
    ).join('');
    const value = rule === 'quote.around_link' ? `«${placeholders}»` : placeholders;
    assert.throws(
      () => typo.process(JSON.stringify({ value })),
      (error) => error.code === 'ERR_MICROTYPO_INPUT' && error.details?.reason === 'capacity'
    );
  });
}

test('feature masks preserve UTF-16 boundaries and alternating visible fragments', () => {
  const state = { text: null, mask: 0, previousText: null, previousMask: 0 };
  const mask = (value) => featureMask(value, state);
  const unknown = F.LATIN | F.CYRILLIC;
  for (let high = 0xd800; high <= 0xdbff; high++) {
    for (const low of [0xdc00, 0xdfff]) {
      const pair = String.fromCodePoint(high, low);
      assert.equal(mask(pair), unknown);
      assert.equal(mask(`${pair}.7`), unknown | F.PERIOD | F.SOURCE | F.DIGIT);
      assert.equal(mask(pair), unknown);
      assert.equal(mask(pair.slice(0, 1)), unknown);
      assert.equal(mask(pair.slice(1)), unknown);
    }
  }
  assert.equal(mask('7'), F.DIGIT);
  assert.equal(mask('Амбер') & F.DIGIT, 0);
  assert.equal(mask('7'), F.DIGIT);
  assert.equal(mask('!'), F.EXCLAMATION);
});

test('later rules see symbols produced by an earlier rule', () => {
  const typo = new MicroTypo();

  assert.equal(typo.process('1/2 кг'), '½\u{00A0}кг');
  assert.equal(typo.process('7F'), '7\u{00A0}°F');
  assert.equal(typo.process('Амбер'), 'Амбер');
  assert.equal(typo.process('7F'), '7\u{00A0}°F');
});

test('custom groups retain tags minted by builtin handlers without text changes', () => {
  const typo = new MicroTypo({ html: true });
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'observe',
          handler: (ctx) =>
            `${ctx.text} ${ctx.tags.findByTagName('span').length > 0 ? 'сохранил' : 'потерял'}`
        }
      ]
    },
    { name: 'observer', position: 'after:other' }
  );

  assert.equal(typo.process('Амбер'), '<p>Амбер сохранил</p>');
});

test('a cycle callback can replace a later builtin group and observe its predecessors', () => {
  const typo = new MicroTypo({ html: true });
  let calls = 0;
  typo.onCycleLimit = (id) => {
    assert.equal(id, 'apostrophe');
    calls += 1;
    typo.registerRuleGroup(
      {
        rules: [
          {
            id: 'observe',
            handler: (ctx) =>
              `${ctx.text} ${ctx.tags.findByTagName('span').length > 0 ? 'сохранил' : 'потерял'}`
          }
        ]
      },
      { name: 'text' }
    );
  };

  const result = typo.process(`${"а'".repeat(102)}а`);
  assert.equal(calls, 1);
  assert.match(result, / сохранил$/u);
});

test('unhinted custom rules and preParse still transform plain scalar values', () => {
  const typo = new MicroTypo({ presets: false, input: 'json' });
  typo.registerRuleGroup(
    {
      preParse: (ctx) => {
        ctx.text += '!';
      },
      rules: [{ id: 'rename', pattern: /Амбер/g, replacement: 'Тень' }]
    },
    { name: 'rename' }
  );

  assert.equal(typo.process('{"place":"Амбер"}'), '{"place":"Тень!"}');
});

test('plain scalar skipping preserves mandatory normalization and edge whitespace', () => {
  const typo = new MicroTypo({ presets: false, input: 'json' });
  const values = {
    plain: '  Амбер  ',
    quotes: '&#34;Амбер&#34;',
    glyphs: '\u{2010}\u{2012}\u{201C}\u{201D}\u{201E}\u{201F}',
    lines: 'a\r\nb\r\r\rc',
    reserved: '\u{E000}\u{E001}\u{E100}\u{E101}',
    code: '<code>1  2</code>'
  };

  assert.deepEqual(JSON.parse(typo.process(JSON.stringify(values))), {
    plain: '  Амбер  ',
    quotes: '"Амбер"',
    glyphs: '--"»««',
    lines: 'a\nb\n\nc',
    reserved: '\u{E000}\u{E001}\u{E100}\u{E101}',
    code: '<code>1  2</code>'
  });
});

test('custom scalar protection still enforces its entry limit', () => {
  const typo = new MicroTypo({
    presets: false,
    input: 'json',
    maxInputLength: 5_000_000,
    maxProcessingMs: 0
  });
  typo.addSafeBlock({ id: 'letters', open: 'a', close: 'b' });
  const value = Array.from({ length: 100_001 }, (_, index) => `a${index}b`).join('');

  assert.throws(
    () => typo.process(JSON.stringify({ value })),
    (error) => error.code === 'ERR_MICROTYPO_INPUT' && error.details?.reason === 'capacity'
  );
});

for (const [format, document] of [
  ['json', (values) => JSON.stringify(values)],
  ['yaml', (values) => values.map((value) => `- '${value}'`).join('\n')],
  ['toml', (values) => `items = [${values.map((value) => `'${value}'`).join(',')}]`]
]) {
  test(`${format} plain scalar values grow linearly`, (t) => {
    const typo = new MicroTypo({ input: format, maxInputLength: 5_000_000 });
    const time = (count) => {
      const values = Array.from(
        { length: count },
        (_, index) =>
          `Амбер${String.fromCodePoint(0x430 + (index % 32), 0x430 + ((index >>> 5) % 32), 0x430 + ((index >>> 10) % 32))}`
      );
      const input = document(values);
      assert.equal(typo.process(input), input);
      let best = Infinity;
      for (let sample = 0; sample < 3; sample += 1) {
        const started = performance.now();
        for (let iteration = 0; iteration < 5; iteration += 1) {
          typo.process(input);
        }
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };

    time(1_000);
    const [one, two, four] = [time(1_000), time(2_000), time(4_000)];
    const detail = `${format}: N ${one.toFixed(3)}ms, 2N ${two.toFixed(3)}ms, 4N ${four.toFixed(3)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
