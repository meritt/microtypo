import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const ACUTE = '\u{0301}';
const THINSP = '\u{2009}';
const NNBSP = '\u{202F}';

// Strip <p> wrapping so assertions check each rule's own effect.
const NOP = { html: true, render: { paragraphs: false } };

describe('other.acute_accent', () => {
  test('injects combining stress after a vowel', () => {
    assert.ok(microtypo('Э`рик в Амбере', NOP).includes(ACUTE));
  });

  test('leaves consonants unstressed', () => {
    assert.equal(microtypo('к`озырь', NOP).includes(ACUTE), false);
  });
});

describe('other.sup_word', () => {
  test('superscripts ^word after a space', () => {
    const out = microtypo('Амбер ^st рядом', NOP);
    assert.ok(out.includes('<sup>'));
    assert.ok(out.includes('<small>'));
  });

  test('leaves ^ inline without leading space', () => {
    assert.equal(microtypo('a^b', NOP).includes('<sup>'), false);
  });

  // number.sup is disabled so it can't consume the caret first.
  describe('leading-group boundaries', () => {
    const P = { ...NOP, rules: { 'number.sup': false } };

    test('fires at string start', () => {
      assert.equal(microtypo('^2 Amber', P), '<sup><small>2</small></sup> Amber');
    });

    test('fires after a space', () => {
      assert.equal(microtypo('mc ^2 Corwin', P), 'mc<sup><small>2</small></sup> Corwin');
    });

    test('fires after nbsp', () => {
      assert.equal(microtypo(`mc${NBSP}^2 Amber`, P), 'mc<sup><small>2</small></sup> Amber');
    });

    test('leaves a^b without whitespace', () => {
      assert.equal(microtypo('a^b', P), 'a^b');
    });
  });
});

describe('sub/sup markup', () => {
  test('wraps 2^10 in sup/small markup', () => {
    const out = microtypo('2^10', { html: true });
    assert.match(out, /<sup[\s>]/i);
    assert.match(out, /<small[\s>]/i);
    assert.doesNotMatch(out, /\^/);
  });

  test('wraps amber_2 in sub/small markup', () => {
    const out = microtypo('amber_2', { html: true });
    assert.match(out, /<sub[\s>]/i);
    assert.match(out, /<small[\s>]/i);
    assert.doesNotMatch(out, /amber_2/);
  });
});

describe('other.en_century_range', () => {
  test('en-dashes a century range', () => {
    const out = microtypo('смута XIX-XX вв. миновала', NOP);
    assert.ok(out.includes('XIX–XX'));
    assert.equal(out.includes('XIX—XX'), false);
  });

  test('does not corrupt the word after a bare в marker', () => {
    const out = microtypo('в XIX–XX веках', NOP);
    assert.match(out, /веках/, `word corrupted by marker: ${out}`);
    assert.match(out, /XIX–XX/, `en-dash lost: ${out}`);
  });

  test('marked range still resolves', () => {
    assert.match(microtypo('XIX–XX вв.', NOP), /XIX–XX/);
  });
});

describe('other.roman_range_dash', () => {
  test('bare Roman range keeps its en-dash', () => {
    const out = microtypo('(XIX–XX)', NOP);
    assert.ok(out.includes('–') && !out.includes('XIX-XX'), `en-dash lost: ${out}`);
  });

  test('leaves a hyphenated word with a non-Roman part untouched', () => {
    assert.equal(microtypo('X-фактор', NOP), 'X-фактор');
  });
});

describe('other.en_time_range', () => {
  test('en-dashes a time range', () => {
    assert.ok(microtypo('стража 9:00-18:00 на Колвире', NOP).includes('9:00–18:00'));
  });

  test('wraps both ranges glued by a comma (XTEST-META)', () => {
    const out = microtypo('Стража Колвира 9:00-13:00,14:00-18:00 сменяется', NOP);
    assert.ok(
      out.includes('<span style="white-space:nowrap;">9:00–13:00'),
      `first unwrapped: ${out}`
    );
    assert.ok(
      out.includes('<span style="white-space:nowrap;">14:00–18:00'),
      `second unwrapped: ${out}`
    );
  });
});

describe('other.strip_nbsp_in_nowrap', () => {
  test('pulls an NBSP-bound trailing word into the nowrap span', () => {
    const out = microtypo('Оберон пал 01.01.2024 г. затем', NOP);
    assert.equal(out, 'Оберон пал <span style="white-space:nowrap;">01.01.2024 г. затем</span>');
  });

  test('disabled: the trailing word stays NBSP-bound outside the span', () => {
    const out = microtypo('Оберон пал 01.01.2024 г. затем', {
      ...NOP,
      rules: { 'other.strip_nbsp_in_nowrap': false }
    });
    assert.equal(
      out,
      `Оберон пал <span style="white-space:nowrap;">01.01.2024 г.</span>${NBSP}затем`
    );
  });
});

describe('other.split_triads', () => {
  test('groups both numbers of a range', () => {
    const out = microtypo('15000—20000', NOP);
    assert.match(out, new RegExp(`15${NNBSP}000`), `first ungrouped: ${out}`);
    assert.match(out, new RegExp(`20${NNBSP}000`), `second ungrouped: ${out}`);
  });

  test('leaves a number glued to a preceding letter unsplit', () => {
    assert.equal(microtypo('a15000', NOP), 'a15000');
  });

  test('big-number triads use a narrow non-breaking space', () => {
    assert.equal(microtypo('24990'), `24${NNBSP}990`);
    assert.ok(!microtypo('1000000').includes(THINSP), 'thin space U+2009 still present');
  });

  test('triad entities emit &#8239; not &thinsp;', () => {
    assert.ok(microtypo('378000', { entities: true }).includes('378&#8239;000'));
  });
});

describe('other.nbsp_in_nowrap', () => {
  test('converts internal spaces to nbsp keeping the wrapper', () => {
    const typo = new MicroTypo({
      ...NOP,
      render: { nowrap: 'span' },
      rules: { 'other.nbsp_in_nowrap': true }
    });
    const out = typo.process('Зови +7 495 123-45-67 быстро');
    assert.ok(out.includes('<span'));
    assert.ok(out.includes('</span>'));
    assert.ok(out.includes(`+7${NBSP}495`));
  });
});
