// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node from
// `.nvmrc`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';
import { scanXmlSpacePreserve, validateXml } from '../../src/input/xml.js';

// Best of three per size with the rounds interleaved, so a burst of load lands on both sizes, and a
// fourfold step: linear growth lands near 4x and quadratic near 16x. One pass per size of a doubling
// scaled a linear walk past 3x under load, which no margin between 2x and 4x absorbs. `floor` keeps a
// sub-millisecond small size from turning scheduler jitter into the ratio.
function growth(run, src, small, floor) {
  const time = (input) => {
    const start = performance.now();
    run(input);
    return performance.now() - start;
  };
  const a = src(small);
  const b = src(small * 4);
  let smallMs = Infinity;
  let largeMs = Infinity;

  time(src(small / 10)); // warm up the JIT

  for (let i = 0; i < 3; i += 1) {
    smallMs = Math.min(smallMs, time(a));
    largeMs = Math.min(largeMs, time(b));
  }

  return largeMs / Math.max(smallMs, floor);
}

// Calls validateXml directly, bypassing the maxInputLength cap, to measure the construct mask itself; it must stay O(n), not O(n^2).
function build(n) {
  let s = '<root>';

  for (let i = 0; i < n; i += 1) {
    s += `<x><!-- comment ${i} --></x>`;
  }

  return `${s}</root>`;
}

test('XML masking (many small comments) scales ~linearly, not quadratically', () => {
  const ratio = growth(validateXml, build, 10_000, 1);

  assert.ok(
    ratio < 8,
    `quadratic XML masking: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});

// scanXmlSpacePreserve adds one bounded regex test per open tag's attribute span; each tag's work is bounded by its own length, so total stays O(n).
function buildSpacePreserve(n) {
  let s = '<root>';

  for (let i = 0; i < n; i += 1) {
    s += `<x xml:space="preserve">a ${i}</x><y>b ${i}</y>`;
  }

  return `${s}</root>`;
}

test('scanXmlSpacePreserve (many preserve + plain siblings) scales ~linearly', () => {
  const ratio = growth(scanXmlSpacePreserve, buildSpacePreserve, 10_000, 1);

  assert.ok(
    ratio < 8,
    `quadratic scanXmlSpacePreserve: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});

test('scanXmlSpacePreserve returns promptly when xml:space is absent', () => {
  const src = `<root>${'<x>Корвин - Рэндом</x>'.repeat(100_000)}</root>`;
  scanXmlSpacePreserve(src);

  const start = performance.now();
  const spans = scanXmlSpacePreserve(src);
  const ms = performance.now() - start;

  assert.deepEqual(spans, []);
  assert.ok(ms < 8, `absent xml:space scan took ${ms.toFixed(1)}ms (expected < 8ms)`);
});

// A `<` that opens no tag is the cheapest thing an attacker writes. Scanning the whole name run
// before asking whether the first character may start one re-read the same suffix from every one of
// them, and this walk has no budget check of its own to interrupt it.
test('a run of bare `<` scales ~linearly, not quadratically', () => {
  const ratio = growth(validateXml, (n) => '<'.repeat(n), 8000, 0.5);

  assert.ok(
    ratio < 8,
    `quadratic bare-'<' scan: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});

// The document's edge white space is cut off by a walk in from each end, so a run of spaces inside it
// is read once, not once from every space it holds.
test('a long run of spaces inside the XML document scales ~linearly', () => {
  const config = { input: { format: 'xml' }, maxInputLength: 5_000_000, maxProcessingMs: 0 };
  const ratio = growth(
    (src) => microtypo(src, config),
    (n) => `<r>a${' '.repeat(n)}b</r>`,
    5000,
    1
  );

  assert.ok(
    ratio < 8,
    `quadratic XML edge trim: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});

test('full XML pipeline with xml:space="preserve" siblings scales ~linearly', () => {
  const config = { input: { format: 'xml' }, maxInputLength: 5_000_000, maxProcessingMs: 0 };
  const ratio = growth((src) => microtypo(src, config), buildSpacePreserve, 4000, 1);

  assert.ok(
    ratio < 8,
    `quadratic full XML pipeline with xml:space: 4x the input scaled ${ratio.toFixed(1)}x (expected < 8)`
  );
});
