import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

test('a paragraph gap survives the inline closure following an author paragraph', () => {
  const typo = new MicroTypo({ html: true });
  for (const [source, expected] of [
    [
      '<span>начало<p>абзац</p>конец</span>\n\nдалее',
      '<span>начало<p>абзац</p>конец</span>\n\n<p>далее</p>'
    ],
    [
      '<span><em>начало<p>абзац</p>конец</em></span>\n\nдалее',
      '<span><em>начало<p>абзац</p>конец</em></span>\n\n<p>далее</p>'
    ],
    [
      '<span>начало<p>абзац</p>конец\n\nдалее</span>',
      '<span>начало<p>абзац</p>конец\n\nдалее</span>'
    ],
    ['<p>абзац</p>конец\n\nдалее', '<p>абзац</p>\n\n<p>конец</p>\n\n<p>далее</p>']
  ]) {
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  }
});

test('the first line indent goes inside a paragraph generated around that line', () => {
  const typo = new MicroTypo({ html: true });
  for (const [source, expected] of [
    ['  Строка\n\n  второй', '<p>  Строка</p>\n\n<p>второй</p>'],
    ['\n\tСтрока', '<p>\tСтрока</p>'],
    ['  <span>Строка</span>', '<p>  <span>Строка</span></p>'],
    ['  <p>Строка</p>', '  <p>Строка</p>'],
    ['  <div>Строка</div>', '  <div>Строка</div>']
  ]) {
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  }
  assert.equal(new MicroTypo().process('  Строка'), '  Строка');
  assert.equal(
    new MicroTypo({ html: true, render: { paragraphs: false } }).process('  Строка'),
    '  Строка'
  );
});
