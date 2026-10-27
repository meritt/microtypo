// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node from
// `.nvmrc`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

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

// A ratio of warm best-of-three scans with the rounds interleaved, so a burst of load lands on both
// sizes, because one cold scan here swings several-fold on the same machine. 4x the input measured
// 2.9-6.5x even beside a full test run; a rescan per opener, 12x and up. The slack absorbs a
// sub-millisecond small size.
function growth(scan, unit, small) {
  const time = (src) => {
    const start = performance.now();
    scan(src);
    return performance.now() - start;
  };
  const a = unit.repeat(small);
  const b = unit.repeat(small * 4);
  let smallMs = Infinity;
  let largeMs = Infinity;

  for (let i = 0; i < 3; i += 1) {
    smallMs = Math.min(smallMs, time(a));
    largeMs = Math.min(largeMs, time(b));
  }

  return { smallMs, largeMs, ok: largeMs < smallMs * 8 + 1 };
}

const growthText = ({ smallMs, largeMs }) =>
  `4x the input cost ${(largeMs / smallMs).toFixed(1)}x the time (${smallMs.toFixed(2)}ms -> ${largeMs.toFixed(2)}ms)`;

// Packed comments whose quotes never pair: every quote is comment prose, so each span ends at its own close.
for (const [name, unit] of [
  ['jinja', `{# don't "x #}`],
  ['erb', `<%# don't "x %>`],
  ['erb', `<% # don't "x\n y %>`],
  ['liquid', `{% # don't "x %}`],
  ['mustache', `{{! don't "x }}`],
  ['handlebars', `{{!-- don't }} "x --}}`]
]) {
  test(`templateScanner("${name}") (20,000 packed comments with unpaired quotes) vaults each and stays linear`, () => {
    const scan = templateScanner(name);

    assert.equal(scan(unit.repeat(20_000)).length, 20_000);

    const run = growth(scan, unit, 5000);

    assert.ok(run.ok, `packed comment scan should be O(n): ${growthText(run)}`);
  });
}

// "{{!--" openers with a plain "}}" ahead but no "--}}": without its own last-close guard each opener
// would rescan the whole window for a dashed close that is not there.
test('templateScanner("handlebars") (packed "{{!--" with no "--}}" anywhere) vaults each to "}}" and stays linear', () => {
  const scan = templateScanner('handlebars');

  assert.equal(scan('{{!-- }}'.repeat(1000)).length, 1000);

  const run = growth(scan, '{{!-- }}', 2500);

  assert.ok(run.ok, `dashed-comment scan should be O(n): ${growthText(run)}`);
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
