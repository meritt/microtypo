import assert from 'node:assert/strict';
import { test } from 'node:test';

import { edgeWhitespace } from '../../src/lib/strings.js';

test('edgeWhitespace returns the non-whitespace core range', () => {
  const samples = [
    '',
    'Корвин',
    '  Корвин в Амбере  ',
    '\t\nРэндом у Лабиринта\r\n',
    '\u00a0Оберон в Тени\u202f',
    '\ufeffАрден и Колвир\u3000',
    '\u2000\u200aБенедикт у Лабиринта\u205f',
    ' \t\r\n '
  ];

  for (const sample of samples) {
    const { start, end } = edgeWhitespace(sample);
    const core = sample.slice(start, end);

    assert.equal(core, sample.trim(), sample);

    if (core !== '') {
      assert.equal(sample.slice(0, start), sample.match(/^\s*/u)[0], sample);
      assert.equal(sample.slice(end), sample.match(/\s*$/u)[0], sample);
    } else {
      assert.equal(start, end, sample);
    }
  }
});
