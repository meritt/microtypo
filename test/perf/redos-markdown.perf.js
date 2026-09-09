import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codeSpanReader,
  opaqueInline,
  scanCodeSpans,
  scanFences,
  scanIndentedCode,
  scanLinePrefix,
  scanLinkDestinations,
  scanReferenceDefinitions
} from '../../src/input/markdown.js';
import { templateReader } from '../../src/input/template.js';

// Best of three at each size, and a fourfold step: one timed pass at a few milliseconds picks up GC
// and scheduling noise large enough to swamp the ratio. Linear growth lands near 4x, quadratic near
// 16x, and the slack term absorbs a noise floor without letting the two verdicts meet.
function assertLinear(name, scan, build) {
  const best = (n) => {
    const src = build(n);
    let ms = Infinity;

    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      scan(src);
      ms = Math.min(ms, performance.now() - start);
    }

    return ms;
  };

  best(4000);
  const small = best(40_000);
  const large = best(160_000);

  assert.ok(
    large < small * 8 + 5,
    `quadratic ${name}: 4x the input cost ${(large / small).toFixed(1)}x the time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms)`
  );
}

// Many adjacent fence pairs, each found and consumed in one pass: the scan never revisits a line.
test('scanFences (many small fenced blocks) scales ~linearly', () => {
  assertLinear('scanFences', scanFences, (n) => '```\nline\n```\n'.repeat(n));
});

// One fence unclosed to EOF with many too-short near-miss lines between, which must not cost more
// than a single pass over the body.
test('scanFences (single unclosed fence, many near-miss lines) scales ~linearly', () => {
  assertLinear('scanFences', scanFences, (n) => `\`\`\`\n${"''\n".repeat(n)}`);
});

// Many `](` starts and no `)` anywhere, which is literal prose rather than a fail-open: the
// precomputed last `)` lets the scan bail once instead of rescanning per start.
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

// The same shape with a nested never-closed `(` in each destination, so the balanced-paren depth
// tracking runs; still no `)`, so all of them stay literal.
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

// The same density with one `)` far beyond the scan bound, which must fail closed on the first
// attempt rather than scan ahead.
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

test('scanCodeSpans (many closed spans) scales ~linearly', () => {
  assertLinear('scanCodeSpans', scanCodeSpans, (n) => '`код` '.repeat(n));
});

// Every run is a different length, so none can close another, and the closer table still has to
// resolve in one backward pass.
test('scanCodeSpans (many never-closing runs of distinct lengths) scales ~linearly', () => {
  assertLinear('scanCodeSpans', scanCodeSpans, (n) => {
    const parts = [];

    for (let i = 0; i < n; i += 1) {
      parts.push('`'.repeat((i % 64) + 1), 'x');
    }

    return parts.join('');
  });
});

test('scanIndentedCode (alternating code and prose lines) scales ~linearly', () => {
  assertLinear('scanIndentedCode', scanIndentedCode, (n) => 'Амбер\n\n    код\n'.repeat(n));
});

// The container prefix costs the prefix, never the prefix once per container on it: each level
// starts where the one above it stopped, and the thematic-break question is asked of the whole line
// once.
test('scanFences (deeply nested list markers) scales ~linearly', () => {
  assertLinear(
    'scanFences',
    scanFences,
    (n) => `${'- '.repeat(n)}\`\`\`\n${'  '.repeat(n)}код\n${'  '.repeat(n)}\`\`\`\n`
  );
});

test('scanIndentedCode (a line of nothing but markers) scales ~linearly', () => {
  assertLinear('scanIndentedCode', scanIndentedCode, (n) => `${'- '.repeat(n)}Корвин\n`);
});

test('scanLinePrefix (every line indented) scales ~linearly', () => {
  assertLinear('scanLinePrefix', scanLinePrefix, (n) => '    Корвин\n'.repeat(n));
});

test('scanReferenceDefinitions (many near-miss "]:" lines) scales ~linearly', () => {
  assertLinear('scanReferenceDefinitions', scanReferenceDefinitions, (n) =>
    '[а]: /p "т" лишнее\n'.repeat(n)
  );
});

// The label walk runs only once a definition exists, and each `[` stops at the next bracket, so two
// scans never cover the same stretch.
test('scanReferenceDefinitions (many uses of one defined label) scales ~linearly', () => {
  assertLinear(
    'scanReferenceDefinitions',
    scanReferenceDefinitions,
    (n) => `[амбер]: /p\n${'[Книга][амбер] '.repeat(n)}`
  );
});

test('scanReferenceDefinitions (many never-closing "[" starts) scales ~linearly', () => {
  assertLinear(
    'scanReferenceDefinitions',
    scanReferenceDefinitions,
    (n) => `[амбер]: /p\n${'[Хаос '.repeat(n)}`
  );
});

// A line that leaves a container may still be the paragraph inside it continuing, and the chain it
// left has to survive that question without being cut and pushed back per line.
test('a lazy continuation under a deep container chain scales ~linearly', () => {
  assertLinear(
    'scanIndentedCode',
    scanIndentedCode,
    (n) => `${'> '.repeat(n / 9)}Корвин\n${'Рэндом\n'.repeat(n / 9)}`
  );
});

// The two opaque inline constructs are settled against each other by one walk, so a document of k
// code spans and k expressions costs k steps rather than a membership test per pair.
test('code spans and template expressions settle in ~linear time', () => {
  const settle = opaqueInline(codeSpanReader, templateReader('mustache'));

  assertLinear('opaqueInline', settle, (n) => '`К` {{Р}}\n'.repeat(n / 10));
});

// The same walk on a document whose two constructs cut each other on every construct: a reader is
// asked again only where the walk has overrun its last answer, and each such answer lies further
// along than the one before it.
test('alternating opaque constructs settle in ~linear time', () => {
  const settle = opaqueInline(codeSpanReader, templateReader('mustache'));

  assertLinear('opaqueInline', settle, (n) => '{{ ` }}'.repeat(n / 7));
});

// The construct that cuts the other one on every unit, from both sides at once: a template closed
// across a backtick, and a code span closed across an expression.
test('constructs that cut each other from both sides settle in ~linear time', () => {
  const settle = opaqueInline(codeSpanReader, templateReader('mustache'));

  assertLinear('opaqueInline', settle, (n) => '{{`}}`'.repeat(n / 6));
});

// One far-off expression behind many code spans: the walk keeps an answer that still lies ahead, so
// finding that expression is paid for once and not once per span.
test('many code spans in front of one expression stay ~linear', () => {
  const settle = opaqueInline(codeSpanReader, templateReader('mustache'));

  assertLinear('opaqueInline', settle, (n) => `${'`К` '.repeat(n / 4 - 2)}{{Р}}`);
});
