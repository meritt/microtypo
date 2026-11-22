import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';
import { BLOCK_TAG_NAMES } from '../../src/lib/block-tags.js';
import { PARAGRAPH_OPEN, PARAGRAPH_CLOSE } from '../../src/protect/placeholders.js';
import { processQuotes } from '../../src/rules/quote-state.js';
import { prepareAuthoredQuotes } from '../../src/rules/quote.js';

const BDQUO = '„';
const LDQUO = '“';
const PRIME = '″';

test('a touching quote or reference only enables authored rewriting in its own paragraph', () => {
  const title = 'В Омске нашли "Каталог "Письма «Осень» от 1938» издан в Риге".';
  const expected = 'В Омске нашли «Каталог „Письма „Осень“ от 1938“ издан в Риге».';
  for (const [config, combine] of [
    [{}, (a, b) => `${a}\n\n${b}`],
    [{ input: 'markdown' }, (a, b) => `${a}\r\n\r\n${b}`],
    [{ input: 'html' }, (a, b) => `<p>${a}</p>\n<p>${b}</p>`],
    [{ input: 'xml' }, (a, b) => `<doc><p>${a}</p>\n<p>${b}</p></doc>`]
  ]) {
    const engine = new MicroTypo(config);
    for (const field of [
      'В Москве ячейка "" пуста.',
      'Изданы "Север""Запад".',
      'Напечатано &quot;Море&quot;.'
    ]) {
      const normalize = (a, b) => engine.process(combine(a, b));
      assert.equal(normalize(field, title), normalize(field, expected));
      assert.equal(normalize(title, field), normalize(expected, field));
      assert.equal(engine.process(normalize(field, title)), normalize(field, title));
    }
  }
});

