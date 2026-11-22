import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

for (const [name, build] of [
  ['long quoted attribute', (n) => `<img alt="${'А - б &quot; '.repeat(n)}">`],
  ['many selected attributes', (n) => '<img alt="А - б" title="Корвин - принц">'.repeat(n)],
  ['many unclosed attribute candidates', (n) => '<img alt="А - б '.repeat(n)]
]) {
  test(`${name} grows linearly`, (t) => {
    const typo = new MicroTypo({
      input: { format: 'html', attributes: ['alt', 'title'] },
      presets: false,
      maxInputLength: 1_000_000,
      maxProcessingMs: 0
    });
    const sample = (source) => {
      let best = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const start = performance.now();
        for (let repeat = 0; repeat < 5; repeat += 1) {
          typo.process(source);
        }
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const inputs = [1_000, 2_000, 4_000].map(build);
    sample(inputs[0]);
    const [one, two, four] = inputs.map(sample);
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
