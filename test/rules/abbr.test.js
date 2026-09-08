import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NBSP = '\u{00A0}';

// Strip <p> wrapping so assertions check each rule's own effect.
const NOP = { html: true, render: { paragraphs: false } };

describe('abbr.nbsp_organization', () => {
  test('binds ООО to name with nbsp', () => {
    assert.ok(microtypo('ООО Грейсвандир', NOP).includes(`ООО${NBSP}Грейсвандир`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('ООО Грейсвандир', {
      ...NOP,
      rules: { 'abbr.nbsp_organization': false }
    });
    assert.ok(out.includes('ООО Грейсвандир'));
    assert.ok(!out.includes(`ООО${NBSP}Грейсвандир`));
  });
});

describe('abbr.nbsp_location', () => {
  test('binds г. to place with nbsp', () => {
    assert.ok(microtypo('дорога в г. Амбер', NOP).includes(`г.${NBSP}Амбер`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('дорога в г. Амбер', { ...NOP, rules: { 'abbr.nbsp_location': false } });
    assert.ok(out.includes('г. Амбер'));
    assert.ok(!out.includes(`г.${NBSP}Амбер`));
  });
});

describe('abbr.nowrap_ie', () => {
  test('wraps т.е. as nowrap т. е.', () => {
    const out = microtypo('т.е. в Тень', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">'));
    assert.ok(out.includes('т. е.'));
  });

  test('leaves т.е. untouched when off', () => {
    const out = microtypo('т.е. в Тень', { ...NOP, rules: { 'abbr.nowrap_ie': false } });
    assert.ok(out.includes('т.е.'));
    assert.ok(!out.includes('white-space:nowrap'));
  });
});

describe('abbr.nowrap_gost', () => {
  test('wraps ГОСТ + number as nowrap', () => {
    const out = microtypo('Клинок ГОСТ 8.417 выкован', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">ГОСТ 8.417'));
  });

  test('leaves ГОСТ unwrapped when off', () => {
    const out = microtypo('Клинок ГОСТ 8.417 выкован', {
      ...NOP,
      rules: { 'abbr.nowrap_gost': false }
    });
    assert.ok(out.includes('ГОСТ 8.417'));
    assert.ok(!out.includes('white-space:nowrap'));
  });
});

describe('abbr.nbsp_dpi', () => {
  test('binds number to dpi with nbsp', () => {
    assert.ok(microtypo('Козырь 300 dpi чёткий', NOP).includes(`300${NBSP}dpi`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('Козырь 300 dpi чёткий', { ...NOP, rules: { 'abbr.nbsp_dpi': false } });
    assert.ok(out.includes('300 dpi'));
    assert.ok(!out.includes(`300${NBSP}dpi`));
  });
});

describe('abbr.nbsp_dpi — spaced form (NBSP-1)', () => {
  test('300 dpi binds with nbsp', () => {
    assert.ok(microtypo('300 dpi', NOP).includes(`300${NBSP}dpi`));
  });

  test('300dpi (glued) binds with nbsp', () => {
    assert.ok(microtypo('300dpi', NOP).includes(`300${NBSP}dpi`));
  });
});

describe('abbr.nbsp_unit — number binds to unit, unit stays breakable from noun (NBSP-2)', () => {
  test('unit binds to number only, not to the following noun', () => {
    const out = microtypo('5 кг серебра', NOP);
    assert.match(out, new RegExp(`5${NBSP}кг`), `number↔unit NBSP missing: ${out}`);
    assert.match(out, /кг серебра/, `unit↔noun must be a plain space: ${out}`);
  });

  test('unit followed by punctuation keeps only the number binding', () => {
    assert.ok(microtypo('всего 5 кг.', NOP).includes(`5${NBSP}кг.`));
  });
});

describe('abbr.nbsp_unit — serial units', () => {
  test('binds both parts of a compound weight', () => {
    const out = microtypo('Слиток из Амбера весит 5 кг 300 г', NOP);
    assert.ok(out.includes(`5${NBSP}кг`), `first unbound: ${out}`);
    assert.ok(out.includes(`300${NBSP}г`), `second unbound: ${out}`);
  });

  test('binds both parts of a compound length', () => {
    const out = microtypo('Коридор Амбера шириной 2 м 40 см', NOP);
    assert.ok(out.includes(`2${NBSP}м`), `first unbound: ${out}`);
    assert.ok(out.includes(`40${NBSP}см`), `second unbound: ${out}`);
  });
});

describe('abbr.nbsp_unit — binds unit after a dash-separated range', () => {
  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo('Тропа через Тени растянулась на 15000—20000 м');
    assert.ok(out.includes(`20\u{202F}000${NBSP}м`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo('Тропа через Тени растянулась на 15000—20000 м');
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_weight_unit — binds unit after a dash-separated range', () => {
  const text = 'Слиток из сердца Хаоса весит 15000—20000 кг.';

  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo(text);
    assert.ok(out.includes(`20\u{202F}000${NBSP}кг`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo(text);
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_data_unit — binds unit after a dash-separated range', () => {
  const text = 'Архив Дворкина хранит 15000—20000 ГБ хроник Отражений.';

  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo(text);
    assert.ok(out.includes(`20\u{202F}000${NBSP}ГБ`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo(text);
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_fraction_unit — fraction glyph binds to unit (number.fraction runs first)', () => {
  test('3/4 кг binds the fraction glyph to the unit with nbsp', () => {
    const out = microtypo('3/4 кг золота Амбера', NOP);
    assert.ok(out.includes(`¾${NBSP}кг`), `fraction↔unit NBSP missing: ${out}`);
  });

  test('¾ мгновение is not mistaken for the мг unit (word boundary guard)', () => {
    const out = microtypo('¾ мгновение спустя Корвин пересёк Тень', NOP);
    assert.ok(out.includes('¾ мгновение'), `guard failed, unit false-matched: ${out}`);
    assert.ok(!out.includes(`¾${NBSP}мг`), `unit incorrectly bound inside word: ${out}`);
  });

  // Every measurement rule reads one boundary set, closers included, so a measurement inside
  // brackets or quotes binds as a bare `5 км` does.
  describe('boundaries around a measurement', () => {
    const NB = '\u{00A0}';
    const wrapped = [
      ['скобки', '(', ')'],
      ['кавычки', '«', '»'],
      ['квадратные', '[', ']'],
      ['фигурные', '{', '}']
    ];
    const units = ['5 км', '5 кг', '5 л', '5 мин', '20 °C', '7 ГБ', '100 МГц', '16 px'];

    for (const [name, open, close] of wrapped) {
      test(`измерение в обрамлении: ${name}`, () => {
        for (const unit of units) {
          const bare = microtypo(`Путь ${unit} дальше`);
          const inside = microtypo(`Путь ${open}${unit}${close} дальше`);
          const glued = unit.replace(' ', NB);

          assert.ok(bare.includes(glued), `без обрамления не связалось: ${bare}`);
          assert.ok(inside.includes(glued), `в обрамлении ${name} не связалось: ${inside}`);
        }
      });
    }

    test('серия единиц связывается вся, а не через одну', () => {
      const out = microtypo('Рост 2 м 40 см ровно');

      assert.ok(out.includes(`2${NB}м`), out);
      assert.ok(out.includes(`40${NB}см`), out);
    });
  });

  // The dash group runs first and reads the abbreviation's period as the end of a sentence, so it
  // binds the dash to the word after it. Then this rule removes the period — and the sentence it was
  // supposed to end never existed. The rule that takes the evidence away restores the conclusion.
  describe('a dash after a currency abbreviation', () => {
    const NB = '\u{00A0}';

    test('binds to the amount, not to the next word', () => {
      assert.equal(
        microtypo('Клинок оценили в 100 руб. — шутка Рэндома'),
        `Клинок оценили в${NB}100${NB}₽${NB}— шутка Рэндома`
      );
      assert.equal(
        microtypo('Долг 50 долл. — и ни центом больше'),
        `Долг 50${NB}$${NB}— и${NB}ни${NB}центом больше`
      );
    });

    test('the same amount written with the symbol agrees', () => {
      assert.equal(
        microtypo('Клинок оценили в 100 ₽ — шутка'),
        microtypo('Клинок оценили в 100 руб. — шутка')
      );
    });

    test('a real sentence end still keeps its period', () => {
      assert.equal(microtypo('Дань 100 руб. Корвин ушёл'), `Дань 100${NB}₽. Корвин ушёл`);
      assert.equal(microtypo('Дань 100 руб.'), `Дань 100${NB}₽.`);
    });

    // Markup and a bracket are not what ends a sentence — what stands behind them is — so putting the
    // phrase behind the amount in emphasis must not change its punctuation.
    test('inline markup does not make a sentence end', () => {
      const render = { html: true, render: { paragraphs: false } };

      assert.equal(
        microtypo('Цена 100 руб. <em>за штуку</em>', render),
        `Цена 100${NB}₽ <em>за${NB}штуку</em>`
      );
      assert.equal(microtypo('Цена 100 долл. (за штуку)', render), `Цена 100${NB}$ (за${NB}штуку)`);
      assert.equal(
        microtypo('Цена 100 руб. <em>За штуку</em>', render),
        `Цена 100${NB}₽. <em>За${NB}штуку</em>`
      );
    });

    // Inline markup is transparent, a block boundary is not: the period that ends a paragraph ends
    // its sentence whatever the next paragraph opens with.
    test('the search stops at a block boundary', () => {
      const render = { html: true, render: { paragraphs: false }, rules: { 'hanging.*': false } };

      assert.equal(
        microtypo('<p>Он заплатил 100 руб.</p><p>12 сентября лавка закрылась.</p>', render),
        `<p>Он${NB}заплатил 100${NB}₽.</p><p>12${NB}сентября лавка закрылась.</p>`
      );
      assert.equal(
        microtypo('<div>Цена 100 руб.</div><div>за штуку</div>', render),
        `<div>Цена 100${NB}₽.</div><div>за${NB}штуку</div>`
      );
    });

    // An element that renders nothing adds no words, so what stands behind it decides — the same
    // answer inline markup gets. Every other protected region is content, and the words inside it go
    // on with the sentence, so the two cannot be one class.
    test('an element that shows nothing leaves the decision to what follows', () => {
      const render = { html: true, render: { paragraphs: false }, rules: { 'hanging.*': false } };

      assert.equal(
        microtypo('Он заплатил 100 руб. <script>void 0;</script>', render),
        `Он${NBSP}заплатил 100${NBSP}₽. <script>void 0;</script>`
      );
      assert.equal(
        microtypo('Он заплатил 100 руб. <style>a{}</style>', render),
        `Он${NBSP}заплатил 100${NBSP}₽. <style>a{}</style>`
      );
      assert.equal(
        microtypo('Он заплатил 100 руб. <script>void 0;</script> Корвин ушёл.', render),
        `Он${NBSP}заплатил 100${NBSP}₽. <script>void 0;</script> Корвин ушёл.`
      );
      assert.equal(
        microtypo('Он заплатил 100 руб. <script>void 0;</script> и ушёл', render),
        `Он${NBSP}заплатил 100${NBSP}₽ <script>void 0;</script> и${NBSP}ушёл`
      );
    });

    test('a visible protected region continues it', () => {
      const render = { html: true, render: { paragraphs: false }, rules: { 'hanging.*': false } };

      assert.equal(
        microtypo('Корвин платит 100 руб. <code>за книгу.</code>', render),
        `Корвин платит 100${NBSP}₽ <code>за книгу.</code>`
      );
      assert.equal(
        microtypo('Корвин платит 100 руб. <kbd>за книгу</kbd>', render),
        `Корвин платит 100${NBSP}₽ <kbd>за книгу</kbd>`
      );
      assert.ok(
        microtypo('Он заплатил 100 руб. <notg>Арден</notg>', render).startsWith(
          `Он${NBSP}заплатил 100${NBSP}₽ <span`
        )
      );
    });

    // An element with nothing in it shows nothing either, whatever element it is.
    test('an empty protected region carries no words', () => {
      const render = { html: true, render: { paragraphs: false }, rules: { 'hanging.*': false } };

      for (const body of ['', '  ', '\t']) {
        assert.equal(
          microtypo(`Корвин заплатил 100 руб. <code>${body}</code>`, render),
          `Корвин заплатил 100${NBSP}₽. <code>${body}</code>`,
          JSON.stringify(body)
        );
      }
    });

    test('settles in one pass', () => {
      const once = microtypo('Итого 12 500 руб. — и ни монетой меньше');

      assert.equal(microtypo(once), once);
    });
  });
});

// The word abbreviations share the measurement rules' boundaries, so `(гл. 5)` and `гл. 5;` bind as
// a bare `гл. 5` does, and the trailing lookahead stops a run binding every other one.
describe('abbr word abbreviations — shared content boundaries', () => {
  const wraps = [
    (s) => `Текст (${s}) конец`,
    (s) => `Текст «${s}» конец`,
    (s) => `Текст [${s}] конец`,
    (s) => `Текст ${s}; конец`,
    (s) => `Текст — ${s} конец`
  ];

  test('every abbreviation binds in every environment', () => {
    for (const subject of ['гл. 5', 'см. Амбер', 'ул. Ардена', 'д. 5', 'б-р Колвира']) {
      for (const wrap of wraps) {
        const out = microtypo(wrap(subject), NOP);

        assert.ok(out.includes(NBSP), `${wrap(subject)} → ${JSON.stringify(out)}`);
      }
    }
  });

  test('a run binds every one of them, not every other', () => {
    const out = microtypo('Смотри гл. 5 гл. 7 гл. 9 указа Дворкина', NOP);

    assert.equal(out.split(NBSP).length - 1, 3, out);
    assert.equal(microtypo(out, NOP), out);
  });
});

// The four word forms on the shared boundaries: `(и т. д.)`, `(т. е. …)`, `(до н. э.)` and
// `(г-н Рэндом)` bind as their bare forms do. The three that wrap their match in a span take the
// boundary without `>`, because opening a wrapper as the first thing inside a foreign element nests
// one span per pass — `etc.drop_nested_nowrap` knows only the wrappers this engine emitted in the
// current layout.
describe('abbr word forms — shared content boundaries', () => {
  const wraps = [
    (s) => `Хроника (${s}) конец`,
    (s) => `Хроника «${s}» конец`,
    (s) => `Хроника [${s}] конец`
  ];

  test('every wrapped form binds inside every bracket', () => {
    for (const subject of ['и т. д.', 'т. е. тень', 'до н. э.', 'г-н Рэндом']) {
      for (const wrap of wraps) {
        const out = microtypo(wrap(subject), NOP);

        assert.ok(
          out.includes(NBSP) || out.includes('nowrap'),
          `${wrap(subject)} → ${JSON.stringify(out)}`
        );
      }
    }
  });

  test('a wrapper is not opened right inside a foreign tag', () => {
    const source = 'Хроника <span style="white-space:nowrap;">и т. д.</span> Корвина';

    for (const layout of [{}, { render: { hanging: 'class' } }]) {
      const out = microtypo(source, { html: true, ...layout });

      assert.equal(out, `<p>${source}</p>`, JSON.stringify(out));
    }
  });
});
