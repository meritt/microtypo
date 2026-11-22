import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

// Idempotent only for inputs the engine fully owns, never for already-emitted HTML — an `<a>` or a
// `<span>` re-processes on a second pass.

describe('per-group idempotency — one group enabled at a time', () => {
  const GROUPS = [
    'quote',
    'dash',
    'symbol',
    'punctuation',
    'number',
    'space',
    'abbr',
    'nobr',
    'date',
    'hanging',
    'other',
    'text'
  ];

  for (const group of GROUPS) {
    test(`idempotent per group: only ${group}`, () => {
      const rules = Object.fromEntries(GROUPS.map((g) => [`${g}.*`, g === group]));
      const typo = new MicroTypo({ rules });

      const sample = 'Клинок "Грейсвандир" -- цена 1000 рублей, ГОСТ 8.417.';
      const once = typo.process(sample);
      const twice = typo.process(once);

      assert.equal(
        twice,
        once,
        `Group ${group} not idempotent:\n  once:  ${once}\n  twice: ${twice}`
      );
    });
  }
});

describe('whole-pipeline idempotency on short canonical inputs', () => {
  const CANONICAL_SAMPLES = [
    'Клинок "Грейсвандир" -- цена 1000 рублей.',
    'Тень до 31 июля.',
    'Привет "Амбер" — раз.',
    'EXAMPLE.COM — король Амбера Оберон и принц Корвин',
    '«Козырь» — карта',
    '5-10 Козырей',
    // Adjacent and degenerate angle-quote pairs convert fully and round-trip, leaving no stray
    // straight quotes.
    '«Корвин» — «Эрик»',
    '«Амбер» «Арден»'
    // A `7 °C`-style temperature is not idempotent: the nobr group re-positions the NBSP on a second
    // pass.
  ];

  for (const sample of CANONICAL_SAMPLES) {
    test(`idempotent: ${JSON.stringify(sample.slice(0, 30))}`, () => {
      const typo = new MicroTypo();
      const once = typo.process(sample);
      const twice = typo.process(once);
      assert.equal(twice, once);
    });
  }

  test('idempotent: emphatic particle binds forward (default config)', () => {
    const typo = new MicroTypo();
    const once = typo.process('Поди кась в Арден');
    assert.equal(typo.process(once), once);
  });

  // `abbr.nowrap_era` is likewise not idempotent on already-emitted HTML: reprocessing the emitted
  // nowrap span nests a second one.
});

describe('idempotency under a few preset combinations', () => {
  const PRESET_CONFIGS = [
    { name: 'entities:true', cfg: { entities: true } },
    { name: 'paragraphs:false', cfg: { render: { paragraphs: false } } },
    { name: 'autolink:false', cfg: { render: { autolink: false } } },
    {
      name: 'hanging rules enabled',
      cfg: { rules: { 'hanging.quote': true, 'hanging.bracket': true } }
    },
    { name: 'quote.nested:false', cfg: { rules: { 'quote.nested': false } } }
  ];

  const PRESET_SAMPLE = 'Клинок "Грейсвандир" -- цена 1000 рублей, до 31 июля.';

  for (const { name, cfg } of PRESET_CONFIGS) {
    test(`idempotent under ${name}`, () => {
      const typo = new MicroTypo(cfg);
      const once = typo.process(PRESET_SAMPLE);
      const twice = typo.process(once);
      assert.equal(twice, once);
    });
  }
});

describe('edge inputs — empty / pure punctuation / pure whitespace', () => {
  test('idempotent: empty string', () => {
    const typo = new MicroTypo();
    assert.equal(typo.process(typo.process('')), typo.process(''));
  });

  test('idempotent: pure whitespace', () => {
    const typo = new MicroTypo();
    assert.equal(typo.process(typo.process('   \n\n   ')), typo.process('   \n\n   '));
  });

  test('idempotent: short already-typeset string', () => {
    const typo = new MicroTypo();
    const input = '«Козырь» — карта';
    assert.equal(typo.process(typo.process(input)), typo.process(input));
  });

  test('idempotent: numeric-heavy text', () => {
    const typo = new MicroTypo();
    const input = 'Клинок Корвина 1000 руб., пошлина 5%, путь до Амбера 5-10 дней.';
    assert.equal(typo.process(typo.process(input)), typo.process(input));
  });
});

// Deterministic LCG so a failing seed reproduces.
function lcg(seed) {
  let s = seed >>> 0;

  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;

    return s / 0x100000000;
  };
}

const LETTERS = ['a', 'b', 'я', 'ю', 'x'];

function phrase(rng) {
  let out = LETTERS[Math.floor(rng() * LETTERS.length)];
  const extra = Math.floor(rng() * 4);

  for (let i = 0; i < extra; i++) {
    out += LETTERS[Math.floor(rng() * LETTERS.length)];
  }

  return out;
}

// Single-style only: mixing or nesting raw quotes is inherently ambiguous, since a `""` run reads as
// nested, and that is a documented non-idempotency.
function genFlat(rng, open, close) {
  const parts = [];
  const n = 1 + Math.floor(rng() * 4);

  for (let i = 0; i < n; i++) {
    parts.push(rng() < 0.6 ? `${open}${phrase(rng)}${close}` : phrase(rng));
  }

  return parts.join(rng() < 0.5 ? '' : ' ');
}

