import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { scanToml } from '../../src/input/toml.js';
import { scanYaml } from '../../src/input/yaml.js';

const BASE =
  'Корвин вернулся в Амбер, Рэндом ждал у Лабиринта. 1000 рублей, 31 января 2009 года, 12 - 19.';

function jsonDoc(count) {
  const items = Array.from({ length: count }, (_, i) => ({
    title: `Корвин ${i} - Рэндом`,
    body: BASE
  }));

  return JSON.stringify({ items }, null, 2);
}

function jsonSelectorDoc(count) {
  const items = Array.from({ length: count }, (_, i) => ({
    title: `Корвин ${i} - Рэндом`,
    body: BASE,
    note: `Оберон сказал: "Амбер ждёт ${i}"`
  }));

  return JSON.stringify({ items }, null, 2);
}

const nestedArrays = (depth) => `${'['.repeat(depth)}"Корвин - принц Амбера"${']'.repeat(depth)}`;
const nestedObjects = (depth) => `${'{"a":'.repeat(depth)}"Корвин - принц"${'}'.repeat(depth)}`;
const stackedFlowOpeners = (count) =>
  `${Array.from({ length: count }, (_, i) => `k${i}: [`).join('\n')}\n${']'.repeat(count)}`;
const deepFlowValues = (depth) =>
  `k: ${'["Корвин - принц", '.repeat(depth)}"дно"${']'.repeat(depth)}`;
const flowElements = (count) =>
  Array.from({ length: count }, (_, i) => `"Корвин ${i} - принц"`).join(', ');
const wideFlowSequence = (count) => `tags: [${flowElements(count)}]`;
const wideInlineArray = (count) => `tags = [${flowElements(count)}]`;

// Every element above carries a comma, so the flow scan finds the end of a plain scalar on the
// token itself. Without one it must not rescan to the end of the line per token.
const commalessFlowLine = (words) =>
  `корвин: [\n  ${Array.from({ length: words }, () => 'слово').join(' ')}\n  ]`;

// A deep table header with many keys under it. Both halves grow with the document, so rebuilding
// the full path per key line is quadratic in it.
const deepTomlHeader = (keys) =>
  [
    `[${Array.from({ length: Math.round(keys / 8) }, () => 'arden').join('.')}]`,
    ...Array.from({ length: keys }, (_, i) => `key${i} = "Корвин - принц Амбера"`)
  ].join('\n');

function once(fn) {
  fn();

  let best = Infinity;

  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }

  return best;
}

test('JSON many selected values splice without repeated whole-document copying', () => {
  const text = jsonDoc(2000);
  const typo = new MicroTypo({
    input: { format: 'json', fields: ['/items/*/body', '/items/*/title'] },
    maxInputLength: 5_000_000,
    maxProcessingMs: 0
  });

  const ms = once(() => typo.process(text));

  assert.ok(ms < 250, `Got ${ms.toFixed(1)}ms (expected < 250ms)`);
});

test('structured selector matching stays bounded with many selectors', () => {
  const text = jsonSelectorDoc(1500);
  const misses = Array.from({ length: 45 }, (_, i) =>
    i % 2 === 0 ? `items.*.shadow${i}` : `/items/*/shadow${i}`
  );
  const excludeMisses = Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0 ? `items.${i}.shadow` : `/items/${i}/shadow`
  );
  const typo = new MicroTypo({
    input: {
      format: 'json',
      fields: [...misses, 'items.*.title', 'items.*.body', '/items/*/note'],
      exclude: [...excludeMisses, 'items.17.body', '/items/23/note']
    },
    maxInputLength: 5_000_000,
    maxProcessingMs: 0
  });

  const ms = once(() => typo.process(text));

  assert.ok(ms < 200, `selector-heavy JSON took ${ms.toFixed(1)}ms`);
});

// Each of these costs one or two characters per level, so a document at the default input cap
// reaches a depth of thousands, inside scans the processing budget never interrupts. Every row below
// measures between 1.2x and 4.1x for a 4x input and quadratic growth is 16x, so the ceiling sits at
// 6x: close enough to catch it, far enough from the measured spread.
const SCALING = [
  ['nested JSON arrays', 'json', nestedArrays, 1500, 6000, 60],
  ['nested JSON objects', 'json', nestedObjects, 1000, 4000, 60],
  ['stacked YAML flow openers', 'yaml', stackedFlowOpeners, 700, 2800, 60],
  // These typeset one value per level/element, so the budget covers the pipeline runs too; the
  // ratio is what pins the scan itself to the document size.
  ['YAML flow values at depth', 'yaml', deepFlowValues, 300, 1200, 150],
  ['YAML flow elements in one collection', 'yaml', wideFlowSequence, 200, 800, 150],
  ['TOML inline array elements', 'toml', wideInlineArray, 200, 800, 150],
  ['YAML flow words with no comma', 'yaml', commalessFlowLine, 1000, 4000, 150]
];

