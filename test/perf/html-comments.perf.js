// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node from
// `.nvmrc`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanUnclosedHtmlBlock } from '../../src/input/markdown.js';
import { scanHtmlComments } from '../../src/protect/blocks.js';

const K = 50000;

// Calls the scanners directly, bypassing maxInputLength. A ceiling rather than a ratio, as in
// tag-spans.perf.js: a search for `-->` per opener reads the tail once per opener, which at this size
// takes seconds, while the single search takes a few milliseconds.
function bestOfThree(scan, src) {
  let ms = Infinity;

  for (let round = 0; round < 3; round += 1) {
    const start = performance.now();

    scan(src);

    ms = Math.min(ms, performance.now() - start);
  }

  return ms;
}

test('comment openers with no closer are searched once, not once per opener', () => {
  const ms = bestOfThree(scanHtmlComments, 'Корвин <!-- Амбер '.repeat(K));

  assert.ok(ms < 100, `repeated comment closer search: ${ms.toFixed(1)}ms at k=${K}`);
});

test('markdown HTML-block openers with no end are searched once, not once per opener', () => {
  const ms = bestOfThree(scanUnclosedHtmlBlock, '\n<pre x\n</pre Корвин <!-- Амбер '.repeat(K));

  assert.ok(ms < 300, `repeated HTML-block end search: ${ms.toFixed(1)}ms at k=${K}`);
});
