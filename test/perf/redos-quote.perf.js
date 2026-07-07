import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { G } from '../../src/lib/glyphs.js';
import { processQuotes } from '../../src/rules/quote-state.js';

function benchNested(k) {
  const input = '«'.repeat(k) + '»'.repeat(k);
  const start = performance.now();
  processQuotes(input);
  return performance.now() - start;
}

// Quote state machine must be ~linear; isolated from the pipeline to keep the signal. 4x input grows ~4x if linear, ~16x if quadratic (pre-fix ~40x).
test('quote-state scales sub-quadratically on nested input', () => {
  benchNested(2_000); // warm up the JIT
  const t10 = Math.max(benchNested(10_000), 1);
  const t40 = benchNested(40_000);
  const ratio = t40 / t10;
  assert.ok(ratio < 8, `4x input scaled time ${ratio.toFixed(1)}x (expected < 8, quadratic ~16)`);
});

// Each "1»" is an unmatched close forcing the inch fallback; a backward resume re-scans a growing prefix (O(n^2)), a monotonic resume stays linear.
test('"1»"×k inch-fallback scales ~linearly', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const t = (k) => {
    const s = performance.now();
    typo.process('1»'.repeat(k));
    return performance.now() - s;
  };
  t(5000);
  const r = t(40000) / t(10000);
  assert.ok(r < 8, `quadratic tryConvertInches: ratio ${r.toFixed(1)} (linear≈4, quadratic≈16)`);
});

test('nested inch-fallback avoids repeated candidate reconstruction at default maxInputLength', () => {
  const group = `${G.LAQUO}${G.LAQUO}5${G.RAQUO}${G.LAQUO}5${G.RAQUO}${G.RAQUO}`; // «« 5 » « 5 » »
  const reps = 3_333; // 9 chars/rep (8-char group + 1 trailing »); 9*3333 = 29_997, under the default 30_000 cap
  const text = group.repeat(reps) + G.RAQUO.repeat(reps);
  assert.ok(text.length <= 30_000, `payload ${text.length} exceeds default maxInputLength`);

  const typo = new MicroTypo();
  const start = performance.now();
  typo.process(text);
  const ms = performance.now() - start;
  assert.ok(ms < 600, `nested inch-fallback payload took ${ms.toFixed(0)}ms (expected < 600ms)`);
});
