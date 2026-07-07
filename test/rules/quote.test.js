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

  // A straight quote glued to a tag is opener/closer-ambiguous; we keep the closing case, leaving a padded opener straight.
  test('opening quote glued to a tag with padding is left straight (documented limitation)', () => {
    assert.equal(microtypo('<b>" слово"</b>', NOP), '<b>" слово"</b>');
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

describe('XTEST-8 — comma before a straight quote must not flip a closer to opener', () => {
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

describe('quote-padded-straight-multiphrase — accepted limitation (R7)', () => {
  // With two padded phrases, the first closer is misread as an opener and glues to the next word.
  test('two padded phrases: first closer misread as opener, glues to next word', () => {
    assert.equal(microtypo('" Порядок " и " Хаос "'), '«Порядок «и «Хаос»');
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
  // `\"` is ambiguous (escaped quote vs path separator + closer); the close rule keeps the backslash only after a preceding backslash-word run.
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

describe('TASK-5.5 — pre-existing single curly quotes fold symmetric', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  // Both single curly quotes canonicalize to straight `'` before any rule runs.
  test('single curly quotes nested in a double-quoted span both fold straight', () => {
    assert.equal(microtypo('"‘22’"', NOP), "«'22'»");
  });

  test('matches the existing straight-single-quote baseline (never promoted to „…“)', () => {
    assert.equal(microtypo('"a \'b\' c"', NOP), microtypo('"a ‘b’ c"', NOP));
  });

  test('non-regression: apostrophe rule still converts straight and pre-curled forms', () => {
    assert.equal(microtypo("Corwin's crown", NOP), 'Corwin’s crown');
    assert.equal(microtypo('Corwin’s crown', NOP), 'Corwin’s crown');
  });

  test('&lsquo; entity folds the same way as the ‘ glyph', () => {
    assert.equal(microtypo('&lsquo;Амбер&rsquo;', NOP), microtypo('‘Амбер’', NOP));
  });
});
