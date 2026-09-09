import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };
const P = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

function entity(text) {
  return new MicroTypo({ ...P, entities: true }).process(text);
}

describe('emphatic particles attach with a hyphen', () => {
  test('ка joins the stem', () => {
    assert.equal(microtypo('принеси ка', P), 'принеси-ка');
    assert.equal(microtypo('Ступай ка', P), 'Ступай-ка');
  });

  test('кась joins the stem', () => {
    assert.equal(microtypo('Гляди кась', P), 'Гляди-кась');
  });

  test('де joins the stem', () => {
    assert.equal(microtypo('молвил де', P), 'молвил-де');
  });

  test('already hyphenated stays', () => {
    assert.equal(microtypo('принеси-ка', P), 'принеси-ка');
  });

  test('bare то keeps no hyphen', () => {
    // `то` binds with an NBSP short-word rule, never a hyphen.
    assert.ok(!microtypo('то был Эрик', P).includes('-'));
  });
});

describe('en-dash for number ranges', () => {
  test('range gains an ndash entity', () => {
    assert.ok(entity('войско 100-500').includes('100&ndash;500'));
  });

  test('range gains an en-dash glyph', () => {
    assert.ok(microtypo('войско 100-500', P).includes('100–500'));
  });

  test('short range converts', () => {
    assert.ok(microtypo('от 5-10 клинков', P).includes('5–10'));
  });

  test('day range converts', () => {
    assert.ok(microtypo('за 12-19 дней', P).includes('12–19'));
  });

  test('ISO date is preserved', () => {
    const out = microtypo('Хроника 2024-01-01.', P);
    assert.ok(out.includes('2024-01-01'), out);
    assert.ok(!out.includes('–'), out);
  });

  test('phone number is preserved', () => {
    const out = microtypo('зов 8-800-555-35-35', P);
    assert.ok(out.includes('8-800-555-35-35'), out);
    assert.ok(!out.includes('–'), out);
  });

  test('year range becomes an en-dash', () => {
    assert.ok(microtypo('с 1999-2003 г.', P).includes('1999–2003'));
  });

  test('time interval gains an ndash entity', () => {
    assert.ok(entity('с 9:00-18:00 в карауле').includes('9:00&ndash;18:00'));
  });
});

describe('a range written with an en dash stays a range', () => {
  const NBSP = '\u{00A0}';

  test('a spaced en dash closes up', () => {
    assert.equal(microtypo('за 12 – 19 дней', P), `за${NBSP}12–19 дней`);
  });

  test('an ndash entity closes up', () => {
    assert.equal(microtypo('за 12 &ndash; 19 дней', P), `за${NBSP}12–19 дней`);
  });

  test('the range survives entity output', () => {
    assert.ok(entity('за 12 – 19 дней').includes('12&ndash;19'));
  });

  test('a unit after the range still binds', () => {
    assert.equal(microtypo('везли 100 – 200 кг', P), `везли 100–200${NBSP}кг`);
  });

  test('an en dash glued to a mark becomes an em dash', () => {
    assert.equal(microtypo('Корвин:– Рэндом', P), `Корвин:${NBSP}— Рэндом`);
  });

  test('a spaced em dash stays as written', () => {
    assert.equal(microtypo('за 12 — 19 дней', P), `за${NBSP}12${NBSP}— 19 дней`);
  });
});

// `abbr.currency` takes the abbreviation's period away four groups after `dash` has read it as a
// sentence mark, so anything the dash rules decline on account of that period would be decided again
// on the next pass.
describe('a dash settles in one pass around an abbreviation', () => {
  const NBSP = '\u{00A0}';

  test('a dash that ends the text binds backwards, like every other dangling dash', () => {
    const once = microtypo('Амбер вечен. -', P);

    assert.equal(once, `Амбер вечен.${NBSP}—`);
    assert.equal(microtypo(once, P), once);
  });

  test('a sum before a dangling dash settles in one pass', () => {
    const once = microtypo('100 руб. 100 руб. -', P);

    assert.equal(once, `100${NBSP}₽${NBSP}100${NBSP}₽${NBSP}—`);
    assert.equal(microtypo(once, P), once);
  });

  test('a sum before a spaced dash settles in one pass', () => {
    const once = microtypo('Амбер 100 руб. -- из за дождя', P);

    assert.equal(once, `Амбер 100${NBSP}₽${NBSP}— из-за дождя`);
    assert.equal(microtypo(once, P), once);
  });

  // The hyphen join consumes the character in front of the word it joins, and that character is the
  // non-breaking space the sentence dash just wrote to bind itself forward.
  test('a hyphen join keeps the binding the sentence dash wrote', () => {
    assert.equal(microtypo('Амбер. — кто то шёл', P), `Амбер. —${NBSP}кто-то шёл`);
  });
});

