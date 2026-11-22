import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanMath } from '../../src/input/math.js';

const scenes = [
  ['unpaired dollars', (n) => '$ '.repeat(n)],
  ['currency dollars', (n) => '$5 и $10 '.repeat(n)],
  ['long dollar run', (n) => '$'.repeat(n)],
  ['unpaired slash math', (n) => String.raw`\(x - y `.repeat(n)],
  ['mixed math markers', (n) => '$a - b$ $$x - y$$ \\[z - y\\] '.repeat(n)]
];

function sample(source) {
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    for (let repeat = 0; repeat < 10; repeat += 1) {
      scanMath(source);
    }
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

for (const [name, build] of scenes) {
  test(`${name} grows linearly`, (t) => {
    const inputs = [10_000, 20_000, 40_000].map(build);
    sample(inputs[0]);
    const [one, two, four] = inputs.map(sample);
    const detail = `${name}: ${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)} ms; ${(four / one).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}

for (const [name, formula] of [
  ['early math owns late angle syntax', '$a - b<c$'],
  ['quoted attribute excludes its dollar', '$a - b <i title="$">c - d$']
]) {
  test(`${name} grows linearly with exact boundaries`, (t) => {
    const unit = `${formula}> `;
    const sizes = [2000, 4000, 8000];
    const sources = sizes.map((n) => unit.repeat(n));
    for (const [i, source] of sources.entries()) {
      assert.deepEqual(
        scanMath(source),
        Array.from({ length: sizes[i] }, (_, k) => [
          k * unit.length,
          k * unit.length + formula.length
        ])
      );
    }
    sample(sources[0]);
    const times = sources.map(sample);
    const detail = `${name}: ${times.map((n) => n.toFixed(2)).join(', ')} ms; ${(times[2] / times[0]).toFixed(2)}x`;
    t.diagnostic(detail);
    assert.ok(times[2] / times[0] < 8, detail);
  });
}

test('backslashes cannot hide inline math physical line boundaries at scale', (t) => {
  const sources = [5000, 10000, 20000].map((n) => '$a - b\\\nc - d$\n'.repeat(n));
  for (const source of sources) {
    assert.deepEqual(scanMath(source), []);
  }
  sample(sources[0]);
  const times = sources.map(sample);
  const detail = `math physical lines: ${times.map((n) => n.toFixed(2)).join(', ')} ms; ${(times[2] / times[0]).toFixed(2)}x`;
  t.diagnostic(detail);
  assert.ok(times[2] / times[0] < 8, detail);
});
