import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NNBSP = '\u{202F}';

const P = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const entity = (t) => new MicroTypo({ ...P, entities: true }).process(t);
const u = (s) => microtypo(s, { html: true, entities: false });
const cfg = { html: true, render: { paragraphs: false } };
const NOP = { html: true, render: { paragraphs: false } };

describe('fractions', () => {
  test('standalone fractions convert to glyphs', () => {
    assert.equal(microtypo('1/2', P), '½');
    assert.equal(microtypo('3/4', P), '¾');
    assert.equal(microtypo('1/4', P), '¼');
  });

  test('fraction before a period converts mid-sentence', () => {
    assert.equal(microtypo('Эрик прошёл 1/2.', P), 'Эрик прошёл ½.');
  });

  test('fraction before an inch mark is left raw', () => {
    assert.equal(microtypo('3/4"', P), '3/4″');
  });

  test('unknown fraction is untouched', () => {
    assert.equal(microtypo('5/8', P), '5/8');
  });

  test('a fraction glued into a longer number is untouched', () => {
    assert.equal(microtypo('11/2', P), '11/2');
    assert.equal(microtypo('1/24', P), '1/24');
  });

  test('1/4 converts in prose', () => {
    assert.ok(microtypo('доля Эрика 1/4 трона', cfg).includes('¼'));
  });

  test('3/4 converts in prose', () => {
    assert.ok(microtypo('пройдено 3/4 Лабиринта', cfg).includes('¾'));
  });

  test('digit prefix blocks 21/2 conversion', () => {
    assert.equal(microtypo('знак 21/2 здесь', cfg).includes('½'), false);
  });

  test('default converts 1/2 to ½', () => {
    assert.ok(microtypo('печать 1/2 Лабиринта', cfg).includes('½'));
  });

  test('number.fraction:false leaves 1/2 raw', () => {
    const out = microtypo('печать 1/2 Лабиринта', { ...cfg, rules: { 'number.fraction': false } });
    assert.ok(out.includes('1/2'));
    assert.ok(!out.includes('½'));
  });
});

describe('multiplication sign', () => {
  test('× between letters is preserved with and without spaces', () => {
    assert.ok(u('колода A × B').includes('A × B'));
    assert.ok(u('A×B').includes('A×B'));
  });

  test('&times; entity normalizes to × not x', () => {
    assert.ok(u('A &times; B').includes('×'));
  });

  test('dimensional x becomes ×', () => {
    assert.equal(u('2x3'), '<p>2×3</p>');
    assert.equal(u('5 x 5'), '<p>5×5</p>');
    assert.equal(u('2×3'), '<p>2×3</p>');
  });

  test('literal × between digits normalizes irregular spacing', () => {
    assert.equal(u('2 × 3'), '<p>2×3</p>');
    assert.equal(u('5 ×5'), '<p>5×5</p>');
    assert.equal(u('3× 4'), '<p>3×4</p>');
    assert.equal(u('3 ×4'), '<p>3×4</p>');
  });

  test('× without digit context is never collapsed', () => {
    assert.equal(u('колода A × B'), '<p>колода A × B</p>');
    assert.equal(u('A×B'), '<p>A×B</p>');
  });
});

describe('math signs', () => {
  test('default converts != to ≠', () => {
    assert.ok(microtypo('x != y', cfg).includes('≠'));
  });

  test('number.math:false leaves != raw', () => {
    const out = microtypo('x != y', { ...cfg, rules: { 'number.math': false } });
    assert.ok(out.includes('!='));
    assert.ok(!out.includes('≠'));
  });

  test('<= becomes ≤', () => {
    assert.ok(microtypo('a <= b', cfg).includes('≤'));
  });

  test('>= becomes ≥', () => {
    assert.ok(microtypo('a >= b', cfg).includes('≥'));
  });

  test('+- becomes ±', () => {
    assert.ok(microtypo('5 +-1', cfg).includes('±'));
  });
});

