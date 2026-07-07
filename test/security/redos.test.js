import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoBudgetError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { SafeSequences } from '../../src/protect/sequences.js';
import { processQuotes } from '../../src/rules/quote-state.js';

const params = { html: true, render: { paragraphs: false } };

// Bomb: scheme + '(' + long body run — the exponential backtracking source.
test('paren after scheme stays fast', () => {
  const bomb = `http://(${'a'.repeat(5000)}`;
  const start = performance.now();
  microtypo(bomb);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `paren bomb slow: ${ms.toFixed(1)}ms`);
});

test('schemeless paren bomb stays fast', () => {
  const bomb = `www.example.com/(${'a'.repeat(5000)}`;
  const start = performance.now();
  microtypo(bomb);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `schemeless paren bomb slow: ${ms.toFixed(1)}ms`);
});

// Almost-all-trailing-')' is the O(n^2) worst case if balance is recounted per trim.
test('trailing close-paren run stays linear', () => {
  const bomb = `http://${')'.repeat(29_000)}`;
  const start = performance.now();
  microtypo(bomb);
  const ms = performance.now() - start;
  assert.ok(ms < 200, `paren trimming slow: ${ms.toFixed(1)}ms`);
});

test('urls still autolink after linearization', () => {
  const cases = [
    ['http://example.com', 'http://example.com'],
    // '&' is escaped in the generated href attribute.
    ['https://example.com/path?q=1&x=2', 'https://example.com/path?q=1&amp;x=2'],
    ['http://example.com/wiki/Foo_(bar)', 'http://example.com/wiki/Foo_(bar)'],
    ['http://example.com/foo(baz)', 'http://example.com/foo(baz)']
  ];

  for (const [input, expectedHref] of cases) {
    const out = microtypo(input, { html: true });
    assert.ok(out.includes(`href="${expectedHref}"`), `Got: ${out}`);
  }
});

// Autolink fires only after whitespace/start, so a leading '(' suppresses linking; here just prove ')' survives.
test('paren-wrapped url keeps its closing paren', () => {
  const seq = new SafeSequences();
  const stored = seq.protect('(http://example.com)');
  assert.ok(stored.startsWith('('), `Got: ${stored}`);
  assert.ok(stored.endsWith(')'), `Got: ${stored}`);
  assert.equal(seq.restore(stored), '(http://example.com)');
});

// Bounding the bare-domain run to {1,253} chars must not change URL recognition.
test('url forms still autolink under bounded domain run', () => {
  const cases = [
    'http://example.com',
    'https://example.com/path?q=1&x=2',
    'ftp://example.com/file.txt',
    'www.example.com',
    'a.b.c.example.co.uk/path',
    'example.com/path',
    'sub-domain.example-site.com/x'
  ];

  for (const url of cases) {
    const out = microtypo(url, params);
    assert.ok(out.includes('<a '), `Expected ${JSON.stringify(url)} to autolink: ${out}`);
  }
});

test('mailto links still autolink', () => {
  const out = microtypo('mailto:test@example.com', params);
  assert.ok(out.includes('<a '), `Got: ${out}`);
});

test('dotted and hyphenated prose is not autolinked', () => {
  const cases = ['1.2.3 Корвин', 'кое-как Оберон', 'см. п. 3.4.5 Амбера'];

  for (const text of cases) {
    const out = microtypo(text, { render: { paragraphs: false } });
    assert.ok(!out.includes('<a '), `Should not autolink ${JSON.stringify(text)}: ${out}`);
  }
});

// The {1,253} bound caps the matched run but must not reject the URL outright.
test('over-long domain label still autolinks', () => {
  const longRun = 'a'.repeat(300);
  const out = microtypo(`http://${longRun}.com/x`, params);
  assert.ok(out.includes('<a '), `Got: ${out}`);
});

// Config-time selector compile must not blow up on a long '*' run.
test('many-star selector is rejected fast', () => {
  const selector = `quote.c${'*'.repeat(40)}Z`;
  const start = performance.now();

  assert.throws(() => new MicroTypo({ rules: { [selector]: false } }), /selector/i);

  const ms = performance.now() - start;
  assert.ok(ms < 50, `selector compile slow: ${ms.toFixed(1)}ms`);
});

test('plain wildcard selector still works', () => {
  const typo = new MicroTypo({ rules: { 'quote.*': false } });
  const out = typo.process('"Корвин"');
  assert.ok(out.includes('"Корвин"'), `quote.* disable failed: ${out}`);
});

// 'em*' is an embedded wildcard, not bare '*': it must prefix-match only em-prefixed rules.
test('embedded wildcard disables only prefixed rules', () => {
  const spacedHyphen = 'Корвин - Оберон.';

  assert.equal(new MicroTypo().process(spacedHyphen), 'Корвин — Оберон.');
  assert.equal(
    new MicroTypo({ rules: { 'dash.em*': false } }).process(spacedHyphen),
    'Корвин - Оберон.'
  );

  // Non-em dash rule must still fire — proves 'em*' didn't over-match.
  assert.equal(
    new MicroTypo({ rules: { 'dash.em*': false } }).process('из за угла.'),
    'из-за угла.'
  );
});

// The quote scan must check the budget WHILE it runs; a throwing stub proves the in-loop check fires.
test('quote scan checks budget inside its loop', () => {
  let calls = 0;
  assert.throws(
    () =>
      processQuotes('«Корвин» «Эрик» «Рэндом»', {
        checkBudget: () => {
          calls += 1;
          throw new MicroTypoBudgetError('stub budget exceeded');
        }
      }),
    MicroTypoBudgetError
  );
  assert.ok(calls > 0, 'checkBudget was never invoked');
});

test('no-op budget leaves quotes intact', () => {
  const typo = new MicroTypo();
  assert.equal(typo.process('«Амбер»'), '«Амбер»');
});

// 10K Cyrillic letters with no '@' must not trigger email-regex backtracking.
test('many cyrillic letters without at-sign stay fast', () => {
  const text = 'а'.repeat(10000);
  const start = Date.now();
  microtypo(text, params);
  assert.ok(Date.now() - start < 1000, `Took too long`);
});

// Long digit run: isolated split is O(n); the full pipeline stays under the budget.
test('long digit run processes quickly', () => {
  const text = `1${'2'.repeat(10000)}`;
  const start = Date.now();
  new MicroTypo({ maxProcessingMs: 30_000 }).process(text);
  assert.ok(Date.now() - start < 5_000, `Took too long`);
});