describe('quote fuzz — single-style phrases reach a fixed point', () => {
  for (const html of [false, true]) {
    test(`adjacent/spaced «angle» phrases are idempotent (html:${html})`, () => {
      const rng = lcg(0xc0ffee);

      for (let n = 0; n < 5000; n++) {
        const input = genFlat(rng, '«', '»');
        const once = microtypo(input, { html });
        const twice = microtypo(once, { html });
        assert.equal(
          twice,
          once,
          `not idempotent (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`
        );
      }
    });

    test(`spaced "straight" phrases convert idempotently (html:${html})`, () => {
      const rng = lcg(0x1234abcd);

      for (let n = 0; n < 5000; n++) {
        // Straight quotes join with a space so the ambiguous `""` run never forms.
        const parts = [];
        const count = 1 + Math.floor(rng() * 4);

        for (let i = 0; i < count; i++) {
          parts.push(rng() < 0.6 ? `"${phrase(rng)}"` : phrase(rng));
        }
        const input = parts.join(' ');
        const once = microtypo(input, { html });
        const twice = microtypo(once, { html });
        assert.equal(
          twice,
          once,
          `not idempotent (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`
        );
      }
    });
  }

  test('no straight quote survives glued to an angle quote', () => {
    const rng = lcg(0xbeefcafe);

    for (let n = 0; n < 5000; n++) {
      const input = genFlat(rng, '«', '»');
      const out = microtypo(input);
      assert.ok(
        !/["][«»„“]|[«»„“]["]/u.test(out),
        `stray straight quote glued to angle (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(out)}`
      );
    }
  });
});

describe('idempotency on already-typeset text', () => {
  const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
  const entity = (text) => new MicroTypo({ ...PARAMS, entities: true }).process(text);

  test('idempotent on already-typeset text', () => {
    const text = 'Цена 100 ₽ за «Козырь» — всего 1000.';
    const once = microtypo(text, PARAMS);
    const twice = microtypo(once, PARAMS);
    assert.equal(twice, once, `\nonce:  ${once}\ntwice: ${twice}`);
  });

  test('idempotent in entity mode', () => {
    const text = 'Вот «Козырь» и число 1000.';
    const once = entity(text);
    const twice = entity(once);
    assert.equal(twice, once);
  });

  // A closing quote glyph the author wrote where nothing is open. Whatever the engine decides it
  // means, it has to decide it on the first pass: settling it as a neutral straight quote left the
  // direction to be re-derived by the second one, and the two passes disagreed.
  describe('a quotation written with the closing glyph on both sides', () => {
    for (const source of ['”Амбер”', '” Амбер', '&rdquo;Амбер&rdquo;', '\n\n”Амбер”', '»Амбер»']) {
      test(`settles on the first pass: ${JSON.stringify(source)}`, () => {
        const once = microtypo(source, PARAMS);
        const twice = microtypo(once, PARAMS);

        assert.equal(twice, once, `\nonce:  ${once}\ntwice: ${twice}`);
      });
    }

    test('the English pair keeps its own boundary', () => {
      assert.equal(microtypo('“Амбер ” “ Хаос”', PARAMS), '«Амбер» «Хаос»');
    });

    test('a real closing quote is still one', () => {
      assert.equal(microtypo('«Амбер » и «Хаос»', PARAMS), '«Амбер» и\u{00A0}«Хаос»');
    });
  });
});

// `⍽` and `⎵` stand for the no-break and the narrow no-break space. Each case is the input and the
// first pass; the second pass has to give the first one back.
const typeset = (s) => s.replaceAll('⍽', '\u{00A0}').replaceAll('⎵', '\u{202F}');

function settles(cases, config = {}) {
  for (const [source, expected] of cases) {
    const typo = new MicroTypo(config);
    const once = typo.process(typeset(source));

    assert.equal(once, typeset(expected), `first pass of ${JSON.stringify(source)}`);
    assert.equal(typo.process(once), once, `second pass of ${JSON.stringify(source)}`);
  }
}

describe('a particle binds to the word before it on the first pass', () => {
  test('a dash, an acronym or the next particle after it keeps its binding', () => {
    settles([
      ['вам ли - нет', 'вам⍽ли⍽— нет'],
      ['Кто бы — нет', 'Кто⍽бы⍽— нет'],
      ['о б —', 'о⍽б⍽—'],
      ['Вот же НЕ так', 'Вот⍽же⍽НЕ так'],
      ['жно ли Ж. Кон', 'жно⍽ли⍽Ж. Кон'],
      ['вот ли ли он', 'вот⍽ли⍽ли он']
    ]);
  });

  test('a particle is no short word before a quote or a word', () => {
    settles([
      ['вам ли «Амбер»', 'вам⍽ли «Амбер»'],
      ['и б „', 'и⍽б «'],
      ['ь - б ви', 'ь⍽—⍽б ви'],
      ['к б⍽л евро', 'к⍽б⍽л евро']
    ]);
  });

  test('the other bindings around a particle stay', () => {
    settles([
      ['вам ли в доме', 'вам⍽ли в⍽доме'],
      ['шёл бы в и дом', 'шёл⍽бы в⍽и⍽дом'],
      ['да ли он', 'да⍽ли⍽он'],
      ['те же люди', 'те⍽же⍽люди'],
      ['ну же, иди', 'ну⍽же, иди'],
      ['Ну! — бы он', 'Ну! —⍽бы⍽он'],
      ['в «Амбере»', 'в⍽«Амбере»']
    ]);
  });
});

describe('a shortened и т. д. reads as one typed out in full on the first pass', () => {
  test('a number after it binds and a dash after it takes the sentence form', () => {
    settles([
      ['и тд 1', 'и⍽т.⍽д.⍽1'],
      ['и т.д. 5 раз', 'и⍽т.⍽д.⍽5 раз'],
      ['и тп 15 августа', 'и⍽т.⍽п.⍽15⍽августа'],
      ['и тд — с', 'и⍽т.⍽д. —⍽с'],
      ['в тч - и', 'в⍽т.⍽ч. —⍽и'],
      ['и т. д. 1', 'и⍽т.⍽д.⍽1'],
      ['и т. д. — с', 'и⍽т.⍽д. —⍽с'],
      ['в тч 5', 'в⍽т.⍽ч. 5'],
      ['и тд -', 'и⍽т.⍽д.⍽—']
    ]);
  });

  test('a wrapped phrase leaves the number apart, as typed out in full it binds it', () => {
    settles(
      [
        ['и тд 1', '<p><span style="white-space:nowrap;">и т. д.</span> 1</p>'],
        ['и т. д. 1', '<p><span style="white-space:nowrap;">и т. д.</span>⍽1</p>'],
        ['и тд — с', '<p><span style="white-space:nowrap;">и т. д.</span> —⍽с</p>']
      ],
      { html: true }
    );
  });
});

