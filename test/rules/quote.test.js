import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';
import { PARAGRAPH_OPEN, PARAGRAPH_CLOSE } from '../../src/protect/placeholders.js';
import { processQuotes } from '../../src/rules/quote-state.js';

const BDQUO = '„';
const LDQUO = '“';
const PRIME = '″';

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

    assert.equal(microtypo(src), src);
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
    assert.ok(microtypo('«текст (c) ещё»', NOP).includes('©'));
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
