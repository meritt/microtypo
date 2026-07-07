import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

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
