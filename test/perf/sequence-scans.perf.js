import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { SafeSequences } from '../../src/protect/sequences.js';

for (const [name, make] of [
  [
    'candidate-free cut fragments',
    (n) => {
      const text = '[слово][метка] '.repeat(n);
      const cuts = Array.from(
        { length: n * 2 },
        (_, i) => Math.floor(i / 2) * 15 + (i % 2 ? 13 : 6)
      );
      return { text, cuts };
    }
  ],
  ['punctuated non-address fragments', (n) => ({ text: '...:@-- '.repeat(n), cuts: [] })],
  [
    'URL-only restoration beside foreign tokens',
    (n) => ({
      text: 'https://amber.example/a '.repeat(n),
      suffix: 'A1SAFE0000000000000000NUM99ID@simonenko.xyz AzSAFE0TOK99TK '.repeat(n),
      cuts: []
    })
  ]
]) {
  test(`${name} grows linearly`, (t) => {
    const sequences = new SafeSequences();
    const time = (n) => {
      const { text, cuts, suffix = '' } = make(n);
      const run = () => {
        sequences.reset();
        assert.equal(sequences.restore(sequences.protect(text, cuts) + suffix), text + suffix);
      };
      run();
      let best = Infinity;
      for (let sample = 0; sample < 5; sample++) {
        const started = performance.now();
        for (let repeat = 0; repeat < 10; repeat++) {
          run();
        }
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    time(500);
    const [one, two, four] = [time(1000), time(2000), time(4000)];
    const detail = `${name}: N ${one.toFixed(3)}ms, 2N ${two.toFixed(3)}ms, 4N ${four.toFixed(3)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}

for (const [name, unit] of [
  ['absent lexical prerequisites', 'Абвг1234 Корвин1234 Рэндом1234 '],
  ['near-matching lexical prerequisites', 'АБ Т. гул.просп.б-р тел8_12345- ']
]) {
  test(`${name} grows linearly`, (t) => {
    const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });
    const time = (n) => {
      const text = unit.repeat(n);
      typo.process(text);
      let best = Infinity;
      for (let sample = 0; sample < 3; sample++) {
        const started = performance.now();
        for (let repeat = 0; repeat < 5; repeat++) {
          typo.process(text);
        }
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    time(250);
    const [one, two, four] = [time(500), time(1000), time(2000)];
    const detail = `${name}: N ${one.toFixed(3)}ms, 2N ${two.toFixed(3)}ms, 4N ${four.toFixed(3)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
