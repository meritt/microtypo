import assert from 'node:assert/strict';
import { test } from 'node:test';

import { templateScanner } from '../../src/input/template.js';

test('templateScanner("handlebars") returns promptly when no opener exists', () => {
  const scan = templateScanner('handlebars');
  const src = 'Корвин }} Рэндом '.repeat(50_000);

  scan(src);

  const start = performance.now();
  assert.deepEqual(scan(src), []);
  const ms = performance.now() - start;

  assert.ok(ms < 5, `no-op template scan took ${ms.toFixed(1)}ms`);
});

// Many "{{" starts, no "}}" anywhere: the precomputed lastClose guard skips the bounded findClose per opener (O(1), not O(MAX_TEMPLATE_SCAN)), staying O(n); output is literal [] since an opener with no close is prose, not a rejected construct.
function buildUnclosedOpens(n) {
  return '{{ x '.repeat(n);
}

test('templateScanner("handlebars") (many "{{" starts, no "}}" anywhere) resolves literal and stays linear', () => {
  const scan = templateScanner('handlebars');
  const src = buildUnclosedOpens(50_000); // ~250 KB
  const start = performance.now();
  assert.deepEqual(scan(src), []);
  const ms = performance.now() - start;
  assert.ok(
    ms < 30,
    `no-close scan cost should be O(n), not O(n * MAX_TEMPLATE_SCAN): took ${ms.toFixed(1)}ms`
  );
});

// Same density but each open holds a never-closing quoted string — guards against the string-aware findClose going quadratic on an unterminated quote.
function buildUnclosedQuotedOpens(n) {
  return '{{ "x '.repeat(n);
}

test('templateScanner("handlebars") (many unclosed opens with an unterminated quote, no "}}" anywhere) resolves literal and stays linear', () => {
  const scan = templateScanner('handlebars');
  const src = buildUnclosedQuotedOpens(50_000);
  const start = performance.now();
  assert.deepEqual(scan(src), []);
  const ms = performance.now() - start;
  assert.ok(
    ms < 30,
    `no-close scan cost should be O(n), not O(n * MAX_TEMPLATE_SCAN): took ${ms.toFixed(1)}ms`
  );
});

// Densest no-close input: bare packed "{{" with no "}}" — proves lastClose must be checked before findClose, else each of 30,000 opens repeats an O(MAX_TEMPLATE_SCAN) scan (quadratic).
test('templateScanner("handlebars") (30,000 packed "{{" opens, no "}}" anywhere) resolves literal and stays linear', () => {
  const scan = templateScanner('handlebars');
  const src = '{{'.repeat(30_000);
  const start = performance.now();
  assert.deepEqual(scan(src), []);
  const ms = performance.now() - start;
  assert.ok(
    ms < 30,
    `no-close scan cost should be O(n), not O(n * MAX_TEMPLATE_SCAN): took ${ms.toFixed(1)}ms`
  );
});
