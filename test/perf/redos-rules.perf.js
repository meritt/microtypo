import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

// Quadratic backtracking on long single-char runs; 29_990 stays under the 30_000 cap so input is accepted, then must process fast.
const N = 29_990;
const BOMBS = ['a', 'я', '1', ' ', '\n'];

function best(fn, n) {
  let ms = Infinity;

  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    fn(n);
    ms = Math.min(ms, performance.now() - start);
  }

  return ms;
}

for (const ch of BOMBS) {
  test(`${JSON.stringify(ch)}×${N} processes < 200ms`, () => {
    const typo = new MicroTypo();
    const input = ch.repeat(N);
    const start = performance.now();
    typo.process(input);
    const ms = performance.now() - start;
    assert.ok(ms < 200, `quadratic blowup on ${JSON.stringify(ch)}: ${ms.toFixed(0)}ms`);
  });
}

test('number/date groups keep no-digit prose within budget', () => {
  const src = 'Корвин Рэндом Амбер Арден Лабиринт '.repeat(2000);
  const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });

  typo.process(src);

  const start = performance.now();
  typo.process(src);
  const ms = performance.now() - start;

  assert.ok(ms < 80, `no-digit prose took ${ms.toFixed(1)}ms`);
});

// URL_REGEX quadratic on dotted/hyphenated ASCII runs (NOT Latin1-masked).
for (const unit of ['a.', '1.', 'a-', '1.0.']) {
  test(`${JSON.stringify(unit)}×N scales ~linearly`, () => {
    const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
    const t = (n) => {
      typo.process(unit.repeat(n));
    };
    t(4000); // warm
    const r = best(t, 16000) / best(t, 8000);
    assert.ok(r < 3, `quadratic URL_REGEX on ${unit}: ratio ${r.toFixed(1)}`);
  });
}

// nbsp_volt — MUST be Cyrillic-prefixed or V8 Latin1 masks the quadratic.
test('"я"+"1"×N scales ~linearly', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const t = (n) => {
    typo.process(`я${'1'.repeat(n)}`);
  };
  t(8000);
  const r = best(t, 60000) / best(t, 30000);
  assert.ok(r < 3, `quadratic nbsp_volt: ratio ${r.toFixed(1)}`);
});

// nbsp_frequency_unit / nbsp_css_unit on "1,"/"1." runs.
for (const unit of ['1,', '1.']) {
  test(`" "+${JSON.stringify(unit)}×N scales ~linearly`, () => {
    const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
    const t = (n) => {
      typo.process(` ${unit.repeat(n)}`);
    };
    t(8000);
    const r = best(t, 60000) / best(t, 30000);
    assert.ok(r < 3, `quadratic abbr unit on ${unit}: ratio ${r.toFixed(1)}`);
  });
}

// TAG_RE was exponential on a stray-quote run before an unterminated tag opener; it hangs inside an atomic String.replace before any budget checkpoint, so small n keeps a reintroduced regression at low seconds instead of a suite hang.
test('TAG_RE linear on stray-quote run before an unterminated tag', () => {
  const typo = new MicroTypo({ maxProcessingMs: 5_000 });
  const t = (n) => {
    const s = performance.now();
    typo.process(`<x ${'"'.repeat(n)}`);
    return performance.now() - s;
  };
  t(20); // warm
  const r = t(40) / t(30);
  assert.ok(r < 3, `exponential TAG_RE backtracking: ratio ${r.toFixed(1)} for +10 quote chars`);

  const ms = t(400);
  assert.ok(ms < 100, `TAG_RE too slow on 400 stray quotes: ${ms.toFixed(1)}ms`);
});
