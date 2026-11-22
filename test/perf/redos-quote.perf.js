// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node pinned in
// `package.json`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

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

for (const [name, build] of [
  ['one balanced quotation', (n) => `«${'а😀'.repeat(n)}»`],
  ['an unclosed quotation', (n) => `«${'а😀'.repeat(n)}`]
]) {
  const time = (n) => {
    const text = build(n);
    let fastest = Infinity;
    for (let sample = 0; sample < 5; sample++) {
      const started = performance.now();
      for (let repeat = 0; repeat < 10; repeat++) {
        assert.equal(processQuotes(text), text);
      }
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  };
  test(`${name} over long content grows linearly`, (t) => {
    time(1000);
    const [one, two, four] = [time(10000), time(20000), time(40000)];
    const detail = `${name}: N ${one.toFixed(3)}ms, 2N ${two.toFixed(3)}ms, 4N ${four.toFixed(3)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}

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

// Best of three per size with the rounds interleaved, so a burst of load lands on both sizes, and a
// fourfold step: linear growth lands near 4x and quadratic near 16x. `floor` keeps a
// sub-millisecond small size from turning scheduler jitter into the ratio.
function growth(run, small, floor) {
  const time = (k) => {
    const start = performance.now();
    run(k);
    return performance.now() - start;
  };
  let smallMs = Infinity;
  let largeMs = Infinity;

  time(small / 10); // warm up the JIT

  for (let i = 0; i < 3; i += 1) {
    smallMs = Math.min(smallMs, time(small));
    largeMs = Math.min(largeMs, time(small * 4));
  }

  return largeMs / Math.max(smallMs, floor);
}

const group = `${G.LAQUO}${G.LAQUO}5${G.RAQUO}${G.LAQUO}5${G.RAQUO}${G.RAQUO}`; // «« 5 » « 5 » »
const nestedInches = (reps) => processQuotes(group.repeat(reps) + G.RAQUO.repeat(reps));

// Each trailing `»` is unmatched: it turns the last `5»` behind it into a prime and walks again
// from the balanced point in front of that, through a tail that grows with every closer. Taken
// mark by mark, those walks reread the input hundreds of times over.
test('nested inch-fallback scales ~linearly', () => {
  const ratio = growth(nestedInches, 2_000, 1);

  assert.ok(
    ratio < 8,
    `quadratic nested inch-fallback: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});

test('nested inch-fallback stays fast at default maxInputLength', () => {
  const reps = 3_333; // 9 chars/rep (8-char group + 1 trailing »); 9*3333 = 29_997, under the default 30_000 cap
  const text = group.repeat(reps) + G.RAQUO.repeat(reps);
  assert.ok(text.length <= 30_000, `payload ${text.length} exceeds default maxInputLength`);

  const typo = new MicroTypo();
  const start = performance.now();
  typo.process(text);
  const ms = performance.now() - start;
  assert.ok(ms < 600, `nested inch-fallback payload took ${ms.toFixed(0)}ms (expected < 600ms)`);
});

// Every closer here stands where an opener stands, with a straight quote glued behind it: the walk
// turns it and asks what the opening rule writes for that quote. Asked on a copy of the paragraph
// made for each closer, that is a reading of the paragraph per closer.
test('closers turned into openers with a straight quote behind them scale ~linearly', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const ratio = growth((k) => typo.process(' »"а»»'.repeat(k)), 4_000, 1);

  assert.ok(
    ratio < 8,
    `quadratic turn of a wrong-way closer: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});
