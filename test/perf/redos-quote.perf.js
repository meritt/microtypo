import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { G } from '../../src/lib/glyphs.js';
import { processQuotes } from '../../src/rules/quote-state.js';

// Best of three: at these sizes a single unwarmed pass swings the ratio far enough on a loaded
// machine to fail a linear scan, and the gap between linear (~4x) and quadratic (~16x) is what the
// threshold has to read.
function best(run, k) {
  let ms = Infinity;

  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    run(k);
    ms = Math.min(ms, performance.now() - start);
  }

  return ms;
}

const nested = (k) => processQuotes('«'.repeat(k) + '»'.repeat(k));

// The quote state machine has to stay near-linear, and is isolated from the pipeline to keep the
// signal: a 4x input grows about 4x if linear and about 16x if quadratic.
test('quote-state scales sub-quadratically on nested input', () => {
  best(nested, 2_000); // warm up the JIT
  const ratio = best(nested, 40_000) / Math.max(best(nested, 10_000), 1);

  assert.ok(ratio < 8, `4x input scaled time ${ratio.toFixed(1)}x (expected < 8, quadratic ~16)`);
});

// Each `1»` is an unmatched close forcing the inch fallback: a backward resume re-scans a growing
// prefix, while a monotonic one stays linear.
test('"1»"×k inch-fallback scales ~linearly', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const run = (k) => typo.process('1»'.repeat(k));

  best(run, 5000);
  const ratio = best(run, 40_000) / best(run, 10_000);

  assert.ok(
    ratio < 8,
    `quadratic tryConvertInches: ratio ${ratio.toFixed(1)} (linear≈4, quadratic≈16)`
  );
});

// Each `" Корвин «` is a spaced quote whose partner stands past a balanced pair, so the search for
// it steps over that pair and keeps going. Answered by a scan per quote it reads to the end of the
// document every time, in a rule that polls no budget.
test('spaced-quote pairing scales ~linearly over stepped-over pairs', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const run = (k) => typo.process('" Корвин « '.repeat(k));

  best(run, 500);
  const ratio = best(run, 8_000) / best(run, 2_000);

  assert.ok(
    ratio < 8,
    `quadratic spaced-quote pairing: ratio ${ratio.toFixed(1)} (linear≈4, quadratic≈16)`
  );
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