describe('a line-start and post-sentence dash read the en dash too', () => {
  const NBSP = '\u{00A0}';

  test('an en dash after a line break becomes an em dash', () => {
    assert.equal(microtypo('Амбер.\n– Корвин шёл', P), `Амбер.\n—${NBSP}Корвин шёл`);
  });

  test('an en dash after a sentence mark becomes an em dash', () => {
    assert.equal(microtypo('Амбер. – Корвин шёл', P), `Амбер. —${NBSP}Корвин шёл`);
  });

  test('an en dash after an ellipsis becomes an em dash', () => {
    assert.equal(microtypo('Тень… – Корвин шёл', P), `Тень… —${NBSP}Корвин шёл`);
  });
});

describe('range and dash bundles', () => {
  test('endash bundle converts a hyphen range', () => {
    assert.ok(microtypo('отряд 100-500 бойцов', NOP).includes('100–500'));
  });

  test('emdash bundle converts a spaced hyphen', () => {
    assert.ok(microtypo('Амбер - вечен.', NOP).includes('—'));
  });

  test('endash bundle converts a spaced range', () => {
    assert.ok(microtypo('дозор 12 - 19 стрелков', NOP).includes('12–19'));
  });

  // `em` reads a run of horizontal whitespace, so a range accepting exactly one space would fall
  // past this rule into that one and come out as an em dash — the one glyph a range never takes. The
  // two rules have to agree on what separates a dash from its neighbour.
  test('a range keeps its sign whatever whitespace surrounds the dash', () => {
    for (const src of ['12  –  19', '12  -  19', '12 \t- \t19', '12 - 19', '12–19']) {
      assert.ok(microtypo(`дозор ${src} стрелков`, NOP).includes('12–19'), src);
    }

    assert.ok(microtypo('смена 8:00  -  9:00 в Ардене', NOP).includes('8:00–9:00'));
  });
});

describe('dash.hyphenated_particle — кое- prefix (GAP-A1)', () => {
  test('кое какой becomes кое-какой', () => {
    assert.equal(microtypo('кое какой', NOP), 'кое-какой');
  });

  test('кое что becomes кое-что', () => {
    assert.equal(microtypo('расскажу кое что', NOP), 'расскажу кое-что');
  });

  test('existing кое-как is unchanged', () => {
    assert.equal(microtypo('кое-как', NOP), 'кое-как');
  });
});

describe('dash.em — neighbours that are not letters', () => {
  const NBSP = '\u{00A0}';

  test('a closing bracket ends content', () => {
    assert.equal(microtypo('Читай [Амбер][a] - вот.', NOP), `Читай [Амбер][a]${NBSP}— вот.`);
  });

  test('an emphasis marker ends content', () => {
    assert.equal(microtypo('Слово *важно* - вот.', NOP), `Слово *важно*${NBSP}— вот.`);
  });

  test('a percent ends content', () => {
    assert.equal(microtypo('Шанс 50% - невелик.', NOP), `Шанс 50%${NBSP}— невелик.`);
  });

  test('a protected code span ends content', () => {
    assert.equal(
      microtypo('Строка `код` - вот.', { ...NOP, input: 'markdown' }),
      `Строка \`код\`${NBSP}— вот.`
    );
  });

  test('a spaced thematic break is still not an em dash', () => {
    assert.equal(microtypo('- - -', { ...NOP, input: 'markdown' }), '- - -');
  });

  test('a sentence mark keeps the em_after_sentence spacing', () => {
    assert.equal(
      microtypo('Корвин ушёл. - Эрик остался.', NOP),
      `Корвин ушёл. —${NBSP}Эрик остался.`
    );
  });

  test('an opening paren does not take a dash', () => {
    assert.doesNotMatch(microtypo('Отряд ( - без карты) ушёл.', NOP), /—/);
  });
});

