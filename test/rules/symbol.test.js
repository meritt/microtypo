import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NOP = { html: true, render: { paragraphs: false } };

describe('symbol glyphs fire', () => {
  test('(c) becomes ©', () => {
    assert.ok(microtypo('(c) 2024 Амбер', NOP).includes('©'));
  });

  test('(r) becomes ®', () => {
    assert.ok(microtypo('Грейсвандир(r) наш', NOP).includes('®'));
  });

  test('(tm) becomes ™', () => {
    assert.ok(microtypo('Козырь(tm) тут', NOP).includes('™'));
  });

  test('<- becomes a left arrow', () => {
    assert.ok(microtypo('Тень <- Амбер', NOP).includes('←'));
  });
});

describe('symbol.copyright — glued to a following letter or digit (REAL-2)', () => {
  test('converts (c) glued to a following letter or digit', () => {
    assert.equal(microtypo('(c)Амбер', NOP), '©Амбер');
    assert.equal(microtypo('(с)Оберон', NOP), '©Оберон'); // Cyrillic с
    assert.equal(microtypo('(c)2024', NOP), '©2024');
    assert.equal(microtypo('(c)9', NOP), '(c)9');
  });
});

describe('symbol.copyright — protected block spacing (EF1)', () => {
  test('keeps regular spaces around a protected block', () => {
    assert.equal(microtypo('Козырь © <pre>(c)</pre> © ©', NOP), 'Козырь © <pre>(c)</pre> © ©');
  });
});

describe('symbol.copyright — only the copyright mark', () => {
  test('(c) before a year or a capitalised word, or after Copyright, becomes ©', () => {
    for (const [src, want] of [
      ['Amber (c) 2024', `Amber ©${NBSP}2024`],
      ['(c) 2024 Амбер', `©${NBSP}2024 Амбер`],
      ['(c) Амбер', `©${NBSP}Амбер`],
      ['Copyright (c) Амбер', `Copyright ©${NBSP}Амбер`],
      ['copyright (c) amber', `copyright ©${NBSP}amber`],
      ['(c) <s>Амбер</s>', `©${NBSP}<s>Амбер</s>`]
    ]) {
      const once = microtypo(src);

      assert.equal(once, want);
      assert.equal(microtypo(once), once);
    }
  });

  test('(c) glued to a word, without a year or a name, or in an enumeration stays as typed', () => {
    for (const src of [
      'f(c)',
      'x(c) + y',
      'вариант (c)',
      '(a), (b), (c).',
      '(а) первый, (б) второй, (c) Третий',
      '(a) первый\n(b) второй\n(c) Третий'
    ]) {
      assert.equal(microtypo(src), src);
    }
    assert.equal(microtypo('см. п. (a) и (c)'), `см.${NBSP}п. (a) и (c)`);
  });

  test('a run of spaces before the year is one gap', () => {
    assert.equal(microtypo('(C)  1999'), `©${NBSP}1999`);
  });

  test('(c) glued to a Russian word stays glued and as typed', () => {
    for (const src of ['ь(c) 2009', 'слово(c) Амбер', '<b>f</b>(c) Амбер']) {
      assert.equal(microtypo(src), src);
    }
  });

  test('(c) glued to a word stays as typed once the word is wrapped', () => {
    const src = 'М.А.Да IP(C) Б';
    const once = microtypo(src, { html: true, input: 'html' });

    assert.ok(once.includes('IP</span>(C) Б'));
    assert.equal(microtypo(once, { html: true, input: 'html' }), once);
  });

  test('an enumeration in another paragraph does not hold the mark back', () => {
    assert.equal(microtypo('(a) первый\n\n(c) Амбер'), `(a) первый\n\n©${NBSP}Амбер`);
    assert.equal(
      microtypo('<p>(a) первый</p><p>(c) Амбер</p>', { input: 'html' }),
      `<p>(a) первый</p><p>©${NBSP}Амбер</p>`
    );
  });
});

