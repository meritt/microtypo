import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

for (const [name, input, document, sizes] of [
  [
    'YAML values',
    'yaml',
    (n, letter = 'a') => Array.from({ length: n }, (_, i) => `k${i}: ${letter}\n`).join(''),
    [8000, 32000]
  ],
  [
    'TOML values',
    'toml',
    (n, letter = 'a') => Array.from({ length: n }, (_, i) => `k${i} = '${letter}'\n`).join(''),
    [8000, 32000]
  ],
  [
    'selected attributes after protection',
    { format: 'html', attributes: ['title'] },
    (n, letter = 'a') => `<code>x</code>${`<b title="${letter}">x</b> `.repeat(n)}`,
    [1000, 4000]
  ]
]) {
  test(`trace of ${name} grows with the document`, (t) => {
    const typo = new MicroTypo({
      presets: false,
      input,
      maxInputLength: 5_000_000,
      maxProcessingMs: 0,
      ruleGroups: [
        {
          name: 'terms',
          rules: [
            {
              id: 'a',
              pattern: { source: 'a', flags: 'g' },
              replacement: 'b'
            }
          ]
        }
      ]
    });
    const measure = (n) => {
      const text = document(n);
      let best = Infinity;
      for (let run = 0; run < 2; run++) {
        const start = performance.now();
        const result = typo.process(text, { trace: true });
        best = Math.min(best, performance.now() - start);
        const expected = document(n, 'b');
        assert.equal(result.text, typeof input === 'string' ? expected : expected.trimEnd());
        assert.equal(result.trace[0].count, n);
        const first = text.indexOf('a');
        const last = text.lastIndexOf('a');
        assert.deepEqual(result.trace[0].ranges[0], [first, first + 1]);
        assert.deepEqual(result.trace[0].ranges.at(-1), [last, last + 1]);
      }
      return best;
    };
    measure(1000);
    const small = measure(sizes[0]);
    const large = measure(sizes[1]);
    const detail = `${name}: ${small.toFixed(1)} → ${large.toFixed(1)} ms, ${(large / small).toFixed(2)}x for 4x values`;
    t.diagnostic(detail);
    assert.ok(large < small * 8 + 10, detail);
  });
}