// Half-typeset sources arrive with short words already glued: the separator around the dash is a
// non-breaking space, which em_after_sentence has always read and em did not.
describe('dash after a non-breaking space', () => {
  const NBSP = '\u{00A0}';

  test('em converts with the nbsp before the dash', () => {
    assert.equal(microtypo(`Корвин${NBSP}- принц.`, NOP), `Корвин${NBSP}— принц.`);
  });

  test('em converts with the nbsp on both sides', () => {
    assert.equal(microtypo(`Корвин${NBSP}-${NBSP}принц.`, NOP), `Корвин${NBSP}—${NBSP}принц.`);
  });

  test('a spaced range stays a range, not an em dash', () => {
    assert.equal(microtypo(`Годы 1979${NBSP}- 1985 тут.`, NOP), 'Годы 1979–1985 тут.');
    assert.equal(microtypo(`Годы 1979${NBSP}-${NBSP}1985 тут.`, NOP), 'Годы 1979–1985 тут.');
  });

  test('an existing em dash after an nbsp is left alone', () => {
    assert.equal(microtypo(`Корвин${NBSP}— принц.`, NOP), `Корвин${NBSP}— принц.`);
  });

  test('a thematic break is still not an em dash', () => {
    assert.equal(
      microtypo(`-${NBSP}-${NBSP}-`, { ...NOP, input: 'markdown' }),
      `-${NBSP}-${NBSP}-`
    );
  });

  // The space after `--` is the one the next `--` needs as its own opening boundary, so consuming it
  // would convert every other one in a run.
  test('a run of double hyphens converts in one pass', () => {
    const out = microtypo('Дворкин: -- -- -- и всё');

    assert.ok(!out.includes('--'), out);
    assert.equal((out.match(/—/g) ?? []).length, 3, out);
    assert.equal(microtypo(out), out);
  });

  // Only the range rules would put a folded en dash back — from digits, roman numerals and dates —
  // so everywhere else the author's dash would come out a hyphen in the default configuration.
  describe('en dash keeps the form it was written with', () => {
    const EN = '\u{2013}';

    test('a glued en dash between words survives', () => {
      assert.equal(microtypo(`Путь Корвин${EN}Эрик пройден`), `Путь Корвин${EN}Эрик пройден`);
      assert.equal(microtypo(`связка отец${EN}сын`), `связка отец${EN}сын`);
    });

    test('a range survives even with the number group disabled', () => {
      const src = `Годы 1990${EN}2005`;

      assert.ok(microtypo(src).includes(`1990${EN}2005`));
      assert.ok(microtypo(src, { rules: { number: false } }).includes(`1990${EN}2005`));
    });

    test('a spaced en dash between words is still raised to an em dash', () => {
      assert.equal(microtypo(`Корвин ${EN} принц`), 'Корвин\u{00A0}— принц');
    });

    test('the entity spelling decodes to the glyph and back', () => {
      assert.ok(microtypo('Годы 1990&ndash;2005').includes(`1990${EN}2005`));
      assert.ok(microtypo('Годы 1990&#8211;2005').includes(`1990${EN}2005`));
      assert.ok(microtypo(`Годы 1990${EN}2005`, { entities: true }).includes('1990&ndash;2005'));
    });

    // U+2010 is the hyphen itself and U+2012 only stands between figures: both still fold.
    test('the hyphen and figure dash still fold', () => {
      assert.equal(microtypo('Слово\u{2010}связка тут'), 'Слово-связка тут');
      assert.ok(microtypo('Номер 5\u{2012}7 в списке').includes(`5${EN}7`));
    });
  });

  // A single-character separator leaves a dash set off with two spaces unbound until
  // `space.collapse_spaces` reduces the run, four groups later.
  test('a dash set off by several spaces binds in one pass', () => {
    const NB = '\u{00A0}';

    for (const src of [
      'Дворкин оставил 3 пробела -- и ушёл',
      'Дворкин оставил 3 пробела  -- и ушёл',
      'Дворкин оставил 3 пробела   -- и ушёл',
      'Дворкин оставил 3 пробела   — и ушёл'
    ]) {
      const once = microtypo(src);

      assert.ok(once.includes(`пробела${NB}—`), `not bound: ${JSON.stringify(once)}`);
      assert.equal(microtypo(once), once);
    }
  });

  test('a sentence dash set off by several spaces settles too', () => {
    const once = microtypo('Корвин ушёл.   —   сказал Рэндом');

    assert.equal(microtypo(once), once);
  });

  // A boundary of whitespace and `>` alone leaves a bracket or a quote on either side keeping the
  // space that a bare form loses.
  test('a hyphen-joined form binds inside every bracket and quote', () => {
    const forms = [
      ['кто то', 'кто-то'],
      ['кое что', 'кое-что'],
      ['всё таки', 'всё-таки'],
      ['ну ка', 'ну-ка'],
      ['из за', 'из-за']
    ];

    for (const [src, want] of forms) {
      for (const wrap of [
        (s) => `(${s})`,
        (s) => `«${s}»`,
        (s) => `[${s}]`,
        (s) => `Текст — ${s}.`
      ]) {
        const out = microtypo(wrap(src), { render: { paragraphs: false } });

        assert.ok(out.includes(want), `${wrap(src)} → ${JSON.stringify(out)}`);
      }
    }
  });

  // A consumed trailing boundary binds the first form and leaves the rest to a later pass.
  test('a run of hyphen-joined forms settles in one pass', () => {
    const once = microtypo('из за из под из за', { render: { paragraphs: false } });

    assert.equal(once, 'из-за из-под из-за');
    assert.equal(microtypo(once, { render: { paragraphs: false } }), once);
  });

  // A single-character separator makes the binding wait for `space.collapse_spaces`, four groups
  // later, so the same document comes out two ways.
  test('several spaces inside a hyphen-joined form still bind in one pass', () => {
    const once = microtypo('Текст кое  как конец', { render: { paragraphs: false } });

    assert.equal(once, 'Текст кое-как конец');
    assert.equal(microtypo(once, { render: { paragraphs: false } }), once);
  });
});
