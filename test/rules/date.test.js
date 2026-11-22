import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };
const NBSP = ' ';

test('the last group of a number does not start a day range in XML', () => {
  for (const entities of [true, false]) {
    const typo = new MicroTypo({
      input: 'xml',
      entities,
      rules: { 'date.nowrap_day_range': true }
    });
    const en = entities ? '&#8211;' : '–';
    const gap = entities ? '&#160;' : NBSP;
    const narrow = entities ? '&#8239;' : '\u202f';
    for (const [number, written] of [
      ['12&#x202f;345', '12&#x202f;345'],
      ['1&#0008239;234', '1&#0008239;234'],
      ['1&#50;&#x202f;345', '1&#50;&#x202f;345'],
      ['1&#X000032;&#8239;345', '1&#X000032;&#8239;345'],
      ['1&#050;\u202f345', `1&#050;${narrow}345`],
      ['123&#8239;456&#X000202F;789', '123&#8239;456&#X000202F;789'],
      ['12\u202f345', `12${narrow}345`]
    ]) {
      const expected = `<p>${written}${en}7${gap}июля&#44; далее</p>`;
      assert.equal(typo.process(`<p>${number}-7 июля&#44; далее</p>`), expected);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('the boundary of a month reads the same in XML text and numeric references', () => {
  for (const entities of [false, true]) {
    const typo = new MicroTypo({ input: 'xml', entities, rules: { 'date.*': true } });
    const em = entities ? '&#8212;' : '—';
    const en = entities ? '&#8211;' : '–';
    const gap = entities ? '&#160;' : NBSP;
    for (const [tail, written, dash] of [
      [' -', `${gap}${em}`, em],
      [' слово', ' слово', em],
      ['&#x00a0;слово', '&#x00a0;слово', em],
      ['&#32;слово', '&#32;слово', em],
      ['&#44; далее', '&#44; далее', em],
      [', далее', ', далее', em],
      ['<i>слово</i>', '<i>слово</i>', em],
      ['я', 'я', en],
      ['&#1103;', '&#1103;', en]
    ]) {
      const source = `<doc><title>1-5 июля${tail}</title></doc>`;
      const expected = `<doc><title>1${dash}5${gap}июля${written}</title></doc>`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('a day range reads its dash and month separator in each output spelling', () => {
  for (const input of ['text', 'html', 'xml']) {
    for (const entities of [false, true]) {
      const typo = new MicroTypo({ input, entities, rules: { 'date.nowrap_day_range': true } });
      const number = new MicroTypo({ input, entities, rules: { 'date.nowrap_day_range': false } });
      const document = (body) => (input === 'text' ? body : `<p>${body}</p>`);
      const em = entities ? (input === 'xml' ? '&#8212;' : '&mdash;') : '—';
      const en = entities ? (input === 'xml' ? '&#8211;' : '&ndash;') : '–';
      const gap = entities ? (input === 'xml' ? '&#160;' : '&nbsp;') : NBSP;
      const expected = document(`6${em}8${gap}декабря`);
      for (const range of [
        '6-8 декабря',
        '6—8 декабря',
        '6&#8212;8&#160;декабря',
        '6&#x02013;8&#x00A0;декабря'
      ]) {
        assert.equal(typo.process(document(range)), expected);
      }
      assert.equal(typo.process(expected), expected);
      assert.equal(typo.process(document('6-8 яблок')), document(`6${en}8${gap}яблок`));
      assert.equal(number.process(document('6-8 декабря')), document(`6${en}8${gap}декабря`));
      const result = typo.process(document('6-8 декабря'), { trace: true });
      assert.equal(result.text, expected);
      assert.equal(result.trace.find(({ rule }) => rule === 'date.nowrap_day_range').count, 1);
    }
  }
});

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
      ['125009 г. Москва, ул. Ленина', `125009${NBSP}г.${NBSP}Москва, ул.${NBSP}Ленина`],
      ['индекс 125009 г. Москва', `индекс 125009${NBSP}г.${NBSP}Москва`]
    ]) {
      const once = microtypo(source);

      assert.equal(once, expected, source);
      assert.equal(microtypo(once), once, source);
    }
  });

  test('a comma after the index, a glued г, a lowercase word and any other number read as before', () => {
    assert.equal(microtypo('125009, г. Москва'), `125\u{202F}009, г.${NBSP}Москва`);
    assert.equal(microtypo('125009г. Москва'), `125009${NBSP}г.${NBSP}Москва`);
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
      ['21.10.72г.я о', `21.10.72${NBSP}г. я${NBSP}о`],
      [`30.07.30г${NBSP}P.p.s.н`, `30.07.30${NBSP}г.${NBSP}P.${NBSP}p.${NBSP}s. н`],
      ['29.10.97г ли 2', `29.10.97${NBSP}г.${NBSP}ли 2`],
      ['02.12.01г 02.10.59г(', `02.12.01${NBSP}г. 02.10.59${NBSP}г. (`],
      ['05.07.41г Ж. Д.Т.Чё', `05.07.41${NBSP}г.${NBSP}Ж.${NBSP}Д.${NBSP}Т.${NBSP}Чё`],
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
  test('formatting through a spaced separator settles on the first pass', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const [source, expected] of [
      [
        '«Летопись по 19<em>98 - 20</em>04 гг.».',
        `«Летопись по${NBSP}19<em>98–20</em>04${NBSP}гг.».`
      ],
      [
        '«Летопись <b>по</b> 1998 – 2004 г<em>г.</em>».',
        `«Летопись <b>по</b>${NBSP}1998–2004${NBSP}г<em>г.</em>».`
      ]
    ]) {
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('a run of source spaces before a split year suffix follows the bare phrase', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const gap of ['  ', '\t \t', '    ', NBSP.repeat(2), ` ${NBSP}\t`]) {
      const source = `«Архив <b>по</b> 1998 - 2004${gap}г<em>г.</em>».`;
      const expected = `«Архив <b>по</b>${NBSP}1998–2004${NBSP}г<em>г.</em>».`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
    const source = `«Архив по 1998<i>-</i>2004${NBSP.repeat(2)}гг.».`;
    const expected = `«Архив по${NBSP}1998<i>–</i>2004${NBSP}гг.».`;
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  });

  test('a formatted gap obeys the enabled space and binding rules', () => {
    const source = `«Архив по 1998 - 2004${NBSP}<b>${NBSP}</b>г<em>г.</em>».`;
    const next = new MicroTypo({ input: 'html' });
    const unbound = new MicroTypo({
      input: 'html',
      rules: { 'nobr.nbsp_after_number': false }
    });
    for (const [typo, expected] of [
      [next, `«Архив по${NBSP}1998–2004${NBSP}<b></b>г<em>г.</em>».`],
      [unbound, `«Архив по${NBSP}1998–2004${NBSP}<b>${NBSP}</b>г<em>г</em>».`]
    ]) {
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('collapsing long gaps keeps the original digits in each author element', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const gap of [' '.repeat(4), '\t '.repeat(8), NBSP.repeat(32)]) {
      const record = `по${gap}19<em>98${gap}-${gap}20</em>04${gap}гг.`;
      const linked = `по${gap}19<a href="/docs"><b>98${gap}-${gap}20</b></a><i>04</i>${gap}гг.`;
      const source = `«Летопись ${record}». «Сведения ${linked}».`;
      const plain = `по${gap}1998${gap}-${gap}2004${gap}гг.`;
      const bare = `«Летопись ${plain}». «Сведения ${plain}».`;
      const [first, second] = typo.process(bare).split(' «');
      const expected = [
        first.replace('1998–2004', '19<em>98–20</em>04'),
        second.replace('1998–2004', '19<a href="/docs"><b>98–20</b></a><i>04</i>')
      ].join(' «');
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('a replacement dash stays inside the element that held the author’s glyph', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const dash of [' <i>-</i> ', '\t<i>–</i>\t', '&nbsp;<i>-</i>&nbsp;']) {
      const source = `«Летопись по 1998${dash}2004 гг.».`;
      const expected = `«Летопись по${NBSP}1998<i>–</i>2004${NBSP}гг.».`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('an uncollapsed separator follows the punctuation of the same bare phrase', () => {
    for (const [sep, rules] of [
      [' -', {}],
      ['- ', {}],
      [' — ', {}],
      [' − ', {}],
      [' - ', { 'dash.en_range': false }]
    ]) {
      const typo = new MicroTypo({ input: 'html', rules: { ...rules } });
      const source = `«Летопись <b>по</b> 1998${sep}2004 г<em>г.</em>».`;
      const bare = `«Летопись по 1998${sep}2004 гг.».`;
      const expected = typo.process(bare).replace('по', '<b>по</b>').replace('гг»', 'г<em>г</em>»');
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('arithmetic and protected operands keep their original separators', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const [source, expected] of [
      ['1998 <em>-</em> 2004 = -6', '1998 <em>-</em> 2004 = -6'],
      ['по 1998 <em>-</em> 2004 = -6', `по${NBSP}1998 <em>-</em> 2004 = -6`],
      ['<code>по 1998 - 2004 гг.</code>', '<code>по 1998 - 2004 гг.</code>']
    ]) {
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('a single formatted interval can start and end anywhere in a year range', () => {
    const typo = new MicroTypo({ input: 'html' });
    const phrase = 'по 2020–2023 гг.';
    const written = `по${NBSP}2020–2023${NBSP}гг.`;
    for (let from = 0; from < phrase.length; from++) {
      for (let to = from + 1; to <= phrase.length; to++) {
        const mark = (text) =>
          `«Сведения ${text.slice(0, from)}<i>${text.slice(from, to)}</i>${text.slice(to)}».`;
        const expected = mark(written);
        assert.equal(typo.process(mark(phrase)), expected, `${from}..${to}`);
        assert.equal(typo.process(expected), expected);
      }
    }
  });

  test('keeps the two letters and their single period across separate author elements', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const ending of ['г<em>г.</em>', 'гг<em>.</em>']) {
      const source = `«Сведения <i>по</i> 2020–2023 ${ending}».`;
      const expected = `«Сведения <i>по</i>${NBSP}2020–2023${NBSP}${ending}».`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('nested formatting retains its characters when an absent gap and period are added', () => {
    const typo = new MicroTypo({ input: 'html' });
    const source = '«Сведения <em>по</em> 2<a href="/x"><b>020–202</b>3</a><i>гг</i>».';
    const expected = `«Сведения <em>по</em>${NBSP}2<a href="/x"><b>020–202</b>3</a>${NBSP}<i>гг</i>.».`;
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  });

  test('protected content and block boundaries interrupt the expression', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const [source, expected] of [
      ['«Сведения <code>по 2020–2023 гг.</code>».', '«Сведения <code>по 2020–2023 гг.</code>».'],
      ['<p><i>по</i></p><p>2020–2023 г</p>', `<p><i>по</i></p><p>2020–2023${NBSP}г</p>`],
      [
        '«Сведения <i>по</i> 2020–2023 г<code>г.</code>».',
        `«Сведения <i>по</i>${NBSP}2020–2023${NBSP}гг.<code>г.</code>».`
      ]
    ]) {
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('a marked-up introducer binds the year suffix and keeps its own period inside a quote', () => {
    const typo = new MicroTypo({ input: 'html' });
    for (const [source, expected] of [
      ['«Сведения по 2020–2023 гг.».', `«Сведения по${NBSP}2020–2023${NBSP}гг.».`],
      [
        '«Сведения <span>по</span> 2020–2023 гг.».',
        `«Сведения <span>по</span>${NBSP}2020–2023${NBSP}гг.».`
      ],
      [
        '&laquo;Сведения <a href="/x">по</a> 2020&ndash;2023&nbsp;гг&raquo;.',
        `«Сведения <a href="/x">по</a>${NBSP}2020–2023${NBSP}гг.».`
      ],
      [
        '«й <em><b>по</b></em> 2020–2020гг.».',
        `«й${NBSP}<em><b>по</b></em>${NBSP}2020–2020${NBSP}гг.».`
      ]
    ]) {
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('the year range and terminal punctuation switches remain independent inside quotes', () => {
    for (const [rules, input, expected] of [
      [
        { 'date.year_range': false },
        '«й <span>по</span> 2020–2020гг.».',
        '«й <span>по</span> 2020–2020гг».'
      ],
      [
        { 'punctuation.drop_terminal_garbage': false },
        '«Сведения <i>в</i> 2023 г.».',
        '«Сведения <i>в</i> 2023 г.».'
      ]
    ]) {
      const typo = new MicroTypo({ input: 'html', rules });
      assert.equal(typo.process(input), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

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
      `в${NBSP}Ребме собрали супер-8${NBSP}камера`
    );
    assert.equal(microtypo('Рэндом отдал по-2'), 'Рэндом отдал по-2');
    // 'в' before 'Арденском' is NBSP-joined the same way.
    assert.equal(
      microtypo('дом-5 сгорел в Арденском лесу'),
      `дом-5${NBSP}сгорел в${NBSP}Арденском${NBSP}лесу`
    );
    // 'у' is NBSP-joined to 'дороги' the same way.
    assert.equal(microtypo('изба-7 стояла у дороги'), `изба-7${NBSP}стояла у${NBSP}дороги`);
  });
  test('day+month range: a bare day-day range is untouched by this rule (number.en_range already converts it)', () => {
    // Left side lacks a "число месяц" run, so this rule never fires; the en-dash comes from number.en_range.
    assert.equal(microtypo('Корвин ждал 5-20 марта'), `Корвин ждал 5–20${NBSP}марта`);
  });
});
