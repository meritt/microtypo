import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { mdxReader } from '../../src/input/mdx.js';

const scenes = [
  ['nested MDX braces', (n) => `{${'{a:'.repeat(n)}"x - y"${'}'.repeat(n)}}`],
  ['nested JSX expressions', (n) => `${'<A value={'.repeat(n)}1${'}/>'.repeat(n)}`],
  ['MDX template fences', (n) => '{`А - б\n~~~\nВ - г`}\n\n'.repeat(n)],
  ['unclosed MDX braces', (n) => '{ '.repeat(n)],
  ['unclosed expressions across paragraphs', (n) => '{ a - b\n\n'.repeat(n)],
  ['unclosed JSX attribute', (n) => `<Box title="${'<Box prop='.repeat(n)}`],
  ['malformed JSX across empty lines', (n) => `${'<A\n\n'.repeat(n)}"x>`],
  ['quoted JSX fallbacks across paragraphs', (n) => `${'<A title="\n\n'.repeat(n)}>`],
  ['unclosed JavaScript strings across paragraphs', (n) => '{"unterminated\n\n'.repeat(n)],
  ['unclosed regular expressions across paragraphs', (n) => '{/[/\n\n'.repeat(n)],
  ['unclosed JSX expressions before a final angle', (n) => `${'<A x={ '.repeat(n)}>`],
  ['false expression openers in code', (n) => `${'`{` '.repeat(n)}{value}`],
  ['JSX tags with long attribute', (n) => `<Box title="${'А - б '.repeat(n)}">Корвин - принц</Box>`]
];

for (const [name, build] of scenes) {
  test(`${name} grows linearly`, (t) => {
    const typo = new MicroTypo({
      input: 'mdx',
      presets: false,
      maxInputLength: 1_000_000,
      maxProcessingMs: 0
    });
    const sample = (source) => {
      let best = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const start = performance.now();
        for (let repeat = 0; repeat < 5; repeat += 1) {
          typo.process(source);
        }
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const inputs = [1_000, 2_000, 4_000].map(build);
    sample(inputs[0]);
    const [one, two, four] = inputs.map(sample);
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}

function sampleComments(n) {
  const text = `${'{/*\n\n'.repeat(n)}*/`;
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const reader = mdxReader(text);
    const start = performance.now();
    let next = reader.next(0);
    while (next !== null) {
      const span = reader.read(next[0]);
      next = reader.next(span[2]);
    }
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

test('MDX comment endings are resolved once across malformed paragraphs', (t) => {
  sampleComments(1000);
  const [one, two, four] = [10_000, 20_000, 40_000].map(sampleComments);
  const detail = `MDX comment fallbacks: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
  t.diagnostic(detail);
  assert.ok(four / one < 8, detail);
});

test('MDX statement and value brace contexts scale while processing following prose', (t) => {
  const unit = [
    '{(() => { if (ok) {} else /}}/.test(x); return "А - б"; })()}',
    '{(() => { label: {} /}}/.test(x); return "А - б"; })()}',
    '{(async () => { for await (const x of xs) /}}/.test(x); return "А - б"; })()}',
    '{(() => { const x = function() {} / 2; return "А - б"; })()}',
    '{(() => { const x = class {} / 2; return "А - б"; })()}',
    '{(() => { const x = class extends Bases[{}] {} / 2; return "А - б"; })()}'
  ]
    .map((code) => `${code} Корвин - принц\n\n`)
    .join('');
  const typo = new MicroTypo({ input: 'mdx', maxInputLength: 1_000_000, maxProcessingMs: 0 });
  const sources = [200, 400, 800].map((n) => unit.repeat(n));
  const times = sources.map((source) => {
    let best = Infinity;
    const expected = source.replaceAll('Корвин - принц', 'Корвин\u00a0— принц');
    for (let run = 0; run < 4; run += 1) {
      const start = performance.now();
      const actual = typo.process(source);
      best = Math.min(best, performance.now() - start);
      assert.equal(actual, expected);
    }
    return best;
  });
  const detail = `MDX slash contexts: ${times.map((n) => n.toFixed(2)).join(', ')} ms; ${(times[2] / times[0]).toFixed(2)}x`;
  t.diagnostic(detail);
  assert.ok(times[2] / times[0] < 8, detail);
});
