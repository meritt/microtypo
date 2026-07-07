import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanFences, scanLinkDestinations } from '../../src/input/markdown.js';

// Many adjacent fence pairs, each found and consumed in one pass; the scan never revisits a line, so it stays O(n).
function buildFences(n) {
  return '```\nline\n```\n'.repeat(n);
}

test('scanFences (many small fenced blocks) scales ~linearly', () => {
  const t = (n) => {
    const src = buildFences(n);
    const start = performance.now();
    scanFences(src);
    return performance.now() - start;
  };

  t(2000); // warm up the JIT
  const base = Math.max(t(20000), 1);
  const ratio = t(40000) / base;
  assert.ok(ratio < 3, `quadratic scanFences: doubling input scaled ${ratio.toFixed(1)}x`);
});

// Single fence unclosed to EOF with many near-miss (too-short) lines between; must not exceed one pass over the body.
function buildUnclosedFence(n) {
  return `\`\`\`\n${"''\n".repeat(n)}`;
}

test('scanFences (single unclosed fence, many near-miss lines) scales ~linearly', () => {
  const t = (n) => {
    const src = buildUnclosedFence(n);
    const start = performance.now();
    scanFences(src);
    return performance.now() - start;
  };

  t(2000);
  const base = Math.max(t(20000), 1);
  const ratio = t(40000) / base;
  assert.ok(ratio < 3, `quadratic scanFences: doubling input scaled ${ratio.toFixed(1)}x`);
});

// Many "](" starts, no ')' anywhere — literal prose, not fail-open; the precomputed lastIndexOf(')') lets the scan bail once instead of rescanning per start.
function buildUnclosedLinks(n) {
  return '](/x'.repeat(n);
}

test('scanLinkDestinations (many unclosed "](" starts, no ) anywhere) resolves promptly, not quadratically', () => {
  const src = buildUnclosedLinks(50_000); // ~200 KB, zero ')' in the whole document
  const start = performance.now();
  const spans = scanLinkDestinations(src);
  const ms = performance.now() - start;

  assert.deepEqual(spans, []);
  assert.ok(
    ms < 30,
    `literal-resolve cost should be O(MAX_LINK_SCAN), not O(n): took ${ms.toFixed(1)}ms`
  );
});

// Same shape but each destination has a nested never-closed '(', exercising balanced-paren depth tracking; still no ')', so all stay literal.
function buildUnbalancedParenLinks(n) {
  return '](a('.repeat(n);
}

test('scanLinkDestinations (many unclosed nested-paren destinations, no ) anywhere) resolves promptly, not quadratically', () => {
  const src = buildUnbalancedParenLinks(50_000);
  const start = performance.now();
  const spans = scanLinkDestinations(src);
  const ms = performance.now() - start;

  assert.deepEqual(spans, []);
  assert.ok(
    ms < 30,
    `literal-resolve cost should be O(MAX_LINK_SCAN), not O(n): took ${ms.toFixed(1)}ms`
  );
});

// Same density but one ')' exists far beyond the scan bound — must fail closed on the first attempt, not scan ahead.
function buildUnclosedLinksWithFarClose(n) {
  return `${'](/x'.repeat(n)})`;
}

test('scanLinkDestinations (many unclosed "](" starts, one ) far beyond the cap) fails closed promptly, not quadratically', () => {
  const src = buildUnclosedLinksWithFarClose(50_000);
  const start = performance.now();
  assert.throws(() => scanLinkDestinations(src), { code: 'ERR_MICROTYPO_INPUT' });
  const ms = performance.now() - start;
  assert.ok(
    ms < 30,
    `fail-closed scan cost should be O(MAX_LINK_SCAN), not O(n): took ${ms.toFixed(1)}ms`
  );
});
