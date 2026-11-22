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

// A year written `г.` or `г` binds to its number, and the word after it is not a city's name.
describe('г. after a year or a date is the year (A10)', () => {
  test('binds to the year and to nothing on its right, on every pass', () => {
    for (const [source, expected] of [
      ['в 1983г. Москва', `в${NBSP}1983${NBSP}г. Москва`],
      ['17.02.1983 г. И утратил', `17.02.1983${NBSP}г. И${NBSP}утратил`],
      ['17.02.1983г. И утратил', `17.02.1983${NBSP}г. И${NBSP}утратил`]
    ]) {
      const once = microtypo(source);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once), once, source);
    }
  });

  test('a year and a city in one sentence read as each does alone', () => {
    assert.equal(microtypo('в 1983 г.'), `в${NBSP}1983${NBSP}г.`);
    assert.equal(microtypo('в г. Москве'), `в г.${NBSP}Москве`);
    assert.equal(microtypo('в 1983 г. в г. Москве'), `в${NBSP}1983${NBSP}г. в г.${NBSP}Москве`);
  });

  test('a line break after the year stays a line break (A26)', () => {
    assert.equal(microtypo('Сдано 24.06.2017г\nПринято'), `Сдано 24.06.2017${NBSP}г.\nПринято`);
    assert.equal(microtypo('Текст 24.06.17г\n- пункт'), `Текст 24.06.17${NBSP}г.\n—${NBSP}пункт`);
    assert.equal(
      microtypo('Текст 24.06.17г\n- пункт\n- второй', { input: 'markdown' }),
      `Текст 24.06.17${NBSP}г.\n- пункт\n- второй`
    );
    assert.equal(microtypo('в 2017г\nи далее'), `в${NBSP}2017${NBSP}г\nи${NBSP}далее`);
  });

  test('the digit of a unit is not a number, and a number wrapped in an element still is', () => {
    for (const [source, options, expected] of [
      ['2м2 г. Шиповник', {}, `2${NBSP}м² г.${NBSP}Шиповник`],
      [
        '5.8.6.7 г. Не это',
        { html: true },
        `<p><span style="white-space:nowrap;">5.8.6.7</span> г. Не${NBSP}это</p>`
      ]
    ]) {
      const once = microtypo(source, options);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once, options), once, source);
    }
  });

  test('six digits before г. and a capitalised name are a postal index, and г. its city', () => {
    for (const [source, expected] of [
      ['125009 г. Москва, ул. Ленина', `125009 г.${NBSP}Москва, ул.${NBSP}Ленина`],
      ['индекс 125009 г. Москва', `индекс 125009 г.${NBSP}Москва`]
    ]) {
      const once = microtypo(source);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once), once, source);
    }
  });

  test('a comma after the index, a glued г, a lowercase word and any other number read as before', () => {
    assert.equal(microtypo('125009, г. Москва'), `125\u{202F}009, г.${NBSP}Москва`);
    assert.equal(microtypo('125009г. Москва'), `125\u{202F}009${NBSP}г. Москва`);
    assert.equal(microtypo('125009 г. москва'), `125\u{202F}009${NBSP}г. москва`);
    assert.equal(microtypo('5 г. соли'), `5${NBSP}г. соли`);
    assert.equal(microtypo('1983 г. Москва стала'), `1983${NBSP}г. Москва стала`);
    assert.equal(microtypo('В 2024 г. Иванов уехал.'), `В${NBSP}2024${NBSP}г. Иванов уехал.`);
  });

  test('a city with no number in front and a date before a line break read as before', () => {
    assert.equal(microtypo('г. Москва'), `г.${NBSP}Москва`);
    assert.equal(microtypo('Сдано 24.06.2017 г.\nПринято'), `Сдано 24.06.2017${NBSP}г.\nПринято`);
  });
});

const span = (date) => `<span style="white-space:nowrap;">${date}</span>`;

// The year mark of a date is settled before any group reads the text around it, so a glued `г` is
// never a word of its own to them on one pass and the mark `г.` on the next.
describe('a date with its year mark settles in one pass', () => {
  test('a glued г is the year mark to every group', () => {
    for (const [source, expected] of [
      ['12.05.20г XX 2', `12.05.20${NBSP}г. XX${NBSP}2`],
      ['21.10.72г.я о', `21.10.72${NBSP}г. я о`],
      [`30.07.30г${NBSP}P.p.s.н`, `30.07.30${NBSP}г.${NBSP}P.p.s.н`],
      ['29.10.97г ли 2', `29.10.97${NBSP}г.${NBSP}ли 2`],
      ['02.12.01г 02.10.59г(', `02.12.01${NBSP}г. 02.10.59${NBSP}г. (`],
      ['05.07.41г Ж. Д.Т.Чё', `05.07.41${NBSP}г.${NBSP}Ж. Д.${NBSP}Т.${NBSP}Чё`],
      [`08.03.89г${NBSP}.`, `08.03.89${NBSP}г.`]
    ]) {
      const once = microtypo(source);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once), once, source);
    }
  });

  test('in markup, what follows the wrapped date reads as it does after the bare one', () => {
    for (const [source, rules, expected] of [
      ['08.09.25г. -', { 'dash.em_after_sentence': false }, `<p>${span('08.09.25 г.')} -</p>`],
      ['01.08.07г.- издани', {}, `<p>${span('01.08.07 г.')}- издани</p>`],
      ['13.04.46г."', {}, `<p>${span('13.04.46 г.')}"</p>`],
      ['13.04.46г."!', {}, `<p>${span('13.04.46 г.')}"!</p>`],
      ['26.05.56г.— с', {}, `<p>${span('26.05.56 г.')}— с</p>`]
    ]) {
      const options = { html: true, rules };
      const once = microtypo(source, options);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once, options), once, source);
    }
  });

  test('with the rule off, a date and its г stay as written', () => {
    assert.equal(
      microtypo('12.05.20г XX 2', { rules: { 'date.nowrap_date': false } }),
      `12.05.20г${NBSP}XX 2`
    );
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