test('the end of a numbered title and the opening of its neighbour remain paired', () => {
  for (const number of ['5', '27', '1938']) {
    const source = `В оглавлении: "“Добрый вечер” том ${number}" и "Том ${number} "Осень" уже издан".`;
    const expected = `В оглавлении: «„Добрый вечер“ том ${number}» и «Том ${number} „Осень“ уже издан».`;
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
  const title = 'Редактор сказал: "Каталог "Письма «Осень» от 1938» упомянут вчера".';
  const expected = 'Редактор сказал: «Каталог „Письма „Осень“ от 1938“ упомянут вчера».';
  for (const separator of [' ', '\n']) {
    const source = `Ячейка "" пуста.${separator}${title}`;
    const result = `Ячейка «» пуста.${separator}${expected}`;
    assert.equal(microtypo(source), result);
    assert.equal(microtypo(result), result);
  }
  const sizes = 'Саша пишет: «Строка ““Рама 12”” после “Лист 7””” нужна».';
  const measured = 'Саша пишет: «Строка „„Рама 12″“ после „Лист 7″““ нужна».';
  assert.equal(microtypo(sizes), measured);
  assert.equal(microtypo(measured), measured);
});

test('the source owns the ends of two measurements and the prose between them', () => {
  const source = 'Мастер сообщил: «На стенде „Экран 8 ““ и “Рама 12”” показаны рядом».';
  const expected = 'Мастер сообщил: «На стенде „Экран 8″“ и „Рама 12″“ показаны рядом».';
  assert.equal(microtypo(source), expected);
  assert.equal(microtypo(expected), expected);
  for (const input of ['html', 'xml']) {
    const e = new MicroTypo({ input });
    const heading = 'Сообщили: «Сверили «Запись «<em>Маяк</em>» за 12» и корпус 7 “ готов».';
    const correct = 'Сообщили: «Сверили „Запись „<em>Маяк</em>“ за 12“ и корпус 7″ готов».';
    assert.equal(e.process(heading), correct);
    assert.equal(e.process(correct), correct);
  }
});

test('a visible foot mark identifies a complete inch amount without changing its source spelling', () => {
  for (const [input, left, right] of [
    ['text', '2′8,5', '1′7,5'],
    ['text', '2′8.5', '7'],
    ['text', '2′8 1/2', '1′7 1/2'],
    ['text', '2′1 008', '1′1 007'],
    ['html', '2<em>′</em>8,5', '1<em>′</em>7,5'],
    ['xml', '2<em>′</em>8', '1<em>′</em>7'],
    ['html', '2&#8242;8,5', '1&#x2032;7,5'],
    ['xml', '2&#8242;8', '1&#x2032;7']
  ]) {
    const e = new MicroTypo({ input });
    const source = `В журнале: «Ширина ${left} “ у рамы «Сосна», высота ${right}”».`;
    const expected = `В журнале: «Ширина ${left}″ у рамы „Сосна“, высота ${right}″».`;
    assert.equal(e.process(source), expected);
    assert.equal(e.process(expected), expected);
  }
  for (const address of ['2′8.7.1', '2′8/7/1', '2′8-7']) {
    const source = `В описи: «Строка ${address} “ Обзор «Тайги», выпуск 7”».`;
    const expected = microtypo(`В описи: «Строка ${address} „Обзор „Тайги“, выпуск 7“».`);
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('the feet and inches retain their source spelling across visible number boundaries', () => {
  for (const [input, left, right] of [
    ['text', '2′1⁄2', '1′1⁄4'],
    ['html', '2′8&#44;5', '1′7&#x2E;5'],
    ['xml', '&#x32;′8 1&#47;2', '&#49;′7 1&#x2044;4'],
    ['html', '<em>2</em>&prime;1&frasl;2', '&#49;&prime;3&sol;4'],
    ['xml', '<em>&#50;</em><em>′</em>&#49;&#8260;2', '&#x31;′<em>3⁄</em>4']
  ]) {
    const engine = new MicroTypo({ input });
    const source = `В паспорте: «Размер ${left} “ для модели «Ладога», длина ${right}”».`;
    const expected = `В паспорте: «Размер ${left}″ для модели „Ладога“, длина ${right}″».`;
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('opaque markup and unknown units keep the following words inside their quotation', () => {
  const engine = new MicroTypo({ input: 'html' });
  for (const size of ['2<code>′</code>8', '2′<br>8', '2&unknown;8', '2′8&#47;&#47;5']) {
    const source = `В описи: «Строка ${size} “ Обзор «Тайги», выпуск 7”».`;
    const expected = `В описи: «Строка ${size} „Обзор „Тайги“, выпуск 7“».`;
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('long authored speech indexes check the shared budget and release the instance on expiry', (t) => {
  const line = 'Реплика „“” означает пропуск, рама 27" готова, “Лес” означает место“ повторяется. ';
  const source = `Редактор пишет: “${line.repeat(512)}Конец”.`;
  let indexChecks = 0;
  prepareAuthoredQuotes(
    source,
    {
      checkBudget(stage) {
        if (stage === 'quote:authoredIndex') {
          indexChecks++;
        }
      }
    },
    true,
    true
  );
  assert.ok(indexChecks >= 3);

  // Let the public deadline reach progressively later checkpoints. The test
  // is independent of clock speed and of the exact number of earlier stages.
  const engine = new MicroTypo({ maxProcessingMs: 10, maxInputLength: source.length });
  let reads = 0;
  let allowed = 1;
  t.mock.method(performance, 'now', () => (++reads <= allowed ? 0 : 11));
  let stage;
  for (; allowed <= source.length; allowed *= 2) {
    reads = 0;
    try {
      engine.process(source);
      break;
    } catch (error) {
      assert.equal(error.code, 'ERR_MICROTYPO_BUDGET');
      stage = error.details.where;
      if (stage === 'quote:authoredIndex') {
        break;
      }
    }
  }
  assert.equal(stage, 'quote:authoredIndex');
  allowed = Infinity;
  assert.equal(engine.process('Редактор: "Лес".'), 'Редактор: «Лес».');
});

test('an opening quote reads punctuation at the visible start of inline markup', () => {
  for (const [input, expected, rules = {}] of [
    ['Поле "<i> , слово</i>" отмечено.', 'Поле «<i>, слово</i>» отмечено.'],
    ['Поле "<b><i> ! слово</i></b>" отмечено.', 'Поле «<b><i>! слово</i></b>» отмечено.'],
    [
      'Поле "<i> , слово</i>" отмечено.',
      'Поле "<i> , слово</i>" отмечено.',
      { 'space.trim_before_punctuation': false }
    ],
    [
      'Поле "<i> ,слово</i>" отмечено.',
      'Поле «<i>, слово</i>» отмечено.',
      { 'space.trim_before_punctuation': false }
    ],
    [
      'Поле "<i> ,слово</i>" отмечено.',
      'Поле "<i> ,слово</i>" отмечено.',
      { 'space.space_after_comma': false }
    ],
    [
      'Поле "<i> , слово</i>" отмечено.',
      'Поле "<i>, слово</i>" отмечено.',
      { 'quote.open': false }
    ],
    ['Знак "<b> ,</b>" означает паузу.', 'Знак "<b> ,</b>" означает паузу.'],
    ['Поле "<code> , слово</code>" отмечено.', 'Поле «<code> , слово</code>» отмечено.']
  ]) {
    const engine = new MicroTypo({ input: 'html', rules });
    assert.equal(engine.process(input), expected, input);
    assert.equal(engine.process(expected), expected, expected);
  }
});

test('a copyright sign is the content of a padded quotation', () => {
  for (const mark of ['©', '&copy;', '&#169;', '&#xA9;']) {
    const input = `Знак "${mark} " означает авторское право.`;
    const expected = 'Знак «©» означает авторское право.';
    assert.equal(microtypo(input), expected);
    assert.equal(microtypo(expected), expected);
  }
  for (const [input, expected, config] of [
    ['"&copy; " о', '«©» о', { input: 'frontmatter' }],
    ['"&#X00A9; " о', '&laquo;&copy;&raquo; о', { entities: true }],
    [
      'Знак "© " рядом.',
      'Знак «©\u00a0» рядом.',
      { rules: { 'space.strip_quote_padding': false } }
    ],
    ['Знак "© " рядом.', 'Знак «©\u00a0" рядом.', { rules: { 'quote.close': false } }],
    ['Знак "© " рядом.', 'Знак «©» рядом.', { rules: { 'symbol.copyright': false } }],
    ['Знак «© \\" рядом.', 'Знак «©» рядом.', { rules: { 'quote.open': false } }],
    [
      '© " рядом.',
      '© " рядом.',
      { rules: { 'quote.open': false, 'quote.nested': false, 'symbol.copyright': false } }
    ],
    ['Знаки "© " рядом, "© © " дальше.', 'Знаки «©» рядом, «© ©» дальше.', {}],
    ['«Он сказал: "© " рядом»', '«Он\u00a0сказал: „©“ рядом»', {}],
    ['Знак "© 2026" рядом.', 'Знак «©\u00a02026» рядом.', {}],
    ['Copyright (с) Автор', 'Copyright ©\u00a0Автор', {}],
    ['Знак "Copyright (c) " рядом.', 'Знак «Copyright ©» рядом.', {}],
    [
      'Знак "Copyright (с) " рядом.',
      'Знак «Copyright (с)» рядом.',
      { rules: { 'symbol.copyright': false } }
    ],
    ['<p>Знак «&#x00A9;» рядом.</p>', '<p>Знак «&#x00A9;» рядом.</p>', { input: 'xml' }]
  ]) {
    assert.equal(microtypo(input, config), expected, input);
    assert.equal(microtypo(expected, config), expected, input);
  }
});

test('a closing quotation reads through an HTML comment in its original place', () => {
  const comment = '<!-- "чужие" «кавычки» -->';
  for (const config of [{}, { input: 'html' }, { input: 'frontmatter' }]) {
    const typo = new MicroTypo(config);
    for (const title of [
      comment,
      `лист${comment}`,
      `${comment}лист`,
      `лист${comment}${comment}`,
      `<em>лист${comment}</em>`,
      '<em>лист</em>',
      '<code>"север"</code>'
    ]) {
      const source = `Редактор пишет: "Он назвал "том" и "${title}" вчера", затем сообщил: “открыт”.`;
      const expected = `Редактор пишет: «Он\u00a0назвал „том“ и\u00a0„${title}“ вчера», затем сообщил: «открыт».`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('a closing quotation reads through an HTML comment spaced from its words', () => {
  for (const [config, source, expected] of [
    [{}, '"Текст <!-- c -->".', '«Текст <!-- c -->».'],
    [
      { input: 'markdown' },
      'Он сказал: "Это текст <!-- примечание -->", и ушёл.',
      'Он сказал: «Это текст <!-- примечание -->», и ушёл.'
    ],
    [
      { input: 'html' },
      '<p>Он сказал: "Это текст <!-- примечание -->", и ушёл.</p>',
      '<p>Он сказал: «Это текст <!-- примечание -->», и ушёл.</p>'
    ],
    [
      { input: 'xml' },
      '<doc><p>"Цитата <!-- c -->".</p></doc>',
      '<doc><p>«Цитата <!-- c -->».</p></doc>'
    ],
    [
      { input: 'html' },
      '<p>«Слово „цитата <!-- c -->",»</p>',
      '<p>«Слово „цитата <!-- c -->“,»</p>'
    ],
    // A quote behind a comment that its words follow still opens.
    [{ input: 'html' }, '<p>Он <!-- c -->"Текст".</p>', '<p>Он <!-- c -->«Текст».</p>']
  ]) {
    const typo = new MicroTypo(config);
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  }
});

test('a padded inner closer leaves the following quote to close the outer pair', () => {
  for (const [left, right] of [
    ['«', '»'],
    ['„', '“'],
    ['“', '”']
  ]) {
    for (const padding of ['', ' ', '\t', '\u00a0']) {
      for (const sign of [']', "'", '—']) {
        const text = `"${left}старый${padding}${right}"${sign}`;
        const expected = `«„старый“»${sign}`;
        assert.equal(microtypo(text), expected, text);
        assert.equal(microtypo(expected), expected);
      }
    }
  }
  const stable = [
    ['"„<b>день</b> “"—', '«„<b>день</b>“»—', { input: 'html' }],
    ['»"а»»', '«„а“»', {}],
    ['"«старый »"]', '««старый »"]', { rules: { 'space.strip_quote_padding': false } }]
  ];
  for (const [text, expected, config] of stable) {
    assert.equal(microtypo(text, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

test('an English pair inside low quotation marks keeps its nesting', () => {
  assert.equal(microtypo('„Он сказал “Привет” здесь“'), '«Он\u{00A0}сказал „Привет“ здесь»');
  assert.equal(microtypo('„Он сказал (“Привет”) здесь“'), '«Он\u{00A0}сказал („Привет“) здесь»');
  assert.equal(
    microtypo('„Он сказал&nbsp;“Привет” здесь“', { html: true }),
    '<p>«Он\u{00A0}сказал\u{00A0}„Привет“ здесь»</p>'
  );
});

test('paired quotation marks keep their depth in prose', () => {
  const pairs = [
    ['"', '"'],
    ['«', '»'],
    ['„', '“'],
    ['“', '”'],
    ['&laquo;', '&raquo;'],
    ['&quot;', '&quot;']
  ];
  const engine = new MicroTypo();
  function check(inner, normalized, depth) {
    for (const [left, right] of pairs) {
      const body = depth === 3 ? inner : `начало ${inner} конец`;
      const expectedBody = depth === 3 ? normalized : `начало ${normalized} конец`;
      const input = `${left}${body}${right}`;
      const expected = `«${expectedBody}»`;
      assert.equal(engine.process(`Он: ${input}!`), `Он: ${expected}!`, input);
      assert.equal(engine.process(`Он: ${expected}!`), `Он: ${expected}!`, input);
      if (depth > 1) {
        check(input, `„${expectedBody}“`, depth - 1);
      }
    }
  }
  check('слово', 'слово', 3);
  for (const [source, expected] of [
    ['„Я читал “Повесть о „Слове“” вчера“.', '«Я\u{00A0}читал „Повесть о\u{00A0}„Слове““ вчера».'],
    ['«назвал „“Амбер” прежде“ миром»', '«назвал „„Амбер“ прежде“ миром»'],
    ['„отдельно“ “рядом”', '«отдельно» «рядом»']
  ]) {
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('an outer straight quote closes behind a directed pair before punctuation or markup', () => {
  for (const [left, right] of [
    ['„', '“'],
    ['“', '”'],
    ['«', '»']
  ]) {
    for (const [start, end, config] of [
      ['[', ']', {}],
      ['**', '**', { input: 'markdown' }],
      ['<b>', '</b>', { input: 'html' }],
      ['', '-то', {}],
      ['', '/', {}],
      ['', '—', {}]
    ]) {
      const engine = new MicroTypo(config);
      const source = `${start}"сказал ${left}слово${right}"${end}`;
      const expected = `${start}«сказал „слово“»${end}`;
      assert.equal(engine.process(source), expected, source);
      assert.equal(engine.process(expected), expected);
    }
  }
  for (const suffix of ['2', 'ß']) {
    const expected = `««слово»"${suffix}`;
    assert.equal(microtypo(`"«слово»"${suffix}`), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a lone quote and its following dash agree through markup and XML references', () => {
  for (const quote of ['"', '»', '”']) {
    for (const tag of ['<b>', '<i>', '<b></b>']) {
      const config = { html: true };
      const expected = `<p> "${tag} — всё</p>`;
      assert.equal(microtypo(` ${quote}${tag} - всё`, config), expected);
      assert.equal(microtypo(expected, config), expected);
    }
  }
  const xml = { input: 'xml', entities: true };
  for (const [source, expected] of [
    ['а:" - б', 'а:"&#160;&#8212; б'],
    ['а:"&#160;б', 'а:"&#160;б'],
    ['а:"слово"', 'а:&#171;слово&#187;']
  ]) {
    const output = `<doc><p>${expected}</p></doc>`;
    assert.equal(microtypo(`<doc><p>${source}</p></doc>`, xml), output);
    assert.equal(microtypo(output, xml), output);
  }
});

// processQuotes runs after outer "…" pairs are already «…», so inputs use angle quotes directly.
describe('quote state machine', () => {
  describe('no-op', () => {
    test('empty string stays empty', () => {
      assert.equal(processQuotes(''), '');
    });

    test('text without quotes is unchanged', () => {
      const input = 'Текст без Козырей.';
      assert.equal(processQuotes(input), input);
    });

    test('single balanced pair stays flat', () => {
      const input = '«Козырь»';
      assert.equal(processQuotes(input), input);
    });

    test('two adjacent pairs stay flat', () => {
      const input = '«Корвин» и «Эрик»';
      assert.equal(processQuotes(input), input);
    });

    test('three sibling pairs stay flat', () => {
      const input = '«Корвин», «Эрик», «Рэндом»';
      assert.equal(processQuotes(input), input);
    });
  });

  describe('two-level nesting', () => {
    test('converts inner pair to low quotes', () => {
      const input = '«Амбер «Тень» дальше»';
      assert.equal(processQuotes(input), `«Амбер ${BDQUO}Тень${LDQUO} дальше»`);
    });

    test('inner glued to outer open', () => {
      const input = '««Тень» конец»';
      assert.equal(processQuotes(input), `«${BDQUO}Тень${LDQUO} конец»`);
    });

    test('inner glued to outer close', () => {
      const input = '«конец «Тень»»';
      assert.equal(processQuotes(input), `«конец ${BDQUO}Тень${LDQUO}»`);
    });

    test('multiple inner siblings convert', () => {
      const input = '«Корвин «Эрик» и «Рэндом» тут»';
      assert.equal(
        processQuotes(input),
        `«Корвин ${BDQUO}Эрик${LDQUO} и ${BDQUO}Рэндом${LDQUO} тут»`
      );
    });
  });

  describe('deep nesting', () => {
    test('three levels', () => {
      const input = '«Амбер «Тень «глубь» Тень» Амбер»';
      assert.equal(
        processQuotes(input),
        `«Амбер ${BDQUO}Тень ${BDQUO}глубь${LDQUO} Тень${LDQUO} Амбер»`
      );
    });

    test('four levels', () => {
      const input = '«Амбер «Тень «глубь «дно» глубь» Тень» Амбер»';
      assert.equal(
        processQuotes(input),
        `«Амбер ${BDQUO}Тень ${BDQUO}глубь ${BDQUO}дно${LDQUO} глубь${LDQUO} Тень${LDQUO} Амбер»`
      );
    });
  });

  describe('nesting disabled', () => {
    test('keeps outer glyphs at two levels', () => {
      const input = '«Амбер «Тень» дальше»';
      assert.equal(processQuotes(input, { allowNested: false }), input);
    });

    test('keeps outer glyphs at three levels', () => {
      const input = '«Амбер «Тень «глубь» Тень» Амбер»';
      assert.equal(processQuotes(input, { allowNested: false }), input);
    });
  });

  describe('unbalanced opens', () => {
    test('lone open stays', () => {
      const input = '«Корвин ушёл в Тень';
      assert.equal(processQuotes(input), input);
    });

    test('undoes nested rewrite when outer never closes', () => {
      const input = '«Амбер «Тень» без ответа';
      assert.equal(processQuotes(input), input);
    });

    test('keeps balanced part before unbalanced tail', () => {
      const input = '«Амбер «Тень» готово». Потом «Корвин';
      assert.equal(processQuotes(input), `«Амбер ${BDQUO}Тень${LDQUO} готово». Потом «Корвин`);
    });
  });

  describe('unbalanced closes become inches', () => {
    test('digit close becomes inch mark', () => {
      const input = 'Клинок 15» в длину.';
      assert.equal(processQuotes(input), `Клинок 15${PRIME} в длину.`);
    });

    test('each digit close converts independently', () => {
      const input = 'Сперва 5», после 15».';
      assert.equal(processQuotes(input), `Сперва 5${PRIME}, после 15${PRIME}.`);
    });

    test('non-digit close falls back to straight quote', () => {
      const input = 'Корвин» продолжение';
      assert.equal(processQuotes(input), 'Корвин" продолжение');
    });

    // No rule of this engine writes a closing quote where nothing is open and a word follows, so the
    // one standing there is the author's, written the wrong way round.
    test('a closing quote where none is open and a word follows opens instead', () => {
      assert.equal(processQuotes('»Амбер»'), '«Амбер»');
      assert.equal(processQuotes('» Амбер'), '« Амбер');
    });

    test('a closing quote with no word behind it still falls back', () => {
      assert.equal(processQuotes('Амбер »'), 'Амбер "');
    });

    test('a measurement is untouched: its quote follows a digit', () => {
      assert.equal(processQuotes('Брус 5» длиной'), `Брус 5${PRIME} длиной`);
    });

    test('inch conversion off leaves digit close', () => {
      const input = 'Клинок 15» в длину.';
      assert.equal(processQuotes(input, { convertInches: false }), input);
    });

    test('inch inside a balanced pair is untouched', () => {
      const input = '«клинок в 15"»';
      assert.equal(processQuotes(input), input);
    });

    test('back-to-back digit closes both convert', () => {
      assert.equal(processQuotes('1»1»'), `1${PRIME}1${PRIME}`);
    });

    test('long run of digit closes each convert', () => {
      assert.equal(processQuotes('2»'.repeat(20)), `2${PRIME}`.repeat(20));
    });

    test('balanced pair then repeated inch fallbacks', () => {
      assert.equal(processQuotes('«Козырь» 5»9»'), `«Козырь» 5${PRIME}9${PRIME}`);
    });

    test('inch fallbacks then a balanced pair', () => {
      assert.equal(processQuotes('3»7» «Козырь»'), `3${PRIME}7${PRIME} «Козырь»`);
    });

    // The conversion re-reads the quotes from the balanced point before the inch, and that point stays
    // one: the next unmatched close reaches the remaining inch from it too.
    test('an inch inside nested quotes converts and the quotes pair again', () => {
      assert.equal(
        processQuotes('««5»«5»»»»'),
        `«${BDQUO}5${PRIME}${BDQUO}5${PRIME}${LDQUO}${LDQUO}»`
      );
    });

    test('a balanced point a conversion resumes from stays one for the next close', () => {
      for (const [source, expected] of [
        ['5" «Диагональ 15"»', '5″ «Диагональ 15″»'],
        ['0" “0"”', '0″ «0″»'],
        ['0"«0"»', '0″«0″»']
      ]) {
        assert.equal(microtypo(source), expected);
        assert.equal(microtypo(expected), expected);
      }
      const many = '«а» '.repeat(17);
      assert.equal(microtypo(`${many}5" «Диагональ 15"»`), `${many}5″ «Диагональ 15″»`);
      assert.equal(processQuotes('«Козырь» 5»9»'), `«Козырь» 5${PRIME}9${PRIME}`);
    });

    // Low quotes the author typed are nested marks to the walk: a conversion that re-reads them
    // reads them as the quotes they stand for.
    test('typed low quotes re-read by a conversion pair as angle quotes', () => {
      assert.equal(processQuotes(`${BDQUO}5${LDQUO} »`), `«5${PRIME} »`);
    });

    test('a later inch converts from the balanced point before its own quotation', () => {
      assert.equal(processQuotes('1» «Амбер» «5» »'), `1${PRIME} «Амбер» «5${PRIME} »`);
    });

    test('an inch reopens scope over an already-read following pair', () => {
      const source = '«0»«РОНИКИ»у»';
      const expected = '«0″„РОНИКИ“у»';
      for (const pad of ['', '«а» '.repeat(17)]) {
        assert.equal(processQuotes(pad + source), pad + expected);
        assert.equal(processQuotes(pad + expected), pad + expected);
      }
      assert.equal(microtypo('«0"«РОНИКИ»у«'), expected);
      assert.equal(microtypo('„6“ "ильнос" р«'), '«6″ „ильнос“ р»');
    });

    test('after an inch a reversed opening quote still opens', () => {
      assert.equal(processQuotes('5» »Амбер»'), `5${PRIME} «Амбер»`);
    });

    test('an astral character before the quotes keeps the conversion in place', () => {
      assert.equal(
        processQuotes('𝔸 «Амбер «Корвин» 5» »'),
        `𝔸 «Амбер ${BDQUO}Корвин${LDQUO} 5${PRIME} »`
      );
    });

    // Past a few dozen quote marks the conversions run over an index of the marks; the same input
    // gives the same output either way.
    describe('in a paragraph with many quote marks', () => {
      const pad = '«а» '.repeat(17);

      for (const [input, expected] of [
        ['««5»«5»»»»', `«${BDQUO}5${PRIME}${BDQUO}5${PRIME}${LDQUO}${LDQUO}»`],
        [`${BDQUO}5${LDQUO} »`, `«5${PRIME} »`],
        ['1» «Амбер» «5» »', `1${PRIME} «Амбер» «5${PRIME} »`],
        ['5» »Амбер»', `5${PRIME} «Амбер»`],
        ['𝔸 «Амбер «Корвин» 5» »', `𝔸 «Амбер ${BDQUO}Корвин${LDQUO} 5${PRIME} »`],
        ['3»7» «Козырь»', `3${PRIME}7${PRIME} «Козырь»`]
      ]) {
        test(input, () => {
          assert.equal(processQuotes(pad + input), pad + expected);
        });
      }
    });
  });

  describe('straight quotes left alone', () => {
    test('straight quote inside a balanced pair', () => {
      const input = '«речь с "вставкой" внутри»';
      assert.equal(processQuotes(input), input);
    });

    test('straight quote inside a converted nesting', () => {
      const input = '«Амбер «Тень "x"» конец»';
      assert.equal(processQuotes(input), `«Амбер ${BDQUO}Тень "x"${LDQUO} конец»`);
    });
  });

  describe('markup stays opaque', () => {
    test('placeholders between quotes are unchanged', () => {
      const input = '«<a href="x">Козырь</a>»';
      assert.equal(processQuotes(input), input);
    });

    test('nesting spans markup', () => {
      const input = '«Корвин «<i>Грейсвандир</i>» дал»';
      assert.equal(processQuotes(input), `«Корвин ${BDQUO}<i>Грейсвандир</i>${LDQUO} дал»`);
    });
  });

  describe('paragraph isolation', () => {
    test('chunks process independently', () => {
      const input = `«Корвин»${PARAGRAPH_CLOSE}«Эрик»`;
      assert.equal(processQuotes(input), input);
    });

    test('unbalanced chunk does not leak', () => {
      const input = `«Корвин${PARAGRAPH_CLOSE}«Эрик»`;
      assert.equal(processQuotes(input), input);
    });

    test('nesting in one chunk does not affect another', () => {
      const input = `«Амбер «Тень» дальше»${PARAGRAPH_CLOSE}«Козырь»`;
      const expected = `«Амбер ${BDQUO}Тень${LDQUO} дальше»${PARAGRAPH_CLOSE}«Козырь»`;
      assert.equal(processQuotes(input), expected);
    });

    test('CRLF blank line separates chunks', () => {
      const input = '«Корвин»\r\n\r\n«Амбер «Тень»»';
      assert.equal(processQuotes(input), `«Корвин»\r\n\r\n«Амбер ${BDQUO}Тень${LDQUO}»`);
    });

    test('LF blank line separates chunks', () => {
      const input = '«Корвин»\n\n«Амбер «Тень»»';
      assert.equal(processQuotes(input), `«Корвин»\n\n«Амбер ${BDQUO}Тень${LDQUO}»`);
    });

    test('paragraph token wins over blank line', () => {
      const input = `«Корвин\n\nЭрик»${PARAGRAPH_CLOSE}«Рэндом»`;
      assert.equal(processQuotes(input), input);
    });

    test('lone paragraph-open marker is opaque', () => {
      const input = `${PARAGRAPH_OPEN}«Корвин»${PARAGRAPH_CLOSE}${PARAGRAPH_OPEN}«Эрик»${PARAGRAPH_CLOSE}`;
      assert.equal(processQuotes(input), input);
    });
  });

  describe('idempotent', () => {
    test('stable on nested output', () => {
      const once = processQuotes('«Амбер «Тень» дальше»');
      assert.equal(processQuotes(once), once);
    });

    test('stable on inch output', () => {
      const once = processQuotes('клинок 15» длиной');
      assert.equal(processQuotes(once), once);
    });

    test('stable on plain text', () => {
      const input = 'единорог в Тени';
      assert.equal(processQuotes(processQuotes(input)), input);
    });
  });

  describe('combined', () => {
    test('nesting and inch in one chunk', () => {
      const input = '«Амбер «Тень» конец», плюс 7».';
      assert.equal(processQuotes(input), `«Амбер ${BDQUO}Тень${LDQUO} конец», плюс 7${PRIME}.`);
    });

    test('inch in two chunks separately', () => {
      const input = `клинок 5»${PARAGRAPH_CLOSE}щит 9»`;
      assert.equal(processQuotes(input), `клинок 5${PRIME}${PARAGRAPH_CLOSE}щит 9${PRIME}`);
    });
  });
});

describe('adjacent angle quotes', () => {
  test('adjacent quoted phrases both stay angle', () => {
    assert.equal(microtypo('«Эрик»«Рэндом»'), '«Эрик»«Рэндом»');
    assert.equal(microtypo('«Корвин»«Оберон»'), '«Корвин»«Оберон»');
  });

  test('quoted phrases around an em dash stay angle', () => {
    assert.equal(microtypo('«Корвин»—«Эрик»'), '«Корвин»—«Эрик»');
  });

  test('no straight quote left beside an angle quote', () => {
    for (const input of ['«Эрик»«Рэндом»', '«Корвин»—«Эрик»', '«Корвин»«Оберон»']) {
      const out = microtypo(input);
      assert.ok(!/["][«»]|[«»]["]/u.test(out), `stray straight quote in ${out}`);
    }
  });

  test('degenerate empty quotes are idempotent', () => {
    for (const input of ['«»', '«»Тень«»', '«»«»«»']) {
      const once = microtypo(input, { html: true });
      const twice = microtypo(once, { html: true });
      assert.equal(twice, once, `not idempotent: ${input} -> ${once} -> ${twice}`);
    }
  });
});

const P = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

describe('closing quote before symbol', () => {
  test('closes before an asterisk', () => {
    assert.equal(microtypo('"Амбер"*', P), '«Амбер»*');
  });

  test('closes before a registered sign', () => {
    assert.equal(microtypo('"Корвин"®', P), '«Корвин»®');
  });

  test('closes before a hyphen, hyphen kept', () => {
    assert.equal(microtypo('"Эрик"-', P), '«Эрик»-');
  });

  test('closes before a question mark', () => {
    assert.equal(microtypo('"Оберон"?', P), '«Оберон»?');
  });

  test('inch mark stays', () => {
    assert.equal(microtypo('3/4"', P), `3/4${PRIME}`);
  });
});

describe('glued quote next to Cyrillic', () => {
  test('digit-glued open before Cyrillic', () => {
    assert.equal(microtypo('Отражение7"Амбер"', P), 'Отражение7 «Амбер»');
  });

  test('word-glued open before Cyrillic', () => {
    assert.equal(microtypo('Корвин"Грейсвандир"', P), 'Корвин «Грейсвандир»');
  });

  test('Latin neighbours stay straight', () => {
    assert.equal(microtypo('Amber"Corwin"Amber', P), 'Amber"Corwin"Amber');
  });
});

describe('nested and inch settings', () => {
  const PS = { render: { paragraphs: false } };
  const NESTED = 'Тень скрывает "клинок "Грейсвандир" крепко" молча.';
  const INCH = 'клинок 15"';

  test('default: nesting and inch on', () => {
    assert.equal(
      microtypo(NESTED, PS),
      `Тень скрывает «клинок ${BDQUO}Грейсвандир${LDQUO} крепко» молча.`
    );
    assert.equal(microtypo(INCH, PS), `клинок 15${PRIME}`);
  });

  test('quote.nested false keeps inch', () => {
    const cfg = { ...PS, rules: { 'quote.nested': false } };
    assert.equal(microtypo(NESTED, cfg), 'Тень скрывает «клинок «Грейсвандир» крепко» молча.');
    assert.equal(microtypo(INCH, cfg), `клинок 15${PRIME}`);
  });

  test('quote.inch false keeps nesting', () => {
    const cfg = { ...PS, rules: { 'quote.inch': false } };
    assert.equal(
      microtypo(NESTED, cfg),
      `Тень скрывает «клинок ${BDQUO}Грейсвандир${LDQUO} крепко» молча.`
    );
    const inchOff = microtypo(INCH, cfg);
    assert.ok(!inchOff.includes(PRIME), `expected no inch mark, got ${JSON.stringify(inchOff)}`);
  });
});

describe('hanging quote alignment', () => {
  test('fires when enabled under html', () => {
    const out = microtypo('«Амбер»', { html: true, rules: { 'hanging.quote': true } });
    assert.match(out, /oa_oquote|margin-left:-0\.44em/);
  });

  test('off by default', () => {
    const out = microtypo('«Амбер»', { html: true });
    assert.doesNotMatch(out, /oa_oquote|margin-left:-0\.44em/);
  });

  test('fires after a newline', () => {
    const out = microtypo('Тень\n«Амбер»', { html: true, rules: { 'hanging.quote': true } });
    assert.match(out, /oa_oquote|margin-left:-0\.44em/);
  });
});

describe('cycled rules converge', () => {
  const chains = [
    "'".repeat(500),
    "Корвин'-ка ".repeat(50),
    "Эрик'-'таки ".repeat(50),
    "Рэндом'-'то ".repeat(60),
    "'-".repeat(200),
    "Amber'-'Corwin'-'Grayswandir"
  ];

  for (const input of chains) {
    test(`converges on ${JSON.stringify(input.slice(0, 16))}…`, () => {
      const typo = new MicroTypo();
      let capHit = false;
      typo.onCycleLimit = () => {
        capHit = true;
      };
      typo.process(input);
      assert.ok(!capHit, 'cycle cap reached — a cycled rule failed to converge');
    });
  }
});

describe('quote.fix_orphan_open — stray opener where closer expected (REG-1)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('trailing « glued to a word becomes »', () => {
    assert.equal(microtypo('Корвин «всякие« знаки', NOP), 'Корвин «всякие» знаки');
  });

  test('nested opener glued to opener is untouched', () => {
    assert.equal(microtypo('««Тень» конец»', NOP), `«${BDQUO}Тень${LDQUO} конец»`);
  });

  test('padded opening quote is not flipped to closer', () => {
    const out = microtypo('Корвин « текст »', NOP);
    assert.ok(out.startsWith('Корвин «'), `opening quote was flipped: ${out}`);
    assert.ok(!out.includes('«»'), `padded quote became empty: ${out}`);
  });
});

describe('quote relocation and hanging', () => {
  const NOP = { html: true, render: { paragraphs: false } };
  const LINK = 'Читайте <a href="https://amber.example/pattern">"Козырь"</a> сейчас.';

  test('relocates straight quotes outside the anchor', () => {
    const out = microtypo(LINK, NOP);
    assert.ok(!out.includes('>"Козырь"</a>'), out);
    assert.ok(out.includes('«<a href="https://amber.example/pattern">'), out);
  });

  test('around_link off keeps quotes inside the anchor', () => {
    const out = microtypo(LINK, { ...NOP, rules: { 'quote.around_link': false } });
    assert.ok(!out.includes('«<a href="https://amber.example/pattern">'), out);
    assert.ok(/<a href="https:\/\/amber\.example\/pattern">[^<]*<\/a>/.test(out), out);
  });

  test('hanging quote wraps the opening angle quote for optical alignment', () => {
    const out = microtypo('Корвин «Козырь»', { ...NOP, rules: { 'hanging.quote': true } });
    assert.ok(out.includes('margin-left:-0.44em'), out);
  });

  test('hanging quote is off by default', () => {
    const out = microtypo('Корвин «Козырь»', NOP);
    assert.ok(!out.includes('margin-left:-0.44em'), out);
    assert.ok(out.includes('Корвин «Козырь»'), out);
  });
});

describe('quote.open — closing quote after a tag (REG-2)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('closing " after </a> becomes » and keeps the following space', () => {
    const out = microtypo('радио "<a href="http://amber.example">голос Ардена</a>" ддддд', NOP);
    assert.ok(out.includes(`</a>${'»'} ддддд`), `closer/space wrong: ${out}`);
    assert.ok(!out.includes(`</a>${'«'}`), `flipped to opener: ${out}`);
  });

  // The end of a tag is a boundary, so a quotation may open right behind one whether or not the
  // author padded the quote.
  test('opening quote glued to a tag opens the quotation, padded or not', () => {
    assert.equal(microtypo('<b>" слово"</b>', NOP), '<b>«слово»</b>');
    assert.equal(microtypo('<b>"слово"</b>', NOP), '<b>«слово»</b>');
  });
});

// What follows a finished paragraph does not reach back into it: a quote between an inline end tag
// and the end tag of its block closes whether the document ends there or goes on.
describe('quote.open — a quote after an end tag closes before the end of its block (A31)', () => {
  const HTML = { input: 'html', html: false };
  const CLOSED = '<p>«слово <em>другое</em>»</p>';

  for (const [label, tail] of [
    ['a newline and a paragraph', '\n<p>текст</p>'],
    ['a paragraph with no newline', '<p>текст</p>'],
    ['a figure', '\n<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>'],
    ['a paragraph holding code', '\n<p><code>"x" -- a  b</code></p>'],
    ['a trailing newline', '\n'],
    ['nothing', '']
  ]) {
    test(`followed by ${label}`, () => {
      const out = new MicroTypo(HTML).process(`<p>"слово <em>другое</em>"</p>${tail}`);

      assert.ok(out.startsWith(CLOSED), out);
    });
  }

  for (const block of ['div', 'li', 'h2']) {
    test(`in a <${block}> followed by a paragraph`, () => {
      assert.equal(
        new MicroTypo(HTML).process(`<${block}>"слово <em>другое</em>"</${block}>\n<p>текст</p>`),
        `<${block}>«слово <em>другое</em>»</${block}>\n<p>текст</p>`
      );
    });
  }

  test('the last of two such paragraphs closes on the first call', () => {
    const source = '<p>"первый <em>абзац</em>"</p>\n<p>"второй <em>абзац</em>"</p>\n';
    const out = new MicroTypo(HTML).process(source);

    assert.equal(out, '<p>«первый <em>абзац</em>»</p>\n<p>«второй <em>абзац</em>»</p>');
    assert.equal(new MicroTypo(HTML).process(out), out);
  });

  for (const block of ['p', ...BLOCK_TAG_NAMES.filter((name) => name !== 'pre')]) {
    test(`a following block leaves a closed <${block}> as it was`, () => {
      const closed = `<${block}>«слово <em>другое</em>»</${block}>`;
      const source = `<${block}>"слово <em>другое</em>"</${block}>`;

      for (const tail of ['', '\n', '\n<p>текст</p>']) {
        const out = new MicroTypo(HTML).process(source + tail);

        assert.ok(out.startsWith(closed), `${JSON.stringify(tail)}: ${out}`);
      }
    });
  }

  for (const [open, close] of [
    ['<em>', '</em>'],
    ['<a href="/x">', '</a>'],
    ['<b>', '</b>'],
    ['<i>', '</i>'],
    ['<strong>', '</strong>'],
    ['<span>', '</span>'],
    ['<code>', '</code>']
  ]) {
    test(`a following paragraph leaves the quote after ${close} closed`, () => {
      const closed = `<p>«слово ${open}другое${close}»</p>`;
      const source = `<p>"слово ${open}другое${close}"</p>`;

      for (const tail of ['', '\n', '\n<p>текст</p>', '<p>текст</p>']) {
        const out = new MicroTypo(HTML).process(source + tail);

        assert.ok(out.startsWith(closed), `${JSON.stringify(tail)}: ${out}`);
      }
    });
  }

  test('a word or a sentence mark in front of the end tag is read as before', () => {
    for (const [source, expected] of [
      [
        '<p>"<em>слово</em> другое"</p>\n<p>текст</p>',
        '<p>«<em>слово</em> другое»</p>\n<p>текст</p>'
      ],
      [
        '<p>"слово <em>другое</em>".</p>\n<p>текст</p>',
        '<p>«слово <em>другое</em>».</p>\n<p>текст</p>'
      ],
      ['<p>"слово"</p>\n', '<p>«слово»</p>']
    ]) {
      assert.equal(new MicroTypo(HTML).process(source), expected);
    }
  });

  test('a quote alone in an element still opens', () => {
    assert.equal(new MicroTypo(HTML).process('<p><b>"</b>слово"</p>'), '<p><b>«</b>слово»</p>');
  });

  test('what closes a quote behind a word closes it behind an end tag', () => {
    for (const [source, expected] of [
      ['<p>"слово <em>x</em>"!</p>', '<p>«слово <em>x</em>»!</p>'],
      ['<p>"слово <em>x</em>"?</p>\n<p>текст</p>', '<p>«слово <em>x</em>»?</p>\n<p>текст</p>'],
      ['<p>"слово <em>x</em>"...</p>', '<p>«слово <em>x</em>»…</p>'],
      ['<p>"слово <em>x</em>"<br>текст</p>', '<p>«слово <em>x</em>»<br>текст</p>']
    ]) {
      assert.equal(new MicroTypo(HTML).process(source), expected);
    }
  });

  test('a comma, a paren, a space, and a quote behind a word read as before', () => {
    for (const [source, expected] of [
      ['<p>"слово <em>x</em>", - сказал он.</p>', '<p>«слово <em>x</em>», — сказал он.</p>'],
      ['<p>("слово <em>x</em>")</p>', '<p>(«слово <em>x</em>»)</p>'],
      ['<p>"слово <em>x</em>" и</p>', '<p>«слово <em>x</em>» и</p>'],
      ['<p>"слово"!</p>', '<p>«слово»!</p>']
    ]) {
      assert.equal(new MicroTypo(HTML).process(source), expected);
    }
  });

  test('a closing quote nothing opened is not turned round behind the end tag', () => {
    for (const [source, expected] of [
      ['<p><b>Сказано.</b>"</p>', '<p><b>Сказано.</b>"</p>'],
      ['<p><b>слово</b>"цитата"</p>', '<p><b>слово</b>«цитата»</p>']
    ]) {
      const once = new MicroTypo(HTML).process(source);

      assert.equal(once, expected);
      assert.equal(new MicroTypo(HTML).process(once), once);
    }
  });
});

describe('quote.open — a quote after an end tag closes before the guillemet around it (A22)', () => {
  test('the inner pair around a tag nests', () => {
    assert.equal(microtypo('«"<b>слово</b>"»'), '«„<b>слово</b>“»');
    assert.equal(
      microtypo('<p>«"<b>слово</b>"»</p>', { input: 'html', html: true }),
      '<p>«„<b>слово</b>“»</p>'
    );
  });

  test('a link inside nested quotes survives a second pass', () => {
    const once = microtypo('«„https://example.com“»', { html: true });

    assert.equal(once, '<p>«„<a href="https://example.com">example.com</a>“»</p>');
    assert.equal(microtypo(once, { html: true }), once);
  });

  test('a pair with no tag, a tag with no guillemets and a tag before a word read as before', () => {
    assert.equal(microtypo('«"слово"»'), '«„слово“»');
    assert.equal(microtypo('"<b>слово</b>"'), '«<b>слово</b>»');
    assert.equal(
      microtypo('Он сказал: «"<i>да</i>" и ушёл»'),
      'Он\u{00A0}сказал: «„<i>да</i>“ и\u{00A0}ушёл»'
    );
  });
});

describe('an unmatched guillemet glued to an address stays the author’s (A23)', () => {
  test('stays a guillemet, and the address still becomes a link', () => {
    assert.equal(microtypo('http://x.com/a» далее'), 'http://x.com/a» далее');

    const once = microtypo('http://x.com/a» далее', { html: true });

    assert.equal(once, '<p><a href="http://x.com/a">x.com/a</a>» далее</p>');
    assert.equal(microtypo(once, { html: true }), once);
  });

  test('a pair around an address, a straight quote after it and a guillemet after a word read as before', () => {
    assert.equal(microtypo('«см. http://x.com/a» далее'), '«см.\u{00A0}http://x.com/a» далее');
    assert.equal(microtypo('url="http://x.com/a" далее'), 'url="http://x.com/a" далее');
    assert.equal(microtypo('слово» далее'), 'слово" далее');
  });
});

// A quotation opened in an earlier paragraph closes in this one, and the end tag in front of its `»`
// stands after the words of its element: the guillemet stays a closer, with its space.
describe('an unmatched guillemet behind an end tag stays the author’s', () => {
  test('stays as written, in markup and in plain text', () => {
    for (const [source, options] of [
      ['<p><b>слово</b>» далее</p>', { input: 'html', html: false }],
      ['<b>слово</b>» далее', {}]
    ]) {
      const once = microtypo(source, options);

      assert.equal(once, source);
      assert.equal(microtypo(once, options), once);
    }
  });

  test('a pair around the element reads as before', () => {
    const options = { input: 'html', html: false };

    assert.equal(microtypo('<p>«<b>слово</b>» далее</p>', options), '<p>«<b>слово</b>» далее</p>');
    assert.equal(
      microtypo('<p>«слово <b>два</b>» далее</p>', options),
      '<p>«слово <b>два</b>» далее</p>'
    );
  });
});

// A block's end tag stands after a whole block, and what follows it starts the next one: a quote
// there reads as it does at the start of a paragraph, on the pass that lays the paragraph out and on
// the next.
describe('a quote behind the end tag of a block starts the next block', () => {
  test('reads as at the start of a paragraph, in one pass', () => {
    for (const [source, expected] of [
      ['<pre></pre>» е', '<pre></pre>\n\n<p>«е</p>'],
      ['<div>а</div>» е', '<div>а</div>\n\n<p>«е</p>'],
      ['<div>а</div>"!', '<div>а</div>\n\n<p>«!</p>'],
      ['«слово <pre></pre>"»', '<p>«слово</p>\n\n<pre></pre>\n\n<p>«»</p>']
    ]) {
      const once = microtypo(source, { html: true });

      assert.equal(once, expected, source);
      assert.equal(microtypo(once, { html: true }), once, source);
    }
  });
});

// A quote the author wrote pointing the wrong way is still the author's, and `”` keeps its direction
// by folding to `»`. That puts it on the state machine's path while the straight quote takes the
// pattern rules, so the two have to read one set of boundaries.
describe('a misdirected quote settles in one pass, whatever stands beside it', () => {
  const NOP = { html: true, render: { paragraphs: false, breakline: false } };

  for (const [name, left, right] of [
    ['an inline tag', '<em>', '</em>'],
    ['a bracket', '[', ']'],
    ['a paren', '(', ')'],
    ['a hyphen', '-', ''],
    ['nothing', '', '']
  ]) {
    test(`after ${name} the pair closes on the first call`, () => {
      const source = `${left}”Амбер”${right}`;

      assert.equal(microtypo(source, NOP), `${left}«Амбер»${right}`);
    });
  }

  test('a non-breaking space after the quote is content, not separation', () => {
    assert.equal(microtypo('”\u{00A0}Амбер”', NOP), '«Амбер»');
  });

  test('the same text written with straight quotes reaches the same place', () => {
    for (const source of ['<em>"Амбер"</em>', '["Амбер"]', '"Амбер"']) {
      const once = microtypo(source, NOP);

      assert.equal(microtypo(once, NOP), once, source);
      assert.ok(once.includes('«Амбер»'), `${source}: ${once}`);
    }
  });

  test('a measurement still keeps its prime, because a digit is no boundary', () => {
    assert.ok(microtypo('Корвин прошёл 5” по карнизу', NOP).includes('5\u{2033}'));
  });
});

describe('quote.close — padded quote before parenthetical (EF4)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('closes a padded quote before an opening parenthesis', () => {
    assert.equal(microtypo('" ... Амбера " (Рэбма)', NOP), '«…Амбера» (Рэбма)');
  });
});

describe('GAP-W1 — quote glued to a comma', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('comma-glued quote gets a space and angle quotes', () => {
    assert.equal(microtypo('молвил,"Грейсвандир" он', NOP), 'молвил, «Грейсвандир» он');
  });
});

describe('a comma before a straight quote does not flip a closer to an opener', () => {
  test('open: closing quote after comma stays closing', () => {
    assert.equal(microtypo('"Отражение,".'), '«Отражение,».');
  });

  test('open: digit-comma-glued opener preserved', () => {
    assert.equal(microtypo('2,"3"'), '2,«3»');
  });

  test('plain closer without a comma is unchanged', () => {
    assert.equal(microtypo('"Отражение".'), '«Отражение».');
  });

  test('hyphen and paren openers are unchanged', () => {
    assert.equal(microtypo('1-"5"'), '1-«5»');
    assert.equal(microtypo('("5")'), '(«5»)');
  });

  test('spaced comma stays an opener', () => {
    assert.equal(microtypo(', "Рэбма"'), ', «Рэбма»');
  });
});

// The opening step carries the quote depth and decides each quote knowing what came before it,
// which a pattern replacement cannot do: `String.replace` never sees the substitutions made beside
// it, so every spaced quote would read as an opener that had lost its word.
describe('quote parted from its word by a space', () => {
  const NB = '\u{00A0}';

  test('two padded phrases close where they should', () => {
    assert.equal(microtypo('" Порядок " и " Хаос "'), `«Порядок» и${NB}«Хаос»`);
  });

  test('a padded closer binds back to its own word', () => {
    assert.equal(microtypo('Дворкин "Амбер " ушёл'), 'Дворкин «Амбер» ушёл');
  });

  test('a padded opener still binds forward', () => {
    assert.equal(microtypo('Дворкин " Амбер" ушёл'), 'Дворкин «Амбер» ушёл');
  });

  test('an empty pair stays an empty pair', () => {
    assert.equal(microtypo('Дворкин "" ушёл'), 'Дворкин «» ушёл');
    assert.equal(microtypo('Цитата "" внутри "текста" тут'), 'Цитата «» внутри «текста» тут');
  });

  // The word a spaced quote supposedly lost can be another quote — an empty quotation, not an opener
  // looking for something to bind to.
  test('a row of spaced quotes settles in one pass', () => {
    const once = microtypo('" " " "');

    assert.equal(once, '«» «»');
    assert.equal(microtypo(once), once);
  });

  test('spaced empty pairs beside real quotations', () => {
    assert.equal(microtypo('Дворкин " " и "Амбер" тут'), 'Дворкин «» и\u{00A0}«Амбер» тут');
  });

  test('nested doubled quotes are untouched by the change', () => {
    assert.equal(microtypo('Дворкин ""Амбер"" ушёл'), `Дворкин «${BDQUO}Амбер${LDQUO}» ушёл`);
  });

  // The word a padded opener binds to is a non-space run, so it carries that quotation's own closing
  // quote along with it.
  test('two independent padded quotations both convert', () => {
    const once = microtypo('" Корвин" " Рэндом"');

    assert.equal(once, '«Корвин» «Рэндом»');
    assert.equal(microtypo(once), once);
  });

  test('a particle between two padded quotations keeps its space', () => {
    assert.equal(microtypo('" Корвин" и " Рэндом"'), `«Корвин» и${NB}«Рэндом»`);
  });

  test('a row of three padded quotations converts in one pass', () => {
    assert.equal(
      microtypo('" Корвин" , " Рэндом" и " Дейрдре"'),
      `«Корвин», «Рэндом» и${NB}«Дейрдре»`
    );
  });

  test('a padded opener after a glued quotation converts', () => {
    assert.equal(microtypo('"Амбер" " Рэндом"'), '«Амбер» «Рэндом»');
  });

  // A quotation is already open, so a spaced quote reads as its close — unless the word it binds to
  // carries the matching quote itself, which makes the pair a quotation of its own nested inside.
  test('a padded quotation nested in an open one does not close it', () => {
    const once = microtypo('«Корвин сказал " Рэндом" сегодня»');

    assert.equal(once, `«Корвин сказал ${BDQUO}Рэндом${LDQUO} сегодня»`);
    assert.equal(microtypo(once), once);
  });

  test('a padded quote with no closer of its own still closes the open one', () => {
    assert.equal(microtypo('«Амбер " ушёл'), '«Амбер» ушёл');
  });

  // The word the quote binds to cannot answer whether a quotation opens here: its closing quote may
  // be several words along, and reading only the first word closed the outer quotation instead.
  test('a padded nested quotation of several words does not close the outer one', () => {
    const once = microtypo('«Корвин сказал " Новый Амбер" сегодня»');

    assert.equal(once, `«Корвин сказал ${BDQUO}Новый Амбер${LDQUO} сегодня»`);
    assert.equal(microtypo(once), once);
  });

  // The next straight quote stands past the `»`, so it belongs to a quotation of its own and this
  // one still closes the quotation it is inside.
  test('a quotation closed after the outer one is not read as nested', () => {
    assert.equal(microtypo('«Амбер " ушёл» и "Хаос"'), `«Амбер» ушёл" и${NB}«Хаос»`);
  });

  // Quote state does not cross a paragraph — the state machine says so before it reads a quote, and
  // the role assignment one pass earlier has to agree.
  test('a measurement in another paragraph does not change a quote role', () => {
    const once = microtypo('17" 19"\n\n"Амбер " ушёл');

    assert.equal(once, `17${PRIME} 19${PRIME}\n\n«Амбер» ушёл`);
    assert.equal(microtypo(once), once);
  });

  test('a measurement beside the quotation does not change its role either', () => {
    const once = microtypo('17" 19" «Амбер " ушёл');

    assert.equal(once, `17${PRIME} 19${PRIME} «Амбер» ушёл`);
    assert.equal(microtypo(once), once);
  });

  // A digit is part of the word as readily as it is a measurement, and a quotation already open
  // settles which.
  test('a quote glued to a digit inside an open quotation still closes it', () => {
    const once = microtypo('"Корвин " Рэндом Рэндом1" Корвин0"');

    assert.equal(once, `«Корвин ${BDQUO}Рэндом Рэндом1${LDQUO} Корвин0»`);
    assert.equal(microtypo(once), once);
  });

  // The paragraph break is content: a quote that takes the wrong role goes to the closing rules,
  // whose whitespace matcher would swallow the blank line.
  test('a paragraph break survives a quotation left open above it', () => {
    const once = microtypo('«Пролог\n\n" Амбер"');

    assert.equal(once, '«Пролог\n\n«Амбер»');
    assert.equal(microtypo(once), once);
  });

  // The count says how many undecided quotes close, never which ones.
  test('two nested quotations in one quotation keep their pairing', () => {
    const once = microtypo('«Альфа " Бета" "Гамма " конец»');

    assert.equal(once, `«Альфа ${BDQUO}Бета${LDQUO} ${BDQUO}Гамма${LDQUO} конец»`);
    assert.equal(microtypo(once), once);
  });

  // A quote whose word is the next quote is an empty quotation the walk writes in one step, so the
  // plan has to spend both of its quotes on the pair.
  test('an empty pair costs the plan both of its quotes', () => {
    const once = microtypo('«Альфа " Бета " " Гамма" " Дельта " конец»');

    assert.equal(microtypo(once), once);
    assert.ok(once.includes(`${BDQUO}${LDQUO}`) || once.includes('«»'), once);
  });

  // Padded, glued and empty quotes in every arrangement inside one quotation: the plan and the walk
  // have to agree about all of them, and a disagreement is a second pass that moves the text again.
  test('every arrangement of padded, glued and empty quotes settles in one pass', () => {
    const words = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон'];

    for (let mask = 0; mask < 1 << words.length; mask += 1) {
      const parts = ['«Пролог'];

      for (const [i, word] of words.entries()) {
        parts.push(mask & (1 << i) ? `" ${word}"` : `"${word} "`);
      }

      const src = `${parts.join(' ')} конец»`;
      const once = microtypo(src);

      assert.equal(microtypo(once), once, `not idempotent: ${src} -> ${once}`);
    }
  });

  // An escaped quote is one token, and its left boundary stands in front of the backslash, so a
  // reader asking from the quote alone finds the backslash there instead.
  test('an escaped padded opener reads its boundary from the whole token', () => {
    const once = microtypo(String.raw`«Альфа \" Бета\" конец»`);

    assert.equal(once, `«Альфа ${BDQUO}Бета${LDQUO} конец»`);
    assert.equal(microtypo(once), once);
  });

  // Which quotation is running here says nothing about whether this quote closes it: one the walk
  // opened a moment ago nests exactly like one the author wrote as `«`.
  test('a nested quotation under an opening this pass minted still nests', () => {
    const once = microtypo('" Корвин сказал " Новый Амбер" сегодня"');

    assert.equal(once, `«Корвин сказал ${BDQUO}Новый Амбер${LDQUO} сегодня»`);
    assert.equal(microtypo(once), once);
  });

  // A quote ahead is evidence of a pair only where it can be this one's other half: a `«` between
  // them owns it, and a second spaced quote is the same undecided shape deciding for itself.
  test('an opening between the two does not make them a pair', () => {
    assert.equal(microtypo('"Амбер " затем "Хаос"'), '«Амбер» затем «Хаос»');
  });

  test('a second spaced quote does not make the first one nest', () => {
    assert.equal(microtypo('"Амбер " и " Хаос "'), `«Амбер» и${NB}«Хаос»`);
  });

  // A pair that opens and closes between the two is one level deeper, not another quotation's
  // boundary.
  test('a pair between the two is stepped over, not read as a boundary', () => {
    const once = microtypo('"Он сказал " Название "Амбер" здесь" вчера"');

    assert.equal(
      once,
      `«Он${NB}сказал ${BDQUO}Название ${BDQUO}Амбер${LDQUO} здесь${LDQUO} вчера»`
    );
    assert.equal(microtypo(once), once);
  });

  test('four levels deep still alternate', () => {
    const once = microtypo('"первый " второй "третий "четвёртый" пятый" шестой" седьмой"');

    assert.equal(
      once,
      `«первый ${BDQUO}второй ${BDQUO}третий ${BDQUO}четвёртый${LDQUO} пятый${LDQUO} шестой${LDQUO} седьмой»`
    );
    assert.equal(microtypo(once), once);
  });

  // Whether an author parted an opening quote from its word is a typing habit, not a structure, so
  // every spacing of the same nesting has to come out the same.
  test('the same nesting under every spacing of its opening quotes', () => {
    for (const words of [
      ['Корвин', 'Рэндом'],
      ['Корвин', 'Рэндом', 'Дейрдре'],
      ['Корвин', 'Рэндом', 'Дейрдре', 'Бенедикт']
    ]) {
      const closes = words.map((w, i) => `${w}${i}`).toReversed();

      for (let mask = 0; mask < 1 << words.length; mask += 1) {
        const opened = words.map((w, i) => `"${mask & (1 << i) ? ' ' : ''}${w}`).join(' ');
        const source = `${opened} ${closes.map((w) => `${w}"`).join(' ')}`;

        const inner = words.slice(1).map((w) => `${BDQUO}${w}`);
        const shut = closes.map((w, i) => `${w}${i === closes.length - 1 ? '»' : LDQUO}`);
        const want = `«${[words[0], ...inner].join(' ')} ${shut.join(' ')}`;

        const once = microtypo(source);

        assert.equal(once.replaceAll(NB, ' '), want, source);
        assert.equal(microtypo(once), once, `not idempotent: ${once}`);
      }
    }
  });

  // The matrix above varies the spacing of one nesting; these are the structures beside it — several
  // quotations in a row, each with every spelling of its own boundaries.
  test('independent quotations stay independent under every spacing', () => {
    const NAMES = ['Корвин', 'Рэндом', 'Дейрдре'];

    for (const count of [1, 2, 3]) {
      const heads = NAMES.slice(0, count);

      for (let mask = 0; mask < 1 << (2 * count); mask += 1) {
        const parts = heads.map((word, i) => {
          const osp = mask & (1 << (2 * i)) ? ' ' : '';
          const csp = mask & (1 << (2 * i + 1)) ? ' ' : '';

          return `"${osp}${word} принц${csp}"`;
        });

        const source = parts.join(' и ');
        const want = heads.map((word) => `«${word} принц»`).join(' и ');
        const once = microtypo(source);

        assert.equal(once.replaceAll(NB, ' '), want, source);
        assert.equal(microtypo(once), once, `not idempotent: ${once}`);
      }
    }
  });
});

// A quote written `\"` is one token, and every reader has to agree where it begins, or the two
// halves of a pair are settled apart.
describe('an escaped quote is one token to every reader', () => {
  test('an empty pair is one pair however it is spelled', () => {
    assert.equal(microtypo(String.raw`«Пролог " \" конец»`), `«Пролог ${BDQUO}${LDQUO} конец»`);
    assert.equal(microtypo('«Пролог " " конец»'), `«Пролог ${BDQUO}${LDQUO} конец»`);
    assert.equal(microtypo(String.raw`«Пролог \" \" конец»`), `«Пролог ${BDQUO}${LDQUO} конец»`);
  });

  test('an empty pair inside a quotation settles in one pass', () => {
    const once = microtypo(String.raw`«Пролог " \" конец»`);

    assert.equal(microtypo(once), once);
  });

  test('a padded escaped quote closes the quotation it stands in', () => {
    assert.equal(microtypo(String.raw`Дворкин \"Амбер \" ушёл`), `Дворкин «Амбер» ушёл`);
  });
});

// The inch mark is a measurement where no quotation stands open, which is a fact about the balance
// rather than about how many quotes have been seen.
describe('inches are decided by what stands open, not by what has been seen', () => {
  const NB = '\u{00A0}';

  test('inches after a closed quotation stay inches', () => {
    assert.equal(
      microtypo(String.raw`«Пролог» 17" 19" \"Амбер \" ушёл`),
      `«Пролог» 17${PRIME} 19${PRIME} «Амбер» ушёл`
    );
    assert.equal(
      microtypo('«Пролог» 17" 19" "Амбер " ушёл'),
      `«Пролог» 17${PRIME} 19${PRIME} «Амбер» ушёл`
    );
  });

  test('inches with no quotation around them stay inches', () => {
    assert.equal(microtypo('Экран 17" и 19" рядом'), `Экран 17${PRIME} и${NB}19${PRIME} рядом`);
  });

  // The other half of the same question: a real closing quote after a digit is not a measurement.
  test('a closing quote after a digit inside a quotation still closes', () => {
    assert.equal(microtypo('«Глава 5" хвост'), '«Глава 5» хвост');
    assert.equal(microtypo('"Экран 17" большой'), `«Экран 17» большой`);
  });
});

// An authored `„` opens and nothing else, so the pair it marks is knowable without guessing; folded
// to a neutral straight quote it would not be.
describe('an authored directed quote says which way it points', () => {
  const NB = '\u{00A0}';

  test('two lapki pairs stay two quotations', () => {
    assert.equal(microtypo('„Амбер “ „ Хаос“'), '«Амбер» «Хаос»');
    assert.equal(microtypo('„Амбер  “  „  Хаос“'), '«Амбер» «Хаос»');
    assert.equal(microtypo('„Амбер\t“\t„\tХаос“'), '«Амбер» «Хаос»');
  });

  test('they stay two inside a quotation of their own', () => {
    assert.equal(
      microtypo('«Корвин назвал „Амбер “ „ Хаос“ владениями»'),
      `«Корвин назвал ${BDQUO}Амбер${LDQUO} ${BDQUO}Хаос${LDQUO} владениями»`
    );
    assert.equal(
      microtypo('«Альфа „Бета “ „ Гамма“ конец»'),
      `«Альфа ${BDQUO}Бета${LDQUO} ${BDQUO}Гамма${LDQUO} конец»`
    );
  });

  // A pair already written tight must not move.
  test('a tight lapki pair is unchanged', () => {
    const src = `«Альфа ${BDQUO}Бета${LDQUO} ${BDQUO}Гамма${LDQUO} конец»`;

    assert.equal(microtypo(src), src);
  });

  // `“` points both ways — it closes a Russian `„…“` and opens an English `“…”` — so it stays
  // neutral and what stands around it decides.
  test('an English pair still becomes guillemets', () => {
    assert.equal(microtypo('“Amber, Corwin”'), '«Amber, Corwin»');
  });

  test('the entity spellings read back the same way', () => {
    assert.equal(
      microtypo('&bdquo;Амбер &ldquo; &bdquo; Хаос&ldquo;'),
      `«Амбер»${NB}«Хаос»`.replace(NB, ' ')
    );
    assert.equal(
      microtypo('&laquo;Амбер &bdquo;Тень&ldquo; дальше&raquo;'),
      `«Амбер ${BDQUO}Тень${LDQUO} дальше»`
    );
  });

  // The quotation an opening quote marks may hold no words at all, and the closer of that empty one
  // needs a rule to match.
  test('an empty quotation after an opening quote closes', () => {
    const once = microtypo('« " Корвин');

    assert.equal(once, '«» Корвин');
    assert.equal(microtypo(once), once);
  });

  // That gap is horizontal and nothing else: a run spanning line breaks would swallow the blank line
  // between two paragraphs.
  test('the gap of an empty quotation does not cross a blank line', () => {
    const src = '«\n \n" Амбер';
    const expected = '«\n \n«Амбер';

    assert.equal(microtypo(src), expected);
    assert.equal(microtypo(expected), expected);
  });

  // An English pair points as plainly as a Russian one: `”` closes and nothing else.
  test('two English pairs stay two quotations', () => {
    assert.equal(microtypo('“Амбер ” “ Хаос”'), '«Амбер» «Хаос»');
    assert.equal(
      microtypo('«Корвин назвал “Амбер ” “ Хаос” владениями»'),
      `«Корвин назвал ${BDQUO}Амбер${LDQUO} ${BDQUO}Хаос${LDQUO} владениями»`
    );
  });

  // A non-breaking space is content the author put inside the quotation, not separation, and every
  // spelling of the pair has to reach the answer an authored `«…»` already gets: the space directly
  // inside an empty quotation goes with it.
  test('a non-breaking gap settles in one pass, the same way for every spelling', () => {
    const results = new Set();

    for (const [open, close] of [
      ['“', '”'],
      ['„', '“'],
      ['"', '"'],
      ['«', '»']
    ]) {
      const once = microtypo(`${open}\u{00A0}${close} "Фраза"`);

      assert.equal(microtypo(once), once, `${open}${close} -> ${JSON.stringify(once)}`);
      results.add(once);
    }

    assert.equal(
      results.size,
      1,
      `spellings disagree: ${[...results].map((s) => JSON.stringify(s)).join(' ')}`
    );
  });
});

describe('LOCK-1 — correct where cross-test siblings diverge', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('nested quotes alternate «…„…"…» (akhx/byashimov do not)', () => {
    assert.equal(microtypo('«Амбер «Тень» дальше»', NOP), `«Амбер ${BDQUO}Тень${LDQUO} дальше»`);
  });

  test('inch mark 17" → 17″ (samdark leaves it straight)', () => {
    assert.equal(microtypo('17"', NOP), `17${PRIME}`);
  });

  test('(c) → © even inside quotes', () => {
    assert.ok(microtypo('«текст (c) Амбер»', NOP).includes('©'));
  });
});

describe('TASK-5.4 — path backslash before a closing quote', () => {
  // `\"` is ambiguous — an escaped quote, or a path separator plus a closer — so the close rule
  // keeps the backslash only behind a backslash-word run.
  test('Windows path backslash survives the closing quote', () => {
    assert.equal(microtypo(String.raw`"c:\amber\pattern\"`), String.raw`«c:\amber\pattern\»`);
  });

  test('path backslash survives with surrounding prose', () => {
    assert.equal(
      microtypo(String.raw`Лабиринт хранит "c:\amber\pattern\" глубоко.`),
      String.raw`Лабиринт хранит «c:\amber\pattern\» глубоко.`
    );
  });

  test('non-regression: escaped-quote close with no preceding backslash run is unaffected', () => {
    assert.equal(
      microtypo(String.raw`Корвин произнёс \"Амбер\", улыбнувшись.`),
      'Корвин произнёс «Амбер», улыбнувшись.'
    );
  });

  test('non-regression: single escaped-quote pair around one word is unaffected', () => {
    assert.equal(microtypo(String.raw`\"Тень\" скрывала правду.`), '«Тень» скрывала правду.');
  });
});

// `symbol.apostrophe` is the only way back from ASCII and fires only between letters, so a folded
// `‘…’` pair would come out as two straight quotes. Both are their own canonical form: what the
// author wrote is what comes back.
describe('single curly quotes keep the form they were written with', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('a pair nested in a double-quoted span survives', () => {
    assert.equal(microtypo('"‘22’"', NOP), '«‘22’»');
    assert.equal(microtypo('‘Амбер’', NOP), '‘Амбер’');
  });

  // The straight form is left alone where the apostrophe rule cannot claim it, so neither spelling
  // is rewritten into the other.
  test('a straight pair stays straight, a curly pair stays curly', () => {
    assert.equal(microtypo('"a \'b\' c"', NOP), "«a 'b' c»");
    assert.equal(microtypo('"a ‘b’ c"', NOP), '«a ‘b’ c»');
  });

  test('non-regression: apostrophe rule still converts straight and pre-curled forms', () => {
    assert.equal(microtypo("Corwin's crown", NOP), 'Corwin’s crown');
    assert.equal(microtypo('Corwin’s crown', NOP), 'Corwin’s crown');
  });

  test('&lsquo; entity folds the same way as the ‘ glyph', () => {
    assert.equal(microtypo('&lsquo;Амбер&rsquo;', NOP), microtypo('‘Амбер’', NOP));
  });
});

describe('quote.open — neighbours that are not letters', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  for (const [label, wrap] of [
    ['markdown bold', '**'],
    ['markdown italic', '*'],
    ['markdown underscore', '_'],
    ['markdown strikethrough', '~~']
  ]) {
    test(`${label} around a quoted word converts both quotes`, () => {
      assert.equal(
        microtypo(`Корвин ${wrap}"первый"${wrap} принц.`, NOP),
        `Корвин ${wrap}«первый»${wrap} принц.`
      );
    });
  }

  test('a bracketed quote converts', () => {
    assert.equal(
      microtypo('Читай ["Хроники"](/amber) тут.', NOP),
      'Читай [«Хроники»](/amber) тут.'
    );
  });

  test('a colon with no space still opens', () => {
    assert.equal(microtypo('Корвин сказал:"Амбер" тут.', NOP), 'Корвин сказал:«Амбер» тут.');
  });

  test('emphasis closing a quoted phrase stays a closing quote', () => {
    assert.equal(microtypo('Он сказал "это *важно*".', NOP), 'Он\u{00A0}сказал «это *важно*».');
  });

  test('a closing quote before a sentence mark is not reopened', () => {
    assert.equal(
      microtypo('Указ (п. 3 в ред. Оберона)".', NOP),
      'Указ (п.\u{00A0}3 в\u{00A0}ред. Оберона)".'
    );
  });

  test('inches after a digit are untouched by the widened boundary', () => {
    assert.equal(microtypo('Клинок длиной 5" тут.', NOP), 'Клинок длиной 5″ тут.');
  });

  // The character table leaves « and » out of the folded set so a raw guillemet keeps the direction
  // its author chose, and their entity spellings have to agree.
  test('a guillemet entity keeps the direction its author wrote', () => {
    assert.equal(microtypo('Дворкин &laquo;Амбер&raquo; ушёл'), 'Дворкин «Амбер» ушёл');
    assert.equal(microtypo('Дворкин &#171;Амбер&#187; ушёл'), 'Дворкин «Амбер» ушёл');
  });

  test('an empty guillemet pair survives in every spelling', () => {
    const expected = 'Дворкин «» ушёл';

    assert.equal(microtypo('Дворкин «» ушёл'), expected);
    assert.equal(microtypo('Дворкин &laquo;&raquo; ушёл'), expected);
    assert.equal(microtypo(expected), expected);
  });

  test('entity and raw guillemets still agree with straight quotes on a filled pair', () => {
    const expected = microtypo('"Амбер"');

    assert.equal(microtypo('«Амбер»'), expected);
    assert.equal(microtypo('&laquo;Амбер&raquo;'), expected);
  });
});

const inItem = (body) => `<doc><item>${body}</item></doc>`;

describe('spaced open quotes use the existing significant-content definition', () => {
  test('an authored XML quote reference has a direction and keeps its spelling', () => {
    for (const entities of [false, true]) {
      const typo = new MicroTypo({ input: 'xml', entities });
      for (const [left, right] of [
        ['&laquo;', '&raquo;'],
        ['&quot;', '&quot;'],
        ['&bdquo;', '&ldquo;'],
        ['&ldquo;', '&rdquo;'],
        ['&#34;', '&#x22;'],
        ['&#8222;', '&#8220;'],
        ['&quot;', '&#x22;'],
        ['&#8222;', '&ldquo;'],
        ['&#x00AB;', '&#187;']
      ]) {
        const inner = `${left}мир${right}`;
        const input = `<p>"верх "низ ${inner}""</p>`;
        const expected = entities
          ? `<p>&#171;верх &#8222;низ ${inner}&#8220;&#187;</p>`
          : `<p>«верх „низ ${inner}“»</p>`;
        assert.equal(typo.process(input), expected);
        assert.equal(typo.process(expected), expected);
        assert.equal(typo.process(`<p>${inner}</p>`), `<p>${inner}</p>`);
      }
      const straight = '<p>&quot;&quot;"книга" Мир&quot; это Мир Мир&quot;</p>';
      const wrapped = entities ? '&#171;книга&#187;' : '«книга»';
      const output = `<p>&quot;&quot;${wrapped} Мир&quot; это Мир Мир&quot;</p>`;
      assert.equal(typo.process(straight), output);
      assert.equal(typo.process(output), output);
      for (const [left, right, nested] of [
        ['&quot;', '&quot;', '&laquo;мир&raquo;'],
        ['&laquo;', '&raquo;', '&quot;мир&quot;']
      ]) {
        const body = `низ ${nested}`;
        const quotes = entities ? `&#171;${body}&#187;` : `«${body}»`;
        const source = `<p>${left}верх "${body}"${right}</p>`;
        const expected = `<p>${left}верх ${quotes}${right}</p>`;
        assert.equal(typo.process(source), expected);
        assert.equal(typo.process(expected), expected);
      }
    }
  });

  test('immutable XML quote boundaries leave outside and inside editable pairs independent', () => {
    for (const entities of [false, true]) {
      const engine = new MicroTypo({ input: 'xml', entities });
      const quote = entities ? '&#171;новое&#187;' : '«новое»';
      for (const [left, right] of [
        ['&quot;', '&quot;'],
        ['&bdquo;', '&ldquo;'],
        ['&ldquo;', '&rdquo;'],
        ['&quot;', '&#x22;'],
        ['&#8222;', '&ldquo;'],
        ['&vendor;', '&vendor;']
      ]) {
        const cases = [
          [
            `<p>${left}издатель "новое" издание${right}.</p>`,
            `<p>${left}издатель ${quote} издание${right}.</p>`
          ],
          [`<p>Издатель ${left} сегодня "новое".</p>`, `<p>Издатель ${left} сегодня ${quote}.</p>`],
          [
            `<p>${left}первое</p><p>${right} "новое".</p>`,
            `<p>${left}первое</p><p>${right} ${quote}.</p>`
          ]
        ];
        for (const [source, expected] of cases) {
          assert.equal(engine.process(source), expected, source);
          assert.equal(engine.process(expected), expected, source);
        }
      }
    }
  });

  test('empty and nested preserved pairs use visible XML text through inline elements', () => {
    for (const entities of [false, true]) {
      const engine = new MicroTypo({ input: 'xml', entities });
      const [outer, inside, end, close] = entities
        ? ['&#171;', '&#8222;', '&#8220;', '&#187;']
        : ['«', '„', '“', '»'];
      for (const [left, right] of [
        ['&quot;', '&quot;'],
        ['&#34;', '&#x0022;'],
        ['&quot;', '&#34;'],
        ['&bdquo;', '&ldquo;'],
        ['&#x201E;', '&ldquo;'],
        ['&laquo;', '&raquo;'],
        ['&ldquo;', '&rdquo;']
      ]) {
        const first = `${left}первое${right}`;
        for (const [separator, text] of [
          ['', 'второе'],
          [' ', 'второе'],
          [', ', 'второе'],
          ['', '<em>второе</em>']
        ]) {
          const input = `<p>${first}${separator}"${text}"</p>`;
          const expected = `<p>${first}${separator}${outer}${text}${close}</p>`;
          assert.equal(engine.process(input), expected, input);
          assert.equal(engine.process(expected), expected, input);
        }
        for (const content of [
          '',
          'мир',
          '<em>мир</em>',
          '<b><i>мир</i></b>',
          '<code>мир</code>',
          `${left}текст${right}`,
          `мир ${left}пруд${right}`,
          `мир ${left}пруд ${left}лес${right}${right}`,
          `<em>${left}мир${right}</em>`,
          `мир <em>${left}пруд${right}</em>`
        ]) {
          const preserved = left + content + right;
          const source = `<p>"верх "низ ${preserved}""</p>`;
          const expected = `<p>${outer}верх ${inside}низ ${preserved}${end}${close}</p>`;
          assert.equal(engine.process(source), expected, source);
          assert.equal(engine.process(expected), expected, source);
        }
      }
    }
  });
  test('adjacent writable XML pairs keep their partners across quote normalization', () => {
    const onlyOpen = new MicroTypo({ input: 'xml', rules: { 'quote.close': false } });
    assert.equal(onlyOpen.process('<p>&quot;лес&quot;"река"</p>'), '<p>&quot;лес&quot;«река"</p>');
    const spellings = [
      ['"', '"'],
      ['«', '»'],
      ['„', '“'],
      ['“', '”']
    ];
    for (const entities of [false, true]) {
      const engine = new MicroTypo({ input: 'xml', entities });
      const [open, close, inner, end] = entities
        ? ['&#171;', '&#187;', '&#8222;', '&#8220;']
        : ['«', '»', '„', '“'];
      for (const [a, b] of spellings) {
        for (const [c, d] of spellings) {
          const saved = '&quot;<em>лес</em>&quot;';
          for (const [source, expected] of [
            [
              `${a}город ${saved}${c}река${d}${b}`,
              `${open}город ${saved}${inner}река${end}${close}`
            ],
            [
              `${a}город &#x22;&#34;${b}${c}река${d}`,
              `${open}город &#x22;&#34;${close}${open}река${close}`
            ],
            [
              `${a}город${b}, ${c}река ${saved}${d}`,
              `${open}город${close}, ${open}река ${saved}${close}`
            ],
            [
              `&quot;${a}город${b}${c}река${d}&quot;`,
              `&quot;${open}город${close}${open}река${close}&quot;`
            ]
          ]) {
            const input = `<p>${source}</p>`;
            const output = `<p>${expected}</p>`;
            assert.equal(engine.process(input), output, input);
            assert.equal(engine.process(output), output, input);
          }
        }
      }
      const kept = '&quot;<em>лес</em>&quot;';
      for (const [source, expected] of [
        [`„город “${kept} река” дальше“`, `${open}город ${inner}${kept} река${end} дальше${close}`],
        [
          `${kept}""""пруд""""`,
          `${kept}${open}${inner}${inner}${inner}пруд${end}${end}${end}${close}`
        ],
        [
          `“город „район “парк ${kept}„пруд“”“”`,
          `${open}город ${inner}район ${inner}парк ${kept}${inner}пруд${end}${end}${end}${close}`
        ]
      ]) {
        assert.equal(engine.process(`<p>${source}</p>`), `<p>${expected}</p>`);
        assert.equal(engine.process(`<p>${expected}</p>`), `<p>${expected}</p>`);
      }
    }
  });

  test('XML keeps authored quote directions when an individual quote rule is disabled', () => {
    for (const open of [false, true]) {
      for (const close of [false, true]) {
        for (const nested of [false, true]) {
          const rules = { 'quote.open': open, 'quote.close': close, 'quote.nested': nested };
          for (const entities of [false, true]) {
            const engine = new MicroTypo({ input: 'xml', entities, rules });
            const [outer, end, inside, innerEnd] = entities
              ? ['&#171;', '&#187;', '&#8222;', '&#8220;']
              : ['«', '»', '„', '“'];
            const inner = nested ? inside : outer;
            const stop = nested ? innerEnd : end;
            const check = (source, expected) => {
              const input = `<p>${source}</p>`;
              const output = `<p>${expected}</p>`;
              assert.equal(engine.process(input), output, input);
              assert.equal(engine.process(output), output, output);
            };
            for (const title of [
              '&quot;Север&quot;',
              '&#34;<em>Север</em>&#x22;',
              '&quot;<code>"Юг"</code>&quot;'
            ]) {
              const adjacent = `${outer}город ${title}${inner}река${stop}${end}`;
              check(`«город ${title}„река“»`, adjacent);
              if (open) {
                check(`«город ${title}“река”»`, adjacent);
              }
              check(
                `«Каталог „Вышел ${title}“»`,
                `${outer}Каталог ${inner}Вышел ${title}${stop}${end}`
              );
              check(
                `${title}"река"`,
                `${title}${open ? outer : '"'}река${open && close ? end : '"'}`
              );
            }
            const space = entities ? '&#160;' : '\u00a0';
            check(
              'Редактор написал: «В каталоге сказано „Вышел &quot;Север&quot;“».',
              `Редактор написал: ${outer}В${space}каталоге сказано ${inner}Вышел &quot;Север&quot;${stop}${end}.`
            );
          }
        }
      }
    }
  });

  test('XML quote roles read their own references without changing authored bytes', () => {
    const cfg = { input: 'xml', entities: true, rules: { 'quote.close': false } };
    const source = '<doc><item>„л " “.</item><note>" н</note></doc>';
    const expected = '<doc><item>&#171;л&#160;&#171;&#187;.</item><note>" н</note></doc>';
    assert.equal(microtypo(source, cfg), expected);
    assert.equal(microtypo(expected, cfg), expected);
    assert.equal(microtypo(microtypo(expected, cfg), cfg), expected);
    for (const reference of ['&#171;', '&#xAB;', '&#X000ab;', '&#000171;']) {
      const authored = `<doc><item>${reference}л " ${reference}.</item><note>" н</note></doc>`;
      assert.equal(microtypo(authored, cfg), authored);
      assert.equal(microtypo(microtypo(authored, cfg), cfg), authored);
    }
    for (const entities of [false, true]) {
      for (const close of [false, true]) {
        const options = { input: 'xml', entities, rules: { 'quote.close': close } };
        for (const prefix of [
          '&madeup;',
          '&laquo;',
          '&quot;',
          '&#34;',
          '&#x0022;',
          '&#8220;',
          '&#171;&#8222;а&#8220;&#187;',
          '&#xAB;&#x201E;а&#x201C;&#xBB;',
          '&#000171;&#0008222;а&#0008220;&#000187;'
        ]) {
          const input = `<doc>${prefix} " "</doc>`;
          const output = `<doc>${prefix} ${entities ? '&#171;&#187;' : '«»'}</doc>`;
          assert.equal(microtypo(input, options), output);
          assert.equal(microtypo(output, options), output);
          assert.equal(microtypo(microtypo(output, options), options), output);
        }
      }
    }
  });
  test('inline tags preserve the visible direction and content of a quote', () => {
    const cfg = { html: true, input: 'html', render: { paragraphs: false } };
    for (const close of [false, true]) {
      const options = { ...cfg, rules: { 'quote.close': close } };
      for (const [source, expected] of [
        ['«', '«'],
        ['„', '«'],
        ['"', '"'],
        ['“', '"'],
        ['”', '"']
      ]) {
        for (const [left, right] of [
          ['', ''],
          ['<b>', '</b>'],
          ['<em><b>', '</b></em>']
        ]) {
          const input = `${left}${source}${right}`;
          const output = `${left}${expected}${right}`;
          assert.equal(microtypo(input, options), output);
          assert.equal(microtypo(output, options), output);
        }
      }
    }
    for (const [source, expected] of [
      [' <b>"</b>', ' <b>"</b>'],
      ['<b>"</b>слово"', '<b>«</b>слово»'],
      ['<b>"</b><em>слово</em>"', '<b>«</b><em>слово</em>»'],
      ['«слово<b>"</b>', '«слово<b>»</b>'],
      ['«слово <b>"</b>', '«слово <b>»</b>'],
      ['«слово <em></em><b>"</b>', '«слово <em></em><b>»</b>'],
      ['«слово <em></em> <b>"</b>', '«слово <em></em> <b>»</b>'],
      ['« <b>"</b>', '«<b>»</b>'],
      ['«слово\u00a0<b>"</b>', '«слово\u00a0<b>»</b>'],
      ['«𝟙<b>"</b>', '«𝟙<b>»</b>'],
      ['«🙂<b>"</b>', '«🙂<b>»</b>'],
      ['<b>"</b><img src=x>"', '<b>«</b><img src=x>»'],
      ['<b>"</b><br>"', '<b>«</b><br>»'],
      ['<b>"</b><code>raw</code>"', '<b>«</b><code>raw</code>»']
    ]) {
      assert.equal(microtypo(source, cfg), expected);
      assert.equal(microtypo(expected, cfg), expected);
      assert.equal(microtypo(microtypo(expected, cfg), cfg), expected);
    }
    const xml = '<doc><b>"</b>слово"</doc>';
    assert.equal(microtypo(xml, { input: 'xml' }), xml);
    assert.equal(microtypo(microtypo(xml, { input: 'xml' }), { input: 'xml' }), xml);
  });
  test('closers glued into one run close nested quotations one after another', () => {
    for (const [source, expected, config] of [
      ['«"в«>»"»', '«„в„>““»', {}],
      ['«„в„>““»', '«„в„>““»', {}],
      ['„в„>““', '«в„>“»', {}],
      ['“««отк-->»»”', '«„„отк-->““»', { input: 'markdown' }],
      ['«"в«>»"»', '&laquo;&bdquo;в&bdquo;>&ldquo;&ldquo;&raquo;', { entities: true }]
    ]) {
      assert.equal(microtypo(source, config), expected);
      assert.equal(microtypo(expected, config), expected);
    }
    for (const source of ['«„в„а““»', '«„>“»', 'а>«б»']) {
      assert.equal(microtypo(source), source);
    }
    assert.equal(microtypo('а>“б”'), 'а>«б»');
  });
  test('an empty nested quotation with its padding kept closes as the glued one does', () => {
    const unspaced = { rules: { space: 0 } };
    for (const [source, expected, config] of [
      ['„« » “', '«„ “ »', { input: 'markdown', ...unspaced }],
      ['«а « » б»', '«а „ “ б»', unspaced],
      ['«а « »б»', '«а „ “б»', unspaced],
      ['«« »Амбер»', '«„ “Амбер»', unspaced],
      ['«а « » б»', '«а „“ б»', {}]
    ]) {
      assert.equal(microtypo(source, config), expected);
      assert.equal(microtypo(expected, config), expected);
    }
    assert.equal(microtypo('«„ “Амбер“»'), microtypo('«„“Амбер“»'));
  });
  test('a directed nested pair keeps its high closer before the outer close', () => {
    for (const close of [false, true]) {
      for (const nested of [false, true]) {
        for (const tail of ['', ' слово', '\u00a0слово', '\u00a0<->']) {
          const source = `«„>“»${tail}`;
          const expected = `${nested ? '«„>“»' : '««>»»'}${tail}`;
          const cfg = {
            input: 'markdown',
            rules: { 'quote.close': close, 'quote.nested': nested }
          };
          assert.equal(microtypo(source, cfg), expected);
          assert.equal(microtypo(expected, cfg), expected);
          assert.equal(microtypo(microtypo(expected, cfg), cfg), expected);
        }
      }
    }
    for (const gap of [' ', '\u00a0']) {
      for (const padding of [false, true]) {
        const cfg = { rules: { 'quote.close': false, 'space.strip_quote_padding': padding } };
        const source = `«„${gap}>${gap}“»`;
        const expected = padding ? '«„>“»' : source;
        assert.equal(microtypo(source, cfg), expected);
        assert.equal(microtypo(expected, cfg), expected);
      }
    }
    assert.equal(microtypo('„текст “Амбер”'), '«текст «Амбер»');
    assert.equal(microtypo('«текст «Амбер»'), '«текст «Амбер»');
  });
  test('native closing markup has no content for a spaced quote to open on', () => {
    for (const entities of [false, true]) {
      for (const close of [false, true]) {
        const cfg = { input: 'xml', entities, rules: { 'quote.close': close } };
        const source = '<doc><p> " </p><note> " </note></doc>';
        assert.equal(microtypo(source, cfg), source);
        assert.equal(microtypo(microtypo(source, cfg), cfg), source);
      }
    }
    for (const [source, expected] of [
      ['<doc><p> " <em>Амбер</em>"</p></doc>', '<doc><p> «<em>Амбер</em>»</p></doc>'],
      ['<doc><p> " https://example.com/"</p></doc>', '<doc><p> «https://example.com/»</p></doc>']
    ]) {
      assert.equal(microtypo(source, { input: 'xml' }), expected);
      assert.equal(microtypo(expected, { input: 'xml' }), expected);
    }
    assert.equal(microtypo(' " </em>', { input: 'plain' }), ' «</em>');
  });
  test('a no-break space starts authored content in the same way before serialization', () => {
    for (const open of [true, false]) {
      for (const padding of [true, false]) {
        const cfg = { rules: { 'quote.open': open, 'space.strip_quote_padding': padding } };
        const source = '" \u{00A0}Амбер"';
        const expected = open ? `«${padding ? '' : '\u{00A0}'}Амбер»` : source;
        assert.equal(microtypo(source, cfg), expected);
        assert.equal(microtypo(expected, cfg), expected);
      }
    }
  });
  test('XML reads the same content before its no-break space becomes a reference', () => {
    const source = '<doc><description> " \u{00A0}&</description></doc>';
    for (const padding of [true, false]) {
      const cfg = { input: 'xml', entities: true, rules: { 'space.strip_quote_padding': padding } };
      const expected = `<doc><description> &#171;${padding ? '' : '&#160;'}&</description></doc>`;
      assert.equal(microtypo(source, cfg), expected);
      assert.equal(microtypo(expected, cfg), expected);
    }
  });
  test('XML reads a glyph reference beside a glued quote as the glyph it spells', () => {
    for (const [glyphs, references] of [
      ['«у»"…', '&#171;у&#187;"&#8230;'],
      ['«у»"слово', '&#171;у&#187;"слово'],
      ['а,"…"', 'а,"&#8230;"']
    ]) {
      assert.equal(microtypo(glyphs), glyphs);
      assert.equal(microtypo(inItem(glyphs), { input: 'xml', entities: true }), inItem(references));
      for (const entities of [false, true]) {
        const cfg = { input: 'xml', entities };
        assert.equal(microtypo(inItem(glyphs), cfg), inItem(entities ? references : glyphs));
        assert.equal(microtypo(inItem(references), cfg), inItem(references));
        assert.equal(microtypo(microtypo(inItem(references), cfg), cfg), inItem(references));
      }
    }
    const hex = inItem('&#xAB;у&#xBB;"&#x2026;');
    assert.equal(microtypo(hex, { input: 'xml' }), hex);
    for (const [source, expected] of [
      ['а&#8212;"слово"', 'а&#8212;&#171;слово&#187;'],
      ['а&#160;"слово"', 'а&#160;&#171;слово&#187;'],
      ['а;"слово"', 'а;&#171;слово&#187;'],
      ['а&amp;"слово"', 'а&amp;&#171;слово&#187;'],
      ['а,"&#1089;лово"', 'а, &#171;&#1089;лово&#187;']
    ]) {
      const cfg = { input: 'xml', entities: true };
      assert.equal(microtypo(inItem(source), cfg), inItem(expected));
      assert.equal(microtypo(inItem(expected), cfg), inItem(expected));
    }
  });
});

test('a quotation can begin on the following line inside the same paragraph', () => {
  for (const [left, right] of [
    ['"', '"'],
    ['“', '”'],
    ['«', '»']
  ]) {
    for (const [line, config, prefix, suffix] of [
      ['\n', {}, '', ''],
      ['<br>', { input: 'html' }, '<p>', '</p>'],
      ['<br>\n', { input: 'html' }, '<p>', '</p>']
    ]) {
      const engine = new MicroTypo(config);
      const lines = `${line}Привет${line}миру`;
      const expected = `${prefix}Он\u{00A0}сказал: «${lines}»${suffix}`;
      assert.equal(
        engine.process(`${prefix}Он сказал: ${left}${lines}${right}${suffix}`),
        expected
      );
      assert.equal(engine.process(expected), expected);
    }
  }
  const split = 'Он\u{00A0}сказал: "\n\nПривет"';
  assert.equal(microtypo('Он сказал: "\n\nПривет"'), split);
  assert.equal(microtypo(split), split);
});

test('complete neighbouring titles retain their source separator in every prose format', () => {
  for (const input of ['text', 'markdown', 'html', 'xml']) {
    for (const entities of [false, true]) {
      const engine = new MicroTypo({ input, entities });
      const wrap = (text) => (input === 'html' || input === 'xml' ? `<p>${text}</p>` : text);
      const encoded = input === 'xml' ? ['&#171;', '&#187;'] : ['&laquo;', '&raquo;'];
      const [open, close] = entities ? encoded : ['«', '»'];
      for (const [left, right] of [
        ['"', '"'],
        ['«', '»'],
        ['„', '“'],
        ['“', '”']
      ]) {
        const source = wrap(`Редактор сверил названия ${left}Лес${right}"Город" перед печатью.`);
        const expected = wrap(
          `Редактор сверил названия ${open}Лес${close}${open}Город${close} перед печатью.`
        );
        assert.equal(engine.process(source), expected);
        assert.equal(engine.process(expected), expected);
      }
    }
  }
});

test('touching source pairs retain their levels across preceding speech', () => {
  const prefix = 'Канцлер „сказал "тихое «поле» в мае"“ и добавил “позже”. ';
  const expectedPrefix = 'Канцлер «сказал „тихое „поле“ в мае“» и добавил «позже». ';
  for (const inner of ['"лес"', '“лес”', '„лес“', '«лес»']) {
    const source = `${prefix}Редактор записал „слово “${inner} рядом” тут“.`;
    const expected = `${expectedPrefix}Редактор записал «слово „„лес“ рядом“ тут».`;
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a sibling needs a partner and preserves XML references, markup and rule switches', () => {
  const engine = new MicroTypo({ input: 'xml' });
  for (const [source, expected] of [
    ['<p>«Лес»"Город перед печатью.</p>', '<p>«Лес»"Город перед печатью.</p>'],
    ['<p>«Лес»" перед печатью.</p>', '<p>«Лес»" перед печатью.</p>'],
    ['<p>«»"Город".</p>', '<p>«»«Город».</p>'],
    ['<p>"«»"</p>', '<p>«„“»</p>'],
    ['<p>„Лес“<em>"Город"</em>.</p>', '<p>«Лес»<em>«Город»</em>.</p>'],
    ['<p>&quot;Лес&quot;<em>“Город”</em>.</p>', '<p>&quot;Лес&quot;<em>«Город»</em>.</p>'],
    ['<p>„Лес“"Город”.</p>', '<p>«Лес»«Город».</p>'],
    ['<p>«Лес», "Город" и "Река".</p>', '<p>«Лес», «Город» и «Река».</p>']
  ]) {
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
  const source = '<p>«Лес»"Город"</p>';
  for (const [rules, expected] of [
    [{ 'quote.open': false }, source],
    [{ 'quote.close': false }, '<p>«Лес»«Город"</p>'],
    [{ 'quote.*': false }, source]
  ]) {
    assert.equal(new MicroTypo({ input: 'xml', rules }).process(source), expected);
  }
});

test('diagnostic edits for neighbouring titles reconstruct the serialised XML and preserve later source ranges', () => {
  const src = '<p>„Лес“"Город"  1/2.</p>';
  const engine = new MicroTypo({ input: 'xml', entities: true });
  const { text, edits, trace } = engine.process(src, { edits: true, trace: true });
  assert.equal(text, '<p>&#171;Лес&#187;&#171;Город&#187; &#189;.</p>');
  assert.equal(
    edits.toReversed().reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), src),
    text
  );
  const fraction = trace.find(({ rule }) => rule === 'number.fraction');
  assert.deepEqual(
    fraction.ranges.map(([start, end]) => src.slice(start, end)),
    [' 1/2']
  );
});

test('touching titles keep their content and close at the resolved speech level', () => {
  const engine = new MicroTypo({ input: 'markdown' });
  for (const [source, expected] of [
    [`Книги: "Знак '""По средам".`, `Книги: «Знак '»«По средам».`],
    [`Книги: "Знак ‘""(Не)везение".`, `Книги: «Знак ‘»«(Не)везение».`],
    [`Книги: "Знак ’""‘Лес’".`, `Книги: «Знак ’»«‘Лес’».`],
    [`Книги: "Книга 'Лес'""Лето".`, `Книги: «Книга 'Лес'»«Лето».`],
    [`Книги: "Знак '""Панель 15" настенная".`, `Книги: «Знак '»«Панель 15″ настенная».`],
    [`Книги: " 😀""Ряд '""Книга «Лес»".`, `Книги: «😀»«Ряд '»«Книга „Лес“».`],
    [`«Книги "Знак '""Лето" исчезли».`, `«Книги „Знак '“„Лето“ исчезли».`],
    [`Книги: "Знак '""Лето`, `Книги: «Знак '""Лето`],
    [`Редактор пометил "Знак '" и нашёл О'Нила.`, `Редактор пометил «Знак '» и нашёл О’Нила.`],
    [`Поля: «Река» '""Лес".`, `Поля: «Река» '""Лес".`],
    ['Поля: "Список «»" и ширина 5′ 7″.', 'Поля: «Список „“» и ширина 5′ 7″.'],
    [`Реплика: «Таблица „Знак '“».`, `Реплика: «Таблица „Знак '“».`]
  ]) {
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('only removable padding can precede the final endpoint of touching titles', () => {
  const preserve = new MicroTypo({ rules: { 'space.strip_quote_padding': false } });
  for (const gap of [' ', '\t', '\u{00A0}']) {
    const source = `Книги: «Клеймо '""Летний сад${gap}».`;
    const directed = `Книги: «Клеймо '»«Летний сад${gap}».`;
    const expected = `Книги: «Клеймо '»«Летний сад».`;
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
    // Collapsing tabs remains active when only quote padding is disabled.
    assert.equal(preserve.process(source), source.replace('\t', ' '));
    assert.equal(preserve.process(directed), directed.replace('\t', ' '));
  }
  const line = `Книги: «Клеймо '""Летний сад\n».`;
  assert.equal(microtypo(line), line);
});

test('a following title can consist of an independently closed quotation', () => {
  const first = 'Замечания: "Где "Серия "Лес»"?"';
  const expectedFirst = 'Замечания: «Где „Серия „Лес““?»';
  for (const [ending, expectedEnding] of [
    ['"«Маяк»".', '«„Маяк“».'],
    ['"« Маяк » здесь".', '«„Маяк“ здесь».'],
    ['"«Экран 15″»". Ширина 27".', '«„Экран 15″“». Ширина 27″.'],
    ['"«Маяк».', '"«Маяк».'],
    ['"«Маяк»"овский.', '"«Маяк»"овский.']
  ]) {
    const expected = expectedFirst + expectedEnding;
    assert.equal(microtypo(first + ending), expected);
    assert.equal(microtypo(expected), expected);
  }
  const source = 'Она пишет: «Указаны "Где «Маяк»?""«Лес»" сегодня».';
  const expected = 'Она пишет: «Указаны „Где „Маяк“?“„„Лес““ сегодня».';
  assert.equal(microtypo(source), expected);
  assert.equal(microtypo(expected), expected);
});

test('a literal mark at the end of a title keeps rule switches and source ranges', () => {
  const source = `Книги: "Знак '""Лес".`;
  for (const [rules, expected] of [
    [{ 'quote.close': false }, `Книги: «Знак '""Лес".`],
    [{ 'quote.open': false }, source],
    [{ 'quote.*': false }, source]
  ]) {
    const engine = new MicroTypo({ rules });
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
  const xml = new MicroTypo({ input: 'xml', entities: true });
  const line = `<p>Книги: "Знак '""По средам". Цена 1/2.</p>`;
  const expected = `<p>Книги: &#171;Знак '&#187;&#171;По&#160;средам&#187;. Цена &#189;.</p>`;
  const { text, edits, trace } = xml.process(line, { edits: true, trace: true });
  assert.equal(text, expected);
  assert.equal(xml.process(text), expected);
  assert.equal(
    edits
      .toReversed()
      .reduce((s, edit) => s.slice(0, edit.start) + edit.text + s.slice(edit.end), line),
    text
  );
  const fraction = trace.find(({ rule }) => rule === 'number.fraction');
  assert.deepEqual(
    fraction.ranges.map(([start, end]) => line.slice(start, end)),
    [' 1/2']
  );
});

test('a complete title can end in closing punctuation, a symbol, or a unit mark', () => {
  for (const input of ['xml', 'markdown', 'text']) {
    const engine = new MicroTypo({ input });
    const wrap = (s) => (input === 'xml' ? `<doc>${s}</doc>` : s);
    for (const ending of ['[том первый]', '(том первый)', '🦊', '🤝🏾', 'леса…', '15″']) {
      const source = wrap(`Редактор сверил названия "Лес ${ending}""Город".`);
      const expected = wrap(`Редактор сверил названия «Лес ${ending}»«Город».`);
      assert.equal(engine.process(source), expected);
      assert.equal(engine.process(expected), expected);
    }
    const measure = wrap('Экран 15″ и название «Город».');
    assert.equal(engine.process(measure), engine.process(wrap('Экран 15″ и название "Город".')));
  }
});

test('adjacent full titles keep repeated inner names, an empty inner quotation and measurement marks', () => {
  const engine = new MicroTypo({ input: 'xml' });
  for (const [source, expected] of [
    ['„Книга "Лес"“"Книга «Лес»"', '«Книга „Лес“»«Книга „Лес“»'],
    ['"Книга «Лес»"„Книга "Лес"“', '«Книга „Лес“»«Книга „Лес“»'],
    ['"Книга «Лес»""Книга «Лес»"', '«Книга „Лес“»«Книга „Лес“»'],
    ['"Сосна «»""Ясень"', '«Сосна „“»«Ясень»'],
    ['„Экран 15"“"Ясень"', '«Экран 15″»«Ясень»'],
    ['"Ясень"„Экран 15"“', '«Ясень»«Экран 15″»'],
    ['"Экран 15"""Ясень"', '«Экран 15″»«Ясень»'],
    ['"Экран 15""“Ясень”', '«Экран 15″»«Ясень»'],
    ['"Экран 15″""Ясень"', '«Экран 15″»«Ясень»']
  ]) {
    const want = `<doc>${expected}</doc>`;
    assert.equal(engine.process(`<doc>${source}</doc>`), want);
    assert.equal(engine.process(want), want);
  }
  const noInches = new MicroTypo({ input: 'xml', rules: { 'quote.inch': false } });
  assert.ok(!noInches.process('<doc>"Экран 15"""Ясень"</doc>').includes('″'));
});

test('a quotation can open over a soft break but cannot borrow the next block', () => {
  for (const input of ['html', 'markdown']) {
    const config = { input };
    for (const tag of ['p', 'h3', 'ul', 'blockquote', 'section', 'pre']) {
      for (const gap of ['', ' ', '\n']) {
        const block = `<${tag}>Город</${tag}>`;
        const source = `Закончен абзац. »${gap}${block}`;
        const first = microtypo(source, config);
        assert.equal(first, `Закончен абзац. "${gap}${block}`);
        assert.equal(microtypo(first, config), first);
        const quoted = `Название «Север»${gap}${block}`;
        assert.equal(microtypo(quoted, config), quoted);
      }
    }
    for (const middle of ['\n', '<br>', '<em>Город</em>']) {
      const words = middle === '<em>Город</em>' ? middle : `${middle}Город`;
      assert.equal(microtypo(`Сказано: "${words}".`, config), `Сказано: «${words}».`);
    }
  }
});

test('a Markdown code block keeps its own line and a quoted code span keeps its words', () => {
  const config = { input: 'markdown' };
  for (const block of [
    '\n<pre data-lang="x">\n  "Город"\n</pre>',
    '\n```js\n"Город";\n```',
    '\n\n    "Город"'
  ]) {
    const expected = `Абзац. "${block}`;
    assert.equal(microtypo(`Абзац. »${block}`, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  const expected = 'Сказано: «\n`Город`».';
  assert.equal(microtypo('Сказано: "\n`Город`".', config), expected);
  assert.equal(microtypo(expected, config), expected);
});

test('Markdown marks the start of the next speech domain on the occurrence of the prefix', () => {
  const config = { input: 'markdown' };
  for (const next of ['# Город', '> Город', '- Город', '1. Город', '---', '***', '===']) {
    const source = `Абзац. »\n${next}`;
    const expected = `Абзац. "\n${next}`;
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  for (const [source, expected] of [
    ['> Автор: "\n> Город".\n\nАбзац. »\n> Город', '> Автор: «\n> Город».\n\nАбзац. "\n> Город'],
    ['- Автор: "\n  Город".', '- Автор: «\n  Город».'],
    ['Автор: "\n*Город*".', 'Автор: «\n*Город*».']
  ]) {
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

test('native MDX block tags and Markdown table headers end the preceding quotation domain', () => {
  for (const input of ['markdown', 'frontmatter', 'mdx']) {
    for (const block of ['| Город |\n| --- |', '<!--  "А - Б" -->\n<pre>Код</pre>']) {
      const expected = `Абзац. "\n${block}`;
      assert.equal(microtypo(`Абзац. »\n${block}`, { input }), expected);
      assert.equal(microtypo(expected, { input }), expected);
    }
  }
  for (const gap of ['', ' ', '\n']) {
    for (const tag of ['p', 'h2', 'ul', 'hr']) {
      const markup = tag === 'hr' ? '<hr>' : `<${tag}>Лес</${tag}>`;
      const expected = `Абзац. "${gap}${markup}`;
      assert.equal(microtypo(`Абзац. »${gap}${markup}`, { input: 'mdx' }), expected);
      assert.equal(microtypo(expected, { input: 'mdx' }), expected);
    }
  }
  const quoted = 'Автор: «\n<Card>Север</Card>».';
  assert.equal(microtypo('Автор: "\n<Card>Север</Card>".', { input: 'mdx' }), quoted);
  assert.equal(microtypo(quoted, { input: 'mdx' }), quoted);
});

test('an inline br before a comment does not start a Markdown block', () => {
  const config = { input: 'markdown' };
  for (const text of [
    '<br><!-- помета -->Город',
    '<br><!-- первая --><!-- вторая --><em>Город</em>',
    '<br><em><!-- помета -->Город</em>',
    '<em>Город<!-- конец --></em>',
    'Город<br><!-- помета -->'
  ]) {
    const expected = `Автор: «${text}».`;
    assert.equal(microtypo(`Автор: "${text}".`, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  for (const gap of ['\n', '<br>\n']) {
    const block = `${gap}<!-- отдельно -->\n<pre>Город</pre>`;
    const expected = `Абзац. "${block}`;
    assert.equal(microtypo(`Абзац. »${block}`, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

test('an opener needs visible content after comments and soft breaks in its own paragraph', () => {
  for (const input of ['markdown', 'frontmatter']) {
    for (const start of ['<br><!-- помета -->', '<br/><!-- первая --><!-- "Б" -->']) {
      for (const end of ['', '\n\n<pre>Код</pre>', '\n# Город', '<p>Город</p>']) {
        const after = `${start}${end}`;
        for (const [source, expected] of [
          [`Абзац. »${after}`, `Абзац. "${after}`],
          [`Название «Лес»${after}`, `Название «Лес»${after}`]
        ]) {
          assert.equal(microtypo(source, { input }), expected);
          assert.equal(microtypo(expected, { input }), expected);
        }
      }
      for (const end of ['Город', '<em>Город</em>', '\nГород', '<code>А - Б</code>']) {
        const expected = `Автор: «${start}${end}».`;
        assert.equal(microtypo(`Автор: "${start}${end}".`, { input }), expected);
        assert.equal(microtypo(expected, { input }), expected);
      }
    }
  }
});

test('protected hard-break spaces on a blank Markdown line supply no quoted words', () => {
  for (const input of ['markdown', 'frontmatter']) {
    for (const eol of ['\n', '\r\n', '\r']) {
      for (const [padding, written] of [
        ['  ', '  '],
        ['    ', '    '],
        ['\t  ', '   '],
        ['\t', ' ']
      ]) {
        for (const bridge of ['', '<br><!-- помета -->']) {
          const source = `Абзац. »${bridge}${eol}${padding}${eol}"Город".`;
          const expected = `Абзац. "${bridge}${eol}${written}${eol}«Город».`;
          assert.equal(microtypo(source, { input }), expected);
          assert.equal(microtypo(expected, { input }), expected);
        }
      }
      const expected = `Автор: «Ветер  ${eol}стих».`;
      assert.equal(microtypo(`Автор: "Ветер  ${eol}стих".`, { input }), expected);
    }
  }
});

test('a mixed first quotation gives the next complete title its own opening', () => {
  for (const [first, canonical] of [
    ['"Лес»', '«Лес»'],
    ['"»', '«»'],
    ['"”', '«»'],
    ['"Справочник «Лес» целиком»', '«Справочник „Лес“ целиком»']
  ]) {
    for (const title of ['Река', '27', 'd’Artagnan', "'Лес'", '‘Лес’']) {
      const expected = `Редактор записал ${canonical}«${title}».`;
      assert.equal(microtypo(`Редактор записал ${first}"${title}".`), expected);
      assert.equal(microtypo(expected), expected);
    }
  }
  const outside = `Редактор записал «Лес»"' зимой дом"1733.`;
  assert.equal(microtypo(outside), outside);
});

test('a mixed title ends before its sibling even with a later inch sign', () => {
  for (const [source, expected] of [
    ['Названия "”"Река" и ширина 15".', 'Названия «»«Река» и ширина 15″.'],
    ['Названия "Лес»"Река" и ширина 15".', 'Названия «Лес»«Река» и ширина 15″.'],
    ['Названия “Сад "Лес»”"Река".', 'Названия «Сад „Лес“»«Река».'],
    [`Названия «Море»"Лес""' рядом дом"1733.`, `Названия «Море»«Лес»"' рядом дом"1733.`]
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('siblings of a mixed title respect source boundaries, protected content and disabled rules', () => {
  for (const [config, source, expected] of [
    [{ input: 'markdown' }, '"Лес»"`x--y`".', '«Лес»«`x--y`».'],
    [
      { input: 'markdown' },
      '"Лес»"https://example.org/Карты".',
      '«Лес»«https://example.org/Карты».'
    ],
    [{ input: 'markdown' }, '"Лес»"\n\nРека".', '«Лес»"\n\nРека".'],
    [{ input: 'xml' }, '<p>"Лес»<em>"Река"</em>.</p>', '<p>«Лес»<em>«Река»</em>.</p>'],
    [{ input: 'xml' }, '<p>"Лес»&quot;Река&quot;.</p>', '<p>«Лес»&quot;Река&quot;.</p>'],
    [{ input: { format: 'text', placeholders: 'icu' } }, 'Название "»"{n}".', 'Название «»«{n}».'],
    [{ rules: { 'quote.open': false } }, 'Названия "Лес»"Река".', 'Названия "Лес""Река".'],
    [{ rules: { 'quote.close': false } }, 'Названия "Лес»"Река".', 'Названия «Лес»«Река".'],
    [{ rules: { 'quote.*': false } }, 'Названия "Лес»"Река".', 'Названия "Лес»"Река".']
  ]) {
    const engine = new MicroTypo(config);
    assert.equal(engine.process(source), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('a mixed sibling cannot take the endpoint of an enclosing directional quotation', () => {
  for (const [source, expected] of [
    ['Серия: “Книга "Лес»"Река” завершена.', 'Серия: «Книга „Лес“"Река» завершена.'],
    ['Серия: “Книга «Лес»"Река" завершена”.', 'Серия: «Книга „Лес“„Река“ завершена».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a directional first title can close at a typed mark before a complete second title', () => {
  for (const [source, expected] of [
    ['Альбомы: „Книга"“Парк”.', 'Альбомы: «Книга»«Парк».'],
    ['Альбомы: "Книга"“Парк".', 'Альбомы: «Книга»«Парк».'],
    ['Альбомы: „Экран 15"“"Парк".', 'Альбомы: «Экран 15″»«Парк».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('two unclaimed typed marks before a complete title are one empty title', () => {
  for (const [source, expected] of [
    ['Поля: """Июль".', 'Поля: «»«Июль».'],
    ['""""', '«««»'],
    ['Поля: ""«Июль».', 'Поля: «»«Июль».'],
    ['Поля: ""„Июль“.', 'Поля: «»«Июль».'],
    [`Поля: """О'Коннор".`, `Поля: «»«О'Коннор».`],
    ['Поля: """27".', 'Поля: «»«27».'],
    ['Поля: ""«»"Июль".', 'Поля: «»«»«Июль».'],
    ['Поля: """Река" сегодня" далее".', 'Поля: «„„Река“ сегодня“ далее».'],
    ['Поля: "Сосна «»""Ясень".', 'Поля: «Сосна „“»«Ясень».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('an empty value keeps its closing mark before a title on the next line', () => {
  for (const [input, gap] of [
    ['text', '\n'],
    ['markdown', '\n  '],
    ['html', '<br>'],
    ['html', '\n<em></em>']
  ]) {
    const engine = new MicroTypo({ input });
    const expected = `Поля: «»${gap}«Июль».`;
    assert.equal(engine.process(`Поля: ""${gap}"Июль".`), expected);
    assert.equal(engine.process(expected), expected);
  }
  for (const [source, expected] of [
    ['Поля: "\nИюль".', 'Поля: «\nИюль».'],
    ['Поля: ""\nКнига" рядом".', 'Поля: «„\nКнига“ рядом».'],
    ['Поля: "Глава\n"Июль" конец".', 'Поля: «Глава\n„Июль“ конец».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('an independently closed empty title can also stand second', () => {
  for (const empty of ['«»', '„“', '“”', '""', '"“', '„"']) {
    const expected = 'Альбомы: «Лес»«».';
    assert.equal(microtypo(`Альбомы: «Лес»${empty}.`), expected);
    assert.equal(microtypo(expected), expected);
  }
  for (const [source, expected] of [
    ['Альбомы: «»"Книга“.', 'Альбомы: «»«Книга».'],
    ['Альбомы: «Парк»"Книга“.', 'Альбомы: «Парк»«Книга».'],
    ['Альбомы: "Парк“"Книга“.', 'Альбомы: «Парк»«Книга».'],
    ['Альбомы: „Лес"“”.', 'Альбомы: «Лес»«».'],
    ['Альбомы: „Лес""“.', 'Альбомы: «Лес„“».'],
    ['Альбомы: „Экран 15""“.', 'Альбомы: «Экран 15″»".'],
    ['Альбомы: "27""".', 'Альбомы: «27″»".'],
    ['Альбомы: «Сосна «Лес»""».', 'Альбомы: «Сосна „Лес“„“».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a dash can end an expression or introduce a quoted title', () => {
  for (const [input, expected] of [
    ['Строка "обозначение —".', 'Строка «обозначение —».'],
    ['Строка "обозначение —", затем число.', 'Строка «обозначение —», затем число.'],
    ['Строка "обозначение —"…', 'Строка «обозначение —»…'],
    ['—"Город" назван первым.', '—«Город» назван первым.'],
    ['—"?" поставили рядом.', '—«?» поставили рядом.'],
    ['—".NET" указан первым.', '—«.NET» указан первым.'],
    ['—"? Заголовок" появился весной.', '—«? Заголовок» появился весной.'],
    ['Автор сказал: "Вот —"? Пояснения" рядом".', 'Автор сказал: «Вот —„? Пояснения“ рядом».'],
    ['Автор сказал: "Вот —" Пояснения" рядом".', 'Автор сказал: «Вот —„Пояснения“ рядом».']
  ]) {
    assert.equal(microtypo(input), expected);
    assert.equal(microtypo(expected), expected);
  }
  const json = new MicroTypo({ input: 'json' });
  assert.equal(
    json.process(JSON.stringify({ title: 'Строка "обозначение &#8212;".' })),
    JSON.stringify({ title: 'Строка «обозначение —».' })
  );
});

test('unowned marks after a complete title keep one canonical spelling', () => {
  for (const [source, expected] of [
    ['Поля: «Север»"».', 'Поля: «Север»«».'],
    ['Поля: "Север"”".', 'Поля: «Север»«».'],
    ['Поля: «Лес»"«”".', 'Поля: «Лес»«„“».'],
    ['Поля: «Лес»"«”""Книга".', 'Поля: «Лес»«„“»«Книга».'],
    ['Поля: «Лес»«»""«Книга».', 'Поля: «Лес»«»«»«Книга».'],
    ['Поля: «»"" рядом.', 'Поля: «»"" рядом.'],
    ['Поля: „Север“”“.', 'Поля: «Север»«».'],
    ['Поля: «Север»””” рядом.', 'Поля: «Север»«»" рядом.'],
    ['Поля: «Север»"""" рядом.', 'Поля: «Север»«»«» рядом.'],
    ['Поля: «Север»""Книга.', 'Поля: «Север»""Книга.'],
    ['Поля: «Север»"""Книга.', 'Поля: «Север»«»"Книга.'],
    ['Поля: «Север»""Книга".', 'Поля: «Север»"«Книга».'],
    ['Поля: «Север»””"Книга".', 'Поля: «Север»«»«Книга».'],
    ['Поля: «27»"".', 'Поля: «27»«».'],
    ['Поля: "27""".', 'Поля: «27″»".']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('the indexed depth walk gives each residual run the same owner as the short walk', () => {
  const source = 'Названия «Лес»””"Река". Экран 27".';
  const expected = 'Названия «Лес»«»«Река». Экран 27″.';
  for (const n of [1, 32]) {
    const input = Array(n).fill(source).join(' ');
    const want = Array(n).fill(expected).join(' ');
    assert.equal(microtypo(input), want);
    assert.equal(microtypo(want), want);
  }
});

test('resolving a quote run respects XML reference spellings and the rights of each rule', () => {
  const xml = new MicroTypo({ input: 'xml' });
  for (const [source, expected] of [
    ['<p>«Лес»"».</p>', '<p>«Лес»«».</p>'],
    ['<p>«Лес»"&#187;.</p>', '<p>«Лес»"&#187;.</p>'],
    ['<p>&#171;Лес&#187;"».</p>', '<p>&#171;Лес&#187;"".</p>'],
    ['<p>«Лес»&quot;&raquo;.</p>', '<p>«Лес»&quot;&raquo;.</p>']
  ]) {
    assert.equal(xml.process(source), expected);
    assert.equal(xml.process(expected), expected);
  }
  for (const id of ['quote.open', 'quote.close']) {
    const engine = new MicroTypo({ rules: { [id]: false } });
    const expected = 'Поля: «Север»"".';
    assert.equal(engine.process('Поля: «Север»"».'), expected);
    assert.equal(engine.process(expected), expected);
  }
});

test('an empty value between inner titles preserves the outer directional pair', () => {
  for (const [source, expected] of [
    ['Она уточнила: «Поля „Маяк“”"„Юг“».', 'Она уточнила: «Поля „Маяк“„“„Юг“».'],
    ['Она уточнила: «Поля „Маяк“”" остались».', 'Она уточнила: «Поля „Маяк“„“ остались».'],
    ['Она уточнила: «Поля „Экран 15″“”"„Юг“».', 'Она уточнила: «Поля „Экран 15″“„“„Юг“».'],
    ['Она уточнила: «Поля „Маяк“”"<em>„Юг“</em>».', 'Она уточнила: «Поля „Маяк“„“<em>„Юг“</em>».'],
    ['Она уточнила: «Поля „Маяк“"»„Юг“».', 'Она уточнила: «Поля „Маяк“„“„Юг“».'],
    ['Она уточнила: «Поля „Маяк“"»„Юг“„Запад“».', 'Она уточнила: «Поля „Маяк“„“„Юг“„Запад“».'],
    ['Она уточнила: «Поля „Маяк“"»„Юг“.', 'Она уточнила: «Поля „Маяк“»"«Юг».'],
    ['Она уточнила: «Поля „Маяк“»«Юг».', 'Она уточнила: «Поля „Маяк“»«Юг».']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a completed title can be followed by a second word with its own closing mark', () => {
  for (const [source, expected] of [
    ['Книги: «Маяк“"Юг».', 'Книги: «Маяк»«Юг».'],
    ['Книги: “Маяк""Юг”.', 'Книги: «Маяк»«Юг».'],
    ['Книги: "Маяк"”О’Нил".', 'Книги: «Маяк»«О’Нил».'],
    ['Книги: “?“"Юг".', 'Книги: «?»«Юг».'],
    ['Поля: &#x22; Маяк""Южный берег".', 'Поля: «Маяк»«Южный берег».'],
    ['Поля: „“"Новый «Юг”".', 'Поля: «»«Новый „Юг“».'],
    ['Поля: "Список " Маяк""Юг»".', 'Поля: «Список „Маяк“„Юг“».'],
    ['Поля: «Маяк„“Юг».', 'Поля: «Маяк„“Юг».'],
    ['Поля: «Площадь 27""Южный вход».', 'Поля: «Площадь 27″"Южный вход».'],
    ['Поля: «Маяк»"ушёл «Юг» рядом.', 'Поля: «Маяк»"ушёл «Юг» рядом.']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('matching source marks can finish two adjacent titles at any visible content boundary', () => {
  for (const form of [(title) => `Книги: «Лес“"${title}».`, (title) => `Книги: “Лес""${title}”.`]) {
    for (const [input, content] of [
      ['Экран 15″', 'Экран 15″'],
      ['Широта 30′', 'Широта 30′'],
      ['Серия #', 'Серия #'],
      ['Скидка 15%', 'Скидка 15%'],
      ['Том 27', 'Том 27'],
      ['Хит № 1', 'Хит № 1'],
      ['Счёт 7:2', 'Счёт 7:2'],
      ['(Не)везение', '(Не)везение'],
      ['#Форум', '#Форум'],
      ['…и снова', '…и снова'],
      ['«Юг» зовёт', '„Юг“ зовёт'],
      ['<em>Маяк</em>', '<em>Маяк</em>']
    ]) {
      const expected = `Книги: «Лес»«${content}».`;
      assert.equal(microtypo(form(input)), expected);
      assert.equal(microtypo(expected), expected);
    }
  }
  for (const [input, expected] of [
    ['Экран 27" и диагональ 15".', 'Экран 27″ и диагональ 15″.'],
    ['Книги: «Лес“"Том 27»2026.', 'Книги: «Лес»"Том 27″2026.'],
    ['Книги: «Лес“"Том 27', 'Книги: «Лес»"Том 27'],
    ['Книги: «Лес“"».', 'Книги: «Лес„“».']
  ]) {
    assert.equal(microtypo(input), expected);
  }
  const xml = new MicroTypo({ input: 'xml' });
  assert.equal(xml.process('<p>«Лес“"Экран 15&#8243;».</p>'), '<p>«Лес»«Экран 15&#8243;».</p>');
});

test('later straight marks keep their own roles after two completed titles', () => {
  for (const [quote, canonical] of [
    ['Книги: «Лес“"Том 27».', 'Книги: «Лес»«Том 27».'],
    ['Книги: “Лес""Том 27”.', 'Книги: «Лес»«Том 27».'],
    ['Книги: «Лес“"Экран 15″».', 'Книги: «Лес»«Экран 15″».'],
    ['Книги: “Лес""Экран 15″”.', 'Книги: «Лес»«Экран 15″».']
  ]) {
    for (const [before, after, expectedBefore, expectedAfter] of [
      ['', ' Диагональ экрана 15".', '', ' Диагональ экрана 15″.'],
      ['Диагональ 27". ', ' Затем «Юг».', 'Диагональ 27″. ', ' Затем «Юг».'],
      ['', ' Редактор выбрал "Маяк".', '', ' Редактор выбрал «Маяк».'],
      ['', ' В анкете: "".', '', ' В анкете: «».'],
      [
        'Она уточнила: «Поля „Маяк“"»„Юг“». ',
        ' В анкете: "". Диагональ 15".',
        'Она уточнила: «Поля „Маяк“„“„Юг“». ',
        ' В анкете: «». Диагональ 15″.'
      ]
    ]) {
      const expected = expectedBefore + canonical + expectedAfter;
      assert.equal(microtypo(before + quote + after), expected);
      assert.equal(microtypo(expected), expected);
    }
  }
  for (const [input, expected] of [
    [
      'Она уточнила: «Поля „Маяк“"»„Юг“». Диагональ экрана 15".',
      'Она уточнила: «Поля „Маяк“„“„Юг“». Диагональ экрана 15″.'
    ],
    ['Она уточнила: «Поля „Маяк“""„Юг“ остались».', 'Она уточнила: «Поля „Маяк“„“„Юг“ остались».']
  ]) {
    assert.equal(microtypo(input), expected);
    assert.equal(microtypo(expected), expected);
  }
  assert.equal(
    microtypo('Книги: «Лес“"Том 27»2026. Диагональ экрана 15".'),
    'Книги: «Лес»"Том 27″2026. Диагональ экрана 15″.'
  );
});

test('an empty value between inner titles stays inside its authored speech', () => {
  for (const [before, after, expectedBefore, expectedAfter] of [
    ['', ', поле: "".', '', ', поле: «».'],
    ['Поле: "". ', '. Затем поле: "".', 'Поле: «». ', '. Затем поле: «».'],
    ['Ширина 17". ', '. Экран 26". Поле: "".', 'Ширина 17″. ', '. Экран 26″. Поле: «».']
  ]) {
    for (const [format, title] of [
      ['text', 'Север'],
      ['html', '<em>Север</em>'],
      ['markdown', '*Север*']
    ]) {
      const engine = new MicroTypo({ input: format });
      const source = `${before}Редактор пояснил: «Полки „${title}“""„Запад“ опустели»${after}`;
      const expected = `${expectedBefore}Редактор пояснил: «Полки „${title}“„“„Запад“ опустели»${expectedAfter}`;
      assert.equal(engine.process(source), expected);
      assert.equal(engine.process(expected), expected);
    }
  }
});

test('a German empty pair inside an English quotation leaves its closer to the outer speech', () => {
  for (const [source, expected] of [
    [
      'Редактор пояснил: “Полки „Север“„“„Запад“ опустели”. Экран 17".',
      'Редактор пояснил: «Полки „Север“„“„Запад“ опустели». Экран 17″.'
    ],
    ['Редактор пояснил: “Полки „“ пустуют”.', 'Редактор пояснил: «Полки „“ пустуют».'],
    [
      'Редактор пояснил: “Вывеска „“Север” в порту“ готова”.',
      'Редактор пояснил: «Вывеска „„Север“ в порту“ готова».'
    ]
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('an English quotation inside a German one can begin with a complete empty quotation', () => {
  const expected = 'Редактор пояснил: «Надпись „„“ означает пропуск“ исчезла».';
  for (const empty of ['«»', '„“', '“”']) {
    assert.equal(
      microtypo(`Редактор пояснил: „Надпись “${empty} означает пропуск” исчезла“.`),
      expected
    );
  }
  assert.equal(microtypo(expected), expected);
  for (const [source, result] of [
    [
      'Редактор сказал: „Лес“«». Потом он сказал “ОК”.',
      'Редактор сказал: «Лес»«». Потом он сказал «ОК».'
    ],
    [
      'Редактор отметил: „Север “«». Затем поле: „Юг“.',
      'Редактор отметил: «Север»«». Затем поле: «Юг».'
    ],
    ['Редактор пояснил: “«» означает пропуск”.', 'Редактор пояснил: «„“ означает пропуск».']
  ]) {
    assert.equal(microtypo(source), result);
    assert.equal(microtypo(result), result);
  }
});

test('complete authored speech retains its parent and the space after its children', () => {
  for (const child of ['“Лес”', '«Лес»', '„Лес“', '"Лес"']) {
    const source = `Редактор пишет: “Пометки „“” и ${child}“ записано”.`;
    const expected = 'Редактор пишет: «Пометки „„“ и „Лес““ записано».';
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
    assert.equal(microtypo(source, { rules: { 'quote.inch': false } }), expected);
  }
  for (const [source, expected] of [
    ['Записи: “Пометки "„“", затем "Юг" готовы”.', 'Записи: «Пометки „„““, затем „Юг“ готовы».'],
    ['Размер 27“„“” и каталог.', 'Размер 27″««» и каталог.']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
  const xml = new MicroTypo({ input: 'xml' });
  const expected = '<p>Редактор пишет: «Пометки „„“ и &quot;Лес&quot;“ записано».</p>';
  assert.equal(
    xml.process('<p>Редактор пишет: “Пометки „“” и &quot;Лес&quot;“ записано”.</p>'),
    expected
  );
  assert.equal(xml.process(expected), expected);
});

test('a digit in a completed speech can own an inch while a numbered title keeps its closer', () => {
  for (const unit of ['"', '“', '”', '»', '″']) {
    const source = `Анна пишет: “Читаю „“”, Рама 27${unit} готова, “Лес” исчезло“ сегодня”.`;
    const expected = 'Анна пишет: «Читаю „„“, Рама 27″ готова, „Лес“ исчезло“ сегодня».';
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
  for (const [source, expected] of [
    [
      'Катя пишет: «Строка „„Зал 7“, “Том 27”, рама 27” готова“ нужна».',
      'Катя пишет: «Строка „„Зал 7“, „Том 27“, рама 27″ готова“ нужна».'
    ],
    [
      'Катя пишет: „Читаю ""Лес" затем "Рама 27“"" сегодня“.',
      'Катя пишет: «Читаю „„Лес“ затем „Рама 27″““ сегодня».'
    ],
    [
      'Катя пишет: «Строка ""Размер 7""Размер 27"" нужна».',
      'Катя пишет: «Строка „„Размер 7“„Размер 27““ нужна».'
    ]
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
  const html = new MicroTypo({ input: 'html', html: false });
  const plain = 'Анна пишет: “Читаю „“”, рама <em>27"</em> готова, “Лес” исчезло“ сегодня”.';
  const result = 'Анна пишет: «Читаю „„“, рама <em>27″</em> готова, „Лес“ исчезло“ сегодня».';
  assert.equal(html.process(plain), result);
  assert.equal(html.process(result), result);
  assert.ok(!microtypo(plain, { rules: { 'quote.inch': false } }).includes('″'));
});

test('a later empty field does not turn the year closing a nested title into an inch', () => {
  const empty = ['В поле "" указано значение.', 'В поле «» указано значение.'];
  const titles = [
    [
      'Библиограф: "Найдена "История «Москвы» за 1946» в переплёте".',
      'Библиограф: «Найдена „История „Москвы“ за 1946“ в переплёте».'
    ],
    [
      'Библиограф: "Найдена "История «Москвы», том 3» в переплёте".',
      'Библиограф: «Найдена „История „Москвы“, том 3“ в переплёте».'
    ],
    [
      'Библиограф: "Най­дена "История «Москвы» за 1946» в переплёте".',
      'Библиограф: «Най­дена „История „Москвы“ за 1946“ в переплёте».'
    ],
    [
      'Библиограф: "Найдена "История «Москвы» за 1946» и экран 15″".',
      'Библиограф: «Найдена „История „Москвы“ за 1946“ и экран 15″».'
    ],
    [
      'Библиограф: "Найден "Экран 15" за 1946 год" в переплёте".',
      'Библиограф: «Найден „Экран 15″ за 1946 год“ в переплёте».'
    ],
    [
      'Мастер: "Найдена "Рама 5′11" за 1946 год" в переплёте".',
      'Мастер: «Найдена „Рама 5′11″ за 1946 год“ в переплёте».'
    ]
  ];
  for (const [config, wrap, entity] of [
    [{}, (s) => s, false],
    [{ input: 'markdown' }, (s) => s, false],
    [{ input: 'html' }, (s) => `<p>${s}</p>`, false],
    [{ input: 'xml' }, (s) => `<p>${s}</p>`, false],
    [{ entities: true }, (s) => s, true]
  ]) {
    const engine = new MicroTypo(config);
    for (const [title, canonical] of titles) {
      for (const separator of [' ', '\n', '­', '\n\n']) {
        for (const [source, expected] of [
          [title + separator + empty[0], canonical + separator + empty[1]],
          [empty[0] + separator + title, empty[1] + separator + canonical]
        ]) {
          const result = engine.process(wrap(source));
          if (entity) {
            assert.equal(result, engine.process(expected));
          } else {
            assert.equal(result, engine.process(wrap(expected)));
            assert.ok(!/(?:1946|3)″/u.test(result), result);
          }
          assert.equal(engine.process(result), result);
        }
      }
      assert.equal(engine.process(wrap(title)), engine.process(wrap(canonical)));
    }
  }
  assert.equal(
    microtypo(`${titles[0][0]}\r\n${empty[0]}`),
    microtypo(`${titles[0][1]}\n${empty[1]}`)
  );
  for (const [source, canonical] of [
    [
      `${titles[0][0]}\n${empty[0]}`,
      'Библиограф: «Найдена «История «Москвы» за 1946» в переплёте».\nВ поле «» указано значение.'
    ],
    [`Мастер: "Рама 2′8 за 1946 год".\n${empty[0]}`, `Мастер: «Рама 2′8 за 1946 год».\n${empty[1]}`]
  ]) {
    const engine = new MicroTypo({ rules: { 'quote.nested': false } });
    const result = engine.process(source);
    assert.equal(result, engine.process(canonical));
    assert.ok(!result.includes('″'), result);
    assert.equal(engine.process(result), result);
  }
});

test('a kept no-break space reference after a touching mark reads as the space it spells', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const entities = new MicroTypo({ input: 'xml', entities: true, rules: { nobr: false } });
  for (const [raw, expected] of [
    ['Он сказал «да»" и ушёл".', 'Он сказал «да»" и ушёл".'],
    ['Он сказал "да"" и ушёл“.', 'Он сказал «да»" и ушёл".'],
    ['«Лес»" "', '«Лес»" "']
  ]) {
    for (const reference of ['&#160;', '&#xA0;']) {
      const source = `<doc><p>${raw.replace(' ', reference)}</p></doc>`;
      const result = xml.process(source);
      assert.equal(result, `<doc><p>${expected.replace(' ', reference)}</p></doc>`);
      assert.equal(xml.process(result), result);
      assert.equal(xml.process(`<doc><p>${raw}</p></doc>`), `<doc><p>${expected}</p></doc>`);
      const encoded = entities.process(source);
      assert.equal(entities.process(encoded), encoded);
      assert.ok(!encoded.includes('&#171;&#160;'), encoded);
    }
  }
  for (const [source, expected] of [
    ['Он сказал «да»"и ушёл".', 'Он сказал «да»«и ушёл».'],
    ['Он сказал «да»"&#1080; ушёл".', 'Он сказал «да»«&#1080; ушёл».'],
    ['Он сказал «да» "&#160;и ушёл".', 'Он сказал «да» «&#160;и ушёл».']
  ]) {
    const result = xml.process(`<doc><p>${source}</p></doc>`);
    assert.equal(result, `<doc><p>${expected}</p></doc>`);
    assert.equal(xml.process(result), result);
  }
});

test('a closing mark after a mixed title does not open a frame that turns a later number into an inch', () => {
  const plain = { rules: { nobr: false } };
  for (const [config, wrap] of [
    [plain, (s) => s],
    [{ ...plain, input: 'markdown' }, (s) => s],
    [{ ...plain, input: 'html' }, (s) => `<p>${s}</p>`],
    [{ ...plain, input: 'xml' }, (s) => `<p>${s}</p>`]
  ]) {
    const engine = new MicroTypo(config);
    for (const [source, expected] of [
      [
        'Он сказал "до «мы явились"", и «Лес» и 8 "малого" есть.',
        'Он сказал «до „мы явились“», и «Лес» и 8 «малого» есть.'
      ],
      [
        'Он сказал "до «мы \'явились\'"", и в НИИ «Лес» есть кодировка utf_8 "малого припасов" свою.',
        "Он сказал «до „мы 'явились'“», и в НИИ «Лес» есть кодировка utf_8 «малого припасов» свою."
      ],
      [
        'Он сказал "до «мы явились"", и «Лес» и рама 8" есть.',
        'Он сказал «до „мы явились“», и «Лес» и рама 8″ есть.'
      ],
      [
        'Он сказал "до «мы явились"", и «Лес», и рама 5′11" есть.',
        'Он сказал «до „мы явились“», и «Лес», и рама 5′11″ есть.'
      ],
      ['Он сказал: "Рама 8" у «Леса» стоит".', 'Он сказал: «Рама 8″ у „Леса“ стоит».']
    ]) {
      const result = engine.process(wrap(source));
      assert.equal(result.replaceAll(' ', ' '), wrap(expected));
      assert.equal(engine.process(result), result);
    }
  }
  const markdown = new MicroTypo({ ...plain, input: 'markdown' });
  const reference =
    'Он сказал "до «мы явились"", и в НИИ &#171;Лес&#187; есть utf_8 "малого" свою.';
  const result = markdown.process(reference);
  assert.equal(
    result.replaceAll(' ', ' '),
    'Он сказал «до „мы явились“», и в НИИ «Лес» есть utf_8 «малого» свою.'
  );
  assert.equal(markdown.process(result), result);
});

test('a mark between a number and a Latin word is not a unit inside a completed speech', () => {
  for (const [source, expected] of [
    ['Он сказал: ""Цена 96"USD"" и ушёл.', 'Он сказал: «„Цена 96"USD“» и ушёл.'],
    ['Он сказал: «„Цена 96"USD“».', 'Он сказал: «„Цена 96"USD“».'],
    ['Он сказал: «Цена 96"USD».', 'Он сказал: «Цена 96"USD».'],
    ['Он сказал: ""Цена 96" USD"".', 'Он сказал: «„Цена 96″ USD“».'],
    ['Он сказал: «„Цена 96" USD“».', 'Он сказал: «„Цена 96″ USD“».'],
    ['Он сказал: «„Цена 96"“».', 'Он сказал: «„Цена 96″“».'],
    [
      'Он сказал: ""Экран 15" новый"" и "стража" ушла.',
      'Он сказал: «„Экран 15″ новый“» и «стража» ушла.'
    ]
  ]) {
    const result = microtypo(source, { rules: { nobr: false } });
    assert.equal(result.replaceAll(' ', ' '), expected);
    assert.equal(microtypo(result, { rules: { nobr: false } }), result);
  }
  for (const config of [{ input: 'markdown' }, { input: 'html' }]) {
    const source = 'Но ""не кольчуги решит 96"USD"" "стража найдёшь пути" скрыта.';
    const engine = new MicroTypo({ ...config, rules: { nobr: false } });
    const result = engine.process(source);
    assert.equal(result, 'Но «„не кольчуги решит 96"USD“» «стража найдёшь пути» скрыта.');
    assert.equal(engine.process(result), result);
  }
});

test('a mark between a number and a Cyrillic word stays a unit inside a completed speech', () => {
  const rules = { nobr: false };
  for (const [source, expected] of [
    ['Он сказал: «„Экран 15"новый“».', 'Он сказал: «„Экран 15″новый“».'],
    ['Он сказал: «„Экран 15"новый“ и „Лес“».', 'Он сказал: «„Экран 15″новый“ и „Лес“».'],
    [
      'Отчёт: «Модель „Тайга“, экран 15"новый, „Лес“».',
      'Отчёт: «Модель „Тайга“, экран 15″новый, „Лес“».'
    ],
    ['Он сказал: «Экран 27"новый и „Лес“».', 'Он сказал: «Экран 27″новый и „Лес“».'],
    ['Он сказал: «„Рама 5′11"новая“».', 'Он сказал: «„Рама 5′11″новая“».'],
    ['Он сказал: «„Цена 96"USD“».', 'Он сказал: «„Цена 96"USD“».'],
    ['Экран 15"новый и всё.', 'Экран 15 «новый и всё.']
  ]) {
    const result = microtypo(source, { rules });
    assert.equal(result.replaceAll('\u{00A0}', ' '), expected);
    assert.equal(microtypo(result, { rules }), result);
  }
});

test('a directional closer finishes the typed opener before a touching nested quotation', () => {
  const rules = { nobr: false };
  const engine = new MicroTypo({ rules });
  for (const [source, expected] of [
    ['Он сказал л""«да»» и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    ['Он сказал л""«да» и «нет»» и ушёл.', 'Он сказал л"«„да“ и\u{00A0}„нет“» и ушёл.'],
    ['Он сказал л""„да“» и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    ['Он сказал л""“да”» и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    ['Он сказал л""«да»», а потом «нет».', 'Он сказал л"«„да“», а потом «нет».'],
    ['Он сказал л""«да»»', 'Он сказал л"«„да“»'],
    ['Цена 5""«да»» и всё.', `Цена 5${PRIME}«„да“» и всё.`]
  ]) {
    const result = engine.process(source);
    assert.equal(result, expected, source);
    assert.equal(engine.process(result), result, source);
    // The same quotation closed by a typed mark reads the same way.
    assert.equal(
      engine.process(
        `${source.slice(0, source.lastIndexOf('»'))}"${source.slice(source.lastIndexOf('»') + 1)}`
      ),
      expected,
      source
    );
  }
  for (const [config, source, expected] of [
    [{ input: 'markdown' }, 'Он сказал л""«да»» и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    [{ input: 'html' }, '<p>Он сказал л""«да»» и ушёл.</p>', '<p>Он сказал л"«„да“» и ушёл.</p>'],
    [
      { input: 'html', entities: true },
      '<p>Он сказал л""&laquo;да&raquo;&raquo; и ушёл.</p>',
      '<p>Он сказал л"&laquo;&bdquo;да&ldquo;&raquo; и ушёл.</p>'
    ],
    [
      { input: 'xml' },
      '<doc><p>Он сказал л""«да»» и ушёл.</p></doc>',
      '<doc><p>Он сказал л"«„да“» и ушёл.</p></doc>'
    ],
    [
      { rules: { 'quote.nested': false, ...rules } },
      'Он сказал л""«да»» и ушёл.',
      'Он сказал л"««да»» и ушёл.'
    ],
    // Kept references and a mark glued to the word with no second typed mark stay as they were.
    [
      { input: 'xml' },
      '<doc><p>Он сказал л""&#171;да&#187;&#187; и ушёл.</p></doc>',
      '<doc><p>Он сказал л""&#171;да&#187;&#187; и ушёл.</p></doc>'
    ],
    [{}, 'Он сказал л"«да»» и ушёл.', 'Он сказал л"«да»" и ушёл.'],
    [{}, 'Он сказал "«да» и нет» и ушёл.', 'Он сказал «„да“ и нет» и ушёл.']
  ]) {
    const typo = new MicroTypo({ rules, ...config });
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a typed mark closing the inner quotation leaves the touching outer pair its own closer', () => {
  const rules = { nobr: false };
  for (const [config, source, expected] of [
    [{}, 'Он сказал л"“«да"” и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    [{}, 'Он сказал л"“«да" и нет” и ушёл.', 'Он сказал л"«„да“ и нет» и ушёл.'],
    [{}, 'Цена 5"“«да"” и всё.', `Цена 5${PRIME}«„да“» и всё.`],
    [{ input: 'markdown' }, 'Он сказал л"“«да"” и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    [
      { input: 'html', entities: true },
      '<p>Он сказал л"&ldquo;&laquo;да"&rdquo; и ушёл.</p>',
      '<p>Он сказал л"&laquo;&bdquo;да&ldquo;&raquo; и ушёл.</p>'
    ],
    [
      { rules: { 'quote.nested': false, ...rules } },
      'Он сказал л"“«да"” и ушёл.',
      'Он сказал л"««да»» и ушёл.'
    ],
    // A typed closer of a guillemet does not finish an English pair nested in it.
    [{}, 'Он сказал «“ ”"\' и ушёл.', "Он сказал «» ««' и ушёл."]
  ]) {
    const typo = new MicroTypo({ rules, ...config });
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
  // Without the mark glued to the word, the same quotation has always read this way.
  const typo = new MicroTypo({ rules });
  assert.equal(typo.process('Он сказал “«да"” и ушёл.'), 'Он сказал «„да“» и ушёл.');
});

test('a touching nested quotation has one form for every spelling of its closers', () => {
  const typo = new MicroTypo({ rules: { nobr: false } });
  const match = { '«': '»', '„': '“', '“': '”' };
  const fits = (opener, closer) => opener === '"' || closer === '"' || match[opener] === closer;
  for (const lead of ['л', '?']) {
    for (const outer of ['"', '«', '„', '“']) {
      for (const inner of ['"', '«', '„', '“']) {
        for (const first of ['"', '»', '“', '”']) {
          for (const second of ['"', '»', '“', '”']) {
            const crossing = match[outer] === first && match[inner] === second;
            const marks = `${outer}${inner}${first}${second}`;
            // `„“` right after the opener is an empty quotation, as it is after a space.
            if (
              (!crossing && !(fits(outer, second) && fits(inner, first))) ||
              marks === '""""' ||
              `${outer}${inner}` === '„“'
            ) {
              continue;
            }
            const source = `Он сказал ${lead}"${outer}${inner}да${first}${second} и ушёл.`;
            const result = typo.process(source);
            assert.equal(result, `Он сказал ${lead}"«„да“» и ушёл.`, source);
            assert.equal(typo.process(result), result, source);
          }
        }
      }
    }
  }
});

test('a nested quotation right after a closed title nests in the opener touching it', () => {
  const typo = new MicroTypo({ rules: { nobr: false } });
  for (const [source, expected] of [
    ['Он "ы""«трех>y""', 'Он «ы»«„трех>y“»'],
    ['"з "я "ы""""«трех>y""', '«з „я „ы““»«„трех>y“»'],
    ['Он "ы""«трех>y"" да', 'Он «ы»«„трех>y“» да'],
    ['Он «ы»"«трех>y»"', 'Он «ы»«„трех>y“»'],
    // Without the sign inside the title, the same quotation has always read this way.
    ['Он "ы""«трех""', 'Он «ы»«„трех“»'],
    ['Он «ы»"«трех»" да', 'Он «ы»«„трех“» да']
  ]) {
    const result = typo.process(source);
    assert.equal(result.replaceAll('\u{00A0}', ' '), expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a touching run takes no typed closer the ordinary walk would not close with', () => {
  // A typed mark glued to the next word or number, or standing apart from the content, closes
  // nothing on the first pass, so the second pass does not give it to the outer opener either.
  for (const [config, source] of [
    [{}, '""а„у“" а"1'],
    [{}, '""а„у“" а"б'],
    [{ input: 'plain' }, '" «к "щегоам"» " p'],
    [{ input: 'html' }, '"„ы „с ом“» " ,'],
    [{ input: 'html', entities: 'on' }, '""й\'"𝟙"'],
    [{ input: 'frontmatter' }, '« "пот(c" " -']
  ]) {
    const typo = new MicroTypo(config);
    const result = typo.process(source);
    assert.equal(typo.process(result), result, source);
  }
  const typo = new MicroTypo({ rules: { nobr: false } });
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  for (const [engine, source, expected] of [
    // Two typed openers take their closers on the first pass, as directional ones do on the second.
    [
      xml,
      '<doc><note>""<![CDATA[]]>" м"</note></doc>',
      '<doc><note>«„<![CDATA[]]>“ м»</note></doc>'
    ],
    [xml, '<doc><p>""<?у"?>" р"</p></doc>', '<doc><p>«„<?у"?>“ р»</p></doc>'],
    [typo, '""Цена 96"USD""', '«„Цена 96"USD“»'],
    [typo, 'Он сказал л""«да"» и ушёл.', 'Он сказал л"«„да“» и ушёл.'],
    [typo, '""а„у“" а" и', '«„а„у““ а» и']
  ]) {
    const result = engine.process(source);
    assert.equal(result.replaceAll('\u{00A0}', ' '), expected, source);
    assert.equal(engine.process(result), result, source);
  }
});

test('a sign or a tag inside a title does not end the title after a closed one', () => {
  const text = new MicroTypo({ rules: { nobr: false } });
  const html = new MicroTypo({ input: 'html', rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [text, 'Он "ы""«трех>y"е"', 'Он «ы»«„трех>y“е»'],
    [text, 'Он «ы»"«трех>y»е"', 'Он «ы»«„трех>y“е»'],
    [text, 'Он "ы \'""кубок >"', "Он «ы '»«кубок >»"],
    [text, 'Он «ы \'""кубок >»', "Он «ы '»«кубок >»"],
    [html, '<p>"ы""«трех<b>y</b>"е"</p>', '<p>«ы»«„трех<b>y</b>“е»</p>'],
    [html, '<p>"ы""«трех<br>y"е"</p>', '<p>«ы»«„трех<br>y“е»</p>'],
    [html, '<p>"ы \'""кубок <i>x</i>"</p>', "<p>«ы '»«кубок <i>x</i>»</p>"],
    // Without the sign or the tag, the same titles have always read this way.
    [text, 'Он "ы""«трех y"е"', 'Он «ы»«„трех y“е»'],
    [text, 'Он "ы \'""кубок"', "Он «ы '»«кубок»"],
    [
      html,
      '<p>«Лес» "Том <b>27</b>" и "<i>Сад</i>"</p>',
      '<p>«Лес» «Том <b>27</b>» и «<i>Сад</i>»</p>'
    ]
  ]) {
    const result = typo.process(source);
    assert.equal(result.replaceAll('\u{00A0}', ' '), expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a touching nested quotation takes the closers of its pairs that cross or stand apart', () => {
  const typo = new MicroTypo({ rules: { nobr: false } });
  for (const [source, expected] of [
    ['Он л»“«с”» и ушёл.', 'Он л"«„с“» и ушёл.'],
    ['Тир-на"“«ф” и мир» услышал.', 'Тир-на"«„ф“ и мир» услышал.'],
    ['Тир-на"“«и" и мир» услышал.', 'Тир-на"«„и“ и мир» услышал.'],
    ['Тир-на""«проверке» рф" услышал.', 'Тир-на"«„проверке“ рф» услышал.'],
    ['Он «да»""х» и ушёл.', 'Он «да»"«х» и ушёл.'],
    ['«»""х»', '«»"«х»'],
    ['«»""х"', '«»"«х»'],
    // A typed pair that only a space separates is an empty quotation, not an inner one.
    ['Он сказал «“ ”"\' и ушёл.', "Он сказал «» ««' и ушёл."],
    ['Он сказал “«да”» и ушёл.', 'Он сказал «„да“» и ушёл.']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a touching run nests whatever the spelling of its closers', () => {
  const typo = new MicroTypo({ rules: { nobr: false } });
  for (const closers of ['"»', '”»', '“»', '"“', '””', '”“', '““', '»“', '“”', '“"']) {
    for (const openers of ['""', '"“', '““']) {
      const source = `Он сказал л${openers}«да${closers} и ушёл.`;
      const result = typo.process(source);
      assert.equal(result, 'Он сказал л"«„да“» и ушёл.', source);
      assert.equal(typo.process(result), result, source);
    }
  }
  // A high mark a straight one can close still reads as an empty quotation.
  for (const [source, expected] of [
    ['Книги: «Лес“"».', 'Книги: «Лес„“».'],
    ['Он сказал л"«да"“» и ушёл.', 'Он сказал л"«да„“» и ушёл.'],
    ['Он сказал л“"«да”» и ушёл.', 'Он сказал л«»«да»" и ушёл.'],
    ['Он сказал л“"«да“» и ушёл.', 'Он сказал л«»«да»" и ушёл.'],
    ['Он сказал ?""«Ь"." и ушёл.', 'Он сказал ?"«„Ь“.» и ушёл.'],
    // However long the punctuation between the closers is.
    ['Он ?""«Ь"...." и', 'Он ?"«„Ь“…» и'],
    ['Он сказал л""«да"?!.." и ушёл.', 'Он сказал л"«„да“?!..» и ушёл.'],
    ['Он сказал л""«да"!!!!" и ушёл.', 'Он сказал л"«„да“!!!» и ушёл.'],
    ['Он сказал л““да»," и ушёл.', 'Он сказал л«„да“,» и ушёл.'],
    // An opening mark closes nothing, an empty pair after a space included.
    ['««у «»', '««у «»'],
    ['"«дня уе ""', '««дня уе «»']
  ]) {
    assert.equal(typo.process(source), expected, source);
    assert.equal(typo.process(expected), expected, source);
  }
});

test('a mark or a node between the closers of a touching run keeps the nested pair', () => {
  const text = new MicroTypo({ rules: { nobr: false } });
  const xml = new MicroTypo({ input: 'xml' });
  const entities = new MicroTypo({ entities: true });
  for (const [typo, source, expected] of [
    [text, '""а»′"\'', "«„а“′»'"],
    [text, '""а»8′"\'', "«„а“8′»'"],
    [text, 'Он сказал ""а»′" и ушёл.', 'Он сказал «„а“′» и ушёл.'],
    [entities, '&#x22;"а»′&#x22;\'', "&laquo;&bdquo;а&ldquo;′&raquo;'"],
    [xml, '<doc><p>„«голнце"<![CDATA[]]>“</p></doc>', '<doc><p>«„голнце“<![CDATA[]]>»</p></doc>'],
    [
      xml,
      '<doc><section><p>""тягуне»<![CDATA[]]>"</p></section></doc>',
      '<doc><section><p>«„тягуне“<![CDATA[]]>»</p></section></doc>'
    ],
    [xml, '<doc><p>„«голнце"<?pi?>“</p></doc>', '<doc><p>«„голнце“<?pi?>»</p></doc>'],
    [xml, '<doc><p>„«голнце"<i/>“ и</p></doc>', '<doc><p>«„голнце“<i/>» и</p></doc>'],
    // A typed opener does not pass a closer for an inch a sentence later.
    [
      text,
      'Книги: «Лес“"Том 27»2026. Диагональ экрана 15".',
      'Книги: «Лес»"Том 27″2026. Диагональ экрана 15″.'
    ]
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a high mark opens the touching run that has both its closers, not ends the frame before it', () => {
  const text = new MicroTypo();
  const plain = new MicroTypo({ rules: { nobr: false } });
  const xml = new MicroTypo({ input: 'xml' });
  for (const [typo, source, expected] of [
    [text, '"а "о»",“«я"”', '«а „о“», «„я“»'],
    [
      xml,
      '<doc><item>""от</item><p>"а "о»",“«я"”</p></doc>',
      '<doc><item>««от</item><p>«а «о»», ««я»»</p></doc>'
    ],
    [
      xml,
      '<doc><item>""от"от ГБ"</item><p>"а "о»",“«я"”</p></doc>',
      '<doc><item>««от «от ГБ»</item><p>«а «о»», ««я»»</p></doc>'
    ],
    [
      xml,
      '<doc><item>""от</item><p>"а "о"",“«я"”</p></doc>',
      '<doc><item>««от</item><p>«а «о»», ««я»»</p></doc>'
    ],
    // Whatever closes the inner quotation before it.
    [
      xml,
      '<doc><item>""от</item><p>"а "о“",“«я"”</p></doc>',
      '<doc><item>««от</item><p>«а «о»», ««я»»</p></doc>'
    ],
    [
      xml,
      '<doc><item>"от</item><p>"а "о“",“"я""</p></doc>',
      '<doc><item>«от</item><p>«а «о»», ««я»»</p></doc>'
    ],
    [plain, 'Он ""от «а "о”",“"я"" и.', 'Он ««от «а «о»», ««я»» и.'],
    [plain, 'Он "от “а "о»",“"я"" и.', 'Он «от «а «о»», ««я»» и.'],
    [plain, 'Он "от "а "о"",“"я"" и.', 'Он «от «а «о»», ««я»» и.'],
    [plain, 'Он ""от "а "о"",“"я"" и.', 'Он ««от «а «о»», ««я»» и.'],
    [plain, 'Он сказал "“«да"" и ушёл.', 'Он сказал «««да»» и ушёл.'],
    [plain, 'Он сказал "“«да»..." и ушёл.', 'Он сказал «««да»…» и ушёл.'],
    // A run with one closer still ends the frame.
    [plain, 'Он "а“«б» и', 'Он «а»«б» и']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('the outer mark of a touching run standing apart closes it when no mark follows', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const html = new MicroTypo({ input: 'html', rules: { nobr: false } });
  const plain = new MicroTypo({ rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [xml, '<doc><p>""<![CDATA[]]>" щ " </p></doc>', '<doc><p>«„<![CDATA[]]>“ щ» </p></doc>'],
    [xml, '<doc><p>""<![CDATA[]]>" щ " и</p></doc>', '<doc><p>«„<![CDATA[]]>“ щ» и</p></doc>'],
    [xml, '<doc><p>""<?pi?>" щ " и</p></doc>', '<doc><p>«„<?pi?>“ щ» и</p></doc>'],
    [html, '<p>""<!---->" щ " и</p>', '<p>«„<!---->“ щ» и</p>'],
    // One that a later mark follows is left to that mark.
    [plain, 'Конец.» ""Нет" " да " (', 'Конец." «„Нет“ " да» (']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a straight quote right after a CDATA section, an instruction or a declaration closes', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const plain = new MicroTypo({ rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [xml, '<doc><p>" "у<![CDATA[]]>" т"</p></doc>', '<doc><p>«„у<![CDATA[]]>“ т»</p></doc>'],
    [xml, '<doc><p>" "<![CDATA[]]>" т"</p></doc>', '<doc><p>«„<![CDATA[]]>“ т»</p></doc>'],
    [xml, '<doc><p>« "<![CDATA[x]]>" т»</p></doc>', '<doc><p>«„<![CDATA[x]]>“ т»</p></doc>'],
    [xml, '<doc><p>" "<?pi?>" т"</p></doc>', '<doc><p>«„<?pi?>“ т»</p></doc>'],
    [xml, '<doc><p>"у<?pi x?>" т</p></doc>', '<doc><p>«у<?pi x?>» т</p></doc>'],
    [xml, '<doc><p>"а "<![CDATA[]]>" т"</p></doc>', '<doc><p>«а „<![CDATA[]]>“ т»</p></doc>'],
    [xml, '<doc><p>"<![CDATA[]]>" т</p></doc>', '<doc><p>«<![CDATA[]]>» т</p></doc>'],
    [plain, '"<!>" -', '«<!>» —']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('the first character of a quotation is no strong neighbour of the next quote, a « still is', () => {
  const plain = new MicroTypo({ rules: { nobr: false } });
  const markdown = new MicroTypo({ input: 'markdown', rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [plain, '">". " м', '«>». «м'],
    [plain, 'а ">"! " м', 'а «>»! «м'],
    [plain, '"-". " м', '«-». «м'],
    [markdown, '">". &#x22; м', '«>». «м'],
    [plain, '"«"и"»"', '«„„и““»'],
    [plain, 'Нажмите ">" и "да".', 'Нажмите «>» и «да».']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a comment parts an empty quotation from the title after it, as a CDATA section does', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const html = new MicroTypo({ input: 'html', rules: { nobr: false } });
  const plain = new MicroTypo({ rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [xml, '<doc><p>""<!-- c -->“ щ ” и</p></doc>', '<doc><p>«„<!-- c -->“ щ» и</p></doc>'],
    [xml, '<doc><p>"“<!-- c -->“ щ ” и</p></doc>', '<doc><p>«„<!-- c -->“ щ» и</p></doc>'],
    [html, '<p>«"<!-- c -->“ щ ” и</p>', '<p>«„<!-- c -->“ щ» и</p>'],
    [xml, '<doc><p>""<![CDATA[]]>“ щ ” и</p></doc>', '<doc><p>«„<![CDATA[]]>“ щ» и</p></doc>'],
    [plain, '""“ щ ” и', '«»«щ» и']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('a straight quote right after an empty element closes, after an open element it opens', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  for (const [source, expected] of [
    ['<doc><p>"а <fn/>" т</p></doc>', '<doc><p>«а <fn/>» т</p></doc>'],
    ['<doc><p>"а<fn n="1"/>" т</p></doc>', '<doc><p>«а<fn n="1"/>» т</p></doc>'],
    ['<doc><p>"<fn/>" т</p></doc>', '<doc><p>«<fn/>» т</p></doc>'],
    ['<doc><p>"а <b></b>" т</p></doc>', '<doc><p>«а <b></b>» т</p></doc>'],
    ['<doc><p>"а <b class="x"></b>" т</p></doc>', '<doc><p>«а <b class="x"></b>» т</p></doc>'],
    ['<doc><p>"а "в<b><i></i></b>" т"</p></doc>', '<doc><p>«а „в<b><i></i></b>“ т»</p></doc>'],
    ['<doc><p>а <b>"т"</b> в</p></doc>', '<doc><p>а <b>«т»</b> в</p></doc>'],
    ['<doc><p>"а <i>" т</i></p></doc>', '<doc><p>«а <i>" т</i></p></doc>']
  ]) {
    const result = xml.process(source);
    assert.equal(result, expected, source);
    assert.equal(xml.process(result), result, source);
  }
});

test('a block element name opens no paragraph in XML, an HTML block still does', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const html = new MicroTypo({ input: 'html', rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [xml, '<doc><p>Ответ "<br/>да" и.</p></doc>', '<doc><p>Ответ «<br/>да» и.</p></doc>'],
    [xml, '<doc><p>"а "<br/>б" в"</p></doc>', '<doc><p>«а „<br/>б“ в»</p></doc>'],
    [xml, '<doc><p>Ответ "<hr/>да" и.</p></doc>', '<doc><p>Ответ «<hr/>да» и.</p></doc>'],
    [html, '<p>Ответ "<br>да" и.</p>', '<p>Ответ «<br>да» и.</p>'],
    [html, '<p>Ответ "<hr>да" и.</p>', '<p>Ответ "<hr>да" и.</p>']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});

test('an outer opener with no closer of its own takes the one after the inner closer', () => {
  const xml = new MicroTypo({ input: 'xml', rules: { nobr: false } });
  const plain = new MicroTypo({ rules: { nobr: false } });
  for (const [typo, source, expected] of [
    [
      xml,
      '<doc><description>"«ы «я их»т"<![CDATA[]]>"</description></doc>',
      '<doc><description>«„ы „я их“т“<![CDATA[]]>»</description></doc>'
    ],
    [xml, '<doc><p>"«<![CDATA[]]>" щ"</p></doc>', '<doc><p>«„<![CDATA[]]>“ щ»</p></doc>'],
    [xml, '<doc><p>""<![CDATA[]]>“ щ"</p></doc>', '<doc><p>«„<![CDATA[]]>“ щ»</p></doc>'],
    [xml, '<doc><p>«"<?pi?>" щ " и</p></doc>', '<doc><p>«„<?pi?>“ щ» и</p></doc>'],
    [plain, 'Он сказал л""«да"—" и ушёл.', 'Он сказал л"«„да“—» и ушёл.']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
  // A high outer mark may close a frame instead, and the next pass reads it so.
  for (const source of [
    '<doc><description>""в</description><p>\'""т" л"</p></doc>',
    '<doc><p>"а "о“",“«я"”</p></doc>'
  ]) {
    const result = xml.process(source);
    assert.equal(xml.process(result), result, source);
  }
});

test('a typed mark closes after a closing bracket as after a closing parenthesis', () => {
  const text = new MicroTypo({ rules: { nobr: false } });
  const markdown = new MicroTypo({ input: 'markdown', entities: true });
  for (const [typo, source, expected] of [
    [text, 'Он "а]"&x ушёл.', 'Он «а]»&x ушёл.'],
    [text, 'Он "а)"&x ушёл.', 'Он «а)»&x ушёл.'],
    [text, '"«]"&4;леса"', '«„]“&4;леса»'],
    [text, '" "«]"&4;леса"', '«««]»&4;леса»'],
    [markdown, '" &#34;«]"&4;леса"', '&laquo;&laquo;&laquo;]&raquo;&4;леса&raquo;']
  ]) {
    const result = typo.process(source);
    assert.equal(result, expected, source);
    assert.equal(typo.process(result), result, source);
  }
});