for (const [name, format, document, smallSize, largeSize, budgetMs] of SCALING) {
  test(`${name} scale with document size, not with size squared`, () => {
    const typo = new MicroTypo({ input: { format }, maxProcessingMs: 0 });

    const small = once(() => typo.process(document(smallSize)));
    const large = once(() => typo.process(document(largeSize)));

    assert.ok(large < budgetMs, `${name} at ${largeSize} took ${large.toFixed(1)}ms`);
    assert.ok(
      large < small * 6 + 2,
      `4x the size cost ${(large / small).toFixed(1)}x the time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms)`
    );
  });
}

// One value per level, and an indexed bucket of selectors that matches none of them. Every span is
// rejected on its last segment, which the chain's own position already is: building the whole
// ancestry to read it makes the rejection cost the depth.
const nestedValues = (depth) => {
  let body = '{"v":"Корвин - принц"}';

  for (let i = depth; i > 0; i -= 1) {
    body = `{"v":"Корвин - принц","n":${body}}`;
  }

  return body;
};

const tomlHeader = (depth) =>
  `[[seed]]\nv = 1\n[${Array.from({ length: depth }, (_, i) => `a${i}`).join('.')}]\nv = "Корвин - принц"\n`;

// A header's counters live in a tree, one node per segment, so k segments cost k lookups; one
// accumulated key carrying every ancestor and its index would build k strings of growing length.
test('a deep TOML header costs its segments, not their square', () => {
  once(() => scanToml(tomlHeader(400)));

  const small = once(() => scanToml(tomlHeader(400)));
  const large = once(() => scanToml(tomlHeader(1600)));

  assert.ok(
    large < small * 8 + 2,
    `4x the depth cost ${(large / small).toFixed(1)}x the time (${small.toFixed(2)}ms -> ${large.toFixed(2)}ms)`
  );
});

// Both shapes a selector set compiles to: past eight it is indexed by tail, at eight or fewer it is
// a plain list. Neither may read a span's whole ancestry before comparing the tail it can reject on.
for (const count of [8, 9]) {
  test(`rejecting ${count} selectors on their tail costs the document, not its square`, () => {
    const config = {
      input: { format: 'json', fields: Array.from({ length: count }, (_, i) => `/absent${i}`) },
      maxProcessingMs: 0,
      maxInputLength: 5_000_000
    };
    const typo = new MicroTypo(config);

    const small = once(() => typo.process(nestedValues(400)));
    const large = once(() => typo.process(nestedValues(1600)));

    assert.ok(
      large < small * 6 + 2,
      `4x the depth cost ${(large / small).toFixed(1)}x the time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms)`
    );
  });
}

// A flow sequence carries no `}` at all, so the search for the nearest delimiter must not run to the
// end of the document once per comma. Measured on the scanner: every element here is a bare word the
// pipeline leaves alone, and the sizes are past the default input cap `process()` enforces.
const commaFlowSequence = (elements) => `[${'Амбер,'.repeat(elements)}Амбер]`;

// The same miss one level up: the delimiter cursors belong to the document, so many small
// collections must not re-seed them and rescan the tail once per collection.
const manyFlowSequences = (lines) =>
  Array.from({ length: lines }, (_, i) => `ключ${i}: [Корвин, Рэндом, Дворкин]`).join('\n');

for (const [name, document, small, large] of [
  ['delimiters', commaFlowSequence, 8000, 32_000],
  ['collections', manyFlowSequences, 4000, 16_000]
]) {
  test(`YAML flow ${name} cost the document, not the document squared`, () => {
    const smallMs = once(() => scanYaml(document(small)));
    const largeMs = once(() => scanYaml(document(large)));

    assert.ok(largeMs < 60, `${large} at ${name} took ${largeMs.toFixed(1)}ms`);
    assert.ok(
      largeMs < smallMs * 6 + 2,
      `4x the size cost ${(largeMs / smallMs).toFixed(1)}x the time (${smallMs.toFixed(2)}ms -> ${largeMs.toFixed(2)}ms)`
    );
  });
}

// Measured on the scanner rather than through process(): the per-key path building this catches is
// microseconds against the pipeline runs for the same values, so a whole-document measurement drowns
// it and passes whatever the scanner does. The sizes are past the default input cap for the same
// reason — the cap is a setting, and the growth only separates from noise above it.
test('TOML key paths under a deep header cost the document, not the document squared', () => {
  const small = once(() => scanToml(deepTomlHeader(1000)));
  const large = once(() => scanToml(deepTomlHeader(4000)));

  assert.ok(
    large < small * 6 + 1,
    `4x the size cost ${(large / small).toFixed(1)}x the time (${small.toFixed(2)}ms -> ${large.toFixed(2)}ms)`
  );
});
