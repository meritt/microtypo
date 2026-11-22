import assert from 'node:assert/strict';
import { test } from 'node:test';

import { restoreFileTail } from '../../src/lib/line-endings.js';

test('every short CR/LF tail is restored byte-exactly', () => {
  let words = [''];

  for (let depth = 0; depth < 7; depth += 1) {
    for (const tail of words) {
      for (const prefix of ['', '\r\n\r\n', '\n'.repeat(20)]) {
        assert.equal(
          restoreFileTail(`${prefix}Источник${tail}`, 'Результат\n\r\n'),
          `Результат${tail}`
        );
      }
    }
    words = words.flatMap((word) => [`${word}\r`, `${word}\n`]);
  }
});

const time = (size) => {
  const prefix = '\r\n'.repeat(size);
  const source = `${prefix}Источник${prefix}`;
  const result = `Результат${prefix}`;
  let best = Infinity;

  for (let sample = 0; sample < 3; sample += 1) {
    const started = performance.now();
    for (let repeat = 0; repeat < 30; repeat += 1) {
      assert.equal(restoreFileTail(source, result), result);
    }
    best = Math.min(best, performance.now() - started);
  }

  return best;
};

test('long newline prefixes and suffixes have linear growth', (t) => {
  time(4_000);
  const [one, two, four] = [time(4_000), time(8_000), time(16_000)];
  const detail = `${one.toFixed(2)}, ${two.toFixed(2)}, ${four.toFixed(2)}ms; ${(four / one).toFixed(2)}x`;
  t.diagnostic(detail);
  assert.ok(four / one < 8, detail);
});