describe('a quote opening after an opening quote', () => {
  test('opens on the first pass when the quote before it opened too', () => {
    settles([
      ['"«"и"»"', '«„„и““»'],
      ['он: "«"и"»"', 'он: «„„и““»'],
      ['"«“но таке.”»"', '«„„но⍽таке.““»'],
      ['"«и»"', '«„и“»'],
      ['«"и"»', '«„и“»']
    ]);
  });
});

describe('an inner quote closing before a closing guillemet', () => {
  test('closes after any character, so the inner pair reads back as written', () => {
    settles([
      ["««иляда'»»", "«„иляда'“»"],
      ["«„к'“»", "«„к'“»"],
      ['«„{name}“»', '«„{name}“»'],
      ['«„1906⍽₽“»', '«„1906⍽₽“»'],
      ['«„после“»', '«„после“»'],
      ['а "б"» в', 'а⍽«б»" в']
    ]);
  });
});

describe('an unmatched closing guillemet glued between a word and a Cyrillic letter', () => {
  test('stays as written rather than turn into a quote the next pass opens', () => {
    settles([
      ['ает»б', 'ает»б'],
      ['ает&raquo;б', 'ает»б'],
      ['а «б» в»г', 'а⍽«б» в»г'],
      ['ает» б', 'ает" б'],
      ['ает»1', 'ает"1']
    ]);
  });
});

describe('a long number before a spaced group of three digits', () => {
  test('is left as typed, as one after a bare digit is', () => {
    settles([
      ['74305 865', '74305 865'],
      ['12345 678 901', '12345 678 901'],
      ['8 100644', '8 100644'],
      ['74305 8', '74⎵305 8'],
      ['74305 8650', '74⎵305 8650'],
      ['74305 руб', '74⎵305⍽₽']
    ]);
  });
});

describe('до н. э. in its wrapper', () => {
  test('keeps its end in the wrapper of the whole phrase', () => {
    settles([['до нэ.', '<span style="white-space:nowrap;">до н. э.</span>']], {
      html: true,
      input: 'markdown',
      rules: { other: false }
    });
    settles([['<i>до</i> н.э.', '<p><nobr><i>до</i> н. э.</nobr></p>']], {
      html: true,
      render: { nowrap: 'nobr' }
    });
    settles([['в 30 г. н.э.', '<p>в⍽30⍽г. <nobr>н. э.</nobr></p>']], {
      html: true,
      render: { nowrap: 'nobr' }
    });
  });
});

describe('triads apart by a run of spaces or a tab', () => {
  test('are read as the number the run collapses to', () => {
    settles([
      ['5\t482', '5⎵482'],
      ['6  395', '6⎵395'],
      ['8  100 644', '8⎵100⎵644'],
      ['1 000  000', '1⎵000⎵000'],
      ['+7 999  123 45 67', '+7 999 123 45 67'],
      ['+7 999 123 45 67', '+7 999 123 45 67'],
      ['12 345  6', '12⎵345 6']
    ]);
  });
});

describe('a hyphen glued to a wrapped temperature', () => {
  test('stays the minus it was before the wrapper', () => {
    settles(
      [
        ['о -7F', '<p>о -<span style="white-space:nowrap;">7 °F</span></p>'],
        ['о - 7F', '<p>о⍽— <span style="white-space:nowrap;">7 °F</span></p>'],
        ['а -<b>слово</b>', '<p>а⍽-<b>слово</b></p>']
      ],
      { html: true }
    );
  });
});

describe('a unit glued to its number before a quote', () => {
  test('is no short word for the quote to bind', () => {
    settles([
      ['0м «', '0⍽м «'],
      ['2г «а»', '2⍽г «а»'],
      ['0г"а', '0⍽г «а'],
      ['4ч“ы', '4⍽ч «ы'],
      ['в «Амбере»', 'в⍽«Амбере»'],
      ['5 м «', '5⍽м⍽«']
    ]);
  });
});

describe('an address before a reference to a space', () => {
  test('ends at the reference, as at the space it writes', () => {
    settles(
      [
        ['n.hy/0&nbsp;ИНН 1591793', 'n.hy/0&nbsp;ИНН 1591793'],
        ['n.hy/0 ИНН 1591793', 'n.hy/0 ИНН 1591793'],
        ['http://a.ru/?a=1&amp;b=2 x', 'http://a.ru/?a=1&amp;b=2 x']
      ],
      { entities: true }
    );
  });
});

