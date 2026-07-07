import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const SHORT = 'Корвин сказал: "Амбер рядом".';
const MEDIUM = `${'Корвин вернулся в Амбер, Рэндом ждал у Лабиринта. 1000 рублей, 12 - 19.\n\n'.repeat(30)}`;
const HTML = `<article><h1>Амбер</h1><p>${MEDIUM}</p><pre>Эрик - Бенедикт</pre></article>`;
const JSON_TEXT = JSON.stringify({
  items: Array.from({ length: 250 }, (_, i) => ({
    title: `Корвин ${i} - Рэндом`,
    body: 'Оберон сказал: "Амбер ждёт". 1000 рублей.'
  }))
});

function once(fn) {
  fn();

  let best = Infinity;

  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }

  return best;
}

test('P0 reused short text stays below 0.5ms', () => {
  const typo = new MicroTypo();
  const ms = once(() => typo.process(SHORT));

  assert.ok(ms < 0.5, `P0 short text took ${ms.toFixed(3)}ms`);
});

test('P0 medium prose stays below 5ms', () => {
  const typo = new MicroTypo();
  const ms = once(() => typo.process(MEDIUM));

  assert.ok(ms < 5, `P0 medium prose took ${ms.toFixed(1)}ms`);
});

test('P1 HTML article stays below 10ms', () => {
  const typo = new MicroTypo({ html: true, input: 'html', maxInputLength: 200_000 });
  const ms = once(() => typo.process(HTML));

  assert.ok(ms < 10, `P1 HTML article took ${ms.toFixed(1)}ms`);
});

test('P3 tag-dense HTML stays within raised-cap budget', () => {
  const html = Array.from(
    { length: 3000 },
    (_, i) => `<p>Корвин ${i} - Рэндом</p><code>Эрик ${i} - Бенедикт</code>`
  ).join('\n');
  const typo = new MicroTypo({
    html: true,
    input: 'html',
    maxInputLength: 1_000_000,
    maxProcessingMs: 0
  });

  const ms = once(() => typo.process(html));

  assert.ok(ms < 600, `tag-dense HTML took ${ms.toFixed(1)}ms`);
});

test('P2 selected JSON values stay below 80ms', () => {
  const typo = new MicroTypo({
    input: { format: 'json', fields: ['/items/*/title', '/items/*/body'] },
    maxInputLength: 1_000_000,
    maxProcessingMs: 0
  });
  const ms = once(() => typo.process(JSON_TEXT));

  assert.ok(ms < 80, `P2 selected JSON took ${ms.toFixed(1)}ms`);
});

test('functional API remains acceptable for one-off short calls', () => {
  const ms = once(() => microtypo(SHORT));

  assert.ok(ms < 2, `functional short call took ${ms.toFixed(3)}ms`);
});
