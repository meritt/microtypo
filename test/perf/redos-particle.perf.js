import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

for (const [name, build] of [
  [
    'one particle chain',
    (n) => [`Поди${' ка кась'.repeat(n)} дальше`, `Поди${'-ка-кась'.repeat(n)}\u{00A0}дальше`]
  ],
  [
    'a hyphenated word without a particle',
    (n) => {
      const text = `${'а-'.repeat(n)}а мимо`;
      return [text, text];
    }
  ]
]) {
  test(`${name} grows linearly`, (t) => {
    const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 0 });
    const time = (n) => {
      const [source, expected] = build(n);
      let best = Infinity;
      for (let sample = 0; sample < 5; sample += 1) {
        const start = performance.now();
        assert.equal(typo.process(source), expected);
        best = Math.min(best, performance.now() - start);
      }
      assert.equal(typo.process(expected), expected);
      return best;
    };
    time(1000);
    const one = time(5000);
    const four = time(20000);
    t.diagnostic(
      `N ${one.toFixed(3)}ms; 4N ${four.toFixed(3)}ms; ratio ${(four / one).toFixed(3)}`
    );
    assert.ok(four / Math.max(one, 0.2) < 8);
  });
}