describe('symbol.registered — only after a name', () => {
  test('(r) after a word of two letters or more with a capital becomes ®', () => {
    assert.equal(microtypo('Windows(R)'), 'Windows®');
    assert.equal(microtypo('Windows (R)'), 'Windows ®');
    assert.equal(microtypo('iPhone(R)'), 'iPhone®');
    assert.equal(microtypo('<b>Windows</b>(R)'), '<b>Windows</b>®');
    assert.equal(microtypo('Но  (R)'), 'Но ®');
  });

  test('a name glued to a number reads as a name on every run', () => {
    for (const [src, want] of [
      ['0DPI (r)', `0${NBSP}DPI ®`],
      ['6Гц(r)', '6Гц®']
    ]) {
      const once = microtypo(src);

      assert.equal(once, want);
      assert.equal(microtypo(once), once);
    }
  });

  test('(r) after a lowercase word, a single letter or nothing stays as typed', () => {
    for (const src of ['f(r)', 'sin(r)', 'радиус (r)', 'пункт (r)', 'пункты (a) и (r) договора']) {
      assert.equal(microtypo(src), src);
    }
  });

  test('(tm) is not restricted', () => {
    assert.equal(microtypo('Слово(tm)'), 'Слово™');
  });
});

describe('copyright toggle', () => {
  test('default converts (c) to ©', () => {
    assert.ok(microtypo('(c) 2026', NOP).includes('©'));
  });

  test('off leaves (c) untouched', () => {
    const out = microtypo('(c) 2026', { ...NOP, rules: { 'symbol.copyright': false } });
    assert.ok(out.includes('(c)'));
  });
});

describe('symbol.trademark — leading space preserved (G5)', () => {
  test('(tm) keeps the space before it', () => {
    assert.equal(microtypo('Амбер (tm) тут'), 'Амбер ™ тут');
  });

  test('(r) and (tm) in series each keep their space', () => {
    assert.equal(microtypo('Козырь (r) и (tm)'), 'Козырь ® и ™');
  });
});

describe('trademark toggle', () => {
  test('default converts (tm) to ™', () => {
    assert.ok(microtypo('Grayswandir(tm) ready', NOP).includes('™'));
  });

  test('off leaves (tm) untouched', () => {
    const out = microtypo('Grayswandir(tm) ready', {
      ...NOP,
      rules: { 'symbol.trademark': false }
    });
    assert.ok(out.includes('(tm)'));
    assert.ok(!out.includes('™'));
  });
});

describe('registered toggle', () => {
  test('default converts (r) to ®', () => {
    assert.ok(microtypo('Козырь(r) готов', NOP).includes('®'));
  });

  test('off leaves (r) untouched', () => {
    const out = microtypo('Козырь(r) готов', { ...NOP, rules: { 'symbol.registered': false } });
    assert.ok(out.includes('(r)'));
    assert.ok(!out.includes('®'));
  });
});

describe('arrows toggle', () => {
  test('default converts -> to →', () => {
    assert.ok(microtypo('Амбер -> Тень', NOP).includes('→'));
  });

  test('off leaves -> untouched', () => {
    const out = microtypo('Амбер -> Тень', { ...NOP, rules: { 'symbol.arrows': false } });
    assert.ok(out.includes('->'));
    assert.ok(!out.includes('→'));
  });
});

describe('apostrophe toggle', () => {
  test('default converts straight apostrophe to ’', () => {
    assert.ok(microtypo("Corwin's crown", NOP).includes('’'));
  });

  test('off leaves straight apostrophe untouched', () => {
    const out = microtypo("Corwin's crown", { ...NOP, rules: { 'symbol.apostrophe': false } });
    assert.ok(out.includes("'"));
    assert.ok(!out.includes('’'));
  });
});

describe('symbol.apostrophe — double apostrophe (GAP-A2)', () => {
  test("O''Really becomes O\u{2019}Really", () => {
    assert.equal(microtypo("O''Really", NOP), `O\u{2019}Really`);
  });

  test('single apostrophe still converts', () => {
    assert.equal(microtypo("O'Really", NOP), `O\u{2019}Really`);
  });
});