describe('subscript and superscript', () => {
  test('default wraps H_2 in <sub>', () => {
    assert.ok(microtypo('печать H_2 Дворкина', cfg).includes('<sub>'));
  });

  test('number.sub:false leaves H_2 raw', () => {
    const out = microtypo('печать H_2 Дворкина', { ...cfg, rules: { 'number.sub': false } });
    assert.ok(out.includes('H_2'));
    assert.ok(!out.includes('<sub>'));
  });

  test('default wraps x^2 in <sup>', () => {
    assert.ok(microtypo('сила x^2 Козыря', cfg).includes('<sup>'));
  });

  test('number.sup + other.sup_word off leaves x^2 raw', () => {
    const out = microtypo('сила x^2 Козыря', {
      ...cfg,
      rules: { 'number.sup': false, 'other.sup_word': false }
    });
    assert.ok(out.includes('x^2'));
    assert.ok(!out.includes('<sup>'));
  });
});

describe('en range', () => {
  test('en-range normalizes an em-dash input between digits', () => {
    assert.equal(microtypo('12—19'), '12–19');
  });

  test('en-range normalizes a minus input between digits', () => {
    assert.equal(microtypo('12−19'), '12–19');
  });

  test('en-range still converts a hyphen', () => {
    assert.equal(microtypo('12-19'), '12–19');
  });

  test('an em-dash chain (phone-like) is not converted', () => {
    assert.equal(microtypo('8—800—555'), '8—800—555');
  });
});

describe('minus range', () => {
  test('default turns a leading hyphen into a minus sign', () => {
    assert.ok(microtypo('в Ардене -5...10 градусов', cfg).includes('−5'));
  });

  test('number.minus_range:false leaves the hyphen', () => {
    const out = microtypo('в Ардене -5...10 градусов', {
      ...cfg,
      rules: { 'number.minus_range': false }
    });
    assert.ok(!out.includes('−5'));
  });
});

describe('time', () => {
  test('default collapses 8 : 59 to 8:59', () => {
    assert.ok(microtypo('дозор в 8 : 59 утра', cfg).includes('8:59'));
  });

  test('number.time:false does not merge 8:59', () => {
    const out = microtypo('дозор в 8 : 59 утра', { ...cfg, rules: { 'number.time': false } });
    assert.ok(!out.includes('8:59'));
  });
});

describe('magnitude abbreviations', () => {
  test('тыс gets a nbsp', () => {
    assert.equal(microtypo('23тыс.', P), `23${NBSP}тыс.`);
  });

  test('млн gets a nbsp', () => {
    assert.equal(microtypo('64млн.', P), `64${NBSP}млн.`);
  });

  test('млрд gets a nbsp', () => {
    assert.equal(microtypo('7млрд', P), `7${NBSP}млрд`);
  });

  test('identifiers 3d / 2x / 4k are left alone', () => {
    assert.equal(microtypo('3d', P), '3d');
    assert.equal(microtypo('2x', P), '2x');
    assert.equal(microtypo('4k', P), '4k');
  });

  test('does not fire inside тысяч', () => {
    assert.equal(microtypo('5тысяч', P), '5тысяч');
  });
});

describe('units spacing', () => {
  test('data unit ГБ gets nbsp', () => {
    assert.ok(entity('7 ГБ хроник').includes(`7&nbsp;ГБ`));
  });

  test('data unit МБ gets nbsp', () => {
    assert.ok(entity('100 МБ свитка').includes('100&nbsp;МБ'));
  });

  test('data unit ТБ gets nbsp', () => {
    assert.ok(entity('5 ТБ').includes('5&nbsp;ТБ'));
  });

  test('bitrate Мбит/с gets nbsp', () => {
    assert.ok(entity('Рэндом качал 100 Мбит/с').includes('100&nbsp;Мбит/с'));
  });

  test('bitrate Гбит/с gets nbsp', () => {
    assert.ok(entity('1 Гбит/с').includes('1&nbsp;Гбит/с'));
  });

  test('frequency МГц gets nbsp', () => {
    assert.ok(entity('Колвир 100 МГц').includes('100&nbsp;МГц'));
  });

  test('frequency ГГц gets nbsp', () => {
    assert.ok(entity('единорог 2.4 ГГц').includes('2.4&nbsp;ГГц'));
  });

  test('CSS unit px gets nbsp', () => {
    assert.ok(entity('герб 16 px').includes('16&nbsp;px'));
  });

  test('CSS unit em gets nbsp', () => {
    assert.ok(entity('печать 1.5 em').includes('1.5&nbsp;em'));
  });

  test('CSS unit vh gets nbsp', () => {
    assert.ok(entity('башня 100 vh').includes('100&nbsp;vh'));
  });

  test('units bundle binds number to unit with nbsp', () => {
    assert.ok(microtypo('клинок весит 5 кг', cfg).includes(`5${NBSP}кг`));
  });
});

