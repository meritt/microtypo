import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';
import { scanXmlSpacePreserve, validateXml } from '../../src/input/xml.js';

// Calls validateXml directly, bypassing the maxInputLength cap, to measure the scan (maskConstructs) itself; it must stay O(n), not O(n^2).
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