describe('a space before a punctuation mark glued to the next word', () => {
  test('punctuation after repeated gaps or a glued word keeps its known next-pass spacing', () => {
    for (const [input, first, second, config] of [
      ['о  :n', 'о :n', 'о: n', {}],
      ['а\t !б', 'а !б', 'а! б', {}],
      ['П.П :n', 'П. П :n', 'П. П: n', {}],
      ['в.к :::g', 'в. к :g', 'в. к: g', {}],
      ['й:e :n', 'й: e :n', 'й: e: n', {}]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('a run before a comma is removed on the first pass', () => {
    settles([['привет  ,мир', 'привет, мир']]);
  });
  test('a single space and a mark with no word after it stay as before', () => {
    settles([
      ['привет ,мир', 'привет, мир'],
      ['Слово :текст', 'Слово: текст'],
      ['Слово  ) и', 'Слово) и'],
      ['т.е. :x', 'т.⍽е. :x']
    ]);
  });
});

describe('triads beside a wrapper a later group writes', () => {
  test('generated wrappers and unit powers keep their known next-pass triads', () => {
    for (const [input, first, second, config] of [
      [
        '5 960 650 01.08.19',
        '<p>5 960 650 <span style="white-space:nowrap;">01.08.19</span></p>',
        '<p>5⎵960⎵650 <span style="white-space:nowrap;">01.08.19</span></p>',
        {
          html: true
        }
      ],
      [
        '7 (246) 07-67-32 6 371',
        '<p><span style="white-space:nowrap;">7 (246) 07-67-32</span> 6 371</p>',
        '<p><span style="white-space:nowrap;">7 (246) 07-67-32</span> 6⎵371</p>',
        {
          html: true
        }
      ],
      [
        '8м2 6 126',
        '<p>8⍽м² 6 126</p>',
        '<p>8⍽м² 6⎵126</p>',
        {
          html: true
        }
      ],
      ['+7(261)4846588 830', '+7⍽261⍽484-65-88 830', '+7⍽261⍽484-65-88⎵830', {}]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('a terminal line break leaves grouped triads on the first pass', () => {
    settles([['цена 9 127\n', 'цена 9⎵127']]);
  });

  test('a postal index before a generated date wrapper keeps its known next-pass triads', () => {
    for (const [input, first, second, config] of [
      [
        '103811,П 05.02.19',
        '<p>103811, <span style="white-space:nowrap;">П 05.02.19</span></p>',
        '<p>103⎵811, <span style="white-space:nowrap;">П 05.02.19</span></p>',
        {
          html: true
        }
      ]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });
  test('triads with a word or nothing after them group as before', () => {
    settles(
      [
        ['цена 5 960 руб.', '<p>цена 5⎵960⍽₽.</p>'],
        ['12-345 678', '<p>12–345⎵678</p>'],
        ['103811, Москва', '<p>103811, Москва</p>']
      ],
      { html: true }
    );
  });
});

describe('triads across HTML line and block boundaries', () => {
  test('numbers on different lines or blocks stay independent', () => {
    settles(
      [
        ['5 960 <br>650', '<p>5⎵960 <br>650</p>'],
        ['5 960 <hr>650', '<p>5⎵960</p>\n\n<hr>\n\n<p>650</p>'],
        ['5 960 <p>650</p>', '<p>5⎵960</p>\n\n<p>650</p>'],
        ['5 960<hr>\n650', '<p>5⎵960</p>\n\n<hr>\n\n<p>650</p>'],
        ['5 960<br>\n650', '<p>5⎵960<br>\n650</p>'],
        ['1<br> 6 371', '<p>1<br> 6⎵371</p>'],
        ['1<hr> 6 371', '<p>1</p>\n\n<hr>\n\n<p>6⎵371</p>'],
        ['1</p><p> 6 371', '<p>1</p><p> 6⎵371</p>']
      ],
      { html: true }
    );
  });

  test('inline tags still leave digits adjacent for grouping', () => {
    settles(
      [
        ['5 960 <b>650</b>', '<p>5⎵960⎵<b>650</b></p>'],
        ['<b>1</b> 6 371', '<p><b>1</b> 6 371</p>']
      ],
      { html: true }
    );
  });

  test('a plain newline without HTML break rendering keeps the base spacing', () => {
    for (const config of [
      {},
      { html: false },
      { input: 'markdown' },
      { input: 'frontmatter' },
      { input: 'markdown', html: true }
    ]) {
      settles([['9 127\nдалее', '9 127\nдалее']], config);
    }
    settles([['9 127\nдалее', '<p>9 127\nдалее</p>']], {
      html: true,
      render: { breakline: false }
    });
  });

  test('a newline inside an authored element keeps the base spacing', () => {
    settles(
      [
        ['<div>9 127\nдалее</div>', '<div>9 127\nдалее</div>'],
        ['<span>9 127\nдалее</span>', '<p><span>9 127\nдалее</span></p>']
      ],
      { html: true }
    );
  });

  test('a generated line break is read as an authored line break on the next pass', () => {
    const typo = new MicroTypo({ html: true });
    const once = typo.process('9 127\nдалее');

    assert.equal(once, '<p>9 127<br>\nдалее</p>');
    assert.equal(typo.process(once), '<p>9\u{202F}127<br>\nдалее</p>');
  });
});

describe('initials', () => {
  test('successive location abbreviations preserve the stable XML entity output', () => {
    settles([['<doc>Г.Г. 2</doc>', '<doc>Г.&#160;Г. 2</doc>']], {
      input: 'xml',
      entities: true
    });
  });

  test('a mixed identifier after initials stays outside the name grammar', () => {
    settles([['Ои⍽Е.Г.Н9679257', 'Ои⍽Е.Г.Н9679257']], {
      html: 'on',
      input: 'frontmatter'
    });
    settles([['<b><em>Аа</em></b> П.Г.т1933411956', '<p><b><em>Аа</em></b> П.Г.т1933411956</p>']], {
      html: true,
      input: 'html'
    });
  });

  test('a glued lowercase word does not turn preceding text into a wrapped name', () => {
    settles([['Сн Н.Г.как то:', '<p>Сн Н.Г.как⍽то:</p>']], { html: 'on' });
    settles([['С <i><span>Шй</span></i> М.Г.о', '<p>С⍽<i><span>Шй</span></i> М.Г.о</p>']], {
      html: '1',
      input: 'html',
      rules: { 'other.drop_nested_nowrap': false }
    });
  });

  test('a location abbreviation after a year range keeps its binding', () => {
    settles([['С 1976-2029г.г. ш.т', 'С&nbsp;1976&ndash;2029&nbsp;гг. ш.&nbsp;т']], {
      entities: true,
      input: 'markdown'
    });
  });

  test('initials without a surname do not introduce an abbreviation boundary', () => {
    settles([
      ['Е.Г. н', 'Е.Г. н'],
      ['Е.Г. Н', 'Е.Г. Н'],
      ['Н.С. 8', 'Н.С. 8'],
      ['Н.С.8', 'Н.С.8'],
      ['Е.Г.A9', 'Е.Г.A9'],
      ['г.Н9679257', 'г.⍽Н9679257']
    ]);
  });

  test('a wrapped name keeps the following word or number outside its span', () => {
    settles(
      [
        ['До В.С. 8', '<p><span style="white-space:nowrap;">До В. С.</span> 8</p>'],
        ['Ко А.Г. н', '<p><span style="white-space:nowrap;">Ко А. Г.</span> н</p>'],
        ['Сн Н.Г. как то:', '<p><span style="white-space:nowrap;">Сн Н. Г.</span> как⍽то:</p>']
      ],
      { html: true }
    );
  });

  test('abbreviations separated by a name keep their known next-pass binding', () => {
    for (const [input, first, second, config] of [
      ['Ко А.Г. н', 'Ко⍽А.⍽Г. н', 'Ко⍽А.⍽Г.⍽н', {}],
      ['До В.С. 8', 'До⍽В.⍽С. 8', 'До⍽В.⍽С.⍽8', {}],
      ['Г.Г. 2', 'Г.⍽Г. 2', 'Г.⍽Г.⍽2', {}],
      ['пр.Ш. П', 'пр.⍽Ш. П', 'пр.⍽Ш.⍽П', {}],
      [
        'П.Г.Фл',
        '<p><span style="white-space:nowrap;">П. Г. Фл</span></p>',
        '<p><span style="white-space:nowrap;">П. Г.⍽Фл</span></p>',
        { html: true, rules: { 'other.*': false } }
      ]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(input);

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('adjacent names and terminal initial periods keep their known next-pass changes', () => {
    for (const [input, first, second, config] of [
      [
        'Л.Н.Дм И. И. Ке.',
        '<p><span style="white-space:nowrap;">Л. Н. Дм</span> И. И. Ке.</p>',
        '<p><span style="white-space:nowrap;">Л. Н. Дм</span> <span style="white-space:nowrap;">И. И. Ке</span>.</p>',
        {
          html: true
        }
      ],
      [
        'о Пи КЛ',
        '<p><span style="white-space:nowrap;">о Пи К. Л.</span></p>',
        '<p><span style="white-space:nowrap;">о Пи К. Л..</span></p>',
        {
          html: true,
          rules: {
            'nobr.initials_dots': true
          }
        }
      ],
      [
        'м⍽Ло К.Р⍽<',
        '<p><span style="white-space:nowrap;">м Ло К. Р.</span>⍽<</p>',
        '<p><span style="white-space:nowrap;">м Ло К. Р..</span>⍽<</p>',
        {
          html: true,
          rules: {
            'nobr.initials_dots': true
          }
        }
      ]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });
  test('a lowercase abbreviation, a word before the period and a spaced name stay as before', () => {
    settles([
      ['т.г. Москва', 'т.г. Москва'],
      ['МВД.Г. Москва', 'МВД.Г. Москва'],
      ['Ко А. Г. н', 'Ко⍽А.⍽Г.⍽н'],
      ['рис. 5', 'рис.⍽5']
    ]);
    settles([['П.Г.Фл', '<p><span style="white-space:nowrap;">П. Г. Фл</span></p>']], {
      html: true
    });
  });
});

describe('an abbreviation before a number or a word a unit binds', () => {
  const UNIT_CASES = [
    ['с.0 px', 'с.⍽0⍽px', { input: 'markdown' }],
    ['с.7 Б', 'с.⍽7⍽Б', { input: 'yaml' }],
    ['с.5 <a>ч т</a>', 'с.⍽5⍽<a>ч т</a>', { input: 'html' }],
    ['с.3 ч зм', 'с.&nbsp;3&nbsp;ч зм', { entities: '1' }],
    ['<doc><note>гл.5 м</note></doc>', '<doc><note>гл.⍽5⍽м</note></doc>', { input: 'xml' }],
    ['с.8 см.х', 'с.&nbsp;8&nbsp;см.&nbsp;х', { entities: '1' }],
    ['с.1 Л', 'с.⍽1⍽Л', { input: 'markdown' }],
    ['п.3 т', 'п.⍽3⍽т', { input: 'html' }],
    ['с.7 кг пи', 'с.&nbsp;7&nbsp;кг пи', { entities: true }],
    ['гл.1 Т.И.Це', 'гл.&nbsp;1&nbsp;Т.&nbsp;И.&nbsp;Це', { entities: 1 }],
    ['с.9 *px* Пл', 'с.&nbsp;9&nbsp;*px* Пл', { entities: 1, input: 'markdown' }],
    ['с.6 ч.⍽', 'с.&nbsp;6&nbsp;ч.&nbsp;', { entities: true, input: 'markdown' }],
    ['гл.1 м', 'гл.⍽1⍽м', {}],
    ['с.8 см.е', 'с.&nbsp;8&nbsp;см.&nbsp;е', { entities: true, input: 'markdown' }],
    ['с.8 мм сс', 'с.&nbsp;8&nbsp;мм сс', { entities: '1', input: 'markdown' }],
    ['с.0 Л', 'с.⍽0⍽Л', { input: 'html' }],
    ['с.5 т', 'с.⍽5⍽т', { input: 'html' }],
    ['с.6 т сы', 'с.&nbsp;6&nbsp;т сы', { entities: true }],
    ['гл.5\tт', 'гл.⍽5⍽т', {}],
    ['<doc><p>с.5 ч</p></doc>', '<doc><p>с.⍽5⍽ч</p></doc>', { input: 'xml' }],
    ['с.9 м', 'с.⍽9⍽м', { input: 'frontmatter' }],
    ['с.1 Л', 'с.&nbsp;1&nbsp;Л', { entities: 'on', input: 'markdown' }],
    ['с.9 т', 'с.⍽9⍽т', { input: 'html' }],
    ['с.1 г ыш', 'с.&nbsp;1&nbsp;г ыш', { entities: true, input: 'html' }],
    ['с.1\tч', 'с.&nbsp;1&nbsp;ч', { entities: 'on' }]
  ];

  for (const [input, expected, config] of UNIT_CASES) {
    test(`a number glued to an abbreviation keeps its unit binding: ${input}`, () => {
      settles([[input, expected]], config);
    });
  }

  test('a reference after a unit preserves the stable XML entity output', () => {
    settles([['<doc>9см.к</doc>', '<doc>9&#160;см.к</doc>']], {
      input: 'xml',
      entities: true
    });
  });

  test('a glued unit retains the known abbreviation remainder', () => {
    const typo = new MicroTypo();

    for (const [input, first, second] of [
      ['с. 2026г', 'с. 2026⍽г', 'с.⍽2026⍽г'],
      ['П. 1978г', 'П. 1978⍽г', 'П.⍽1978⍽г'],
      ['9см.к', '9⍽см. к', '9⍽см.⍽к']
    ]) {
      const once = typo.process(input);

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('a postal index with a glued г and a plain reference read as before', () => {
    settles([
      ['125009г. Москва', '125⎵009⍽г. Москва'],
      ['см. рис. 5', 'см.⍽рис.⍽5'],
      ['стр. 5 кг', 'стр.⍽5⍽кг']
    ]);
  });
});

describe('consecutive organization abbreviations', () => {
  test('each binds the word after it on the first pass', () => {
    settles([
      ['НИИ ООО в', 'НИИ⍽ООО⍽в'],
      ['ООО НИИ Рос', 'ООО⍽НИИ⍽Рос'],
      ['ООО Ромашка', 'ООО⍽Ромашка'],
      ['СООО Ромашка', 'СООО Ромашка'],
      ['ООО 5', 'ООО 5']
    ]);
  });
});

describe('terminal punctuation separated by stray marks', () => {
  test('drops the entire garbage tail on the first pass', () => {
    settles([
      ['!,?,!!!', '!'],
      ['?,!;?', '?'],
      ['!,,!;!!!', '!'],
      ['что!,?', 'что!'],
      ['что!?,', 'что!?,'],
      ['!,', '!,'],
      ['!?', '!?']
    ]);
  });
});

describe('a range of days', () => {
  test('an authored day range in the output-shaped wrapper keeps its base conversion', () => {
    const rules = { 'date.*': true };
    settles(
      [
        [
          '<span style="white-space:nowrap;">6—7 августа</span>',
          '<p><span style="white-space:nowrap;">6–7 августа</span></p>'
        ]
      ],
      { html: true, rules }
    );
  });

  test('a day-range wrapper produced by the date rule has the same next-pass conversion', () => {
    const typo = new MicroTypo({ html: true, rules: { 'date.*': true } });
    const once = typo.process('6-7 августа');

    assert.equal(once, '<p><span style="white-space:nowrap;">6—7 августа</span></p>');
    assert.equal(typo.process(once), '<p><span style="white-space:nowrap;">6–7 августа</span></p>');
  });

  test('a range in other markup or with no month gets the en dash as before', () => {
    settles(
      [
        ['<b>6—7 августа</b>', '<p><b>6–7⍽августа</b></p>'],
        [
          '<span style="white-space:nowrap;">6—7</span>',
          '<p><span style="white-space:nowrap;">6–7</span></p>'
        ],
        ['100-500', '<p>100–500</p>']
      ],
      { html: true }
    );
  });

  test('an authored wrapper uses the en dash when the day-range rule is off', () => {
    for (const rules of [{ 'date.*': false }, { 'date.nowrap_day_range': false }, {}]) {
      settles(
        [
          [
            '<span style="white-space:nowrap;">6—7 августа</span>',
            '<p><span style="white-space:nowrap;">6–7 августа</span></p>'
          ],
          [
            '<span style="white-space:nowrap;">6—7 августа',
            '<p><span style="white-space:nowrap;">6–7⍽августа</p>'
          ]
        ],
        { html: true, rules }
      );
    }
  });

  test('a wrapper with extra content is not the output of the day-range rule', () => {
    settles(
      [
        [
          '<span style="white-space:nowrap;">6—7 августа<b>пример</b></span>',
          '<p><span style="white-space:nowrap;">6–7 августа<b>пример</b></span></p>'
        ]
      ],
      { html: true, rules: { 'date.*': true } }
    );
  });
});

describe('a nowrap wrapper written as <nobr>', () => {
  test('drops a nested one as a nested <span> wrapper is dropped', () => {
    settles([['а 28.08.20г.', '<p><nobr>а 28.08.20 г.</nobr></p>']], {
      html: true,
      render: { nowrap: 'nobr' }
    });
    settles([['а 28.08.20г.', '<p><span style="white-space:nowrap;">а 28.08.20 г.</span></p>']], {
      html: true
    });
  });
});

describe('an address before a reference to a quote', () => {
  test('a terminal quote reference keeps its known next-pass quote balance', () => {
    for (const [input, first, second, config] of [
      [
        '"„"" й“ a.ru/"',
        '&laquo;&bdquo;&bdquo;&ldquo; й&ldquo; a.ru/&raquo;',
        '&laquo;&laquo;&laquo;&raquo; й&raquo; a.ru/&raquo;',
        {
          entities: true
        }
      ]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('ordinary quote pairs and quote escapes retain their existing output', () => {
    settles(
      [
        ['"a.ru/x" и "b.ru"', '&laquo;a.ru/x&raquo; и&nbsp;&laquo;b.ru&raquo;'],
        ['http://a.ru/?q=&quot;x&quot;', 'http://a.ru/?q=&quot;x&quot;']
      ],
      { entities: true }
    );
  });
  test('a quote reference inside an address stays inside it', () => {
    settles(
      [
        [
          'http://a.ru/?q=&#171;x&#187;/y',
          '<p><a href="http://a.ru/?q=«x»/y">a.ru/?q=&#171;x&#187;/y</a></p>'
        ],
        [
          'http://a.ru/?q=&laquo;x&raquo;/y',
          '<p><a href="http://a.ru/?q=&amp;laquo;x&amp;raquo;/y">a.ru/?q=&laquo;x&raquo;/y</a></p>'
        ],
        [
          'http://a.ru/&ldquo;path/file',
          '<p><a href="http://a.ru/&amp;ldquo;path/file">a.ru/&ldquo;path/file</a></p>'
        ]
      ],
      { html: true }
    );
  });
});

describe('долл.США glued after a number', () => {
  test('is parted on the first pass, wherever the number stands', () => {
    settles([
      ['.5долл.США', '.5⍽долл. США'],
      ['x.5ДОЛЛ.США', 'x.5⍽ДОЛЛ. США'],
      ['5долл.США', '5⍽долл. США'],
      ['5 долл. США', '5⍽долл. США']
    ]);
  });
});

describe('a repeated registered mark', () => {
  test('marks the name once: the second shorthand stands after a mark, not after a name', () => {
    settles([
      ['Печати (r)(r)', 'Печати ®(r)'],
      ['Печати (r)', 'Печати ®'],
      ['Печати ®(r)', 'Печати ®(r)'],
      ['Windows(R) Word(R)', 'Windows® Word®']
    ]);
  });
});

describe('a paragraph laid out from an indented line', () => {
  test('the indent of its first line goes with the blank lines before it', () => {
    settles(
      [
        ['.\n\n    Н', '<p>.</p>\n\n<p>Н</p>'],
        ['    один\n\n    два\n    три', '    <p>один</p>\n\n<p>два<br>\n    три</p>'],
        ['один\n    два', '<p>один<br>\n    два</p>']
      ],
      { html: true }
    );
  });
});

describe('an emphatic particle binds the next word on the first pass', () => {
  test('the next word after the gap may be the next particle word', () => {
    settles([
      ['е-ка ь-ка к', 'е-ка⍽ь-ка⍽к'],
      ['в-де о ка в', 'в-де⍽о-ка⍽в'],
      ['Поди-кась так', 'Поди-кась⍽так'],
      ['Поди-кась, так', 'Поди-кась, так']
    ]);
  });
});

describe('a high quote after an open low quote in its paragraph', () => {
  test('the base reading of authored high quotes stays unchanged', () => {
    settles(
      [
        ['„x“word” z“', '<p>«x"word» z"</p>'],
        ['„x “» z“', '<p>«x⍽„“ z»</p>'],
        ['«„“»', '<p>«««»</p>']
      ],
      { html: true }
    );
  });
  test('preserves the base output when an empty pair is nested', () => {
    const typo = new MicroTypo();
    const once = typo.process('«“”»');

    assert.equal(once, '«„“»');
    assert.equal(typo.process(once), '«««»');
    assert.equal(typo.process('«„“»'), '«««»');
  });

  test('a high quote with no low quote open, or past a blank line, stays neutral', () => {
    settles([
      ['„Привет“ и “Hello”', '«Привет» и⍽«Hello»'],
      ['«Он „сказал“ так»', '«Он „сказал“ так»'],
      ['„x\n\n“y”', '«x\n\n«y»']
    ]);
  });

  test('an English pair inside a low quotation remains nested', () => {
    settles([
      ['„Он сказал “Привет” здесь“', '«Он⍽сказал „Привет“ здесь»'],
      ['«Он „сказал “Привет” здесь“»', '«Он „сказал „Привет“ здесь“»'],
      ['„“слово” конец“', '«„слово“ конец»'],
      ['„“”', '««»'],
      ['&bdquo;&ldquo;&rdquo;', '««»'],
      ['„x “ y ” z“', '«x⍽„y“ z»'],
      ['„x “«y»” z“', '«x⍽„„y““ z»'],
      ['„Он сказал (“Привет”) здесь“', '«Он⍽сказал („Привет“) здесь»'],
      ['„Он сказал [“Привет”] здесь“', '«Он⍽сказал [„Привет“] здесь»'],
      ['„x &ldquo;y&rdquo; z&ldquo;', '«x⍽„y“ z»']
    ]);
    settles(
      [
        ['„Он сказал&nbsp;“Привет” здесь“', '<p>«Он⍽сказал⍽„Привет“ здесь»</p>'],
        ['„Он сказал&#160;“Привет” здесь“', '<p>«Он⍽сказал⍽„Привет“ здесь»</p>'],
        ['„Он сказал—“Привет” здесь“', '<p>«Он⍽сказал—„Привет“ здесь»</p>'],
        ['„Он сказал:“Привет” здесь“', '<p>«Он⍽сказал:„Привет“ здесь»</p>'],
        ['„Он сказал,“Привет” здесь“', '<p>«Он⍽сказал, „Привет“ здесь»</p>'],
        ['„Он сказал«“Привет” здесь“', '<p>«Он⍽сказал««Привет» здесь»</p>'],
        ['„Он сказал<b>“Привет” здесь“</b>', '<p>«Он⍽сказал<b>„Привет“ здесь»</b></p>']
      ],
      { html: true }
    );
  });

  test('an unfinished quotation in one HTML block does not reach the next', () => {
    settles([['<p>„Привет</p><p>“Дальше”</p>', '<p>«Привет</p><p>«Дальше»</p>']], { html: true });
  });
});

describe('a link whose text is its address behind the scheme', () => {
  test('holds an address on the next pass, whatever the address looks like', () => {
    settles(
      [
        ['http://10000', '<p><a href="http://10000">10000</a></p>'],
        ['ftps://10000', '<p><a href="ftps://10000">10000</a></p>'],
        ['http://10000&#65;/x', '<p><a href="http://10000A/x">10000&#65;/x</a></p>'],
        ['http://10000&#x41;/x', '<p><a href="http://10000A/x">10000&#x41;/x</a></p>'],
        ['http://...b/c', '<p><a href="http://...b/c">...b/c</a></p>'],
        ['mailto://12345 и 20000', '<p><a href="mailto://12345">12345</a> и⍽20⎵000</p>'],
        ['http://10&20', '<p><a href="http://10&amp;20">10&20</a></p>']
      ],
      { html: true }
    );
    settles([['http://ab…cd', '<p><a href="http://ab…cd">ab…cd</a></p>']], {
      html: true,
      entities: true
    });
  });

  test('a link with other text is prose', () => {
    settles(
      [
        ['<a href="http://10000">10 000</a>', '<p><a href="http://10000">10⎵000</a></p>'],
        ['<a href="ftps://10000">10 000</a>', '<p><a href="ftps://10000">10⎵000</a></p>'],
        [
          '<a href="http://10000A/x">10000&#66;/x</a>',
          '<p><a href="http://10000A/x">10⎵000&#66;/x</a></p>'
        ],
        ['<a href="http://b.ru">10000...</a>', '<p><a href="http://b.ru">10⎵000…</a></p>']
      ],
      { html: true }
    );
  });
});

describe('whitespace at the edges of a document', () => {
  for (const [input, expected, config] of [
    [' ⍽-', ' &nbsp;&mdash;', { entities: '1' }],
    [' ⍽Мы 0', ' &nbsp;Мы 0', { entities: true }],
    [' ⍽⍽К', ' &nbsp;&nbsp;К', { entities: true }]
  ]) {
    test(`preserves a no-break space after an indent through entity output: ${input}`, () => {
      settles([[input, expected]], config);
    });
  }

  test('text with ordinary document boundaries stays as before', () => {
    settles([
      ['о об', 'о⍽об'],
      ['слово\nдругое', 'слово\nдругое']
    ]);
  });

  test('trimmed document boundaries retain their known next-pass normalization', () => {
    for (const [input, first, second, config] of [
      ['⍽о об', 'о об', 'о⍽об', {}],
      ['⍽– А', '– А', '—⍽А', {}],
      ['003 гг.\n', '003 гг.', '003⍽гг.', {}],
      [
        '---\ntitle: test\n---\n\n\n1997год.',
        '---\ntitle: test\n---\n1997год.',
        '---\ntitle: test\n---\n1997 год.',
        { input: 'frontmatter' }
      ],
      [
        '---\ntitle: test\n---\n\nГост 5773-90',
        '---\ntitle: test\n---\nГост 5773–90',
        '---\ntitle: test\n---\nГОСТ 5773–90',
        { input: 'frontmatter' }
      ]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('preserves the indentation of a Markdown code block', () => {
    settles([['    код\n', '    код']], { input: 'markdown' });
  });
});

describe('stable baseline initials', () => {
  test('N-period', () => {
    settles([['Иванов А.Б.)', 'Иванов⍽А.⍽Б..)']], {
      rules: {
        'nobr.initials_dots': true
      }
    });
  });

  test('N-period-only', () => {
    settles([['Иванов⍽Г. Б.)', 'Иванов⍽Г.⍽Б..)']], {
      rules: {
        'nobr.initials_dots': true
      }
    });
  });

  test('N-period-surname', () => {
    settles(
      [
        ['Иванов А.Б.Петров', '<p><span style="white-space:nowrap;">Иванов А. Б.</span>.Петров</p>']
      ],
      {
        html: true,
        rules: {
          'nobr.initials_dots': true
        }
      }
    );
  });

  test('N-gap', () => {
    settles([['М.⍽Д. Иванов', '<p><span style="white-space:nowrap;">М. Д. Иванов</span></p>']], {
      html: true,
      rules: {
        'other.*': false
      }
    });
  });

  test('N-adjacent-short', () => {
    settles([['А.Б.Ян В.Г.Юн', 'А.⍽Б.⍽Ян В.Г.Юн']], {});
  });

  test('N-adjacent-line', () => {
    settles([['А.Б.Ян В.Г.\nЮн', 'А.⍽Б.⍽Ян⍽В.⍽Г.\nЮн']], {});
  });
});

describe('stable baseline triads', () => {
  test('T-phone', () => {
    settles([['8-800-123-45-67 123', '8-800-123-45-67⎵123']], {});
  });

  test('T-hyphen', () => {
    settles([['8240-57 347', '8240-57⎵347']], {
      rules: {
        endash: false
      }
    });
  });

  test('T-sup', () => {
    settles([['м² 1 000', 'м² 1⎵000']], {});
  });

  test('T-sub', () => {
    settles([['a_8 1 000', '<p>a<sub><small>8</small></sub> 1⎵000</p>']], {
      html: true
    });
  });

  test('T-right-temperature', () => {
    settles([['12 345 6F', '<p>12⎵345 <span style="white-space:nowrap;">6 °F</span></p>']], {
      html: true
    });
  });

  test('T-right-author', () => {
    settles(
      [
        [
          '12 345 <span style="white-space:nowrap;">6 мая</span>',
          '<p>12⎵345 <span style="white-space:nowrap;">6 мая</span></p>'
        ]
      ],
      {
        html: true
      }
    );
  });
});

describe('stable baseline postal index', () => {
  test('an authored date wrapper preserves the existing index grouping', () => {
    settles(
      [
        [
          '<p>103811, <span style="white-space:nowrap;">П 05.02.19</span></p>',
          '<p>103⎵811, <span style="white-space:nowrap;">П 05.02.19</span></p>'
        ]
      ],
      {
        html: true
      }
    );
  });
});

describe('stable baseline punctuation', () => {
  test('S-nbsp', () => {
    settles([['а ⍽:tip', 'а ⍽:tip']], {});
  });

  test('S-decimal', () => {
    settles([['1.2 :tip', '1.2 :tip']], {});
  });

  test('S-chain', () => {
    settles([['1.2?!А', '1.2?!А']], {});
  });

  test('S-triadunit', () => {
    settles([['1234567сек  :::tip', '<p>1⎵234⎵567сек :tip</p>']], {
      html: true
    });
  });

  test('S-email', () => {
    settles([['a@b.co  :::tip', '<p><a href="mailto:a@b.co">a@b.co</a> :tip</p>']], {
      html: true
    });
  });
});

describe('stable baseline terminal URL references', () => {
  test('U-terminal', () => {
    settles([['http://a.ru/&raquo;', 'http://a.ru/&raquo;']], {});
  });

  test('U-terminal-html', () => {
    settles([['http://a.ru/&raquo;', '<p><a href="http://a.ru/&amp;raquo">a.ru/&raquo</a>;</p>']], {
      html: true
    });
  });

  test('U-terminal-withquote', () => {
    settles([['«http://a.ru/»&raquo;', '«http://a.ru/»&raquo;']], {});
  });

  test('U-yaml', () => {
    settles([['k: "а  б amber.ru/&raquo; в"', 'k: "а⍽б⍽amber.ru/&raquo; в"']], {
      input: 'yaml'
    });
  });
});
