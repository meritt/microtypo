import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';

// These separators have no glyph entry, no rule, and none is '\n', so they pass through and never split a paragraph.
const cfg = { render: { paragraphs: false } };

test('U+2028 LINE SEPARATOR passes through unchanged', () => {
  const input = `Корвин${'\u{2028}'}Грейсвандир`;
  assert.equal(microtypo(input, cfg), input);
});

test('U+2029 PARAGRAPH SEPARATOR passes through unchanged', () => {
  const input = `Корвин${'\u{2029}'}Грейсвандир`;
  assert.equal(microtypo(input, cfg), input);
});

test('U+200B ZERO WIDTH SPACE passes through unchanged', () => {
  const input = `Корвин${'\u{200B}'}Грейсвандир`;
  assert.equal(microtypo(input, cfg), input);
});

test('U+00AD SOFT HYPHEN passes through unchanged', () => {
  const input = `Корвин${'\u{00AD}'}Грейсвандир`;
  assert.equal(microtypo(input, cfg), input);
});

test('U+2028/U+2029 do not trigger paragraph splitting (unlike \\n\\n)', () => {
  const withLS = microtypo(`Корвин${'\u{2028}'}Эрик`, { html: true });
  const withPS = microtypo(`Корвин${'\u{2029}'}Эрик`, { html: true });
  assert.equal(withLS, `<p>Корвин${'\u{2028}'}Эрик</p>`);
  assert.equal(withPS, `<p>Корвин${'\u{2029}'}Эрик</p>`);
});
