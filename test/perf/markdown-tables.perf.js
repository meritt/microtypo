import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

const scenes = [
  [
    'table delimiters',
    (n) => '| Альфа | Бета |\n| :- | -: |\n| Корвин - принц | Эрик |\n\n'.repeat(n)
  ],
  ['long non-delimiter row', (n) => `| Альфа | Бета |\n| ${'-'.repeat(n * 20)}x | - |`]
];

for (const [name, build] of scenes) {
  test(`${name} has linear growth`, (t) => {
    const typo = new MicroTypo({
      html: false,
      input: { format: 'markdown' },
      maxProcessingMs: 0,
      maxInputLength: 1_000_000
    });
    const time = (n) => {
      const source = build(n);
      let best = Infinity;

      for (let sample = 0; sample < 3; sample += 1) {
        const started = performance.now();
        for (let repeat = 0; repeat < 3; repeat += 1) {
          typo.process(source);
        }
        best = Math.min(best, performance.now() - started);
      }

      return best;
    };

    time(250);
    const [one, two, four] = [time(250), time(500), time(1_000)];
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
