import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearSpecialChars } from '../../src/clear-special.js';
import { MicroTypoBudgetError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { scanLinkDestinations } from '../../src/input/markdown.js';
import { SafeBlocks } from '../../src/protect/blocks.js';

// Smoke perf tests, not benchmarks; loosen thresholds on a slow dev box.

const SHORT = 'Корвин купил «Грейсвандир» за 1000 рублей 31 января 2009 года.';
const LONG = `${SHORT}\n\n`.repeat(50);

function bench(fn, iter = 1000) {
  const start = process.hrtime.bigint();

  for (let i = 0; i < iter; i++) {
    fn();
  }

  const ns = Number(process.hrtime.bigint() - start);

  return ns / iter / 1_000_000;
}

test('functional API: short input < 5ms median (1000 runs)', () => {
  const ms = bench(() => microtypo(SHORT));
  assert.ok(ms < 5, `Got ${ms.toFixed(2)}ms per call (expected < 5)`);
});

test('reused instance: short input < 1ms median (1000 runs)', () => {
  const typo = new MicroTypo();
  const ms = bench(() => typo.process(SHORT));
  assert.ok(ms < 1, `Got ${ms.toFixed(3)}ms per call (expected < 1)`);
});

test('reused instance vs functional API: instance is faster', () => {
  const typo = new MicroTypo();
  const fn = bench(() => microtypo(SHORT));
  const inst = bench(() => typo.process(SHORT));
  assert.ok(inst < fn, `instance ${inst.toFixed(3)}ms vs functional ${fn.toFixed(3)}ms`);
});

test('long input ~50 paragraphs processes < 50ms', () => {
  const start = performance.now();
  microtypo(LONG);
  const ms = performance.now() - start;
  assert.ok(ms < 50, `Got ${ms.toFixed(1)}ms (expected < 50)`);
});

test('memory: 5000 unique inputs on shared instance does not leak', () => {
  const typo = new MicroTypo();
  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < 5000; i++) {
    typo.process(`<pre>amber-${i}</pre> http://amber.example/${i} corwin${i}@amber.example "${i}"`);
  }
  if (globalThis.gc) {
    globalThis.gc();
  }

  const after = process.memoryUsage().heapUsed;
  const growthMB = (after - before) / 1024 / 1024;
  // Without --expose-gc this is fuzzy; just a GB-land sanity check.
  assert.ok(growthMB < 50, `Heap grew ${growthMB.toFixed(2)} MB`);
});

test('clearSpecialChars: 29K mixed-glyph input processes well under threshold', () => {
  const chunk =
    'Тест &amp; текст &hellip; a &nbsp; b &ndash; c &mdash; d &laquo;e&raquo; 5 &times; 5 &#169;\n';
  const text = chunk.repeat(Math.ceil(29_000 / chunk.length));
  const ms = bench(() => clearSpecialChars(text), 100);
  assert.ok(ms < 5, `Got ${ms.toFixed(3)}ms per call (expected < 5)`);
});

test('cycled rules with big repeated input do not exceed cap', () => {
  const typo = new MicroTypo();
  const text = '5x5x5x5x5x5x5x5x5'.repeat(100);
  const start = performance.now();
  typo.process(text);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `cycled rule blew up: ${ms.toFixed(1)}ms`);
});

// Near the 30_000 maxInputLength cap: guards the whole pipeline against quadratic regressions within the accepted input range.
const NEAR_CAP = 29_000;

test('near-cap: 29K repeated single char processes < 200ms', () => {
  const input = 'a'.repeat(NEAR_CAP);
  const start = performance.now();
  microtypo(input);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `Got ${ms.toFixed(1)}ms (expected < 200)`);
});

test('near-cap: 29K long-word/repeated-token input processes < 200ms', () => {
  const input = 'слово-слово '.repeat(Math.ceil(NEAR_CAP / 'слово-слово '.length));
  const start = performance.now();
  microtypo(input);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `Got ${ms.toFixed(1)}ms (expected < 200)`);
});

test('near-cap: 29K digits input processes < 200ms', () => {
  const input = '1234567890'.repeat(NEAR_CAP / 10);
  const start = performance.now();
  microtypo(input);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `Got ${ms.toFixed(1)}ms (expected < 200)`);
});

// A cycled loop must check the budget each iteration; assert.throws alone can't tell prompt interruption from an eventual throw after 100 iterations.
test('cycled rule respects maxProcessingMs (interrupted promptly, not after 100 iterations)', () => {
  const typo = new MicroTypo({ presets: false, maxProcessingMs: 20 });
  typo.registerRuleGroup(
    {
      title: 'slow',
      rules: [
        {
          id: 'slow',
          cycled: true,
          handler: (ctx) => {
            const e = performance.now() + 5;

            while (performance.now() < e) {
              // busy-wait
            }

            return `${ctx.text}x`;
          }
        }
      ]
    },
    { name: 'slow' }
  );

  const start = performance.now();
  assert.throws(() => typo.process('a'), MicroTypoBudgetError);
  const ms = performance.now() - start;
  assert.ok(ms < 100, `cycle() ignored the budget: took ${ms.toFixed(1)}ms (expected < 100)`);
});

// Isolated at the SafeBlocks level: the full pipeline's URL/email scan would mask whether the scanner's budget check actually fires.
const oneLink = `[x](/p/${'a'.repeat(4000)})`;
const manyValidLinks = oneLink.repeat(1200); // ~4.8M chars, every link valid and in-bound (never OVERLIMIT)

test('SafeBlocks scanner budget check survives large per-match jumps (many valid links)', () => {
  // A match advances the scan by the whole span; a bitmask-keyed periodic check can stride over every checkpoint when matches are large and regular.
  const sb = new SafeBlocks();
  sb.addScanner('md-link-destination', scanLinkDestinations);

  let calls = 0;
  sb.protect(manyValidLinks, () => {
    calls += 1;
  });

  assert.ok(calls > 10, `checkBudget fired only ${calls} times over ~1200 valid matches`);
});

test('SafeBlocks.protect aborts a long in-bound scan promptly once the budget trips', () => {
  const sb = new SafeBlocks();
  sb.addScanner('md-link-destination', scanLinkDestinations);

  const start = performance.now();
  const t0 = performance.now();
  assert.throws(() => {
    sb.protect(manyValidLinks, () => {
      if (performance.now() - t0 > 1) {
        throw new MicroTypoBudgetError('budget exceeded', { details: { where: 'test' } });
      }
    });
  }, MicroTypoBudgetError);
  const elapsed = performance.now() - start;
  assert.ok(
    elapsed < 15,
    `scan should abort well before its unguarded ~20ms+ completion: took ${elapsed.toFixed(1)}ms`
  );
});

test('SafeBlocks scanner output building stays linear with many tiny spans', () => {
  const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });
  typo.addSafeBlock({ id: 'amber-note', open: '<note>', close: '</note>' });
  const src = `${'<note>Корвин - Эрик</note>Рэндом - Бенедикт '.repeat(20_000)}`;

  typo.process(src);

  const start = performance.now();
  typo.process(src);
  const ms = performance.now() - start;

  assert.ok(ms < 1500, `many safe-block spans took ${ms.toFixed(0)}ms`);
});

test('SafeSequences returns promptly when text has no URL/email candidate characters', () => {
  const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });
  const src = 'Корвин Рэндом Амбер Арден Лабиринт '.repeat(4000);

  typo.process(src);

  const start = performance.now();
  typo.process(src);
  const ms = performance.now() - start;

  assert.ok(ms < 40, `no-candidate sequence protection took ${ms.toFixed(1)}ms`);
});
