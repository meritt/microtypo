import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

describe('markup degrades under html:false', () => {
  test('html:false keeps NBSP-joined abbreviation, no <nobr>', () => {
    const out = microtypo('Корвин, Эрик и т. д.', { html: false });

    assert.doesNotMatch(out, /<nobr[\s>]/i);
    assert.match(out, /и\u{00A0}т\.\u{00A0}д\./u);
  });

  test('html:true wraps the same abbreviation in a nowrap span', () => {
    const out = microtypo('Корвин, Эрик и т. д.', { html: true });

    assert.match(out, /<span style="white-space:nowrap;">/);
  });

  test('html:false leaves a bare URL as plain text, no <a> link', () => {
    const out = microtypo('см. http://amber.example там', { html: false });

    assert.doesNotMatch(out, /<a[\s>]/i);
    assert.match(out, /http:\/\/amber\.example/);
  });

  test('html:false emits no <span> for hanging punctuation with hanging rules on', () => {
    const out = microtypo('«Амбер»', {
      html: false,
      rules: { 'hanging.quote': true, 'hanging.bracket': true }
    });

    assert.doesNotMatch(out, /<span[\s>]/i);
  });

  // The three-or-more newline collapse is a standalone engine step, so it survives `html: false`
  // disabling the text group.
  test('html:false still collapses 3+ consecutive newlines to \\n\\n', () => {
    assert.equal(microtypo('Корвин\n\n\n\nОберон', { html: false }), 'Корвин\n\nОберон');
  });
});

// sub and sup are markup-only, so under `html: false` they skip entirely rather than firing and
// dropping the marker they consumed.
describe('sub/sup skip cleanly under html:false', () => {
  test('html:false leaves "2^10" untouched (no <sup>, no dropped "^")', () => {
    const out = microtypo('2^10', { html: false });

    assert.equal(out, '2^10');
    assert.doesNotMatch(out, /<sup[\s>]/i);
  });

  test('html:false leaves "amber_2" untouched (no <sub>, no dropped "_")', () => {
    const out = microtypo('amber_2', { html: false });

    assert.equal(out, 'amber_2');
    assert.doesNotMatch(out, /<sub[\s>]/i);
  });

  test('html:false leaves "Эрик ^note там" untouched (space and "^" survive, no gluing)', () => {
    const out = microtypo('Эрик ^note там', { html: false });

    assert.equal(out, 'Эрик ^note там');
    assert.doesNotMatch(out, /Эрикnote/);
  });
});
