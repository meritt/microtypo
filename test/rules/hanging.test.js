import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };

describe('hanging.bracket', () => {
  test('wraps ( for optical alignment when on', () => {
    const out = microtypo('Амбер (Тень)', { ...NOP, rules: { 'hanging.bracket': true } });
    assert.ok(out.includes('margin-left:-0.3em'));
  });

  test('leaves ( unwrapped when off (opt-in feature)', () => {
    const out = microtypo('Амбер (Тень)', NOP);
    assert.ok(!out.includes('margin-left:-0.3em'));
    assert.ok(out.includes('Амбер (Тень)'));
  });
});
