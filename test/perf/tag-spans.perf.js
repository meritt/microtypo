// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node from
// `.nvmrc`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tagSpans } from '../../src/protect/tag-spans.js';

const RAW = new Set(['script', 'style', 'textarea']);

// An accepted unclosed document, not a claim that it is a well-formed script element: this engine
// reads an opener with no end tag as ordinary markup. Either way the search for that end tag has to
// read the tail once rather than once per opener.
const unclosed = (k) => `${'<script>'.repeat(k)}${'</amber>'.repeat(k)}Корвин`;

// The mirror control: every opener has its closer, so the negative answer is never reached and the
// walk pays one search per element whether or not anything is remembered.
const closed = (k) => '<script>Корвин</script><textarea>Амбер</textarea>'.repeat(k);

const K = 20000;

// Calls tagSpans directly, bypassing maxInputLength, to measure the scan itself. A ceiling rather
// than a ratio, because the two regimes are not neighbours: at this size the linear walk measured
// 2.9 ms and 8.4 ms, while the repeated search this guards against needs `k(k+1)` candidate
// positions — measured at 329 ms for k=4000 alone, so seconds here. A ratio between two numbers of a
// few milliseconds measures the machine's scheduler instead, which is why it is not one.
function bestOfThree(build) {
  const src = build(K);
  let ms = Infinity;

  for (let round = 0; round < 3; round += 1) {
    const start = performance.now();

    tagSpans(src, RAW);

    ms = Math.min(ms, performance.now() - start);
  }

  return ms;
}

test('a raw-text name with no closer is searched once, not once per opener', () => {
  const ms = bestOfThree(unclosed);

  assert.ok(ms < 100, `repeated raw closer search: ${ms.toFixed(1)}ms at k=${K} (expected < 100)`);
});

test('closed raw-text siblings still scale linearly', () => {
  const ms = bestOfThree(closed);

  assert.ok(ms < 150, `repeated raw closer search: ${ms.toFixed(1)}ms at k=${K} (expected < 150)`);
});

// An end tag naming an element open below a run it may not pass over closes nothing, so each one
// would read the whole run again: HTML elements whose end tag may be left out under a `<span>`, and
// SVG under foreignObject over and over below an HTML `<div>`. Bounded, each shape measured about
// 20 ms here; unbounded, 4.4 s.
const optionalRun = (k) =>
  `<svg><foreignObject><div><span>${'<option><rt>'.repeat(k)}${'</div>'.repeat(k)}`;
const foreignRun = (k) =>
  `<svg><foreignObject><div>${'<svg><foreignObject>'.repeat(k)}${'</div>'.repeat(k)}`;

test('end tags that close nothing past a run of open elements stay linear', () => {
  for (const build of [optionalRun, foreignRun]) {
    const ms = bestOfThree(build);

    assert.ok(ms < 100, `end tag search: ${ms.toFixed(1)}ms at k=${K} (expected < 100)`);
  }
});