describe('currency', () => {
  test('руб. becomes ₽ with nbsp', () => {
    assert.equal(entity('Дань 100 руб.'), `Дань 100&nbsp;&#8381;`);
  });

  test('trailing р. variants become ₽', () => {
    assert.equal(entity('100р.'), '100&nbsp;&#8381;');
    assert.equal(entity('100 р.'), '100&nbsp;&#8381;');
    assert.equal(entity('100р'), '100&nbsp;&#8381;');
    assert.equal(entity('100руб'), '100&nbsp;&#8381;');
  });

  test('долл. and долларов become $', () => {
    assert.equal(entity('100 долл.'), '100&nbsp;$');
    assert.equal(entity('100 долларов'), '100&nbsp;$');
  });

  test('евро becomes €', () => {
    assert.equal(entity('100 евро'), '100&nbsp;&euro;');
  });

  test('leading $ gets nbsp inserted', () => {
    assert.equal(entity('$100'), '$&nbsp;100');
  });

  test('bare ₽ gets nbsp bound to the number', () => {
    assert.equal(entity('100 ₽'), '100&nbsp;&#8381;');
  });

  test('a руб-prefixed word is not a currency match', () => {
    assert.equal(entity('100 рубеж'), '100 рубеж');
  });

  test('currency bundle converts руб to ₽', () => {
    assert.ok(microtypo('Рэндом отдал 5 руб', cfg).includes('₽'));
  });
});

describe('digit triads', () => {
  test('triads bundle joins groups with a narrow non-breaking space', () => {
    assert.ok(microtypo('в казне 12 345 клинков', cfg).includes(`12${NNBSP}345`));
  });

  test('existing triad spaces become narrow non-breaking', () => {
    assert.equal(microtypo('378 000'), `378${NNBSP}000`);
  });
});

describe('number.thin_space_triads — G8 phone-tail guard', () => {
  test('a phone number is not partially grouped as triads', () => {
    const out = microtypo('Звоните Корвину 8 800 555 35 35 сегодня', cfg);

    assert.ok(!out.includes(NNBSP), `phone got partially grouped: ${out}`);
    assert.ok(out.includes('8 800 555 35 35'));
  });

  test('a plus-prefixed phone number is not partially grouped as triads', () => {
    const out = microtypo('Звоните Корвину +7 495 123 45 67 сегодня', cfg);

    assert.ok(!out.includes(NNBSP), `phone got partially grouped: ${out}`);
    assert.ok(out.includes('+7 495 123 45 67'));
  });

  test('a compact plus-prefixed phone number is not grouped as triads', () => {
    const out = microtypo('Козырь: +74951004888.', cfg);

    assert.ok(!out.includes(NNBSP), `phone got grouped: ${out}`);
    assert.ok(out.includes('+7 495 100-48-88'), out);
  });

  test('a legitimate big number followed by another number still groups in full', () => {
    assert.equal(microtypo('1 000 000 200 раз', cfg), `1${NNBSP}000${NNBSP}000${NNBSP}200 раз`);
  });

  test('a legitimate big number before a word still groups', () => {
    assert.ok(microtypo('до 1 000 000 человек', cfg).includes(`1${NNBSP}000${NNBSP}000`));
  });
});

describe('number.math — +- guard (BUG-1)', () => {
  test('C++-API is not corrupted', () => {
    assert.equal(microtypo('C++-API', NOP), 'C++-API');
  });

  test('a++-b is not corrupted', () => {
    assert.equal(microtypo('a++-b', NOP), 'a++-b');
  });

  test('i-- stays intact', () => {
    assert.ok(microtypo('счётчик i-- сброшен', NOP).includes('i--'));
  });

  test('legitimate 5+-3 still becomes plus-minus', () => {
    assert.equal(microtypo('5+-3', NOP), `5${'±'}3`);
  });
});
