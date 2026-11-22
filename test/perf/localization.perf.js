import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localizationScanner } from '../../src/input/localization.js';

const scenes = [
  [
    'nested ICU branches',
    'icu',
    (n) => `${'{n, plural, one {'.repeat(n)}# день - текст${'} other {# дней}}'.repeat(n)}`
  ],
  ['unclosed ICU braces', 'icu', (n) => '{ '.repeat(n * 20)],
  ['quoted ICU braces', 'icu', (n) => `{n, plural, one {'#{' день} other {# дней}} `.repeat(n)],
  ['unfinished printf width', 'printf', (n) => `%${'0'.repeat(n * 20)}!`],
  ['percent signs before printf arguments', 'printf', (n) => '7%  %2$.*3$f '.repeat(n * 20)],
  ['unfinished interpolation', 'interpolation', (n) => '${'.repeat(n * 20)]
];

function sample(scan, source) {
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    for (let repeat = 0; repeat < 10; repeat += 1) {
      scan(source);
    }
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

for (const [name, mode, build] of scenes) {
  test(`${name} grows linearly`, (t) => {
    const scan = localizationScanner(mode);
    const sources = [1_000, 2_000, 4_000].map(build);
    sample(scan, sources[0]);
    const [one, two, four] = sources.map((source) => sample(scan, source));
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
