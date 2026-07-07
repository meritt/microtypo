import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };
const NBSP = ' ';

describe('date.nowrap_date', () => {
  test('wraps date + г. in nowrap', () => {
    const out = microtypo('Указ от 01.01.2024 г. вступил', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">'));
  });
});

describe('date.year_range', () => {
  test('does not double the period after гг.', () => {
    const out = microtypo('© 2012-2015 гг.');
    assert.ok(!out.includes('гг..'), `doubled period: ${out}`);
    assert.ok(out.includes('2012–2015'), `range en-dash missing: ${out}`);
  });

  test('range after a preposition uses an en-dash, like number ranges', () => {
    const out = microtypo('в 1999-2001 годах', NOP);
    assert.ok(out.includes('1999–2001'), `en-dash missing: ${out}`);
    assert.ok(!out.includes('1999—2001'), `still em-dash: ${out}`);
  });
});

describe('date.month_range', () => {
  test('month range: hyphen between month names → en-dash', () => {
    // 'в' is NBSP-joined to 'апреле' by the space group, unrelated here.
    assert.equal(microtypo('Корвин вернулся в апреле-мае'), `Корвин вернулся в${NBSP}апреле–мае`);
  });
  test('month range: does not touch non-month hyphen compounds', () => {
    assert.equal(microtypo('Корвин говорил по-русски'), 'Корвин говорил по-русски');
    // 'из' is NBSP-joined to the next word by the space group, unrelated here.
    assert.equal(microtypo('кто-то из принцев'), `кто-то из${NBSP}принцев`);
    assert.equal(microtypo('тёмно-синий плащ'), 'тёмно-синий плащ');
  });
  test('month range: does not match a month stem inside a longer unrelated word', () => {
    // 'мая' is a tail of 'самая', not the month — must stay a plain hyphen.
    // 'в' is NBSP-joined to 'Амбере' by the space group, unrelated here.
    assert.equal(microtypo('самая-майская погода в Амбере'), `самая-майская погода в${NBSP}Амбере`);
    // gerunds ending in '-мая' must not be read as the month.
    assert.equal(microtypo('снимая-августовский плащ'), 'снимая-августовский плащ');
    assert.equal(microtypo('занимая-мартовский указ'), 'занимая-мартовский указ');
    assert.equal(microtypo('обнимая-августовский вечер'), 'обнимая-августовский вечер');
    // 'майский' is an adjective built on the month stem, not the month itself.
    assert.equal(microtypo('апрель-майский указ Оберона'), 'апрель-майский указ Оберона');
  });
});

describe('date.day_month_range', () => {
  test('day+month range: hyphen between two full dates → en-dash', () => {
    // NBSP precedes both months via the space group, upstream of this rule.
    assert.equal(
      microtypo('Корвин пробыл в Эмбере 16 января-20 марта'),
      `Корвин пробыл в${NBSP}Эмбере 16${NBSP}января–20${NBSP}марта`
    );
  });
  test('day+month range: works with a leading preposition and trailing year', () => {
    const out = microtypo('с 16 января-20 марта 2023', NOP);
    assert.ok(out.includes('января–20'), `en-dash missing: ${out}`);
    assert.ok(!out.includes('января-20'), `hyphen still present: ${out}`);
  });
  test('day+month range: does not touch hyphenated words/compounds without a month', () => {
    assert.equal(microtypo('Корвин сказал что-то'), 'Корвин сказал что-то');
    // 'в' is NBSP-joined to 'Ребме' by the space group, unrelated here.
    assert.equal(
      microtypo('в Ребме собрали супер-8 камера'),
      `в${NBSP}Ребме собрали супер-8 камера`
    );
    assert.equal(microtypo('Рэндом отдал по-2'), 'Рэндом отдал по-2');
    // 'в' before 'Арденском' is NBSP-joined the same way.
    assert.equal(microtypo('дом-5 сгорел в Арденском лесу'), `дом-5 сгорел в${NBSP}Арденском лесу`);
    // 'у' is NBSP-joined to 'дороги' the same way.
    assert.equal(microtypo('изба-7 стояла у дороги'), `изба-7 стояла у${NBSP}дороги`);
  });
  test('day+month range: a bare day-day range is untouched by this rule (number.en_range already converts it)', () => {
    // Left side lacks a "число месяц" run, so this rule never fires; the en-dash comes from number.en_range.
    assert.equal(microtypo('Корвин ждал 5-20 марта'), `Корвин ждал 5–20${NBSP}марта`);
  });
});
