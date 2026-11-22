import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanPragmas } from '../../src/input/pragmas.js';

const OPTIONS = { markdown: true, restore: (text) => text, ignoreFile: () => {} };
const scenes = [
  ['unclosed pragma', (n) => `<!-- microtypo-ignore-start -->\n${'Корвин - принц\n'.repeat(n)}`],
  [
    'nested pragmas',
    (n) =>
      `${'<!-- microtypo-ignore-start -->\n'.repeat(
        n
      )}Текст${'<!-- microtypo-ignore-end -->\n'.repeat(n)}`
  ],
  ['ordinary comments', (n) => '<!-- обычный комментарий -->\n'.repeat(n)]
];

function sample(source) {
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    for (let repeat = 0; repeat < 10; repeat += 1) {
      scanPragmas(source, null, OPTIONS);
    }
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

for (const [name, build] of scenes) {
  test(`${name} grows linearly`, (t) => {
    const sources = [1_000, 2_000, 4_000].map(build);
    sample(sources[0]);
    const [one, two, four] = sources.map(sample);
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
