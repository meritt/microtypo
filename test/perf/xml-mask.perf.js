import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';
import { scanXmlSpacePreserve, validateXml } from '../../src/input/xml.js';

// Calls validateXml directly, bypassing the maxInputLength cap, to measure the construct mask itself; it must stay O(n), not O(n^2).
function build(n) {
  let s = '<root>';

  for (let i = 0; i < n; i += 1) {
    s += `<x><!-- comment ${i} --></x>`;
  }

  return `${s}</root>`;
}

test('XML masking (many small comments) scales ~linearly, not quadratically', () => {
  const t = (n) => {
    const src = build(n);
    const start = performance.now();
    validateXml(src);
    return performance.now() - start;
  };

  t(2000); // warm up the JIT
  const base = Math.max(t(20000), 1);
  const ratio = t(40000) / base;
  assert.ok(
    ratio < 3,
    `quadratic XML masking: doubling input scaled ${ratio.toFixed(1)}x (expected < 3)`
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
  const t = (n) => {
    const src = buildSpacePreserve(n);
    const start = performance.now();
    scanXmlSpacePreserve(src);
    return performance.now() - start;
  };

  t(2000); // warm up the JIT
  const base = Math.max(t(20000), 1);
  const ratio = t(40000) / base;
  assert.ok(
    ratio < 3,
    `quadratic scanXmlSpacePreserve: doubling input scaled ${ratio.toFixed(1)}x (expected < 3)`
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
function bareAngleScan(n) {
  const src = '<'.repeat(n);
  const start = performance.now();

  validateXml(src);

  return performance.now() - start;
}
test('a run of bare `<` scales ~linearly, not quadratically', () => {
  bareAngleScan(2000); // warm up the JIT
  const base = Math.max(bareAngleScan(8000), 0.5);
  const ratio = bareAngleScan(16_000) / base;

  assert.ok(
    ratio < 3,
    `quadratic bare-'<' scan: doubling input scaled ${ratio.toFixed(1)}x (expected < 3)`
  );
});

test('full XML pipeline with xml:space="preserve" siblings scales ~linearly', () => {
  const t = (n) => {
    const src = buildSpacePreserve(n);
    const config = { input: { format: 'xml' }, maxInputLength: 5_000_000, maxProcessingMs: 0 };
    const start = performance.now();
    microtypo(src, config);
    return performance.now() - start;
  };

  t(2000); // warm up the JIT
  const base = Math.max(t(8000), 1);
  const ratio = t(16000) / base;
  assert.ok(
    ratio < 3,
    `quadratic full XML pipeline with xml:space: doubling input scaled ${ratio.toFixed(1)}x (expected < 3)`
  );
});