// Glyph normalization folds © to (c) before any rule runs, so the rule has to be total:
// a context it does not cover turns an author's © into a literal (c).
describe('symbol.copyright — © survives normalization', () => {
  const contexts = [
    'Хроники ©',
    'Хроники © Дворкин',
    'Хроники ©.',
    'Хроники ©Дворкин',
    'Хроники ©<b>Дворкин</b>',
    'Хроники (©) Дворкин',
    'Хроники ©; Дворкин',
    'Хроники ©: Дворкин',
    '<b>©</b> Амбер'
  ];

  for (const src of contexts) {
    test(`© kept in ${JSON.stringify(src)}`, () => {
      const out = microtypo(src, NOP);
      assert.ok(out.includes('©'), `© lost: ${out}`);
      assert.ok(!out.includes('(c)'), `residual ASCII form: ${out}`);
    });
  }

  test('&copy; decodes to © even where no spacing pattern applies', () => {
    assert.equal(microtypo('Хроники &copy;; Дворкин', NOP), 'Хроники ©; Дворкин');
  });
});

describe('symbol.registered — adjacency', () => {
  test('converts the mark after the name, and the one after it is not after a name', () => {
    assert.equal(microtypo('Печати (r)(r) на Козырях', NOP), `Печати ®(r) на${NBSP}Козырях`);
  });
});

describe('two-way arrows and comparisons stay as typed', () => {
  test('<->, <=> and <== are not half-converted', () => {
    for (const src of ['a <-> b', 'a <=> b', 'a <== b', 'a => b', 'a <--> b']) {
      assert.equal(microtypo(src), src);
    }
  });

  test('one-way arrows and comparisons still convert', () => {
    assert.equal(microtypo('a -> b'), 'a → b');
    assert.equal(microtypo('a <- b'), 'a ← b');
    assert.equal(microtypo('a <= b'), 'a ≤ b');
    assert.equal(microtypo('a >= b'), 'a ≥ b');
  });
});

describe('symbol.arrows — <-- half-mangle guard', () => {
  test('arrows: <-- is not half-converted to ←-', () => {
    assert.ok(!microtypo('Корвин <-- Эрик', NOP).includes('←'), 'must not arrow-ify <--');
    assert.ok(microtypo('Корвин <- Эрик', NOP).includes('←'), 'real <- still converts');
  });
});

describe('fahrenheit toggle', () => {
  test('default converts 100F to 100 °F', () => {
    assert.ok(microtypo('100F в Тени', NOP).includes('°'));
  });

  test('off leaves 100F untouched', () => {
    const out = microtypo('100F в Тени', { ...NOP, rules: { 'symbol.fahrenheit': false } });
    assert.ok(out.includes('100F'));
    assert.ok(!out.includes('°'));
  });

  // `symbol.apostrophe` is the only way back from ASCII and fires only between letters, so a folded
  // `‘…’` pair would come out as two straight quotes.
  describe('single curly quotes are their own canonical form', () => {
    test('an authored pair survives in every spelling', () => {
      assert.equal(microtypo('Дворкин ‘Амбер’ вечен'), 'Дворкин ‘Амбер’ вечен');
      assert.equal(microtypo('Дворкин &lsquo;Амбер&rsquo; вечен'), 'Дворкин ‘Амбер’ вечен');
      assert.equal(microtypo('Дворкин &#8216;Амбер&#8217; вечен'), 'Дворкин ‘Амбер’ вечен');
    });

    test('the apostrophe rule still promotes a straight quote between letters', () => {
      assert.equal(microtypo("Corwin's Pattern"), 'Corwin’s Pattern');
      assert.equal(microtypo('Corwin’s Pattern'), 'Corwin’s Pattern');
    });

    test('entity mode emits both back', () => {
      assert.equal(
        microtypo('Дворкин ‘Амбер’ вечен', { entities: true }),
        'Дворкин &lsquo;Амбер&rsquo; вечен'
      );
    });
  });
});
