import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

const SCENES = [
  ['html', '<p>Корвин вернулся в <em>Амбер</em> 1000 рублей. <a href="/x">Путь в Тень</a>.</p>\n'],
  ['markdown', 'Корвин вернулся в *Амбер* 1000 рублей. [Путь в Тень](/x).\n\n']
];

for (const [format, chunk] of SCENES) {
  test(`${format} processes one million UTF-16 units with linear growth`, (t) => {
    const typo = new MicroTypo({
      input: format,
      html: true,
      maxInputLength: 1_000_000,
      maxProcessingMs: 0
    });
    const time = (size) => {
      const text = chunk.repeat(Math.floor(size / chunk.length)).padEnd(size, ' ');
      assert.equal(text.length, size);
      let best = Infinity;
      for (let sample = 0; sample < 3; sample += 1) {
        const started = performance.now();
        const output = typo.process(text);
        best = Math.min(best, performance.now() - started);
        assert.ok(output.includes('1000\u{00A0}₽'));
      }
      return best;
    };

    time(50_000);
    const [one, two, four] = [time(250_000), time(500_000), time(1_000_000)];
    const detail = `${format}: 250k ${one.toFixed(2)}ms, 500k ${two.toFixed(2)}ms, 1M ${four.toFixed(2)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
