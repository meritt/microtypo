// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node from
// `.nvmrc`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

// Quadratic backtracking on long single-character runs. 29_990 stays under the 30_000 cap, so the
// input is accepted and then has to process fast.
const N = 29_990;
const BOMBS = ['a', 'я', '1', ' ', '\n'];

function best(fn, n) {
  let ms = Infinity;

  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    fn(n);
    ms = Math.min(ms, performance.now() - start);
  }

  return ms;
}

for (const ch of BOMBS) {
  test(`${JSON.stringify(ch)}×${N} processes < 200ms`, () => {
    const typo = new MicroTypo();
    const input = ch.repeat(N);
    const start = performance.now();
    typo.process(input);
    const ms = performance.now() - start;
    assert.ok(ms < 200, `quadratic blowup on ${JSON.stringify(ch)}: ${ms.toFixed(0)}ms`);
  });
}

// The indent at the start of a line is kept, so a long one reaches the scanner, the edge trim and,
// under `html: true`, the paragraph and line-break layout whole instead of being collapsed first.
const INDENT_SHAPES = {
  'first line': (run) => `${run}слово`,
  'inner line': (run) => `слово\n${run}слово`,
  'every line': (run) => `${run.slice(0, 3)}слово\n`.repeat(Math.floor(run.length / 9)),
  'blank line': (run) => `слово\n${run}\nслово`
};

for (const format of ['text', 'html']) {
  for (const unit of [' ', '\t', ' \t']) {
    for (const [where, build] of Object.entries(INDENT_SHAPES)) {
      test(`${format}: ${JSON.stringify(unit)} indent, ${where}, processes < 200ms`, () => {
        const typo = new MicroTypo({ input: format, html: format === 'html' });
        const input = build(unit.repeat(Math.floor((N - 20) / unit.length)));
        const start = performance.now();
        typo.process(input);
        const ms = performance.now() - start;
        assert.ok(ms < 200, `${where} indent of ${JSON.stringify(unit)}: ${ms.toFixed(0)}ms`);
      });
    }
  }
}

test('number/date groups keep no-digit prose within budget', () => {
  const src = 'Корвин Рэндом Амбер Арден Лабиринт '.repeat(2000);
  const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });

  typo.process(src);

  const start = performance.now();
  typo.process(src);
  const ms = performance.now() - start;

  assert.ok(ms < 80, `no-digit prose took ${ms.toFixed(1)}ms`);
});

// `URL_REGEX` goes quadratic on dotted and hyphenated ASCII runs, which V8 does not Latin1-mask.
for (const unit of ['a.', '1.', 'a-', '1.0.']) {
  test(`${JSON.stringify(unit)}×N scales ~linearly`, () => {
    const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
    const t = (n) => {
      typo.process(unit.repeat(n));
    };
    t(4000); // warm
    const r = best(t, 16000) / best(t, 8000);
    assert.ok(r < 3, `quadratic URL_REGEX on ${unit}: ratio ${r.toFixed(1)}`);
  });
}

// `nbsp_volt`, Cyrillic-prefixed: V8's Latin1 fast path would otherwise mask the quadratic.
test('"я"+"1"×N scales ~linearly', () => {
  const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const t = (n) => {
    typo.process(`я${'1'.repeat(n)}`);
  };
  t(8000);
  const r = best(t, 60000) / best(t, 30000);
  assert.ok(r < 3, `quadratic nbsp_volt: ratio ${r.toFixed(1)}`);
});

// nbsp_frequency_unit / nbsp_css_unit on "1,"/"1." runs.
for (const unit of ['1,', '1.']) {
  test(`" "+${JSON.stringify(unit)}×N scales ~linearly`, () => {
    const typo = new MicroTypo({ maxInputLength: 5_000_000, maxProcessingMs: 0 });
    const t = (n) => {
      typo.process(` ${unit.repeat(n)}`);
    };
    t(8000);
    const r = best(t, 60000) / best(t, 30000);
    assert.ok(r < 3, `quadratic abbr unit on ${unit}: ratio ${r.toFixed(1)}`);
  });
}

// Outside an HTML document a tag the text never ends leaves the next `<` free to open one, and every
// one of these runs to the end of the text: read from each `<` in turn, that is quadratic.
test('tags the text never ends are read in linear time', () => {
  const typo = new MicroTypo({ input: 'markdown', maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const t = (n) => {
    typo.process(`<a x='${"<a x='".repeat(n)} Корвин - принц`);
  };
  t(500);
  const r = best(t, 16000) / best(t, 8000);
  assert.ok(r < 3, `quadratic unterminated-tag reading: ratio ${r.toFixed(1)}`);
});

// A tag reader with a backtracking pattern goes exponential on a stray-quote run before an
// unterminated tag opener, and it hangs before any budget checkpoint, so a small n keeps a
// reintroduced regression at low seconds rather than hanging the suite.
test('tag reading linear on stray-quote run before an unterminated tag', () => {
  const typo = new MicroTypo({ maxProcessingMs: 5_000 });
  const t = (n) => {
    const s = performance.now();
    typo.process(`<x ${'"'.repeat(n)}`);
    return performance.now() - s;
  };
  t(20); // warm
  // A single pass at these sizes lands around 0.04 ms, where JIT warm-up alone moves the ratio by 4x.
  const r = best(t, 400) / best(t, 200);
  assert.ok(r < 3, `exponential TAG_RE backtracking: ratio ${r.toFixed(1)} for 2x the quote run`);

  const ms = t(400);
  assert.ok(ms < 100, `TAG_RE too slow on 400 stray quotes: ${ms.toFixed(1)}ms`);
});
