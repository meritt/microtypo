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

// Initials as `other.strip_nbsp_in_nowrap: false` leaves them: bound inside their wrapper.
const bound = (s) => s.replace(/([А-Я]\.) ([А-Я]\.) /gu, '$1⍽$2⍽');

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
      ['Вот же НЕ так', 'Вот⍽же⍽НЕ⍽так'],
      ['жно ли Ж. Кон', 'жно⍽ли⍽Ж.⍽Кон'],
      ['вот ли ли он', 'вот⍽ли⍽ли⍽он']
    ]);
  });

  test('a particle is no short word before a quote or a word', () => {
    settles([
      ['вам ли «Амбер»', 'вам⍽ли «Амбер»'],
      ['и б „', 'и⍽б «'],
      ['ь - б ви', 'ь⍽—⍽б⍽ви'],
      ['к б⍽л евро', 'к⍽б⍽л⍽евро']
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
      ['и т.д. 5 раз', 'и⍽т.⍽д.⍽5⍽раз'],
      ['и тп 15 августа', 'и⍽т.⍽п.⍽15⍽августа'],
      ['и тд — с', 'и⍽т.⍽д. —⍽с'],
      ['в тч - и', 'в⍽т.⍽ч. —⍽и'],
      ['и т. д. 1', 'и⍽т.⍽д.⍽1'],
      ['и т. д. — с', 'и⍽т.⍽д. —⍽с'],
      ['в тч 5', 'в⍽т.⍽ч.⍽5'],
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
      ['о  :n', 'о: n', 'о: n', {}],
      ['а\t !б', 'а! б', 'а! б', {}],
      ['П.П :n', 'П. П: n', 'П. П: n', {}],
      ['в.к :::g', 'в. к: g', 'в. к: g', {}],
      ['й:e :n', 'й: e: n', 'й: e: n', {}]
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

describe('a dash after an abbreviation the same pass writes', () => {
  test('binds as after the written abbreviation', () => {
    settles([['4р. —', '4⍽₽⍽—']], { rules: { 'dash.em_after_sentence': false } });
    settles([['[2долл.][1] - т', '[2⍽$][1]⍽— т']], { input: 'markdown' });
    settles([['ГОСТ8 -', '<p><span style="white-space:nowrap;">ГОСТ 8⍽—</span></p>']], {
      html: true,
      rules: { other: false }
    });
  });

  test('reads a written abbreviation period as the authored one', () => {
    settles([
      ['5уе — а', '5⍽у.е. —⍽а'],
      ['5⍽у.е. — а', '5⍽у.е. —⍽а'],
      ['X-Xв — а', 'X–X⍽вв. —⍽а'],
      ['слово — а', 'слово⍽— а']
    ]);
    settles([['Но ПО - а', 'Но⍽П.⍽О. —⍽а']], { rules: { 'nobr.*': true } });
  });
});

describe('punctuation brought together by a trimmed gap or stripped quote padding', () => {
  test('collapses on the first pass', () => {
    settles([
      ['«. ».', '«».'],
      ['“.” .', '«».'],
      ['«..».', '«».'],
      ['! ,?!', '!'],
      ['? ,!!!', '?'],
      ['г.&#xA0;.', 'г.']
    ]);
  });

  test('marks kept apart by a disabled trim stay', () => {
    settles([['! ,?!', '! ,?!']], { rules: { 'space.trim_before_punctuation': false } });
    settles([['«. ».', '«. ».']], { rules: { 'space.strip_quote_padding': false } });
  });
});

describe('a long number beside a digit group across a gap', () => {
  test('a tab or a run of spaces refuses the split as one space does', () => {
    settles(
      [
        ['65673\t799', '65673\t799'],
        ['2\t938362285', '2\t938362285'],
        ['6  730333', '6  730333'],
        ['68536  027-1', '68536  027–1']
      ],
      { rules: { 'space.*': false } }
    );
  });

  test('a lone long number and an authored grouping still group', () => {
    settles(
      [
        ['65673\tслово', '65⎵673\tслово'],
        ['38⎵383\t822', '38⎵383⎵822'],
        ['2\t938 362 285', '2⎵938⎵362⎵285']
      ],
      { rules: { 'space.*': false } }
    );
    settles([['цена 65673 руб.', 'цена 65⎵673⍽₽.']]);
  });
});

describe('a comma before a conjunction behind a gap a later rule narrows', () => {
  const comma = { rules: { 'punctuation.comma_before_conjunction': true } };

  test('a collapsed run of spaces takes the comma as one space does', () => {
    settles(
      [
        ['с  но и', 'с, но⍽и'],
        ['а  а и', 'а, а⍽и'],
        ['с но и', 'с, но⍽и'],
        ['с\tно и', 'с, но⍽и']
      ],
      comma
    );
    settles([['а  а и', 'а, а⍽и']], { ...comma, input: 'html' });
  });

  test('a run bound after a short word takes it as an authored no-break space does', () => {
    const uncollapsed = { rules: { ...comma.rules, 'space.collapse_spaces': false } };

    settles(
      [
        ['с  но и', 'с,⍽но⍽и'],
        ['с⍽но и', 'с,⍽но⍽и']
      ],
      uncollapsed
    );
  });

  test('without the rule the gap is only collapsed', () => {
    settles([['с  но и', 'с⍽но⍽и']]);
  });
});

describe('a space after a comma behind a boundary a later group writes', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';

  test('a wrapper or a paragraph before the comma reads as the authored one does', () => {
    settles(
      [
        ['Гост7,5', `<p>${NOWRAP_OPEN}ГОСТ 7</span>, 5</p>`],
        [`${NOWRAP_OPEN}ГОСТ 7</span>,5`, `<p>${NOWRAP_OPEN}ГОСТ 7</span>, 5</p>`],
        ['+7(696)1617051,5', `<p>${NOWRAP_OPEN}+7 696 161-70-51</span>, 5</p>`]
      ],
      { html: true }
    );
    settles(
      [
        [',8', '<p>, 8</p>'],
        ['<p>,8</p>', '<p>, 8</p>']
      ],
      { html: true, input: 'html' }
    );
  });

  test('a decimal comma, a text start and transparent emphasis keep their reading', () => {
    settles([
      ['Гост7,5', 'ГОСТ⍽7,5'],
      ['+7(696)1617051,5', '+7⍽696⍽161-70-51,5'],
      [',8', ',8'],
      ['а\n,8', 'а\n, 8']
    ]);
    settles([['<b>7</b>,5', '<p><b>7</b>,5</p>']], { html: true, input: 'html' });
  });
});

describe('an em dash written as an XML reference reads back as the dash', () => {
  test('a hyphen after the dash a first pass wrote stays the break it was', () => {
    for (const [source, expected] of [
      ['<doc><note> - - етилг</note></doc>', '<doc><note>&#160;&#8212; - етилг</note></doc>'],
      ['<doc><p>,- - сказч</p></doc>', '<doc><p>,&#160;&#8212; - сказч</p></doc>'],
      [
        '<doc><note>слово&#8212; - слово</note></doc>',
        '<doc><note>слово&#8212; - слово</note></doc>'
      ]
    ]) {
      const typo = new MicroTypo({ input: 'xml', entities: true });
      const once = typo.process(source);

      assert.equal(once, expected, `first pass of ${source}`);
      assert.equal(typo.process(once), once, `second pass of ${source}`);
    }
    settles([['слово— - слово', 'слово— - слово']]);
  });

  test('content and other references before a hyphen still take the dash', () => {
    for (const [source, expected] of [
      [
        '<doc><note>слово; - слово</note></doc>',
        '<doc><note>слово;&#160;&#8212; слово</note></doc>'
      ],
      [
        '<doc><note>слово&amp; - слово</note></doc>',
        '<doc><note>слово&amp;&#160;&#8212; слово</note></doc>'
      ],
      [
        '<doc><note>слово&#187; - слово</note></doc>',
        '<doc><note>слово&#187;&#160;&#8212; слово</note></doc>'
      ]
    ]) {
      assert.equal(new MicroTypo({ input: 'xml', entities: true }).process(source), expected);
    }
  });

  test('a dash in any spelling of its reference is spaced as the dash itself', () => {
    const xml = { input: 'xml' };
    const em = ['&#8212;', '&#x2014;', '&#X2014;', '&#08212;'];
    const en = ['&#8211;', '&#x2013;'];

    settles(
      [
        ['<r>слово — - сказал</r>', '<r>слово⍽— - сказал</r>'],
        ['<r>Да! — сказал</r>', '<r>Да! —⍽сказал</r>'],
        ['<r>— Привет</r>', '<r>—⍽Привет</r>'],
        ['<r>Стоит 5 руб. — всё</r>', '<r>Стоит 5⍽₽⍽— всё</r>'],
        ['<r>5 – 7 дней</r>', '<r>5–7⍽дней</r>']
      ],
      xml
    );
    for (const ref of em) {
      settles(
        [
          [`<r>слово ${ref} - сказал</r>`, `<r>слово⍽${ref} - сказал</r>`],
          [`<r>Да! ${ref} сказал</r>`, `<r>Да! ${ref}⍽сказал</r>`],
          [`<r>${ref} Привет</r>`, `<r>${ref}⍽Привет</r>`],
          [`<r>Стоит 5 руб. ${ref} всё</r>`, `<r>Стоит 5⍽₽⍽${ref} всё</r>`]
        ],
        xml
      );
    }
    for (const ref of en) {
      settles(
        [
          [`<r>слово ${ref} - сказал</r>`, '<r>слово⍽— - сказал</r>'],
          [`<r>5 ${ref} 7 дней</r>`, `<r>5${ref}7 дней</r>`]
        ],
        xml
      );
    }
    settles([['<r>слово &#x2014; - сказал</r>', '<r>слово&#160;&#x2014; - сказал</r>']], {
      ...xml,
      entities: true
    });
  });
});

describe('и т. д. read behind a boundary a later rule writes', () => {
  test('a space after an abbreviation and a year mark expose the phrase and its number', () => {
    settles([
      ['т.е.и т. д.\nч', 'т.⍽е. и⍽т.⍽д.\nч'],
      ['т. е. и т. д.', 'т.⍽е. и⍽т.⍽д.']
    ]);
    settles(
      [
        ['и тд 970г.', 'и⍽т.⍽д.⍽970⍽г.'],
        ['и тд 970 г.', 'и⍽т.⍽д.⍽970⍽г.']
      ],
      { rules: { nbsp: false } }
    );
    settles([['и тп 2028г.', 'и&nbsp;т.&nbsp;п.&nbsp;2028&nbsp;г.']], {
      input: 'html',
      entities: true,
      rules: { nbsp: false }
    });
  });

  test('a phrase without the rule, or a number standing apart, keeps its form', () => {
    settles([['т.е.и т. д.', 'т.⍽е. и т. д.']], { rules: { 'abbr.nowrap_etc': false } });
    settles([['и тд 970г.', 'и тд 970⍽г.']], {
      rules: { nbsp: false, 'abbr.nowrap_etc': false }
    });
  });
});

describe('и т. д. inside the wrapper its short word was drawn into', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';
  const uncleaned = { html: true, input: 'markdown', rules: { 'other.drop_nested_nowrap': false } };

  test('the phrase keeps no-break without nesting another wrapper', () => {
    settles(
      [
        ['к⍽и тд', `${NOWRAP_OPEN}к и т. д.</span>`],
        ['а⍽и тд⍽с', `${NOWRAP_OPEN}а и т. д. с</span>`],
        ['о⍽_[и](/x)_ т.п', `${NOWRAP_OPEN}о _[и](/x)_ т. п.</span>`]
      ],
      uncleaned
    );
    settles([['к⍽и тд', `<p>${NOWRAP_OPEN}к и т. д.</span></p>`]], { html: true });
  });

  test('a bare phrase and a white-space reset keep their own wrapping', () => {
    settles([['и тд', `${NOWRAP_OPEN}и т. д.</span>`]], uncleaned);
    settles([['и тд', 'и⍽т.⍽д.']]);
    settles(
      [
        [
          '<span style="white-space:normal;">к и тд</span>',
          '<p><span style="white-space:normal;">к⍽и⍽тд</span></p>'
        ]
      ],
      { html: true, input: 'html', rules: { 'other.drop_nested_nowrap': false } }
    );
  });
});

describe('a time beside a grouped number or a phone', () => {
  test('takes neither the leading group of the number nor the end of the phone', () => {
    settles([
      ['2: 43138', '2: 43⎵138'],
      ['2: 42833710', '2: 42⎵833⎵710'],
      ['2: 43 138', '2: 43⎵138'],
      ['+7(438)4910101: 10', '+7⍽438⍽491-01-01: 10'],
      ['+7 438 491-01-01: 10', '+7⍽438⍽491-01-01: 10']
    ]);
    settles([['<doc><a>2: 43138</a></doc>', '<doc><a>2: 43&#8239;138</a></doc>']], {
      input: 'xml',
      entities: true
    });
    // A thin space is written back as its reference, which leads the group on the next pass as well.
    settles(
      [
        ['<doc><a>0 :44\u{2009}100</a></doc>', '<doc><a>0 :44&#8201;100</a></doc>'],
        ['<doc><a>12 : 44&#8201;100</a></doc>', '<doc><a>12: 44&#8201;100</a></doc>']
      ],
      { input: 'xml', entities: true }
    );
    settles([['<doc><a>12 : 44&#8201;100</a></doc>', '<doc><a>12: 44&#8201;100</a></doc>']], {
      input: 'xml'
    });
    settles([['+7(438)4910101: 10', '+7(438)4910101: 10']], { rules: { nobr: false } });
  });

  test('a time standing apart still closes up', () => {
    settles([
      ['в 2: 43 утра', 'в⍽2:43 утра'],
      ['в 2 : 43 и 100 человек', 'в⍽2:43 и⍽100⍽человек'],
      ['в 10 : 30 : 15 и 08 : 59', 'в⍽10:30:15 и⍽08:59']
    ]);
  });

  test('closes up before an IP address, whose first octet leads no grouped number', () => {
    const rules = { 'number.thin_space_triads': false };
    settles(
      [
        ['9 :46 100.0.4.1', '9:46 100.0.4.1'],
        ['9 :46 100.5', '9 :46 100.5']
      ],
      { rules }
    );
    settles(
      [
        ['9 :46 100.0.4.1', '<p>9:46 <span style="white-space:nowrap;">100.0.4.1</span></p>'],
        ['5:⍽96⍽108.1.2.2', '<p>5:96⍽<span style="white-space:nowrap;">108.1.2.2</span></p>']
      ],
      { html: true, rules }
    );
  });

  test('a leading group of three digits, a wrapped phone or a disabled time stay apart', () => {
    settles([['2: 438138', '2: 438⎵138']]);
    settles([['2: 43138', '2: 43⎵138']], { rules: { 'number.time': false } });
    settles(
      [
        [
          '+7(438)4910101: 10',
          '<p><span style="white-space:nowrap;">+7 438 491-01-01</span>: 10</p>'
        ]
      ],
      { html: true }
    );
  });
});

describe('triads beside a wrapper a later group writes', () => {
  test('generated wrappers and unit powers keep their known next-pass triads', () => {
    for (const [input, first, second, config] of [
      [
        '5 960 650 01.08.19',
        '<p>5⎵960⎵650 <span style="white-space:nowrap;">01.08.19</span></p>',
        '<p>5⎵960⎵650 <span style="white-space:nowrap;">01.08.19</span></p>',
        {
          html: true
        }
      ],
      [
        '7 (246) 07-67-32 6 371',
        '<p><span style="white-space:nowrap;">7 (246) 07-67-32</span> 6⎵371</p>',
        '<p><span style="white-space:nowrap;">7 (246) 07-67-32</span> 6⎵371</p>',
        {
          html: true
        }
      ],
      [
        '8м2 6 126',
        '<p>8⍽м² 6⎵126</p>',
        '<p>8⍽м² 6⎵126</p>',
        {
          html: true
        }
      ],
      ['+7(261)4846588 830', '+7⍽261⍽484-65-88 830', '+7⍽261⍽484-65-88 830', {}]
    ]) {
      const typo = new MicroTypo(config);
      const once = typo.process(typeset(input));

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('a time, an address or a phone wrapped later ends the digit chain on the first pass', () => {
    const NOWRAP = '<span style="white-space:nowrap;">';
    settles(
      [
        ['3:00–9:35 2 658 898', `<p>${NOWRAP}3:00–9:35</span> 2⎵658⎵898</p>`],
        ['8 454 2:05–5:05', `<p>8⎵454 ${NOWRAP}2:05–5:05</span></p>`],
        ['7.1.7.8 2 985 983', `<p>${NOWRAP}7.1.7.8</span> 2⎵985⎵983</p>`],
        ['0 990 4.5.0.3', `<p>0⎵990 ${NOWRAP}4.5.0.3</span></p>`],
        ['1 777 8 (572) 69-29-74', `<p>1⎵777 ${NOWRAP}8 (572) 69-29-74</span></p>`]
      ],
      { html: true }
    );
  });

  test('without a wrapper the digits beside the chain keep it whole', () => {
    settles([
      ['3:00–9:35 2 658 898', '3:00–9:35 2 658 898'],
      ['8 454 2:05–5:05', '8 454 2:05–5:05'],
      ['7.1.7.8 2 985 983', '7.1.7.8 2 985 983']
    ]);
    settles([['<b>35</b> 2 658 898', '<p><b>35</b> 2 658 898</p>']], { html: true });
  });

  test('a terminal line break leaves grouped triads on the first pass', () => {
    settles([['цена 9 127\n', 'цена 9⎵127']]);
  });

  test('a postal index keeps its city across a line break, not across a blank line', () => {
    settles([
      ['307762,\nВологда', '307762,\nВологда'],
      ['307762,\n\nВологда', '307⎵762,\n\nВологда']
    ]);
    settles(
      [
        ['307762,\nВологда', '<p>307762,<br>\nВологда</p>'],
        ['620991 г.\nЕкатеринбург', '<p>620991⍽г.<br>\nЕкатеринбург</p>'],
        ['<p>307762,<br>\nВологда</p>', '<p>307762,<br>\nВологда</p>'],
        ['307762,\n\nВологда', '<p>307⎵762,</p>\n\n<p>Вологда</p>']
      ],
      { html: true }
    );
  });

  test('a postal index before a generated date wrapper keeps its known next-pass triads', () => {
    for (const [input, first, second, config] of [
      [
        '103811,П 05.02.19',
        '<p>103811, <span style="white-space:nowrap;">П 05.02.19</span></p>',
        '<p>103811, <span style="white-space:nowrap;">П 05.02.19</span></p>',
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
      settles([['9 127\nдалее', '9⎵127\nдалее']], config);
    }
    settles([['9 127\nдалее', '<p>9⎵127\nдалее</p>']], {
      html: true,
      render: { breakline: false }
    });
  });

  test('a newline inside an authored element keeps the base spacing', () => {
    settles(
      [
        ['<div>9 127\nдалее</div>', '<div>9⎵127\nдалее</div>'],
        ['<span>9 127\nдалее</span>', '<p><span>9⎵127\nдалее</span></p>']
      ],
      { html: true }
    );
  });

  test('a generated line break is read as an authored line break on the next pass', () => {
    const typo = new MicroTypo({ html: true });
    const once = typo.process('9 127\nдалее');

    assert.equal(once, '<p>9\u{202F}127<br>\nдалее</p>');
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
      ['Ко А.Г. н', 'Ко⍽А.⍽Г. н', 'Ко⍽А.⍽Г. н', {}],
      ['До В.С. 8', 'До⍽В.⍽С. 8', 'До⍽В.⍽С. 8', {}],
      ['Г.Г. 2', 'Г.⍽Г. 2', 'Г.⍽Г. 2', {}],
      ['пр.Ш. П', 'пр.⍽Ш.⍽П', 'пр.⍽Ш.⍽П', {}],
      [
        'П.Г.Фл',
        '<p><span style="white-space:nowrap;">П.⍽Г.⍽Фл</span></p>',
        '<p><span style="white-space:nowrap;">П.⍽Г.⍽Фл</span></p>',
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
        '<p><span style="white-space:nowrap;">Л. Н. Дм</span> <span style="white-space:nowrap;">И. И. Ке</span>.</p>',
        '<p><span style="white-space:nowrap;">Л. Н. Дм</span> <span style="white-space:nowrap;">И. И. Ке</span>.</p>',
        {
          html: true
        }
      ],
      [
        'о Пи КЛ',
        '<p><span style="white-space:nowrap;">о Пи К. Л.</span></p>',
        '<p><span style="white-space:nowrap;">о Пи К. Л.</span></p>',
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
        '<p><span style="white-space:nowrap;">м Ло К. Р.</span>⍽<</p>',
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
      ['Ко А. Г. н', 'Ко⍽А.⍽Г. н'],
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
    ['с.5 <a>ч т</a>', 'с.⍽5⍽<a>ч⍽т</a>', { input: 'html' }],
    ['с.3 ч зм', 'с.&nbsp;3&nbsp;ч&nbsp;зм', { entities: '1' }],
    ['<doc><note>гл.5 м</note></doc>', '<doc><note>гл.⍽5⍽м</note></doc>', { input: 'xml' }],
    ['с.8 см.х', 'с.&nbsp;8&nbsp;см. х', { entities: '1' }],
    ['с.1 Л', 'с.⍽1⍽Л', { input: 'markdown' }],
    ['п.3 т', 'п.⍽3⍽т', { input: 'html' }],
    ['с.7 кг пи', 'с.&nbsp;7&nbsp;кг&nbsp;пи', { entities: true }],
    ['гл.1 Т.И.Це', 'гл.&nbsp;1&nbsp;Т.&nbsp;И.&nbsp;Це', { entities: 1 }],
    ['с.9 *px* Пл', 'с.&nbsp;9&nbsp;*px* Пл', { entities: 1, input: 'markdown' }],
    ['с.6 ч.⍽', 'с.&nbsp;6&nbsp;ч.&nbsp;', { entities: true, input: 'markdown' }],
    ['гл.1 м', 'гл.⍽1⍽м', {}],
    ['с.8 см.е', 'с.&nbsp;8&nbsp;см. е', { entities: true, input: 'markdown' }],
    ['с.8 мм сс', 'с.&nbsp;8&nbsp;мм&nbsp;сс', { entities: '1', input: 'markdown' }],
    ['с.0 Л', 'с.⍽0⍽Л', { input: 'html' }],
    ['с.5 т', 'с.⍽5⍽т', { input: 'html' }],
    ['с.6 т сы', 'с.&nbsp;6&nbsp;т&nbsp;сы', { entities: true }],
    ['гл.5\tт', 'гл.⍽5⍽т', {}],
    ['<doc><p>с.5 ч</p></doc>', '<doc><p>с.⍽5⍽ч</p></doc>', { input: 'xml' }],
    ['с.9 м', 'с.⍽9⍽м', { input: 'frontmatter' }],
    ['с.1 Л', 'с.&nbsp;1&nbsp;Л', { entities: 'on', input: 'markdown' }],
    ['с.9 т', 'с.⍽9⍽т', { input: 'html' }],
    ['с.1 г ыш', 'с.&nbsp;1&nbsp;г&nbsp;ыш', { entities: true, input: 'html' }],
    ['с.1\tч', 'с.&nbsp;1&nbsp;ч', { entities: 'on' }]
  ];

  for (const [input, expected, config] of UNIT_CASES) {
    test(`a number glued to an abbreviation keeps its unit binding: ${input}`, () => {
      settles([[input, expected]], config);
    });
  }

  test('a reference after a unit preserves the stable XML entity output', () => {
    settles([['<doc>9см.к</doc>', '<doc>9&#160;см. к</doc>']], {
      input: 'xml',
      entities: true
    });
  });

  test('a glued unit retains the known abbreviation remainder', () => {
    const typo = new MicroTypo();

    for (const [input, first, second] of [
      ['с. 2026г', 'с.⍽2026⍽г', 'с.⍽2026⍽г'],
      ['П. 1978г', 'П.⍽1978⍽г', 'П.⍽1978⍽г'],
      ['9см.к', '9⍽см. к', '9⍽см. к']
    ]) {
      const once = typo.process(input);

      assert.equal(once, typeset(first));
      assert.equal(typo.process(once), typeset(second));
    }
  });

  test('a postal index with a glued г and a plain reference read as before', () => {
    settles([
      ['125009г. Москва', '125009⍽г.⍽Москва'],
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
  test('an authored day range follows its enabled owner inside the canonical wrapper', () => {
    const rules = { 'date.*': true };
    settles(
      [
        [
          '<span style="white-space:nowrap;">6—7 августа</span>',
          '<p><span style="white-space:nowrap;">6—7 августа</span></p>'
        ]
      ],
      { html: true, rules }
    );
  });

  test('the enabled day-range owner preserves its em dash on every pass', () => {
    const typo = new MicroTypo({ html: true, rules: { 'date.*': true } });
    const once = typo.process('6-7 августа');

    assert.equal(once, '<p><span style="white-space:nowrap;">6—7 августа</span></p>');
    assert.equal(typo.process(once), once);
    assert.equal(typo.process(typo.process(once)), once);
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

  test('an enabled day range keeps its dash in a wrapper with extra content', () => {
    settles(
      [
        [
          '<span style="white-space:nowrap;">6—7 августа<b>пример</b></span>',
          '<p><span style="white-space:nowrap;">6—7 августа<b>пример</b></span></p>'
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
  test('a terminal quote reference is the quote, so the next pass reads the same balance', () => {
    settles([['"„"" й“ a.ru/"', '&laquo;&bdquo;&bdquo;&ldquo; й&ldquo; a.ru/&raquo;']], {
      entities: true
    });
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

  test('an address in an inner quotation ends at its closer, whatever is glued behind it', () => {
    settles([
      ['"а "http://x.ru/b"+ в"', '«а⍽„http://x.ru/b“+ в»'],
      ['„"http:g"+“', '«„http:g“+»'],
      ['«а „http://x.ru/b“+ в»', '«а⍽„http://x.ru/b“+ в»'],
      ['см. http://x.ru/“a”b и', 'см.⍽http://x.ru/“a”b и']
    ]);
    settles([
      ['""еo.uk/"/»', '«„еo.uk/“/»'],
      ['«„сr.ru/“x»', '«„сr.ru/“x»'],
      ['«„см.http://x.ru/b“+ в»', '«„см.⍽http://x.ru/b“+ в»'],
      ['„а“ http://x.ru/“b” и', '«а» http://x.ru/“b” и']
    ]);
    settles([['""лhttp:2"!»', '«„лhttp:2“!»']], { input: 'frontmatter' });
    settles(
      [
        ['"а "http://x.ru/b"+ в"', '&laquo;а&nbsp;&bdquo;http://x.ru/b&ldquo;+ в&raquo;'],
        [
          '«а &#8222;http://x.ru/b&#8220;+ в»',
          '&laquo;а&nbsp;&bdquo;http://x.ru/b&ldquo;+ в&raquo;'
        ]
      ],
      { entities: true }
    );
  });
});

describe('a quote behind a Markdown code span', () => {
  test('closes behind the span as behind a word, wherever another quote changes near it', () => {
    settles(
      [
        ['""о" ``"``"]', '«„о“ ``"``»]'],
        ['«„о“ ``"``"]', '«„о“ ``"``»]'],
        ['"а `б`"]', '«а⍽`б`»]']
      ],
      { input: 'markdown' }
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
        ['    один\n\n    два\n    три', '<p>    один</p>\n\n<p>два<br>\n    три</p>'],
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
  test('a high quote closes the low quote standing innermost, unless it opens an English pair', () => {
    settles(
      [
        ['„x“word” z“', '<p>«x"word» z"</p>'],
        ['„A“word” Z“', '<p>«A"word» Z"</p>'],
        ['„x “» z“', '<p>«x»" z"</p>'],
        ['«„“»', '<p>«„“»</p>']
      ],
      { html: true }
    );
  });
  test('preserves the base output when an empty pair is nested', () => {
    const typo = new MicroTypo();
    const once = typo.process('«“”»');

    assert.equal(once, '«„“»');
    assert.equal(typo.process(once), '«„“»');
    assert.equal(typo.process('«„“»'), '«„“»');
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

  test('the nested pair the first pass writes closes the same way on the next, whatever stands before its closer', () => {
    settles([
      ['"“&#171;бть-->&#187;с”"', '«„„бть-->“с“»'],
      ['„x “ y“ z', '«x» y" z'],
      ['„“', '«»'],
      ['«„x“-y»', '«„x“-y»'],
      ['«„x“>y»', '«„x“>y»']
    ]);
    settles([['««а » »', '«„а “ »']], { rules: { space: false } });
    settles([['<doc><title>"“ремё]>”ы»</title></doc>', '<doc><title>«„ремё]>“ы»</title></doc>']], {
      input: 'xml'
    });
  });
});

describe('a straight quote glued behind a closer the same pass writes', () => {
  test('closes on that pass, as it closes behind the closer on the next', () => {
    settles([
      ['"«««»"»" 6', '«„„„“““» 6'],
      ['"""}"»" X', '«„„}““» X'],
      ['"“"}"”".', '«„„}““».'],
      ['«"а"» б', '«„а“» б'],
      ['"а"; б', '«а»; б']
    ]);
    settles([['«„"𝟙"“" $', '«„„𝟙““» $']], { input: 'html' });
    settles([['"""₽"»" ', '«„„₽““»']], { input: 'markdown' });
  });
});

describe('a straight quote glued to a digit behind a closer with nothing to close', () => {
  test('closes the quotation standing open, so the quote after it opens the next', () => {
    settles([
      ['к" "5" " к', 'к" «5» «к'],
      ['Экран 15" и корпус', 'Экран 15″ и⍽корпус'],
      ['"Экран 15" и корпус"', '«Экран 15″ и⍽корпус»'],
      ['а" экран 15" и " б', 'а" экран 15″ и⍽«б']
    ]);
    settles([['ь" "4" " А', 'ь" «4» «А']], { input: 'html' });
  });
});

describe('a straight quote that cannot open, first among the quotes of its paragraph', () => {
  test('asks no quote after it to open, whatever the closer it came from', () => {
    settles([
      ['Конец.» ""Нет" " да " (', 'Конец." «„Нет“ " да» ('],
      ['Конец." «„Нет“ " да» (', 'Конец." «„Нет“ " да» ('],
      ['Конец" «„Нет“ " да» и', 'Конец" «„Нет“ " да» и'],
      ['текст" и "цитата"', 'текст" и⍽«цитата»']
    ]);
    settles([['Конец.» ""Нет" " да " (', 'Конец." «„Нет“ " да» (']], { input: 'html' });
  });
});

describe('a straight quote last in the text before the spaces a format keeps there', () => {
  test('closes as it closes last in the text', () => {
    settles([['"8" " ', '«8″»']], { input: 'frontmatter' });
    settles([['"8" "', '«8″»']]);
    settles([['"<!>" ', '«<!>»']], { input: 'frontmatter' });
  });
});

describe('an empty quotation written apart before a mark of the sentence', () => {
  test('is the empty pair the quotation written together is', () => {
    settles([
      ['" ".', '«».'],
      ['а " ", б', 'а⍽«», б'],
      ['"".', '«».'],
      ['" " слово', '«» слово'],
      ['" "слово', '««слово']
    ]);
    settles([['" ".', '<p>«».</p>']], { html: true });
  });

  test('keeps its pair once the opening quote hangs', () => {
    const hanging = '<p><span style="margin-left:-0.44em;">«</span>';
    settles(
      [
        ['" ".', `${hanging}».</p>`],
        ['" ",', `${hanging}»,</p>`],
        ['&#x22; &#x22;:', `${hanging}»:</p>`]
      ],
      { html: true, rules: { hanging: true } }
    );
  });
});

describe('an opening guillemet in an element behind a space or a line indent', () => {
  test('stays an opener once the hanging quote wraps it', () => {
    const quote = '<span style="margin-left:-0.44em;">«</span>';
    const space = '<span style="margin-right:0.44em;"> </span>';
    settles(
      [
        [' „', `<p> ${quote}</p>`],
        ['иях „', `<p>иях${space}${quote}</p>`],
        ['иях «', `<p>иях${space}${quote}</p>`]
      ],
      { html: 1, rules: { 'hanging.*': true } }
    );
    settles([['иях „ «" “ 9', `<p>иях${space}${quote} «» " 9</p>`]], {
      html: 1,
      rules: { 'hanging.*': true, 'space.strip_quote_padding': false }
    });
  });

  test('turns round only glued to the word its element follows, as outside markup', () => {
    settles(
      [
        ['иях <span> </span><span>«</span>', 'иях <span> </span><span>«</span>'],
        ['«<a href="/x">Вестник</a>«.', '«<a href="/x">Вестник</a>».'],
        ['«слово <b>"</b>', '«слово <b>»</b>']
      ],
      { input: 'html' }
    );
  });
});

describe('a straight quote before the line break the first pass writes', () => {
  test('opens as before the newline it stands for', () => {
    settles(
      [
        ['“\nт', '<p>«<br>\nт</p>'],
        ['"\n"', '<p>«<br>\n»</p>'],
        ['"\n;', '<p>«<br>\n;</p>'],
        ['"\nслово"', '<p>«<br>\nслово»</p>'],
        ['"слово\nдальше"', '<p>«слово<br>\nдальше»</p>']
      ],
      { html: true }
    );
    settles([['<b>"</b><br>"', '<b>«</b><br>»']], { input: 'html' });
  });
});

describe('a closer with no quotation open behind a weak neighbour', () => {
  test('opens where a straight quote there opens on the next pass', () => {
    settles([
      [';»ж', ';«ж'],
      [";&raquo;'", ";«'"],
      ['Привет,»сказал он', 'Привет, «сказал⍽он']
    ]);
    settles([[';&raquo;с', ';«с']], { input: 'html' });
    settles(
      [
        [' »о', ' «о'],
        ['>»ф', '>«ф'],
        ['`&quot;»', '`«»']
      ],
      { input: 'markdown' }
    );
  });

  test('a second closer glued behind it is the empty pair it closes', () => {
    settles([[';»“', ';«»']], { input: 'html' });
    settles([['>»“', '>«»']], { input: 'frontmatter' });
  });

  test('behind a character reference in XML reads the glyph it spells, not its semicolon', () => {
    settles(
      [
        ['<doc><i>“”"” hppng</i></doc>', '<doc><i>&#171;&#187;"" hppng</i></doc>'],
        ['<doc><i>а&#187;"" б</i></doc>', '<doc><i>а&#187;"" б</i></doc>']
      ],
      { input: 'xml', entities: true }
    );
    settles([['<doc><i>а&#59;»ж</i></doc>', '<doc><i>а&#59;«ж</i></doc>']], { input: 'xml' });
  });

  test('stays a straight quote before a space, and a closer where a quotation is open', () => {
    settles([
      ['а;» б', 'а;" б'],
      ['«а;» б', '«а;» б'],
      ['«Привет,»сказал он', '«Привет,»сказал⍽он'],
      ['а:».«', 'а:".«']
    ]);
  });
});

describe('a closer first among the quotes of its paragraph, where an opener is meant', () => {
  test('a straight quote glued behind it opens behind it on the first pass', () => {
    settles([['»"к', '««к']], { input: 'markdown' });
    settles([
      ['”"м', '««м'],
      ['а\n\n»"к', 'а\n\n««к']
    ]);
  });

  test('stays as written with the quote rules off', () => {
    settles([['»"к', '»"к']], { rules: { quote: false } });
  });

  test('behind a closed quotation, a straight quote glued behind it opens on the first pass too', () => {
    settles(
      [
        ['"" »"\'', "«» ««'"],
        ['"" »"/', '«» ««/'],
        ['«“ ”"\'', "«» ««'"]
      ],
      { input: 'markdown' }
    );
    settles([
      ['«а» »"б" в»', '«а» «„б“ в»'],
      ['«а» »"б в', '«а» ««б⍽в']
    ]);
    settles([['«а» »"б" в»', '«а» «"б» в"']], { rules: { 'quote.open': false } });
  });
});

describe('a straight quote left undecided where a quote opens', () => {
  test('keeps an ordinary space before a dash or a particle', () => {
    settles([['"<l> —', '"<l> —']], { input: 'markdown' });
    settles([['"<!>" -', '«<!>» —']]);
    settles([['„" ж "', '«" ж "']], { input: 'markdown', rules: { 'quote.close': false } });
    settles([['«" ж бы', '«" ж⍽бы']], { rules: { 'quote.close': false } });
  });

  test('binds the dash behind one glued to a word or to the end of an element', () => {
    settles([['а" — б', 'а"⍽— б']], { rules: { 'quote.close': false } });
    settles([['<p>а</b>" — б</p>', '<p>а</b>"⍽— б</p>']], { input: 'html' });
  });
});

describe('a straight quote spaced behind an ellipsis typed as dots', () => {
  test('closes as behind the ellipsis character', () => {
    settles([
      ['"Ну... " — сказал он', '«Ну…»⍽— сказал⍽он'],
      ['"Ну… " — сказал он', '«Ну…»⍽— сказал⍽он']
    ]);
    settles(
      [
        [
          '<doc><title>«</title><description>... " о</description></doc>',
          '<doc><title>«</title><description>…» о</description></doc>'
        ]
      ],
      { input: 'xml' }
    );
  });
});

describe('two straight quotes behind a weak neighbour before a mark of the sentence', () => {
  test('are the empty quotation, as behind a strong neighbour', () => {
    settles([[';"&#34;,', ';«»,']], { rules: { 'quote.close': false } });
    settles([
      ['а;"", б', 'а;«», б'],
      ['а:"". б', 'а:«». б']
    ]);
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

  test('document boundary normalization stays local to each input format', () => {
    for (const [input, first, second, config] of [
      ['⍽о об', 'о⍽об', 'о⍽об', {}],
      ['⍽– А', '—⍽А', '—⍽А', {}],
      ['003 гг.\n', '003⍽гг.', '003⍽гг.', {}],
      [
        '---\ntitle: test\n---\n\n\n1997год.',
        '---\ntitle: test\n---\n\n\n1997⍽год.',
        '---\ntitle: test\n---\n\n\n1997⍽год.',
        { input: 'frontmatter' }
      ],
      [
        '---\ntitle: test\n---\n\nГост 5773-90',
        '---\ntitle: test\n---\n\nГОСТ⍽5773–90',
        '---\ntitle: test\n---\n\nГОСТ⍽5773–90',
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
    settles([['    код\n', '    код\n']], { input: 'markdown' });
  });
});

describe('stable baseline initials', () => {
  test('N-period', () => {
    settles([['Иванов А.Б.)', 'Иванов⍽А.⍽Б.)']], {
      rules: {
        'nobr.initials_dots': true
      }
    });
  });

  test('N-period-only', () => {
    settles([['Иванов⍽Г. Б.)', 'Иванов⍽Г.⍽Б.)']], {
      rules: {
        'nobr.initials_dots': true
      }
    });
  });

  test('N-period-surname', () => {
    settles(
      [
        ['Иванов А.Б.Петров', '<p>Иванов <span style="white-space:nowrap;">А. Б. Петров</span></p>']
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
    settles([['М.⍽Д. Иванов', '<p><span style="white-space:nowrap;">М.⍽Д.⍽Иванов</span></p>']], {
      html: true,
      rules: {
        'other.*': false
      }
    });
  });

  test('N-adjacent-short', () => {
    settles([['А.Б.Ян В.Г.Юн', 'А.⍽Б.⍽Ян⍽В.⍽Г.⍽Юн']]);
  });

  test('N-adjacent-line', () => {
    settles([['А.Б.Ян В.Г.\nЮн', 'А.⍽Б.⍽Ян⍽В.⍽Г.⍽Юн']]);
  });
});

describe('stable baseline triads', () => {
  test('T-phone', () => {
    settles([['8-800-123-45-67 123', '8-800-123-45-67 123']]);
  });

  test('T-hyphen', () => {
    settles([['8240-57 347', '8240-57⎵347']], {
      rules: {
        endash: false
      }
    });
  });

  test('T-sup', () => {
    settles([['м² 1 000', 'м² 1⎵000']]);
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
          '<p>103811, <span style="white-space:nowrap;">П 05.02.19</span></p>'
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
    settles([['а ⍽:tip', 'а ⍽:tip']]);
  });

  test('S-decimal', () => {
    settles([['1.2 :tip', '1.2 :tip']]);
  });

  test('S-chain', () => {
    settles([['1.2?!А', '1.2?!А']]);
  });

  test('S-triadunit', () => {
    settles([['1234567сек  :::tip', '<p>1⎵234⎵567сек: tip</p>']], {
      html: true
    });
  });

  test('S-email', () => {
    settles([['a@b.co  :::tip', '<p><a href="mailto:a@b.co">a@b.co</a> :tip</p>']], {
      html: true
    });
  });
});

describe('a guillemet reference at the end of an address', () => {
  test('is the guillemet after the address, as the character is', () => {
    settles([
      ['http://a.ru/&raquo;', 'http://a.ru/»'],
      ['«http://a.ru/»&raquo;', '«http://a.ru/»"']
    ]);
    settles([['http://a.ru/&raquo;', '<p><a href="http://a.ru/">a.ru/</a>»</p>']], { html: true });
    settles([['k: "а  б amber.ru/&raquo; в"', 'k: "а⍽б⍽amber.ru/» в"']], { input: 'yaml' });
  });

  test('the closing quote entity mode writes after an address is read back as one', () => {
    settles(
      [
        ['"www." е"', '&laquo;www.&raquo; е"'],
        ['"site.ru/a?b=1&c=2" е"', '&laquo;site.ru/a?b=1&c=2&raquo; е"']
      ],
      { entities: true }
    );
    settles([['"http:/".». е', '&laquo;http:/&raquo;.". е']], {
      entities: true,
      input: 'markdown'
    });
  });

  test('an escaped straight quote stays the address’s', () => {
    settles([['http://a.ru/?q=&quot;x&quot;', 'http://a.ru/?q=&quot;x&quot;']]);
  });
});

describe('nowrap ownership with nested cleanup disabled', () => {
  test('does not wrap its own serialized hyphen phrase again', () => {
    settles(
      [
        ['один-ка к', '<span style="white-space:nowrap;">один-ка к</span>'],
        [
          '<span style="white-space:nowrap;">один-ка к</span>',
          '<span style="white-space:nowrap;">один-ка к</span>'
        ],
        ['<em>один-ка к</em>', '<em>один-ка⍽к</em>'],
        ['<p>один-ка к</p>', '<p><span style="white-space:nowrap;">один-ка к</span></p>'],
        [
          '<span style="white-space:nowrap;"> один-ка к</span>',
          '<span style="white-space:nowrap;"> один-ка к</span>'
        ],
        [
          '<span style="white-space:nowrap;">слово один-ка к</span>',
          '<span style="white-space:nowrap;">слово один-ка к</span>'
        ],
        [
          '<span style="white-space:nowrap;"><span style="white-space:nowrap;">один-ка к</span></span>',
          '<span style="white-space:nowrap;"><span style="white-space:nowrap;">один-ка к</span></span>'
        ]
      ],
      { html: true, input: 'frontmatter', rules: { nobr: true, 'other.drop_nested_nowrap': false } }
    );
  });
});

describe('the direction of a matched low/high quotation', () => {
  test('survives normalization with closing conversion disabled', () => {
    settles(
      [
        ['«“те”»', '&laquo;&bdquo;те&ldquo;&raquo;'],
        ['«„те“»', '&laquo;&bdquo;те&ldquo;&raquo;'],
        ['«„“»', '&laquo;&bdquo;&ldquo;&raquo;']
      ],
      { entities: true, input: 'markdown', rules: { 'quote.close': false } }
    );
  });
  test('a definite closer ends its low pair before another English high opener', () => {
    for (const close of [true, false]) {
      settles(
        [
          ['«„a” b “x”»', '«„a“ b⍽„x“»'],
          ['«„a» b “x”»', '«„a“ b⍽„x“»'],
          ['«„a“ b “x”»', '«„a“ b⍽„x“»']
        ],
        { rules: { 'quote.close': close } }
      );
    }
  });
});

describe('abbreviation meaning after a generated boundary', () => {
  test('retains the unit and initial roles and binds a real numeric reference', () => {
    settles([
      ['с. 2026г', 'с.⍽2026⍽г'],
      ['д. 9руб', 'д.⍽9⍽₽'],
      ['9см.к', '9⍽см. к'],
      ['До В.С. 8', 'До⍽В.⍽С. 8'],
      ['Ко А.Г. н', 'Ко⍽А.⍽Г. н'],
      ['Г.Г. 2', 'Г.⍽Г. 2'],
      ['С.8', 'С.⍽8'],
      ['см. 8', 'см.⍽8'],
      ['п.3 т', 'п.⍽3⍽т']
    ]);
  });
  test('does not run a disabled dependent reader', () => {
    settles([['с. 2026г', 'с. 2026⍽г']], { rules: { 'abbr.nbsp_short_acronym': false } });
    settles([['д. 9руб', 'д. 9⍽₽']], { rules: { 'abbr.nbsp_location': false } });
  });
});

describe('numeric notation exposed by a unit', () => {
  test('renders an enabled power after the unit releases its boundary', () => {
    settles([['x_2р', '<p>x<sub><small>2</small></sub>⍽₽</p>']], { html: true });
    settles([['6^2р', '<p>6<sup><small>2</small></sup>⍽₽</p>']], { html: true });
    settles([['6^2р', '<p>6^2⍽₽</p>']], { html: true, rules: { 'number.sup': false } });
    settles([['6^2р', '6^2⍽₽']], { html: false });
  });
});

describe('a colon or a prime after a number an abbreviation or a currency sign exposes', () => {
  test('a colon glued to the next word after a bound house number is parted in the same pass', () => {
    settles([
      ['в д.8 :а', 'в д.⍽8: а'],
      ['в д.8:30', 'в д.⍽8:30']
    ]);
    settles([['в д.8 :а', 'в д.⍽8 :а']], { rules: { 'space.space_after_punctuation': false } });
  });

  test('a prime after a number a currency sign parts is set in the same pass', () => {
    settles(
      [
        ["для ₽81'.", 'для ₽⍽81′.'],
        ["для ₽81'а.", "для ₽⍽81'а."]
      ],
      {}
    );
    settles([["для ₽81'.", 'для ₽⍽81′.']]);
  });
});

describe('phone and postal boundaries keep their meaning', () => {
  test('recognizes a phone before collapsing long author gaps', () => {
    settles([
      ['+7        261 484-65-88 830', '+7⍽261⍽484-65-88 830'],
      ['+7 (261) 484-65-88             830', '+7⍽(261)⍽484-65-88 830'],
      ['8240-57 347', '8240–57⎵347']
    ]);
  });
  test('preserves a postal index across the written city gap', () => {
    settles([
      ['125009 г. Москва', '125009⍽г.⍽Москва'],
      ['125009⍽г. Москва', '125009⍽г.⍽Москва'],
      ['125009г. Москва', '125009⍽г.⍽Москва'],
      ['103811, Москва', '103811, Москва'],
      ['цена 123456 руб.', 'цена 123⎵456⍽₽.']
    ]);
  });
});

describe('shared boundaries after a period', () => {
  test('formats each word after the shared gap on the first pass', () => {
    settles([
      ['Е.Опять доц.Плащи', 'Е.⍽Опять доц.⍽Плащи'],
      ['Р.Калер тов.Слова', 'Р.⍽Калер тов.⍽Слова']
    ]);
  });
});

describe('prospective period and punctuation boundaries', () => {
  test('uses only enabled readers when the two kinds alternate', () => {
    for (const [period, punctuation, expected] of [
      [true, true, 'Е.⍽Опять: нет. что'],
      [true, false, 'Е.⍽Опять:нет.что'],
      [false, true, 'Е.Опять:нет.что'],
      [false, false, 'Е.Опять:нет.что']
    ]) {
      settles([['Е.Опять:нет.что', expected]], {
        rules: {
          'space.space_after_period': period,
          'space.space_after_punctuation': punctuation
        }
      });
    }
  });
  test('settles a mixed chain independently of its length', () => {
    settles([
      [`начало.${'текст:новое.'.repeat(128)}место`, `начало. ${'текст: новое. '.repeat(128)}место`]
    ]);
  });
});

describe('a canonical nowrap keeps its visible dash boundary', () => {
  test('does not invent a right gap when etc moves its neighbour into a wrapper', () => {
    for (const nowrap of ['span', 'nobr']) {
      const wrapped =
        nowrap === 'nobr'
          ? '<nobr>П и т. п.</nobr>'
          : '<span style="white-space:nowrap;">П и т. п.</span>';
      settles(
        [
          ['еня -П⍽и тп', `<p>еня -${wrapped}</p>`],
          [`еня -${wrapped}`, `<p>еня -${wrapped}</p>`],
          ['еня - П⍽и тп', `<p>еня&nbsp;&mdash; ${wrapped}</p>`],
          ['еня — П⍽и тп', `<p>еня&nbsp;&mdash; ${wrapped}</p>`]
        ],
        { html: true, entities: true, render: { nowrap } }
      );
    }
  });
});

describe('initial points and surname boundaries', () => {
  test('a wider gap separates the preceding word from a complete name', () => {
    const rules = { 'nobr.*': true };
    settles(
      [
        ['Рядом ⍽Д.⍽Р.Орлов.', 'Рядом ⍽Д.⍽Р.⍽Орлов.'],
        ['Рядом ⍽Д.⍽Р. Орлов.', 'Рядом ⍽Д.⍽Р.⍽Орлов.'],
        ['Орлов ⍽Д.⍽Р.', 'Орлов⍽Д.⍽Р.'],
        ['Рядом ⍽Орлов.', 'Рядом ⍽Орлов.'],
        ['Ты ⍽же пришёл.', 'Ты ⍽же пришёл.']
      ],
      { rules }
    );
    settles(
      [
        [
          'Рядом &nbsp;Д.&nbsp;Р. Орлов.',
          '<p>Рядом &nbsp;<span style="white-space:nowrap;">Д. Р. Орлов</span>.</p>'
        ]
      ],
      { html: true, input: 'html', entities: true, rules }
    );
    settles([['Рядом ⍽Д.⍽Р.Орлов.', 'Рядом ⍽Д.⍽Р.Орлов.']], {
      rules: { 'nobr.initials_dots': true, 'nobr.nowrap_initials': false }
    });
  });

  test('never borrows a supplied final point as a right boundary', () => {
    settles([['Иванов А.Б.)', 'Иванов⍽А.⍽Б.)']], { rules: { 'nobr.initials_dots': true } });
    settles(
      [
        [
          'Иванов А.Б.Петров',
          '<p>Иванов <span style="white-space:nowrap;">А. Б. Петров</span></p>'
        ],
        [
          'Иванов А.Б. Петров',
          '<p><span style="white-space:nowrap;">Иванов А. Б.</span> Петров</p>'
        ]
      ],
      { html: true, rules: { 'nobr.initials_dots': true } }
    );
  });
});

describe('initial wrapping within an existing canonical nowrap', () => {
  test('keeps undivided abbreviations where moving an authored boundary would turn them into initials', () => {
    for (const nowrap of ['span', 'nobr']) {
      const wrap = (body) =>
        nowrap === 'span'
          ? `<span style="white-space:nowrap;">${body}</span>`
          : `<nobr>${body}</nobr>`;
      const config = {
        html: true,
        input: 'html',
        render: { nowrap, paragraphs: false },
        rules: { 'nobr.initials_dots': true }
      };
      for (const body of [
        'ИП Иванов издал «Маяк».',
        'АО Ромашка',
        'ГК Самолёт',
        'ФК Зенит',
        'ТЦ Весна',
        'Ромашка АО.'
      ]) {
        const text = wrap(body);
        settles(
          [
            [text, text],
            [`Автор⍽${text}`, `Автор⍽${text}`]
          ],
          config
        );
      }
      settles(
        [
          ['АО Ромашка', wrap('А. О. Ромашка')],
          ['Ромашка АО', wrap('Ромашка А. О.')],
          [wrap('А С Пушкин'), wrap('А. С. Пушкин')],
          [`Автор⍽${wrap('Пушкин А.С.')}`, wrap('Автор Пушкин А. С.')],
          [wrap('Начало Ло КР'), wrap('Начало Ло К. Р.')]
        ],
        config
      );
      settles([[`Автор⍽${wrap('АО Ромашка')}`, wrap('Автор АО Ромашка')]], {
        ...config,
        rules: { 'nobr.initials_dots': false }
      });
    }
  });
  test('normalizes the first name inside the same authored element in both orders', () => {
    for (const nowrap of ['span', 'nobr']) {
      const open = nowrap === 'span' ? '<span style="white-space:nowrap;">' : '<nobr>';
      const close = nowrap === 'span' ? '</span>' : '</nobr>';
      const wrap = (s) => `${open}${s}${close}`;
      const config = { html: true, input: 'html', render: { nowrap } };
      settles(
        [
          [wrap('А.С. Пушкин'), `<p>${wrap('А. С. Пушкин')}</p>`],
          [`автор⍽${wrap('Пушкин А.С.')}`, `<p>${wrap('автор Пушкин А. С.')}</p>`],
          [`автор⍽${open}А.С. Пушкин`, `<p>${open}автор А.⍽С.⍽Пушкин</p>`],
          [`<em>${wrap('А.С. Пушкин')}</em>`, `<p><em>${wrap('А. С. Пушкин')}</em></p>`],
          [wrap('Пушкин А. С.'), `<p>${wrap('Пушкин А. С.')}</p>`]
        ],
        config
      );
      settles([[`автор⍽${wrap('А.С. Пушкин')}`, `<p>автор⍽${wrap('А.⍽С.⍽Пушкин')}</p>`]], {
        ...config,
        rules: { 'other.strip_nbsp_in_nowrap': false }
      });
      settles([[wrap('А.С. Пушкин'), `<p>${wrap('А.С. Пушкин')}</p>`]], {
        ...config,
        rules: { 'nobr.nowrap_initials': false }
      });
      settles([[wrap('А С Пушкин'), `<p>${wrap('А. С. Пушкин')}</p>`]], {
        ...config,
        rules: { 'nobr.initials_dots': true }
      });
    }
  });
  test('normalizes points without creating a redundant nested wrapper', () => {
    for (const nowrap of ['span', 'nobr']) {
      const wrap = (body) =>
        nowrap === 'nobr'
          ? `<nobr>${body}</nobr>`
          : `<span style="white-space:nowrap;">${body}</span>`;
      settles(
        [
          ['м⍽Ло К.Р⍽<', `<p>${wrap('м Ло К. Р.')}⍽<</p>`],
          [
            wrap('<span class="x">вступление</span> Ло КР'),
            `<p>${wrap('<span class="x">вступление</span> Ло К. Р.')}</p>`
          ],
          [wrap(wrap('Ло К. Р.')), `<p>${wrap(wrap('Ло К. Р.'))}</p>`],
          [
            wrap('<em style="white-space:normal;">Начало Ло КР</em>'),
            `<p>${wrap(`<em style="white-space:normal;">Начало ${wrap('Ло К. Р.')}</em>`)}</p>`
          ],
          [
            wrap('<span style="white-space:normal;">Начало Ло КР</span>'),
            `<p>${wrap(`<span style="white-space:normal;">Начало ${wrap('Ло К. Р.')}</span>`)}</p>`
          ]
        ],
        {
          html: true,
          render: { nowrap },
          rules: { 'nobr.initials_dots': true, 'other.drop_nested_nowrap': false }
        }
      );
    }
  });
});

describe('quote paragraph boundaries serialized as line breaks', () => {
  test('keeps the blank paragraph after source rendering and authored br pairs', () => {
    settles([['«\n\n«„судьба“»', '«<br>\n<br>\n«„судьба“»']], {
      html: true,
      input: 'html',
      render: { paragraphs: false }
    });
    settles(
      [
        ['«<br>\n<br>\n«„судьба“»', '«<br>\n<br>\n«„судьба“»'],
        [
          '«<br class="x">\t <br data-x="a - b">«„судьба“»',
          '«<br class="x">\t <br data-x="a - b">«„судьба“»'
        ]
      ],
      { input: 'html', rules: { 'space.collapse_spaces': false } }
    );
  });
  test('a line of spaces between the two br is the blank line it was', () => {
    settles(
      [
        ['&raquo;,\n \n"„роярче“"', '«,<br>\n <br>\n«„роярче“»'],
        ['«,<br>\n <br>\n«„роярче“»', '«,<br>\n <br>\n«„роярче“»']
      ],
      { html: true, render: { paragraphs: false } }
    );
  });
  test('a single br, content and a no-break space keep one paragraph', () => {
    settles(
      [
        ['«<br>\n«„судьба“»', '«<br>\n««судьба»»'],
        ['«<br>слово<br>«„судьба“»', '«<br>слово<br>««судьба»»'],
        ['«<br>⍽<br>«„судьба“»', '«<br>⍽<br>««судьба»»']
      ],
      { input: 'html' }
    );
  });
  test('plain and XML literals retain their existing non-HTML interpretation', () => {
    settles([['«<br>\n<br>\n«„судьба“»', '«<br>\n<br>\n««судьба»»']], { input: 'plain' });
    settles([['<doc>«<br/>\n<br/>\n«„судьба“»</doc>', '<doc>«<br/>\n<br/>\n««судьба»»</doc>']], {
      input: 'xml'
    });
    const typo = new MicroTypo({ input: 'json' });
    assert.equal(
      typo.process(JSON.stringify('«<br>\n<br>\n«„судьба“»')),
      JSON.stringify('«<br>\n<br>\n««судьба»»')
    );
  });
});

describe('quote paragraphs use the renderer boundaries', () => {
  test('a padded blank line resets quote roles before rendering', () => {
    settles(
      [
        ['«\n \nо"', '<p>«</p>\n\n<p>о"</p>'],
        ['«\r\n \r\nо"', '<p>«</p>\n\n<p>о"</p>'],
        ['«\n\t\n"«пр.27»"', '<p>«</p>\n\n<p>«„пр.⍽27“»</p>']
      ],
      { html: true }
    );
  });
  test('native blocks end quote scope while inline elements keep it', () => {
    settles(
      [
        ['«<div data-x="a - b">«„слово“»</div>', '«<div data-x="a - b">«„слово“»</div>'],
        ['«Он <em>„сказал“</em> так»', '«Он <em>„сказал“</em> так»']
      ],
      { input: 'html' }
    );
    settles([['«<blockquote>я«', '<p>«</p>\n\n<blockquote>я"']], { html: true });
  });
  test('a Markdown paragraph is parted from the heading or the block line beside it', () => {
    const config = { html: true, input: 'markdown', render: { paragraphs: true } };

    settles(
      [
        ['# «\n""ь""', '# «\n<p>«„ь“»</p>'],
        ['# "л\n""т"»', '# «л\n<p>«„т“»</p>'],
        ['Заголовок\n===\n"а "б" в"', 'Заголовок\n===\n<p>«а⍽„б“ в»</p>'],
        [
          '# "Глава"\n"Он сказал: "Да", и ушёл".\nВторая "строка" абзаца.',
          '# «Глава»\n<p>«Он⍽сказал: „Да“, и⍽ушёл».\nВторая «строка» абзаца.</p>'
        ],
        ['"Первая строка\nвторая" абзаца.', '<p>«Первая строка\nвторая» абзаца.</p>']
      ],
      config
    );
    settles([['<!>"р\n«""ченоиз" х""', '<!>«р\n<p>«„„ченоиз“ х“»</p>']], {
      ...config,
      input: 'frontmatter'
    });
    settles([['# «\n""ь""', '# «\n««ь»»']], { input: 'markdown' });
  });
});

describe('emphatic particles read words and measurement units distinctly', () => {
  test('the dependent change retains its real origin and reconstructs edits', () => {
    const source = 'Б.Чть де';
    const typo = new MicroTypo();
    const result = typo.process(source, { trace: true, edits: true });
    assert.equal(result.text, 'Б. Чть-де');
    const joining = result.trace.find(({ rule }) => rule === 'dash.emphatic_particle');
    assert.equal(joining.count, 1);
    assert.deepEqual(joining.ranges, [[2, source.length]]);
    let output = '';
    let cursor = 0;
    for (const edit of result.edits) {
      output += source.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
    }
    assert.equal(output + source.slice(cursor), result.text);
  });

  test('a full particle chain and already hyphenated head settle on the first read', () => {
    settles([
      ['е ка кась', 'е-ка-кась'],
      ['(т ка кась', '(т-ка-кась'],
      ['Поди-ка кась так', 'Поди-ка-кась⍽так'],
      ['е ка кась дальше', 'е-ка-кась⍽дальше']
    ]);
  });
  test('units retain their quantity role while ordinary verbs still join', () => {
    settles([
      ['5ч ка', '5⍽ч⍽ка'],
      ['5 ч ка', '5⍽ч⍽ка'],
      ['7м⍽ка', '7⍽м⍽ка'],
      ['0л де', '0⍽л⍽де'],
      ['6г ка', '6⍽г⍽ка'],
      ['9Б ка', '9⍽Б⍽ка'],
      ['8В ка', '8⍽В⍽ка'],
      ['5Гц ка', '5⍽Гц⍽ка'],
      ['.5Гц ка', '.5⍽Гц⍽ка'],
      [',5Гц ка', ',5⍽Гц⍽ка'],
      ['5.5Гц ка', '5.5⍽Гц⍽ка'],
      ['5⍽иди ка', '5⍽иди-ка'],
      ['5кВт ка', '5кВт ка'],
      ['5Па ка', '5Па ка'],
      ['5байт ка', '5байт ка']
    ]);
  });
  test('the dependent reader sees boundaries made by space and abbreviations', () => {
    settles([
      ['Б.Чть де', 'Б. Чть-де'],
      ['?..ать ка', '?.. ать-ка'],
      ['просп.о кась', 'просп.⍽о-кась'],
      ['902годом ка', '902 годом-ка']
    ]);
    settles([['Б.Чть де', 'Б.⍽Чть⍽де']], { rules: { 'dash.emphatic_particle': false } });
    settles(
      [
        ['5  ч ка', '5  ч ка'],
        ['5\tч ка', '5\tч ка'],
        ['5⍽ч ка', '5⍽ч ка']
      ],
      {
        rules: { 'space.collapse_spaces': false, 'abbr.*': false, 'nobr.*': false }
      }
    );
    settles([['id5 ч ка', 'id5 ч-ка']], { rules: { 'nobr.*': false } });
  });
});

describe('a leading currency releases its quantity before units', () => {
  test('all three prefix signs create the measurement boundary once', () => {
    settles([
      ['$6 м', '$⍽6⍽м'],
      ['₽9 т', '₽⍽9⍽т'],
      ['€6 см.с', '€⍽6⍽см. с']
    ]);
    settles([['$6 м', '$6 м']], { rules: { 'abbr.nbsp_currency_prefix': false } });
    settles([['$6 м', '$⍽6⍽м']], { rules: { 'abbr.nbsp_unit': false } });
    settles([
      ['1$6 м', '1⍽$⍽6⍽м'],
      ['6руб м', '6⍽₽ м'],
      ['6$ м', '6⍽$ м'],
      ['6 $9 м', '6⍽$⍽9⍽м']
    ]);
  });
});

describe('a complete phone does not turn its tail into a measurement', () => {
  test('XML reads its own phone spaces without changing reference spelling', () => {
    for (const entities of [false, true]) {
      const gap = entities ? '&#160;' : '⍽';
      settles(
        [
          ['<doc>+7(827)2834370 м</doc>', `<doc>+7${gap}827${gap}283-43-70 м</doc>`],
          ['<doc>тел 88272834370</doc>', `<doc>тел 8${gap}827${gap}283-43-70</doc>`],
          ['<doc>+7 827 283-43-70 5 м</doc>', `<doc>+7${gap}827${gap}283-43-70 5${gap}м</doc>`]
        ],
        { input: 'xml', entities }
      );
    }
  });

  test('spaced and glued units remain outside the phone in each rendering', () => {
    settles([
      ['+7(827)2834370 м', '+7⍽827⍽283-43-70 м'],
      ['7 (695) 50-27-26т', '7⍽(695)⍽50-27-26т'],
      ['+7 827 283-43-70 5 м', '+7⍽827⍽283-43-70 5⍽м'],
      ['123-45 м', '123–45⍽м']
    ]);
    for (const nowrap of ['span', 'nobr']) {
      const wrap = (body) =>
        nowrap === 'span'
          ? `<span style="white-space:nowrap;">${body}</span>`
          : `<nobr>${body}</nobr>`;
      settles(
        [
          ['+7(827)2834370 м', `${wrap('+7 827 283-43-70')} м`],
          ['7 (695) 50-27-26т', `${wrap('7 (695) 50-27-26')}т`],
          ['+7 827 283-43-70 5 м', `${wrap('+7 827 283-43-70')} 5⍽м`]
        ],
        { html: true, render: { paragraphs: false, nowrap } }
      );
    }
  });
});

describe('triads retain the role of the complete source token', () => {
  test('mixed numeric tokens, Latin dotted ids and leading fractions stay whole', () => {
    settles([
      ['𝟙82684⍽м2', '𝟙82684⍽м2'],
      ['82684𝟙', '82684𝟙'],
      ['𝟙12 345', '𝟙12 345'],
      ['12 345𝟙', '12 345𝟙'],
      ['p.19924г', 'p.19924г'],
      ['.12345г', '.12345г'],
      ['12.12345г', '12.12345г'],
      ['p. 19924 г', 'p. 19 924⍽г']
    ]);
  });
});

describe('a triad creator releases genuine quantities before binding readers', () => {
  test('symbol quantities bind while reference and postal roles keep their boundaries', () => {
    settles([
      ['🙂60889 м', '🙂60 889⍽м'],
      ['стр.19924г', 'стр.⍽19 924⍽г'],
      ['с.19924г', 'с.⍽19 924⍽г'],
      ['гл.19924г', 'гл.⍽19 924⍽г'],
      ['125009г. Москва', '125009⍽г.⍽Москва'],
      ['125009,Москва', '125009, Москва'],
      ['ИНН 7707083893', 'ИНН 7707083893'],
      ['12.12345г', '12.12345г'],
      ['2026 г. Он', '2026⍽г. Он']
    ]);
    settles([['🙂60889 м', '🙂60889 м']], { rules: { 'other.split_triads': false } });
    settles([['🙂60889 м', '🙂60 889 м']], { rules: { 'abbr.nbsp_unit': false } });
  });
});

describe('numeric source boundaries survive native inline closing tags', () => {
  test('a visible letter or number keeps the adjoining ASCII tail in its token', () => {
    for (const [open, close] of [
      ['<em>', '</em>'],
      ['<span style="white-space:nowrap;">', '</span>'],
      ['<nobr>', '</nobr>']
    ]) {
      for (const prefix of ['K', 'К', '𝟙', '𐐀']) {
        const source = `${open}${prefix}${close}4254275`;
        settles([[source, source]], { html: true, input: 'html', render: { paragraphs: false } });
      }
    }
    const nested = '<span style="white-space:nowrap;"><em>𝟙</em></span>4254275';
    settles([[nested, nested]], { input: 'html', rules: { 'other.drop_nested_nowrap': false } });
    settles(
      [
        [
          '<span style="white-space:nowrap;">K</span> 4254275',
          '<span style="white-space:nowrap;">K</span>⍽4 254 275'
        ],
        ['<div>K</div>4254275', '<div>K</div>4 254 275']
      ],
      { input: 'html' }
    );
  });
  test('opening and adjacent text-inline tags preserve the same numeric token', () => {
    for (const [open, close] of [
      ['<em>', '</em>'],
      ['<span style="white-space:nowrap;">', '</span>'],
      ['<nobr>', '</nobr>']
    ]) {
      for (const prefix of ['K', '𝟙', '𐐀']) {
        const source = `${prefix}${open}4254275${close}`;
        const adjacent = `${open}${prefix}${close}${open}4254275${close}`;
        settles(
          [
            [source, source],
            [adjacent, adjacent]
          ],
          { html: true, input: 'html', render: { paragraphs: false } }
        );
      }
    }
    settles(
      [
        ['K<img src="x">4254275', 'K<img src="x">4 254 275'],
        ['K<IMG src="x">4254275', 'K<IMG src="x">4 254 275'],
        ['K<br>4254275', 'K<br>4 254 275'],
        ['K<div>4254275</div>', 'K<div>4 254 275</div>']
      ],
      { input: 'html' }
    );
    settles(
      [
        ['<doc>K<em>4254275</em></doc>', '<doc>K<em>4 254 275</em></doc>'],
        ['<doc><em>K</em>4254275</doc>', '<doc><em>K</em>4 254 275</doc>']
      ],
      { input: 'xml' }
    );
  });
  test('an XML identifier label reads its own encoded no-break gap', () => {
    settles([['<doc>индекс⍽1682974 а</doc>', '<doc>индекс&#160;1682974&#160;а</doc>']], {
      input: 'xml',
      entities: true
    });
  });
});

describe('an IPv4 owner recognizes whole octets', () => {
  test('long and fifth octets are not partial addresses, while sentence periods remain outside', () => {
    settles(
      [
        ['8.9.8.1556 395', '8.9.8.1556 395'],
        ['8.9.8.155.6', '8.9.8.155.6'],
        ['8.9.8.155.', '<span style="white-space:nowrap;">8.9.8.155</span>.']
      ],
      { html: true, render: { paragraphs: false } }
    );
  });

  test('a letter glued to the last octet keeps the token whole, a letter apart does not', () => {
    settles(
      [
        ['9.8.6.2о 1', '9.8.6.2о 1'],
        ['9.8.6.2 о', '<span style="white-space:nowrap;">9.8.6.2</span> о']
      ],
      { html: true, render: { paragraphs: false } }
    );
    settles([['9.8.6.2о 1', '<p>9.8.6.2о 1</p>']], { html: true, input: 'html' });
  });
});

describe('GOST readers retain standard and surname roles', () => {
  test('newline boundaries and non-HTML ranges use the same nowrap serialization', () => {
    settles([
      ['\nГост 3', 'ГОСТ⍽3'],
      ['Гост 5-0', 'ГОСТ⍽5–0']
    ]);
    for (const entities of [false, true]) {
      settles(
        [
          [
            '<doc>Нет ГОСТ0-3</doc>',
            entities ? '<doc>Нет ГОСТ&#160;0&#8211;3</doc>' : '<doc>Нет ГОСТ⍽0–3</doc>'
          ]
        ],
        { input: 'xml', entities }
      );
    }
    settles([['\nГост 3', 'Гост 3']], { rules: { 'abbr.nowrap_gost': false } });
  });
  test('two actual initials keep proper-case Гост as a surname', () => {
    settles([
      ['Т.В.Гост⍽4', 'Т.⍽В.⍽Гост⍽4'],
      ['Т.⍽В.⍽Гост⍽4', 'Т.⍽В.⍽Гост⍽4'],
      ['Г.С.Гост 9,8', 'Г.⍽С.⍽Гост 9,8'],
      ['А. Гост 4', 'А. ГОСТ⍽4'],
      ['Т. В. ГОСТ 4', 'Т. В. ГОСТ⍽4']
    ]);
    for (const entities of [false, true]) {
      const gap = entities ? '&#160;' : '⍽';
      settles(
        [
          ['<doc>Т.В.Гост⍽4</doc>', `<doc>Т.В.Гост${gap}4</doc>`],
          ['<doc>Т.⍽В.⍽Гост⍽4</doc>', `<doc>Т.${gap}В.${gap}Гост${gap}4</doc>`]
        ],
        {
          input: 'xml',
          entities
        }
      );
    }
    const source = '<span style="white-space:nowrap;">Т. В. Гост 4</span>';
    settles([[source, source]], { html: true, input: 'html', render: { paragraphs: false } });
  });
});

describe('source edges use their existing format owner before typography', () => {
  test('logical indentation is identical for raw and encoded whitespace', () => {
    const spellings = ['⍽', '&nbsp;', '&#160;', '&#xA0;', '&#000160;', '&#X000a0;'];
    for (const entities of [false, true]) {
      const nbsp = entities ? '&nbsp;' : '⍽';
      for (const spelling of spellings) {
        settles(
          [
            [` ${spelling}Мы 0`, ` ${nbsp}Мы 0`],
            [` ${spelling}Мы0`, ` ${nbsp}Мы0`],
            [`\n ${spelling}Мы 0`, `Мы${nbsp}0`],
            [`${spelling}У му`, `У${nbsp}му`],
            [` ${spelling}`, ''],
            [`\r\n\t ${spelling}`, '']
          ],
          { entities }
        );
      }
      settles(
        [
          [' &unknown;У му', ` &unknown;У${nbsp}му`],
          [' &nbspУ му', ' &nbspУ му'],
          [' &#xGG;У му', ` &#xGG;У${nbsp}му`],
          [' \t\r\n ', '']
        ],
        { entities }
      );
    }
    for (const [glyph, spelling] of [
      ['\u202f', '&#8239;'],
      ['\u2009', '&thinsp;']
    ]) {
      settles([
        [` ${glyph}Мы0`, ` ${glyph}Мы0`],
        [` ${spelling}Мы0`, ` ${glyph}Мы0`],
        [` ${spelling}`, '']
      ]);
    }
  });
  test('document trim exposes the same first word before dependent rules', () => {
    for (const cfg of [{}, { input: 'plain' }]) {
      settles(
        [
          ['⍽У му', 'У⍽му'],
          ['&nbsp;У му', 'У⍽му'],
          ['\n ⍽У му', 'У⍽му'],
          ['\r\n\t ⍽У му', 'У⍽му'],
          ['\uFEFF⍽У му', '\uFEFFУ⍽му']
        ],
        cfg
      );
    }
    settles(
      [
        ['⍽У му', '<p>У⍽му</p>'],
        ['&nbsp;У му', '<p>У⍽му</p>']
      ],
      { html: true }
    );
    settles([['⍽У му', 'У⍽му']], { rules: { 'nobr.nbsp_short_word': false } });
  });
  test('Markdown, XML and value edges retain their distinct policies', () => {
    settles(
      [
        ['⍽У му', '⍽У⍽му'],
        ['&nbsp;У му', '⍽У⍽му']
      ],
      { input: 'markdown' }
    );
    settles([['<doc>⍽У му</doc>', '<doc>⍽У му</doc>']], { input: 'xml' });
    for (const [source, expected] of [
      ['⍽У му', '⍽У⍽му'],
      ['&nbsp;У му', 'У⍽му'],
      [' \tУ му ', ' \tУ⍽му ']
    ]) {
      const typo = new MicroTypo({ input: 'json' });
      const output = JSON.stringify(typeset(expected));
      assert.equal(typo.process(JSON.stringify(typeset(source))), output);
      assert.equal(typo.process(output), output);
    }
  });
  test('first indentation, a BOM and protected tails stay byte exact', () => {
    settles([
      ['\uFEFF\n\n    «Амбер»\n\n', '\uFEFF    «Амбер»'],
      [' ⍽Мы 0', ' ⍽Мы 0']
    ]);
    for (const source of ['<!-- tail ⍽\n', '<script>tail ⍽\n']) {
      settles([[source, source]], { input: 'html' });
    }
    settles([['\n\n    "код"\n', '    "код"\n']], { input: 'markdown' });
  });
  test('a whitespace-only source still runs custom handlers on its empty core', () => {
    const typo = new MicroTypo({ presets: false });
    typo.registerRuleGroup(
      { rules: [{ id: 'empty', handler: ({ text }) => (text === '' ? 'visible' : text) }] },
      { name: 'custom' }
    );
    assert.equal(typo.process(' &nbsp;'), 'visible');
  });
});

describe('nowrap owners keep their own canonical context without cleanup', () => {
  test('the optional day range reads full numbers and full months in authored markup', () => {
    for (const nowrap of ['span', 'nobr']) {
      const open = nowrap === 'nobr' ? '<nobr>' : '<span style="white-space:nowrap;">';
      const close = nowrap === 'nobr' ? '</nobr>' : '</span>';
      const cfg = {
        html: true,
        input: 'html',
        render: { nowrap, paragraphs: false },
        rules: { 'other.drop_nested_nowrap': false, 'date.nowrap_day_range': true }
      };
      settles(
        [
          ['о15-7 июня ли', `о${open}15—7 июня ли${close}`],
          ['154-6 августа', `${open}154—6 августа${close}`],
          ['12345-6 августа', '12⎵345–6⍽августа'],
          ['4-6 августан', '4–6⍽августан'],
          ['4-6 неизвестно', '4–6⍽неизвестно'],
          ['<p>4-6 августа</p>', `<p>${open}4—6 августа${close}</p>`],
          ['<em>4-6 августа</em>', `<em>${open}4—6 августа${close}</em>`],
          [`${open}4-6 августа extra${close}`, `${open}4—6 августа extra${close}`]
        ],
        cfg
      );
      settles([[`${open}4—6 августа extra${close}`, `${open}4–6 августа extra${close}`]], {
        ...cfg,
        rules: { ...cfg.rules, 'date.nowrap_day_range': false }
      });
    }
    for (const entities of [false, true]) {
      for (const gap of ['\u202f', '&#8239;']) {
        const typo = new MicroTypo({
          input: 'xml',
          entities,
          rules: { 'date.nowrap_day_range': true }
        });
        const expected = `<doc>12${entities ? '&#8239;' : gap}345${entities ? '&#8211;' : '–'}6${entities ? '&#160;' : '\u00a0'}августа</doc>`;
        assert.equal(typo.process(`<doc>12${gap}345-6 августа</doc>`), expected);
        assert.equal(typo.process(expected), expected);
      }
    }
  });
  test('date, IP, phone and century wrappers do not grow on repeated calls', () => {
    for (const nowrap of ['span', 'nobr']) {
      const open = nowrap === 'nobr' ? '<nobr>' : '<span style="white-space:nowrap;">';
      const close = nowrap === 'nobr' ? '</nobr>' : '</span>';
      const cfg = {
        html: true,
        input: 'markdown',
        render: { nowrap },
        rules: { 'other.drop_nested_nowrap': false }
      };
      settles(
        [
          ['Не 23.09.19г ', `${open}Не 23.09.19 г.${close}`],
          ['До 8.145.6.5', `${open}До 8.145.6.5${close}`],
          ['Ты XIV-Xв', `${open}Ты XIV–X вв.${close}`],
          ['слово⍽+7(284)9704400⍽л', `${open}слово +7 284 970-44-00 л${close}`]
        ],
        cfg
      );
    }
  });
  test('authored nested wrappers and resetting elements keep their actual scope', () => {
    for (const nowrap of ['span', 'nobr']) {
      const open = nowrap === 'nobr' ? '<nobr>' : '<span style="white-space:nowrap;">';
      const close = nowrap === 'nobr' ? '</nobr>' : '</span>';
      const cfg = {
        html: true,
        input: 'markdown',
        render: { nowrap },
        rules: { 'other.drop_nested_nowrap': false }
      };
      for (const [owner, body] of [
        ['date.nowrap_date', 'Не 23.09.19 г.'],
        ['nobr.nowrap_ip', 'До 8.145.6.5'],
        ['nobr.nowrap_phone', 'слово +7 284 970-44-00 л'],
        ['other.en_century_range', 'Ты XIV–X вв.']
      ]) {
        const nested = `${open}${open}${body}${close} ${open}${body}${close}${close}`;
        settles([[nested, nested]], cfg);
        settles([[nested, nested]], { ...cfg, rules: { ...cfg.rules, [owner]: false } });
        const reset = '<span style="white-space:normal;">';
        const source = `${open}${reset}${body}</span>${close}`;
        const resetBody =
          owner === 'nobr.nowrap_phone' ? `слово ${open}+7 284 970-44-00${close} л` : body;
        const expected = `${open}${reset}${resetBody}</span>${close}`;
        settles([[source, expected]], cfg);
      }
    }
  });

  test('successive documents read their own authored nowrap scope', () => {
    const open = '<span style="white-space:nowrap;">';
    const reset = '<span style="white-space:normal;">';
    const phone = '+7 284 970-44-00';
    const phoneText = `слово ${phone} л`;
    const covered = `${open}${phoneText}</span>`;
    const input = `${open}${reset}${phoneText}</span></span>`;
    const expected = `${open}${reset}слово ${open}${phone}</span> л</span></span>`;
    const typo = new MicroTypo({
      input: 'markdown',
      html: true,
      render: { nowrap: 'span' },
      rules: { 'other.drop_nested_nowrap': false }
    });
    for (const [source, output] of [
      [covered, covered],
      [input, expected],
      [covered, covered]
    ]) {
      assert.equal(typo.process(source), output);
      assert.equal(typo.process(output), output);
    }
  });
});

describe('a no-break space the engine writes back as an XML reference', () => {
  test('keeps `т. е.` and a pair of initials apart from the number before them', () => {
    settles(
      [
        ['<doc><item>5 те.</item></doc>', '<doc><item>5&#160;т.&#160;е.</item></doc>'],
        ['<doc><item>3 В.Р.То</item></doc>', '<doc><item>3&#160;В.&#160;Р.&#160;То</item></doc>'],
        ['<doc><item>5 т.&#171;е.</item></doc>', '<doc><item>5&#160;т.&#171;е.</item></doc>'],
        ['<doc><item>3 В.Р.</item></doc>', '<doc><item>3&#160;В.Р.</item></doc>']
      ],
      { input: 'xml', entities: true }
    );
  });
  test('keeps a hyphen before a number a dash or an ellipsis follows', () => {
    settles(
      [
        ['<doc><item>огт -7–</item></doc>', '<doc><item>огт -7&#8211;</item></doc>'],
        ['<doc><title>-4...</title></doc>', '<doc><title>-4&#8230;</title></doc>'],
        ['<doc><item>-7&#160;м</item></doc>', '<doc><item>&#8722;7&#160;м</item></doc>']
      ],
      { input: 'xml', entities: true, rules: { 'number.minus': true } }
    );
  });
  test('keeps the sentence mark after initials or a century range it writes with references', () => {
    settles(
      [
        ['<doc><item>⍽Еа⍽В.К.!</item></doc>', '<doc><item>&#160;Еа&#160;В.&#160;К.!</item></doc>'],
        [
          '<doc><item>в XV-XVI вв.!</item></doc>',
          '<doc><item>в&#160;XV&#8211;XVI&#160;вв.!</item></doc>'
        ],
        ['<doc><item>Еа В.К.?</item></doc>', '<doc><item>Еа В.К.</item></doc>']
      ],
      { input: 'xml', entities: true }
    );
  });
});

describe('a number after the dash of a year range', () => {
  test('binds to the word after it in the pass the range gets its dash', () => {
    settles([['начала 1991-2010 годов', 'начала 1991–2010⍽годов']], {
      rules: { 'number.*': false }
    });
    settles([['код 1991-2010 годах', 'код 1991-2010 годах']], {
      rules: { 'number.*': false }
    });
  });
});

describe('a hyphen before a number split into triads after it', () => {
  test('stays a hyphen where an ellipsis follows the whole number, as before the split', () => {
    settles(
      [
        ['-80235...', '-80⎵235…'],
        ['-12345,5...', '-12⎵345,5…'],
        ['-80235 руб', '−80⎵235⍽₽'],
        ['-80 2357…', '−80 2357…']
      ],
      { rules: { 'number.minus': true } }
    );
  });
});

describe('native paragraph boundaries serialize in the same pass', () => {
  test('a bare inline-block tail does not acquire another break each time', () => {
    const typo = new MicroTypo({ html: true, input: 'html' });
    const source = '<p>слово</p>\nхвост <mark>текст <hr></mark>';
    const expected = '<p>слово</p>\n\nхвост <mark>текст <hr></mark>';
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
    assert.equal(typo.process(typo.process(expected)), expected);
  });
  test('an outer indent before a bare segment ends at its blank line', () => {
    const block = '<em><pre>  "Текст"\n\t -  </pre></em>';
    settles(
      [
        [`Начало.\n\n\t${block}`, `<p>Начало.</p>\n\n${block}`],
        [`Начало.\n\n\tТекст&nbsp;до ${block}`, `<p>Начало.</p>\n\nТекст⍽до ${block}`],
        [`Начало.\n\n&nbsp;Текст до ${block}`, `<p>Начало.</p>\n\n⍽Текст до ${block}`],
        [`<p>Начало.</p>\n\n&#160;Текст до ${block}`, `<p>Начало.</p>\n\n⍽Текст до ${block}`],
        ['Начало.\n\n\t<l><pre>\n\t', '<p>Начало.</p>\n\n<l><pre>\n\t']
      ],
      { html: true, input: 'html' }
    );
  });
  test('text parted from a block tag by a line break is a paragraph, a run glued to blocks stays bare', () => {
    settles(
      [
        ['<div>а</div>\nб\n<div>в</div>', '<div>а</div>\n\n<p>б</p>\n\n<div>в</div>'],
        ['<div>а</div>б\n<div>в</div>', '<div>а</div>\n\n<p>б</p>\n\n<div>в</div>'],
        ['<div></div>\nо</li>', '<div></div>\n\n<p>о</li></p>'],
        ['<table></table>\n.</li>', '<table></table>\n\n<p>.</li></p>'],
        ['<div>а</div>б\n</div>', '<div>а</div>\n\n<p>б\n\n</div></p>'],
        ['<div>а</div>б<div>в</div>', '<div>а</div>б<div>в</div>'],
        ['<div>а</div>\n<div>б</div>в<div>г</div>', '<div>а</div>\n\n<div>б</div>в<div>г</div>']
      ],
      { html: true, input: 'html' }
    );
    settles([['<div>а</div>\nб\n<div>в</div>', '<div>а</div>\n<p>б</p>\n<div>в</div>']], {
      html: true,
      input: 'html',
      rules: { 'text.breakline': false }
    });
  });
  test('a line break between a block and a block inside an inline element stays a blank line', () => {
    settles(
      [
        [
          '<a href="/"><div>карточка</div></a>\n<div>дальше</div>',
          '<a href="/"><div>карточка</div></a>\n\n<div>дальше</div>'
        ],
        ['<div>слово</div>\n<b>x<div>y</div></b>', '<div>слово</div>\n\n<b>x<div>y</div></b>'],
        ['<b>x<div>y</div></b>\n\nслово', '<b>x<div>y</div></b>\n\n<p>слово</p>'],
        ['<b>x<div>y</div></b>\nслово', '<b>x<div>y</div></b><br>\nслово']
      ],
      { html: true, input: 'html' }
    );
  });
  test('whitespace-only prose between block elements is one empty separator', () => {
    for (const space of ['\u2009', '&thinsp;', '&#8201;', '⍽', '&nbsp;', ' ', '\t']) {
      const typo = new MicroTypo({ html: true, input: 'html' });
      const expected = '<h6>слово</h6>\n\n<div>текст</div>';
      const first = typo.process(`<h6>слово</h6>\n${typeset(space)}\n<div>текст</div>`);
      assert.equal(first, expected);
      assert.equal(typo.process(first), expected);
      assert.equal(typo.process(typo.process(first)), expected);
    }
  });
  test('a discarded whitespace-only paragraph contributes no extra separator', () => {
    const rendered = '<p>Начало.</p>\n\n<p>Конец.</p>';
    const config = { input: 'html', html: true };
    settles(
      [
        ['Начало.\n\n&nbsp;\n\nКонец.', rendered],
        ['Начало.\n\n&#160;\n\n&thinsp;\n\nКонец.', rendered],
        ['<p>&nbsp;</p>', '<p>⍽</p>'],
        [
          'Начало.\n\n<span>&nbsp;</span>\n\nКонец.',
          '<p>Начало.</p>\n\n<p><span>⍽</span></p>\n\n<p>Конец.</p>'
        ],
        ['<pre>\n\n&nbsp;\n\n</pre>', '<pre>\n\n&nbsp;\n\n</pre>']
      ],
      config
    );
    settles([['<a>\n\n&#160;\n\n</a>', '<a>\n\n&#160;\n\n</a>']], {
      input: 'xml',
      html: true
    });
    settles([['Начало.\n\n&nbsp;\n\nКонец.', 'Начало.\n\n⍽\n\nКонец.']], {
      input: 'html',
      html: false
    });
  });
  test('authored breaks, significant content and disabled layout retain their roles', () => {
    for (const paragraphs of [false, true]) {
      for (const breakline of [false, true]) {
        const cfg = {
          html: true,
          input: 'html',
          rules: {
            'text.paragraphs': paragraphs,
            'text.breakline': breakline,
            'space.collapse_spaces': false
          }
        };
        const gap = breakline ? '\n\n' : '\n';
        const emptyGap = paragraphs ? '\n\n' : `${gap}⍽${gap}`;
        const pairs = [
          ['<h6>слово</h6>⍽<div>текст</div>', '<h6>слово</h6>⍽<div>текст</div>'],
          ['<div>\n⍽\n</div>', '<div>\n⍽\n</div>'],
          ['<h6>слово</h6>\n⍽\n<div>текст</div>', `<h6>слово</h6>${emptyGap}<div>текст</div>`],
          [
            '<p>слово</p>\n<br>\nхвост <mark>текст <hr></mark>',
            `<p>слово</p>${gap}<br>\nхвост <mark>текст <hr></mark>`
          ],
          [
            'один\nдва',
            `${paragraphs ? '<p>' : ''}один${breakline ? '<br>\n' : '\n'}два${paragraphs ? '</p>' : ''}`
          ]
        ];
        settles(pairs, cfg);
        const typo = new MicroTypo(cfg);
        for (const [, expected] of pairs) {
          assert.equal(typo.process(typo.process(typeset(expected))), typeset(expected));
        }
        assert.equal(
          typo.process('<h6>слово</h6>\n\u00a0текст\n<div>дальше</div>'),
          `<h6>слово</h6>${gap}${paragraphs ? '<p>\u00a0текст</p>' : '\u00a0текст'}${gap}<div>дальше</div>`
        );
      }
    }
  });
});

describe('a particle behind a dash the dash group left apart', () => {
  test('the particle keeps its glue to the next word, as a repeated pass reads it', () => {
    settles(
      [
        ['слово — б тн', 'слово —⍽б⍽тн'],
        ['— б тн', '—⍽б⍽тн'],
        ['&mdash; б тн', '—⍽б⍽тн']
      ],
      { input: 'html', rules: { dash: false } }
    );
    settles([['&mdash; ли го', '—⍽ли⍽го']], { input: 'frontmatter', rules: { emdash: 0 } });
  });

  test('a dash in its em form still leaves the particle alone', () => {
    settles([
      ['слово — б тн', 'слово⍽—⍽б⍽тн'],
      ['— б тн', '—⍽б⍽тн']
    ]);
  });
});

describe('words a no-break wrapper of the same group draws in, with the cleanup off', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';

  test('a short word inside the wrapper is bound as a repeated pass binds it', () => {
    settles([['По АМ', `<p>${NOWRAP_OPEN}По⍽АМ</span></p>`]], {
      html: true,
      input: 'html',
      rules: { other: false }
    });
    settles([['ТВ⎵Пи', `<p>${NOWRAP_OPEN}ТВ⍽Пи</span></p>`]], {
      html: true,
      input: 'html',
      rules: { 'other.strip_nbsp_in_nowrap': false }
    });
    settles([['<b><em>Лы</em></b>⍽ГП', `<p>${NOWRAP_OPEN}<b><em>Лы</em></b>⍽ГП</span></p>`]], {
      html: true,
      input: 'html',
      rules: { 'other.*': false }
    });
  });

  test('with the cleanup on, or the short-word rule off, the wrapper keeps a plain space', () => {
    settles([['По АМ', `<p>${NOWRAP_OPEN}По АМ</span></p>`]], { html: true, input: 'html' });
    settles([['По АМ', `<p>${NOWRAP_OPEN}По АМ</span></p>`]], {
      html: true,
      input: 'html',
      rules: { 'nobr.nbsp_short_word': false, other: false }
    });
  });
});

describe('a « glued to a word end closes before the other quotes are planned', () => {
  test('the quotes after it take the part a repeated pass gives them', () => {
    settles([
      ['а« .\t"\tо', 'а". «о'],
      ['я« "" " ы ла', 'я" «» «ы⍽ла']
    ]);
    settles([['"«» " допоое»ь«', '«„“ „допоое“ь»']], { input: 'markdown' });
  });

  test('without the rule, or with the quotation balanced, the reading stays', () => {
    settles([['а« .\t"\tо', 'а«. " о']], { rules: { 'quote.fix_orphan_open': false } });
    settles([
      ['«Амбер« и «Корвин»', '«Амбер» и⍽«Корвин»'],
      ['слово« и', 'слово" и']
    ]);
  });
});

describe('a particle after a straight quote standing apart', () => {
  test('the particle does not bind to a quote the quote rules left undecided', () => {
    settles([
      ['«. " ж в', '«. " ж⍽в'],
      ['«а, " ли в»', '«а, " ли⍽в»'],
      ['""" " ж \'', '««» " ж \'']
    ]);
    settles([['«, " ли"д', '«, " ли «д']], { input: 'html' });
    settles([['а " ж в', 'а " ж⍽в']], { rules: { quote: false } });
  });

  test('a particle after a quote that ends a word still binds', () => {
    settles([
      ['«а» ж в', '«а»⍽ж⍽в'],
      ['а" ж в', 'а"⍽ж⍽в']
    ]);
    settles([['"а" ж в', '"а"⍽ж⍽в']], { rules: { quote: false } });
  });
});

describe('an empty nested pair keeps its closing direction before what follows', () => {
  test('the pair stays an empty quotation, as its first output writes it', () => {
    settles([
      ['""" ж сый"', '«„“⍽ж⍽сый»'],
      ['«„“⍽ж сый»', '«„“⍽ж⍽сый»'],
      ['«„“слово»', '«„“слово»']
    ]);
    settles([['„"" ж сть"', '«„“⍽ж⍽сть»']], { input: 'html' });
  });

  test('a pair outside a quotation, or with words inside, reads as its own empty or filled pair', () => {
    settles([
      ['„“⍽ж сый', '«»⍽ж⍽сый'],
      ['«„слово“ ж»', '«„слово“ ж»'],
      ['«„“ слово»', '«„“ слово»']
    ]);
  });
});

describe('an em dash after a straight quote standing apart', () => {
  test('the dash is set but not bound to a quote the quote rules left undecided', () => {
    settles([
      ['". &quot; &ndash;', '«. " —'],
      ['«. " — а', '«. " — а']
    ]);
    settles([['а " - б', 'а " — б']], { rules: { quote: false } });
  });

  test('a dash after a quote that ends a word still binds', () => {
    settles([
      ['«а» - б', '«а»⍽— б'],
      ['а" - б', 'а"⍽— б'],
      ['«. " слово – а', '«. " слово⍽— а']
    ]);
    settles([['"а" - б', '"а"⍽— б']], { rules: { quote: false } });
  });
});

describe('the gap after a straight quote standing apart', () => {
  test('a bracket, a mark or a closing quote does not take the gap after an undecided quote', () => {
    settles([['""" " )', '««» " )']], { input: 'html' });
    settles([['"«" " ,', '««» " ,']], { input: 'frontmatter' });
    settles([['"«"" " »', '«««» " »']]);
    settles([['«"держки&#x22; &#x22; »', '«„держки“ " »']], { input: 'yaml' });
    settles(
      [
        ['а " )', 'а " )'],
        ['а " , б', 'а " , б']
      ],
      { rules: { quote: false } }
    );
  });

  test('a gap after a word or a quote that ends one still goes', () => {
    settles([
      ['(слово )', '(слово)'],
      ['слово , б', 'слово, б'],
      ['«слово »', '«слово»'],
      ['(«слово» )', '(«слово»)']
    ]);
  });
});

describe('the т of «т. е.» after a number is no tonne', () => {
  test('an abbreviation set apart from the number stays whole', () => {
    settles([
      ['5 т.е.', '5⍽т.⍽е.'],
      ['5 т. е.', '5⍽т.⍽е.']
    ]);
    settles([['0 те.', '0&nbsp;т.&nbsp;е.']], { entities: true });
  });

  test('a tonne after a number still binds', () => {
    settles([
      ['5 т.', '5⍽т.'],
      ['5 т, а', '5⍽т, а'],
      ['5т.е.', '5⍽т.⍽е.']
    ]);
  });
});

describe('initials after a number are no volts', () => {
  test('a pair of initials before a surname stays apart from the number', () => {
    settles([['0 ВД Ко', '0⍽В.⍽Д.⍽Ко']], {
      input: 'markdown',
      rules: { 'nobr.initials_dots': '1' }
    });
    settles([['0 В. Д. Ко', '0⍽В.⍽Д.⍽Ко']]);
  });

  test('a volt after a number still binds', () => {
    settles([
      ['220 В.', '220⍽В.'],
      ['220 В. Далее', '220⍽В. Далее'],
      ['220В и 5 В', '220⍽В и⍽5⍽В']
    ]);
  });
});

describe('the period of an abbreviation before a question or an exclamation mark', () => {
  test('a century range or initials keep their period, and the sentence keeps its mark', () => {
    settles(
      [
        ['X-Vв?', 'X–V⍽вв.?'],
        ['V-Xв!', 'V–X⍽вв.!']
      ],
      { input: 'markdown' }
    );
    settles([
      ['X-Xв!', 'X–X⍽вв.!'],
      ['в XV–XVI вв.?', 'в⍽XV–XVI⍽вв.?'],
      ['Это Иванов И. И.?', 'Это Иванов⍽И.⍽И.?']
    ]);
    settles([['Кб ПО?', 'Кб⍽П.⍽О.?']], { input: 'html', rules: { 'nobr.*': true } });
  });

  test('so does every abbreviation the engine reads, a phrase or a mark after a number', () => {
    settles([
      ['Яблоки и т. д.! Великая', 'Яблоки и⍽т.⍽д.! Великая'],
      ['Это т. е.? Великая', 'Это т.⍽е.? Великая'],
      ['Мы и др.! Великая', 'Мы⍽и⍽др.! Великая'],
      ['Это 1999 г.? Великая', 'Это 1999⍽г.? Великая'],
      ['Это 1990-е гг.? Великая', 'Это 1990-е⍽гг.? Великая'],
      ['Это XIX в.! Великая', 'Это XIX⍽в.! Великая'],
      ['300 г. до н. э.! Великая', '300⍽г. до⍽н.⍽э.! Великая'],
      ['Купил 5 шт.? Великая', 'Купил 5⍽шт.? Великая'],
      ['Яблоки и т. д.!! Великая', 'Яблоки и⍽т.⍽д.! Великая']
    ]);
    settles(
      [
        [
          'Яблоки и т. д.! Великая',
          '<p>Яблоки <span style="white-space:nowrap;">и т. д.</span>! Великая</p>'
        ]
      ],
      { html: true }
    );
    settles(
      [
        [
          '<doc><p>Это 1999 г.? Да, XIX в.!</p></doc>',
          '<doc><p>Это 1999&#160;г.? Да, XIX&#160;в.!</p></doc>'
        ]
      ],
      { input: 'xml', entities: true }
    );
  });

  test('a doubled mark after any other word still collapses', () => {
    settles([
      ['Слово.? Да', 'Слово. Да'],
      ['Слово.! Да', 'Слово. Да'],
      ['в XV–XVI вв.. Да', 'в⍽XV–XVI⍽вв. Да'],
      ['Это И. И. Иванов.?', 'Это⍽И.⍽И.⍽Иванов.'],
      ['Он ушёл.! Великая', 'Он⍽ушёл. Великая']
    ]);
  });

  test('a currency written as its sign leaves the mark to the sentence, as the word kept it', () => {
    settles([
      ['Стоит 5 руб.! Великая', 'Стоит 5⍽₽! Великая'],
      ['Стоит 5 р.?', 'Стоит 5⍽₽?'],
      ['Стоит 5 долл.? Великая', 'Стоит 5⍽$? Великая'],
      ['Стоит 5 руб.!! Великая', 'Стоит 5⍽₽! Великая'],
      ['Стоит 5 руб. Великая', 'Стоит 5⍽₽. Великая'],
      ['Продано 5 тыс. шт.! Великая', 'Продано 5⍽тыс.⍽шт.! Великая']
    ]);
    settles(
      [
        ['Стоит 5 руб.! Великая', 'Стоит 5⍽руб.! Великая'],
        ['Стоит 5 млн руб.? Великая', 'Стоит 5⍽млн⍽руб.? Великая']
      ],
      { rules: { 'abbr.currency': false } }
    );
    settles([['Стоит 5 тыс. руб.! Великая', 'Стоит 5⍽тыс.⍽руб.! Великая']], {});
  });

  test('the mark behind an abbreviation stays where a wrapper ends inside it', () => {
    const span = '<span style="white-space:nowrap;">';
    settles(
      [
        ['Гост0г.!', `<p>${span}ГОСТ 0</span>г.!</p>`],
        ['ГОСТ 0 г.! Великая', `<p>${span}ГОСТ 0 г</span>.! Великая</p>`],
        ['Р.С.Пе⍽и др.! Да', `<p>${span}Р. С. Пе</span>⍽${span}и др.</span>! Да</p>`]
      ],
      { html: true }
    );
    settles([[`<p>${span}Пе и</span> др.!</p>`, `<p>${span}Пе и др</span>.!</p>`]], {
      html: true,
      input: 'html'
    });
    settles([['и пр.т.ч.!', `${span}и пр. т</span>.ч.!`]], {
      html: true,
      input: 'markdown'
    });
  });
});

describe('a year right after another year with its г.', () => {
  test('the second year binds its г. on the first pass too', () => {
    settles(
      [
        ['2020г. 1983г.', '2020⍽г. 1983⍽г.'],
        ['1905г. 2017 г.', '1905⍽г. 2017⍽г.']
      ],
      { rules: { abbr: false } }
    );
    settles([['в 2020г. и 1983 г.', 'в⍽2020⍽г. и⍽1983⍽г.']]);
  });
});

describe('phone numbers one after another', () => {
  const NOWRAP = '<span style="white-space:nowrap;">';

  test('the second phone is bound on the first pass too', () => {
    settles([
      ['+7(509)2593724 +7 (895)2412770', '+7⍽509⍽259-37-24 +7⍽895⍽241-27-70'],
      ['+7(358)3626326 +7(341)7326364', '+7⍽358⍽362-63-26 +7⍽341⍽732-63-64'],
      ['8 (495) 123-45-67 8 (812) 765-43-21', '8⍽(495)⍽123-45-67 8⍽(812)⍽765-43-21']
    ]);
    settles(
      [
        [
          '7 (576) 43-66-79 8 (7850) 77-74-34.',
          `<p>${NOWRAP}7 (576) 43-66-79</span> ${NOWRAP}8 (7850) 77-74-34</span>.</p>`
        ]
      ],
      { html: true, input: 'html' }
    );
  });

  test('a phone with its gaps written as references is read again, so its last group is no country code', () => {
    settles(
      [
        [
          '<doc><title> 8 (904) 81-42-40 (585) 58-68-43.</title></doc>',
          '<doc><title> 8&#160;(904)&#160;81-42-40 (585) 58-68-43.</title></doc>'
        ]
      ],
      { input: 'xml', entities: true }
    );
  });

  test('a phone glued to the last digit of the one before stays apart', () => {
    settles(
      [['+7(169)9415317+7(926)9906053', `<p>${NOWRAP}+7 169 941-53-17</span>+7(926)9906053</p>`]],
      { html: true, input: 'html' }
    );
  });
});

describe('a year glued to the word год right after another one', () => {
  test('the second year gets its space on the first pass too', () => {
    settles([
      ['710год 707год', '710⍽год 707⍽год'],
      ['в 1990году, 2000году.', 'в⍽1990⍽году, 2000⍽году.']
    ]);
    settles([['946год 892год', '946⍽год 892⍽год']], { input: 'markdown' });
  });
});

describe('a number after a minus written as a reference', () => {
  test('is no start of a range, as after the minus itself', () => {
    settles(
      [
        ['<doc><p>−3-8</p></doc>', '<doc><p>&#8722;3-8</p></doc>'],
        ['<doc><p>&#8722;3-8 и 3-8</p></doc>', '<doc><p>&#8722;3-8 и&#160;3&#8211;8</p></doc>']
      ],
      { input: 'xml', entities: true }
    );
    settles([
      ['−3-8', '−3-8'],
      ['3-8', '3–8']
    ]);
  });
});

describe('a number glued to a temperature after a short abbreviation', () => {
  test('binds to the abbreviation as the set-apart reading does', () => {
    settles([
      ['п. 4°C', 'п.⍽4⍽°C'],
      ['с. 5°С, а', 'с.⍽5⍽°C, а'],
      ['п. 4 °C', 'п.⍽4⍽°C']
    ]);
    settles([['п. 9°F', 'п.⍽9⍽°F']], { input: 'html' });
  });

  test('a number glued to a word stays apart', () => {
    settles([
      ['п. 4°Cа', 'п. 4°Cа'],
      ['рис. 4а', 'рис. 4а']
    ]);
  });
});

describe('a house number glued to a temperature', () => {
  test('binds to д. as the set-apart reading does', () => {
    settles([['д. 2°C', 'д.⍽2⍽°C']]);
    settles([['<doc><note>д. 2°F</note></doc>', '<doc><note>д.⍽2⍽°F</note></doc>']], {
      input: 'xml'
    });
  });
});

describe('a chain of months joined by hyphens', () => {
  test('every pair gets its dash on the first pass', () => {
    settles([
      ['сентября-апреле-мае', 'сентября–апреле–мае'],
      ['в мае-июне', 'в⍽мае–июне']
    ]);
  });
});

describe('a negative range with a run of spaces after its ellipsis', () => {
  test('gets its minus on the first pass, as with one space', () => {
    settles([
      ['-7...  6', '−7… 6'],
      ['-2…  9', '−2… 9'],
      ['-2… 9', '−2… 9']
    ]);
  });

  test('a paragraph break still ends it', () => {
    settles([['-2…\n\n9', '-2…\n\n9']]);
  });
});

describe('a century marker without its period glued to a capital', () => {
  test('is the start of a word, not a marker', () => {
    settles([['V-IвО', 'V-IвО']], { input: 'markdown' });
    settles([['I-XвВ', 'I-XвВ']]);
  });

  test('a marker standing apart still reads', () => {
    settles([
      ['XV-XVIв', 'XV–XVI⍽вв.'],
      ['XV-XVI в, а', 'XV–XVI⍽вв., а'],
      ['XV-XVI вв. Далее', 'XV–XVI⍽вв. Далее']
    ]);
  });
});

describe('two numeric dates in a row', () => {
  const NOWRAP = '<span style="white-space:nowrap;">';

  test('the second date is wrapped on the first pass too', () => {
    settles(
      [
        ['о 03.08.45 14.03.20 и', `<p>${NOWRAP}о 03.08.45</span> ${NOWRAP}14.03.20</span> и</p>`],
        [
          'с 03.08.45 по 14.03.20.',
          `<p>${NOWRAP}с 03.08.45</span> ${NOWRAP}по 14.03.20</span>.</p>`
        ]
      ],
      { html: true }
    );
  });
});

describe('an ellipsis after a question or an exclamation mark with periods behind it', () => {
  test('loses its periods with its third dot, as three periods do', () => {
    settles([
      ['!….', '!..'],
      ['Что!…. Да', 'Что!.. Да'],
      ['Что?.... Да', 'Что?.. Да'],
      ['Что?… Да', 'Что?.. Да']
    ]);
  });
});

describe('a multiplication sign with a tab beside it', () => {
  test('reads the tab as a gap, as a space', () => {
    settles([['1\tx2', '1×2']], { input: 'markdown' });
    settles([['1\tx\t2', '1×2']], { rules: { 'space.collapse_spaces': false } });
    settles([['1 x 2', '1×2']]);
  });
});

describe('a gap before a comma glued to an opening quote', () => {
  test('moves behind the comma on the first pass, as before a word', () => {
    settles([
      ['слово ,«цитата»', 'слово, «цитата»'],
      ['слово ,„цитата“', 'слово, «цитата»'],
      ['слово ,цитата', 'слово, цитата']
    ]);
    settles([['<doc><item> ,«</item></doc>', '<doc><item>, «</item></doc>']], { input: 'xml' });
  });
});

describe('a year glued to the word год after a tab', () => {
  test('gets its space on the first pass, as after a space', () => {
    settles([['а\t930год', 'а⍽930⍽год']], {
      input: 'markdown',
      rules: { 'space.collapse_spaces': false }
    });
  });
});

describe('a number glued to the word год after a currency sign', () => {
  test('gets its space on the first pass, as behind the space that sign gets', () => {
    settles([
      ['₽758год', '₽⍽758⍽год'],
      ['$1999год', '$⍽1999⍽год'],
      ['₽ 758год', '₽⍽758⍽год']
    ]);
  });
});

describe('a bare point before a CSS unit behind a no-break wrapper', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';

  test('is no number: the unit stays apart from it', () => {
    settles([['Л.В.Оа⍽p.s.', `${NOWRAP_OPEN}Л. В. Оа p</span>.s.`]], {
      html: true,
      input: 'markdown'
    });
    settles([['Ко⍽ММ,px', `<p>${NOWRAP_OPEN}Ко ММ</span>, px</p>`]], { html: true });
    settles([['ширина .5 em и 1,5 px', 'ширина .5⍽em и⍽1,5⍽px']]);
  });
});

describe('н. э. or т. е. inside the wrapper grown around it', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';
  const rules = { 'other.drop_nested_nowrap': false };

  test('keeps no-break without nesting another wrapper', () => {
    settles([['у⍽нэ.', `${NOWRAP_OPEN}у н. э.</span>`]], { html: true, input: 'markdown', rules });
    settles([['м⍽те.', '<nobr>м т. е.</nobr>']], {
      html: true,
      input: 'markdown',
      render: { nowrap: 'nobr' },
      rules
    });
    settles(
      [
        [
          'в 300 г. до н. э. и т. е. слово',
          `<p>в⍽300⍽г. ${NOWRAP_OPEN}до н. э.</span> и ${NOWRAP_OPEN}т. е.</span> слово</p>`
        ]
      ],
      { html: true, rules }
    );
  });
});

describe('a word bound to a no-break wrapper by a no-break space', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';

  test('leaves a whole hyphenated word or a quoted suffix outside a name', () => {
    for (const nowrap of ['span', 'nobr']) {
      const wrap = (s) => (nowrap === 'span' ? `${NOWRAP_OPEN}${s}</span>` : `<nobr>${s}</nobr>`);
      const config = { html: true, input: 'html', render: { nowrap } };
      settles(
        [
          [
            'А.С. Пушкин⍽по-русски⍽М.Ю. Лермонтов.',
            `<p>${wrap('А. С. Пушкин')}⍽по-русски⍽${wrap('М. Ю. Лермонтов')}.</p>`
          ],
          ['Орлов Д.С.⍽где-то', `<p>${wrap('Орлов Д. С.')}⍽где-то</p>`],
          ['Орлов Д.С.⍽Голенищев-Кутузов', `<p>${wrap('Орлов Д. С.')}⍽Голенищев-Кутузов</p>`],
          ['Орлов Д.С.⍽сказал»слово', `<p>${wrap('Орлов Д. С.')}⍽сказал»слово</p>`],
          [
            '«Письмо Орлов Д.С.⍽отправил» вчера.',
            `<p>«Письмо ${wrap('Орлов Д. С. отправил')}» вчера.</p>`
          ]
        ],
        config
      );
      settles([['Орлов Д.С.⍽отправил', `<p>${wrap('Орлов Д. С.')}⍽отправил</p>`]], {
        ...config,
        rules: { 'other.strip_nbsp_in_nowrap': false }
      });
    }
  });

  test('reads a hyphenated word through its inline formatting', () => {
    for (const nowrap of ['span', 'nobr']) {
      const wrap = (s) => (nowrap === 'span' ? `${NOWRAP_OPEN}${s}</span>` : `<nobr>${s}</nobr>`);
      const config = { html: true, input: 'html', render: { nowrap, paragraphs: false } };
      for (const compound of [
        'по<em>-</em>русски',
        'п<em>о</em>-русски',
        '<em>по-</em>русски',
        'по-<em>ру</em>сски',
        'по<em>-рус</em>ски',
        'г<em>д<strong>е</strong></em>-то',
        'Голенищев<em>‐</em>Кутузов',
        'по<em>‑</em>русски'
      ]) {
        const expected = compound.replace('‐', '-');
        const sample = [
          [`А.С. Пушкин⍽${compound}`, `${wrap('А. С. Пушкин')}⍽${expected}`],
          [`${compound}⍽А.С. Пушкин`, `${expected}⍽${wrap('А. С. Пушкин')}`],
          [
            `А.С. Пушкин⍽${compound}⍽И.А. Бунин`,
            `${wrap('А. С. Пушкин')}⍽${expected}⍽${wrap('И. А. Бунин')}`
          ]
        ];
        settles(sample, config);
        settles(
          sample.map(([source, want]) => [source, bound(want)]),
          { ...config, rules: { 'other.strip_nbsp_in_nowrap': false } }
        );
      }
      settles(
        [
          [`по<em>-</em> русски⍽А.С. Пушкин`, `по<em>-</em> ${wrap('русски А. С. Пушкин')}`],
          [`по-<br>русски⍽А.С. Пушкин`, `по-<br>${wrap('русски А. С. Пушкин')}`],
          [`<code>по-</code>русски⍽А.С. Пушкин`, `<code>по-</code>${wrap('русски А. С. Пушкин')}`],
          [
            'А.С. Пушкин⍽отправил <em>письмо</em>',
            `${wrap('А. С. Пушкин отправил')} <em>письмо</em>`
          ],
          ['А.С. Пушкин⍽отправил<br>снова', `${wrap('А. С. Пушкин отправил')}<br>снова`]
        ],
        config
      );
    }
  });

  test('joins it whole, never as the letter tail of a token', () => {
    settles(
      [
        ['67673R⍽и тд', `<p>67673R⍽${NOWRAP_OPEN}и т. д.</span></p>`],
        ['4^2к⍽Пи НН', `<p>4^2к⍽${NOWRAP_OPEN}Пи НН</span></p>`],
        ['слово «вот⍽и т. д.', `<p>слово «${NOWRAP_OPEN}вот и т. д.</span></p>`],
        ['сказал⍽и т. д. слово', `<p>${NOWRAP_OPEN}сказал и т. д.</span> слово</p>`]
      ],
      { html: true }
    );
    settles([['а&raquo;й⍽и тд', `а»й⍽${NOWRAP_OPEN}и т. д.</span>`]], {
      html: true,
      input: 'markdown'
    });
  });
});

describe('a currency word behind a no-break space', () => {
  const NOWRAP_OPEN = '<span style="white-space:nowrap;">';

  test('turns into its sign, as behind a space', () => {
    settles([
      ['5⍽р', '5⍽₽'],
      ['5⍽рублей', '5⍽₽'],
      ['10⍽евро', '10⍽€'],
      ['5 руб. и 10 долл. и 100 $', '5⍽₽ и⍽10⍽$ и⍽100⍽$']
    ]);
    settles(
      [
        ['ГОСТ5⍽р', `${NOWRAP_OPEN}ГОСТ 5</span>⍽₽`],
        ['9:20—3:55⍽евро', `${NOWRAP_OPEN}9:20–3:55</span>⍽€`]
      ],
      { html: true, input: 'markdown' }
    );
  });

  test('keeps `долл. США` and a longer word as written', () => {
    settles([
      ['10 долл. США и 10⍽долл. США', '10⍽долл. США и⍽10⍽долл. США'],
      ['5⍽рубероида', '5⍽рубероида']
    ]);
  });

  test('keeps `долл. США` when a wrapper grown around `США` and what follows starts between them', () => {
    settles(
      [
        ['0долл.США⍽6:40–1:20', `<p>0⍽долл. ${NOWRAP_OPEN}США 6:40–1:20</span></p>`],
        ['4долл.США⍽22.04.13', `<p>4⍽долл. ${NOWRAP_OPEN}США 22.04.13</span></p>`]
      ],
      { html: true }
    );
    settles([['3долл.США⍽Дд ВИ', `3⍽долл. ${NOWRAP_OPEN}США Дд ВИ</span>`]], {
      html: true,
      input: 'markdown'
    });
    settles([['5 долл. <b>Канады</b>', '<p>5⍽$. <b>Канады</b></p>']], {
      html: true,
      input: 'html'
    });
  });

  test('turns into its sign behind a run of spaces and no-break spaces, as behind two spaces', () => {
    settles([
      ['2 ⍽руб', '2⍽₽'],
      ['2⍽ руб.', '2⍽₽.'],
      ['5 ⍽€', '5⍽€'],
      ['5 ⍽долл. США', '5⍽долл. США'],
      ['2  руб', '2⍽₽'],
      ['5 ⍽рубероида', '5⍽рубероида']
    ]);
    settles([['2 ⍽руб', '2⍽₽']]);
  });

  test('turns into its sign behind the end of an inline element the amount ends', () => {
    const NOWRAP_CLOSE = '</span>';
    settles(
      [
        ['+7-999-123-45-67⍽Р', `<p>${NOWRAP_OPEN}+7-999-123-45-67${NOWRAP_CLOSE}⍽₽</p>`],
        ['+7-999-123-45-67 руб', `<p>${NOWRAP_OPEN}+7-999-123-45-67${NOWRAP_CLOSE}⍽₽</p>`]
      ],
      { html: true, input: 'html' }
    );
    settles(
      [
        ['<b>5</b> руб.', '<p><b>5</b>⍽₽.</p>'],
        [
          `${NOWRAP_OPEN}ГОСТ 7${NOWRAP_CLOSE} долл. США`,
          `<p>${NOWRAP_OPEN}ГОСТ 7 долл${NOWRAP_CLOSE}. США</p>`
        ],
        ['<b>5 </b>руб', '<p><b>5 </b>руб</p>']
      ],
      { html: true, input: 'html' }
    );
  });
});

describe('a closing guillemet padded away from a digit with a quotation still to close', () => {
  test('is an inch mark, as glued or as a straight quote', () => {
    settles([
      ['«Диагональ 15 » и корпус»', '«Диагональ 15″ и⍽корпус»'],
      ['«Диагональ 15» и корпус»', '«Диагональ 15″ и⍽корпус»'],
      ['"Диагональ 15 " и корпус"', '«Диагональ 15″ и⍽корпус»'],
      ['«3 » л»', '«3″ л»']
    ]);
  });

  test('a balanced pair, a quote turned round or kept padding stay quotes', () => {
    settles([
      ['« Диагональ 15 » и корпус', '«Диагональ 15» и⍽корпус'],
      ['«Дом 2 » и «Дом 3 »', '«Дом 2» и⍽«Дом 3»'],
      ['Труба 6 » длиной', 'Труба 6 «длиной']
    ]);
    settles([['«Диагональ 15 » и корпус»', '«Диагональ 15 » и⍽корпус"']], {
      rules: { 'space.strip_quote_padding': false }
    });
  });
});

describe('two straight quotes glued together before a mark', () => {
  test('are one empty quotation, as written apart', () => {
    settles([
      ['"",', '«»,'],
      ['"")', '«»)'],
      ['слово "", и', 'слово «», и'],
      ['"Амбер", "", "Зелёный"', '«Амбер», «», «Зелёный»'],
      ['пустые кавычки "" и', 'пустые кавычки «» и']
    ]);
    settles([['"",', '<span style="margin-left:-0.44em;">«</span>»,']], {
      html: true,
      input: 'markdown',
      rules: { hanging: 'on' }
    });
  });

  test('before an end tag they are the pair they are at the end of the text', () => {
    settles([
      ['« ""', '««»'],
      ['« ""</p>', '««»</p>'],
      ['«вил ""</p>', '«вил «»</p>'],
      ['«"»</p>', '««»</p>']
    ]);
    settles([['<p>« ""</p>', '<p>««»</p>']], { input: 'html' });
  });

  test('before a word they still open a quotation and a quotation inside it', () => {
    settles([
      ['""слово""', '«„слово“»'],
      ['""Цитата" в цитате"', '«„Цитата“ в⍽цитате»']
    ]);
  });
});

describe('an indefinite pronoun or кое- glued to the end of a sentence', () => {
  test('takes its hyphen on the first pass, as after a space', () => {
    settles([
      ['в.Кое кто', 'в. Кое-кто'],
      ['М.Кто либо', 'М. Кто-либо'],
      ['Привет.Кое кто пришёл', 'Привет. Кое-кто пришёл'],
      ['1.кое как и т.е.кое как', '1. кое-как и т.⍽е. кое-как']
    ]);
    settles([['e="ь?как то"', 'e="ь? как-то"']], { input: 'toml' });
  });

  test('the enumeration idiom stays apart', () => {
    settles([
      ['раз, как то: два', 'раз, как⍽то: два'],
      ['итак.как то: раз', 'итак. как⍽то: раз']
    ]);
  });
});

describe('P. S. behind a no-break space', () => {
  test('binds on the first pass, as behind a space', () => {
    settles([
      ['ё ж⍽P. S.5', 'ё⍽ж P.⍽S.5'],
      ['слово⍽P.p.s. текст', 'слово⍽P.⍽p.⍽s. текст'],
      ['слово P. S. текст', 'слово P.⍽S. текст']
    ]);
    settles([['4="ь ж⍽P. S.е"', '4="ь⍽ж P.⍽S.е"']], { input: 'toml' });
    settles(
      [
        [
          'слово⍽P. P. S. текст',
          '<p><span style="white-space:nowrap;">слово P. P. S.</span> текст</p>'
        ]
      ],
      {
        html: true
      }
    );
  });

  test('glued to a word, it stays as written', () => {
    settles([['словоP. S. текст', 'словоP. S. текст']]);
  });
});

describe('a run of exclamation marks before =', () => {
  test('keeps its marks; a lone != is still ≠', () => {
    settles([
      ['a != b', 'a ≠ b'],
      ['!!!= и Ура!!!=', '!!!= и⍽Ура!!!=']
    ]);
    settles([['!!!=', '!!!=']], { input: 'frontmatter' });
  });
});

describe('a short word a unit splits off before a quote', () => {
  test('binds to the quote on the first pass, as behind a space', () => {
    settles([
      [',5л.т „', ',5⍽л. т⍽«'],
      ['2 249м.т „', '2⎵249⍽м. т⍽«'],
      ['5 л.т „', '5⍽л. т⍽«']
    ]);
    settles([[',5т.т"в', ',5⍽т. т⍽«в']], { input: 'markdown' });
  });

  test('a longer word and a domain stay apart from the quote', () => {
    settles([
      [',5л.кот „', ',5⍽л. кот «'],
      ['на site.ru «Новости»', 'на⍽site.ru «Новости»']
    ]);
  });
});

const nowrap = (body) => `<span style="white-space:nowrap;">${body}</span>`;

describe('a straight quote behind a no-wrap wrapper the engine writes', () => {
  test('opens only where it opens behind what the wrapper holds last', () => {
    settles([['нэ."2', `${nowrap('н. э.')}"2`]], { html: true, input: 'markdown' });
    settles(
      [
        ['и тп."2', `<p>${nowrap('и т. п.')}"2</p>`],
        ['30.07.24г."узнал"о', `<p>${nowrap('30.07.24 г.')}"узнал «о</p>`],
        ['18.07.81г⍽я"1', `<p>${nowrap('18.07.81 г. я')}"1</p>`]
      ],
      { html: true }
    );
  });

  test('a word, a comma or a dash it ends with still opens one, as an authored tag does', () => {
    settles(
      [
        [`${nowrap('ООО Ромашка')}"Мемуары"`, `<p>${nowrap('ООО Ромашка')}«Мемуары»</p>`],
        [`${nowrap('а,')}"слово"`, `<p>${nowrap('а,')}«слово»</p>`],
        [`${nowrap('а —')}"слово"`, `<p>${nowrap('а —')}«слово»</p>`],
        ['<span>н. э.</span>"слово"', '<p><span>н. э.</span>«слово»</p>']
      ],
      { html: true }
    );
  });
});

describe('a number behind a no-wrap wrapper the engine writes', () => {
  test('binds its unit only where it would behind what the wrapper holds last', () => {
    settles(
      [
        ['09.11.31г.8 м', `<p>${nowrap('09.11.31 г.')}8 м</p>`],
        ['16.11.03г.4 <em><a>м</a></em>', `<p>${nowrap('16.11.03 г.')}4 <em><a>м</a></em></p>`]
      ],
      { html: true }
    );
    settles([['26.06.16г.5 Г', `${nowrap('26.06.16 г.')}5 Г`]], { html: true, input: 'markdown' });
  });

  test('behind a space, a dash or an authored tag it binds as before', () => {
    settles(
      [
        [`${nowrap('и т. д.')} 5 м`, `<p>${nowrap('и т. д.')} 5⍽м</p>`],
        [`${nowrap('а —')}5 м`, `<p>${nowrap('а —')}5⍽м</p>`],
        ['<b>а</b>8 м', '<p><b>а</b>8⍽м</p>']
      ],
      { html: true }
    );
  });
});

describe('an unmatched closer spaced on both sides behind a word', () => {
  test('goes back to a straight quote without its gap, as the closing rule takes it', () => {
    settles([
      ['в »\nс', 'в⍽«\nс'],
      ['в "\nс', 'в⍽«\nс']
    ]);
    settles([['в &raquo;\nс', 'в⍽«\nс']], { input: 'markdown' });
    settles([['а "&#187; о', 'а"" о']], { input: 'markdown', rules: { 'quote.open': 0 } });
  });

  test('at the end of the text or behind a dash it keeps the gap', () => {
    settles([
      ['в »', 'в "'],
      ['— »\nс', '—⍽«\nс']
    ]);
  });

  test('last in its paragraph it reads the blank line behind it as a line break', () => {
    settles([
      ['в »\n\nс', 'в"\n\nс'],
      ['в ”\n\nс', 'в"\n\nс'],
      ['в »\r\n\r\nс', 'в"\n\nс']
    ]);
    settles([['в &raquo;\n\nс', 'в"\n\nс']], { input: 'markdown' });
    settles([['в »\n\nс', '<p>в"</p>\n\n<p>с</p>']], { html: true });
  });
});

describe('the last group of a phone number the engine groups', () => {
  test('takes no unit, currency code or prime it would not take before the grouping', () => {
    settles(
      [
        ['+7(789)1118244 А', '+7⍽789⍽111-82-44 А'],
        ['+7(788)7690929 EUR', '+7⍽788⍽769-09-29 EUR'],
        ["+7(253)8809066'", "+7⍽253⍽880-90-66'"],
        ['+7 789 111-82-44 А', '+7⍽789⍽111-82-44 А'],
        ['44 А и 5 EUR', '44⍽А и⍽5⍽EUR'],
        ["5' 10″", '5′ 10″']
      ],
      { input: 'plain' }
    );
  });
});

describe('initials a location abbreviation binds before the wrapper', () => {
  // Only initials before a surname are bound by `nbsp_single_initial`; with nothing to strip it, the
  // binding stays inside the wrapper.
  test('keep inside the wrapper only what their own rules write when nothing strips no-break spaces', () => {
    settles(
      [
        ['Ка Г.Р.', `<p>${nowrap('Ка Г. Р.')}</p>`],
        ['Г.Р. Ка', `<p>${nowrap('Г.⍽Р.⍽Ка')}</p>`],
        ['Ка Ш.Р.', `<p>${nowrap('Ка Ш. Р.')}</p>`],
        ['Иванов И.⍽И.', `<p>${nowrap('Иванов И. И.')}</p>`],
        ['в г. Р. жил', '<p>в г.⍽Р. жил</p>']
      ],
      { html: true, rules: { other: false } }
    );
    settles([['Ка Г.Р.', `<p>${nowrap('Ка Г. Р.')}</p>`]], { html: true });
    settles([['Ка Г.Р.', 'Ка⍽Г.⍽Р.']]);
  });
});

describe('a word glued to тыс. after a number glued to it', () => {
  test('binds on the first pass in XML as in plain text', () => {
    settles(
      [
        ['<doc><p>4тыс.рублей</p></doc>', '<doc><p>4⍽тыс.⍽рублей</p></doc>'],
        ['<doc><p>4тыс.евро</p></doc>', '<doc><p>4⍽тыс.⍽евро</p></doc>'],
        ['<doc><p>4тыс.чел.</p></doc>', '<doc><p>4⍽тыс.чел.</p></doc>']
      ],
      { input: 'xml' }
    );
    settles(
      [
        ['4тыс.рублей', '4⍽тыс.⍽рублей'],
        ['4 тыс.руб.', '4⍽тыс.руб.'],
        ['4тыс.рублевый', '4⍽тыс. рублевый']
      ],
      {}
    );
  });

  test('binds on the first pass after a number standing apart', () => {
    settles(
      [
        ['8 тыс.рублей.', '8⍽тыс.⍽рублей.'],
        ['8 тыс.евро и', '8⍽тыс.⍽евро⍽и'],
        ['8 тыс. рублей.', '8⍽тыс.⍽рублей.'],
        ['8 тыс.руб.', '8⍽тыс.руб.'],
        ['8 тыс.рублейка', '8⍽тыс. рублейка']
      ],
      {}
    );
    settles([['8 тыс.рублей.', '8&nbsp;тыс.&nbsp;рублей.']], {
      entities: true,
      input: 'frontmatter'
    });
    settles([['8 тыс.рублей.', '8⍽тыс.⍽рублей.']]);
  });
});

describe('a requisite label a no-break wrapper draws in before its number', () => {
  test('keeps the number as typed', () => {
    settles([['_и_ пр.индекс 41611', `${nowrap('_и_ пр. индекс')} 41611`]], {
      html: true,
      input: 'markdown'
    });
    settles([['Р.Р.**То**⍽счёт 9471112325', `${nowrap('Р. Р. **То** счёт')} 9471112325`]], {
      html: true,
      input: 'markdown'
    });
    settles(
      [
        ['31.01.04г⍽БИК 9209185056', `<p>${nowrap('31.01.04 г. БИК')} 9209185056</p>`],
        ['т. е. 41611', `<p>${nowrap('т. е.')} 41⎵611</p>`]
      ],
      { html: true }
    );
  });
});

describe('the word after an abbreviated reference or an address label', () => {
  test('см. stays apart only after a number of its own, wrapped later or not', () => {
    settles([
      ['2м2 см.ж', '2⍽м² см.⍽ж'],
      ['А4 см. ниже', 'А4 см.⍽ниже'],
      ['2 см.ж', '2⍽см. ж'],
      ['дом см.ж', 'дом см.⍽ж']
    ]);
    settles(
      [
        ['8.2.1.3 см.н', `<p>${nowrap('8.2.1.3')} см. н</p>`],
        ['+7(297)3653299см. я', `<p>${nowrap('+7 297 365-32-99')}см. я</p>`]
      ],
      { html: true, input: 'html' }
    );
  });

  test('a completed name keeps the next dotted address abbreviation outside its wrapper', () => {
    const name = nowrap('Н. А. Соколов');
    settles(
      [
        ['Н. А. Соколов Б. Д. 3', `${name} Б. Д.⍽3`],
        ['Н. А. Соколов⍽Б. Д. 3', `${name}⍽Б. Д.⍽3`],
        ['Н. А. Соколов\tБ. Д. 3', `${name} Б. Д.⍽3`],
        [`${name} Б. Д. 3`, `${name} Б. Д.⍽3`],
        ['Н. А. Соколов Б. <em>Д.</em> 3', `${name} Б. <em>Д.</em>⍽3`],
        ['Н. А. Соколов⍽Г.Г. 4', `${name}⍽Г.⍽Г.⍽4`],
        ['Н. А. Соколов Б. Ш. энтузиастов', `${name} Б. Ш.⍽энтузиастов`],
        ['Н. А. Соколов, Б. Д. 3', `${name},⍽Б. Д. 3`],
        ['Н. А. Соколов, д. 3', `${name}, д.⍽3`],
        ['Соколов Б. Д. 3', `${nowrap('Соколов Б. Д.')} 3`],
        ['Н. А. Соколов Б. Г. Петров', `${name} ${nowrap('Б. Г. Петров')}`],
        ['Соколов Б. Д., дом 3', `${nowrap('Соколов Б. Д.')}, дом 3`]
      ],
      { input: 'markdown', html: true }
    );
    settles([
      ['Н. А. Соколов Б. Д. 3', 'Н.⍽А.⍽Соколов⍽Б.⍽Д.⍽3'],
      ['Соколов Б. Д. 3', 'Соколов⍽Б.⍽Д. 3']
    ]);
    settles([['Н. А. Соколов Б. Д. 3', `${name} Б. Д. 3`]], {
      input: 'markdown',
      html: true,
      rules: { 'abbr.nbsp_location': false }
    });
    settles(
      [
        [
          '<doc>Н. А. <em>Соколов</em>&#x00a0;Б. Д. 3</doc>',
          '<doc>Н. А. <em>Соколов</em>&#x00a0;Б. Д.&#160;3</doc>'
        ]
      ],
      { input: 'xml', entities: true }
    );
  });

  test('a label right after initials binds its own word', () => {
    settles([
      ['Р. Г. ул. Мира', 'Р. Г. ул.⍽Мира'],
      ['Тё Р. Г. пр.е', 'Тё⍽Р.⍽Г. пр.⍽е'],
      ['в г. ул. Ленина', 'в г.⍽ул.⍽Ленина']
    ]);
    settles([['Ка Р. Г. ул. Мира', `<p>${nowrap('Ка Р. Г.')} ул.⍽Мира</p>`]], { html: true });
  });

  test('a run of references binds label by label in one pass', () => {
    settles([
      ['им.им.о', 'им.⍽им.⍽о'],
      ['им.им.им.о', 'им.⍽им.⍽им.⍽о'],
      ['см.см. выше', 'см.⍽см.⍽выше'],
      ['Ж им. им. о', 'Ж⍽им.⍽им.⍽о'],
      ['Вася им.им.', 'Вася им.⍽им.'],
      ['2 см.им.о', '2⍽см.им.о']
    ]);
  });
});

describe('an indefinite pronoun written apart', () => {
  test('stays apart before the colon of an enumeration a no-break wrapper ends in front of', () => {
    settles([['V-X в как то:', `<p>${nowrap('V–X вв. как то')}:</p>`]], {
      html: true,
      input: 'html'
    });
    settles([['Пи⍽ВД⍽как то:', `<p>${nowrap('Пи ВД как то')}:</p>`]], { html: true });
    settles([['как то: яблоки, как то раз', 'как⍽то: яблоки, как-то раз']]);
  });

  test('takes its hyphen behind a question the space rules part from it', () => {
    settles([
      ['?..когда то', '?.. когда-то'],
      ['Да?..как то раз', 'Да?.. как-то раз']
    ]);
  });
});

describe('a date with its year mark inside a no-break wrapper of the text', () => {
  test('takes no second wrapper beside lifted markup, with nested wrappers kept', () => {
    const kept = { html: true, input: 'markdown', rules: { 'other.drop_nested_nowrap': false } };

    settles(
      [
        ['шай⍽19.05.13г.*А*', `${nowrap('шай 19.05.13 г.')} *А*`],
        [
          'шай⍽19.05.13г. и дом 20.05.13 *А*',
          `${nowrap('шай 19.05.13 г.')} и⍽дом ${nowrap('20.05.13')} *А*`
        ]
      ],
      kept
    );
    settles([['У 06.04.58г _я_', '<nobr>У 06.04.58 г.</nobr> _я_']], {
      ...kept,
      render: { nowrap: 'nobr' }
    });
  });

  test('settles its mark first in the wrapper as behind a word of it, in any form of the wrapper', () => {
    const open = '<span style="white-space:nowrap;">';

    settles(
      [
        [`ями ${open}14.06.15г.</span>`, `<p>ями ${open}14.06.15 г.</span></p>`],
        ['ями <nobr>14.06.15г.</nobr>', '<p>ями <nobr>14.06.15 г.</nobr></p>'],
        [`ями ${open}и 14.06.15г.</span>`, `<p>ями ${open}и 14.06.15 г.</span></p>`],
        [`ями⍽${open}14.06.15г.</span>`, `<p>${open}ями 14.06.15 г.</span></p>`],
        [`под⍽${open}06.09.18г н`, `<p>${open}под 06.09.18 г. н</p>`]
      ],
      { html: true, input: 'html' }
    );
  });
});

describe('a currency sign left with no number in front by a unit power or a fraction', () => {
  test('binds to the number after it in the same pass', () => {
    settles([
      ['5м2⍽€0', '5⍽м²⍽€⍽0'],
      ['2м2 $3 и 4 $5', '2⍽м² $⍽3 и⍽4⍽$⍽5'],
      ['А4 €5', 'А4⍽€⍽5'],
      ['м2 €0', 'м2⍽€⍽0']
    ]);
    settles([['5/8рубле 5', '⅝⍽₽⍽5']]);
  });
});

describe('a label before a number whose power a currency word was glued to', () => {
  test('binds to the number in the pass that writes the power', () => {
    settles(
      [
        ['с. 3^3рубле', '<p>с.⍽3<sup><small>3</small></sup>⍽₽</p>'],
        ['п. 5^3долл', '<p>п.⍽5<sup><small>3</small></sup>⍽$</p>'],
        ['с. 2^2 м', '<p>с.⍽2<sup><small>2</small></sup> м</p>']
      ],
      { html: true }
    );
    settles([['с. 2^2долл', 'с. 2^2⍽$']]);
  });
});

describe('a capital letter with a period before an abbreviated label', () => {
  test('is an initial only on its own, not as the end of a word or a year mark', () => {
    settles([
      ['МЕЖДУ 1925-2001Г. С. 5', 'МЕЖДУ 1925–2001⍽гг. С.⍽5'],
      ['Ке ЖМ. Г. Москва', 'Ке⍽ЖМ. Г.⍽Москва'],
      ['Сидоров А. С. 5', 'Сидоров⍽А.⍽С. 5']
    ]);
    settles([['Ке ЖМ. Г.А...', `<p>${nowrap('Ке ЖМ')}. Г.⍽А…</p>`]], { html: true });
  });

  test('is an initial behind the wrapper of the initials before it, as without markup', () => {
    settles([['Он Ж.П. Г.А', 'Он⍽Ж.⍽П. Г. А']]);
    settles(
      [
        ['Он Ж.П. Г.А', `<p>${nowrap('Он Ж. П.')} Г. А</p>`],
        ['Оя Ж.М. Г.<i>Б</i>', `<p>${nowrap('Оя Ж. М.')} Г. <i>Б</i></p>`]
      ],
      { html: true }
    );
  });
});

describe('the number after a label before a year mark or a degree sign', () => {
  test('binds to the label in the pass that sets the mark apart', () => {
    settles([
      ['д.1944г.', 'д.⍽1944⍽г.'],
      ['ул. 1932°F', 'ул.⍽1932⍽°F'],
      ['д. 5°C', 'д.⍽5⍽°C'],
      ['ул. а1932°F', 'ул. а1932°F'],
      ['д. 1944г.а', 'д.⍽1944⍽г. а']
    ]);
    settles([['д. 1944г.', 'д.⍽1944⍽г.']], { rules: { units: false } });
    settles([['пр. 1932°F', 'пр.&nbsp;1932&nbsp;&deg;F']], { entities: true, input: 'markdown' });
  });
});

describe('an emphatic particle after a surname with initials', () => {
  test('joins in the pass that parts glued initials, and the surname keeps it', () => {
    settles([
      ['К.С.Бл кась П.', 'К.⍽С.⍽Бл-кась⍽П.'],
      ['А. С. Пушкин де сказал', 'А.⍽С.⍽Пушкин-де⍽сказал'],
      ['сайт.рф де', 'сайт.рф⍽де'],
      ['К.С.Петров-Водкин', 'К.С.Петров-Водкин']
    ]);
    settles([['К.С.Бл кась П.', `<p>${nowrap('К. С. Бл-кась П')}.</p>`]], { html: true });
    settles([['В.Д.То⍽ка', nowrap('В. Д. То-ка')]], { html: true, input: 'markdown' });
  });
});

describe('a short word glued behind a no-break wrapper a later group writes', () => {
  test('stays as it was before the wrapper', () => {
    settles(
      [
        ['3:15-9:05с пр', `<p>${nowrap('3:15–9:05')}с⍽пр</p>`],
        ['3:15-9:05 с пр', `<p>${nowrap('3:15–9:05')} с⍽пр</p>`],
        ['3:15-9:05(с пр', `<p>${nowrap('3:15–9:05')}(с⍽пр</p>`],
        ['<b>9:05</b>с пр', '<p><b>9:05</b>с⍽пр</p>']
      ],
      { html: true }
    );
  });
});

describe('an initial behind a no-break wrapper a later group writes', () => {
  test('binds no more than it did before the wrapper', () => {
    settles(
      [
        ['3:55-8:30Е. Об', `<p>${nowrap('3:55–8:30')}Е. Об</p>`],
        ['3:55-8:30 Е.Об', `<p>${nowrap('3:55–8:30')} Е. Об</p>`],
        ['<b>8:30</b> Е. Обер', '<p><b>8:30</b> Е. Обер</p>']
      ],
      { html: true }
    );
  });
});

describe('the dash after a standard number', () => {
  test('is not the hyphen that opens an arrow left as written', () => {
    settles([
      ['Гост6 -->', 'ГОСТ⍽6 -->'],
      ['ГОСТ 6 - текст', 'ГОСТ⍽6⍽— текст'],
      ['ГОСТ 6 -> текст', 'ГОСТ⍽6 → текст']
    ]);
    settles([['ГОСТ 6 --> текст', `<p>${nowrap('ГОСТ 6')} --> текст</p>`]], { html: true });
  });
});

describe('an extended arrow glued behind a no-break wrapper a later group writes', () => {
  test('stays as it was before the wrapper', () => {
    const config = { html: true };
    settles(
      [
        ['и пр.⍽b=> n.На', `<p>${nowrap('и пр. b')}=> n. На</p>`],
        ['и пр. b => n', `<p>${nowrap('и пр. b')} ⇒ n</p>`],
        ['и пр.(=> n', '<p>и⍽пр.(⇒ n</p>']
      ],
      config
    );
  });
  test('as does a plus-minus sign', () => {
    settles(
      [
        ['нэ.+/-', `<p>${nowrap('н. э.')}+/-</p>`],
        ['нэ. +/- 5', `<p>${nowrap('н. э.')} ± 5</p>`]
      ],
      { html: true }
    );
  });
});

describe('a requisite number after a label a no-break wrapper ends inside', () => {
  test('keeps its digits as typed', () => {
    settles([['нэ.⍽р/с 3786968270', `${nowrap('н. э. р')}/с 3786968270`]], {
      html: true,
      input: 'frontmatter'
    });
    settles([['и пр.арт. 3539555.Д', `${nowrap('и пр. арт')}. 3539555. Д`]], {
      html: true,
      input: 'markdown'
    });
    settles([
      ['р/с 3786968270', 'р/с 3786968270'],
      ['сумма 3786968 руб', 'сумма 3⎵786⎵968⍽₽']
    ]);
  });
});

describe('a mark after a surname glued to its initials', () => {
  test('is spaced in the pass that parts the initials', () => {
    settles([
      ['Т.И.Дя :a', 'Т.⍽И.⍽Дя: a'],
      ['Т.И.Дя.Мо', 'Т.⍽И.⍽Дя. Мо'],
      ['Т.И.Дя…a', 'Т.И.Дя… a'],
      ['example.com :a', 'example.com :a']
    ]);
    settles([['Т.И.Дя :a', 'Т.⍽И.⍽Дя: a']], { input: 'markdown' });
    settles([['Т.И.Дя :a', `<p>${nowrap('Т. И. Дя')}: a</p>`]], { html: true });
  });
});

describe('initials with a run of gaps between them', () => {
  test('are read as with one gap', () => {
    settles([
      ['д П.⍽⍽Н.Пг', 'д П.⍽Н.⍽Пг'],
      ['Петров П.⍽⍽Н.', 'Петров⍽П.⍽Н.'],
      ['П.⍽⍽Н. Гост 5', 'П.⍽Н.⍽Гост 5'],
      ['Т.⍽⍽И.Дя :a', 'Т.⍽И.⍽Дя: a']
    ]);
    settles([['д П.⍽⍽Н.Пг', `<p>д ${nowrap('П. Н. Пг')}</p>`]], {
      html: true
    });
  });
});

describe('a number after a comma a paragraph start parts', () => {
  test('binds to the word that ends the paragraph or the line in the same pass', () => {
    settles(
      [
        [',5 ы', '<p>, 5⍽ы</p>'],
        [',5 у', '<p>, 5 у</p>'],
        ['ГОСТ6,4 и Э', `<p>${nowrap('ГОСТ 6')}, 4⍽и⍽Э</p>`]
      ],
      { html: true, input: 'html' }
    );
    settles([[',5 ы\nб', '<p>, 5⍽ы<br>\nб</p>']], { html: true });
    settles(
      [
        [',5 ы', ',5 ы'],
        ['это 6,4 кг и 5 ы', 'это 6,4⍽кг и⍽5⍽ы']
      ],
      {}
    );
  });
});

describe('a digit run with two more dotted groups after it', () => {
  test('is a dotted identifier the triads leave whole', () => {
    settles([
      ['8 :46173.6.4.5', '8 :46173.6.4.5'],
      ['версия 1046173.6.4', 'версия 1046173.6.4'],
      ['версия 46173.6', 'версия 46⎵173.6'],
      ['версия 46173.6.', 'версия 46⎵173.6.'],
      ['версия 46173.a.4', 'версия 46⎵173.a.4']
    ]);
    settles([['8 :46173.6.4.5', '<p>8 :46173.6.4.5</p>']], { html: true });
  });
});

describe('a gap before marks that end in a comma glued to the next word', () => {
  test('is trimmed in the pass that parts the comma', () => {
    settles([
      ['1 …,и', '1…, и'],
      ['а ?,б', 'а?, б'],
      ['а …,α', 'а…,α'],
      ['а. .,и', 'а., и'],
      ['а ,и', 'а, и'],
      ['5 ,5', '5, 5']
    ]);
    settles([['1 &hellip;,и', '1…, и']], { input: 'html' });
    settles([['а …,и', 'а…,и']], { rules: { 'space.space_after_comma': false } });
  });
});

describe('an abbreviation glued to the second of the initials a surname parts', () => {
  test('is bound in the pass that parts the initials, as after spaced ones', () => {
    const config = {};
    settles(
      [
        ['За М.Т. н.', 'За⍽М.⍽Т.⍽н.'],
        ['За М. Т. н.', 'За⍽М.⍽Т.⍽н.'],
        ['Петров М.Т. к. он', 'Петров⍽М.⍽Т.⍽к. он'],
        ['М.Т. н.', 'М.Т. н.']
      ],
      config
    );
    settles([['За М.Т. н.', 'За⍽М.⍽Т.⍽н.']], { ...config, input: 'html' });
    settles([['За М.Т. н.', `<p>${nowrap('За М. Т.')} н.</p>`]], { ...config, html: true });
  });
});

describe('the mark after initials a no-break wrapper ends beside or inside', () => {
  test('is the sentence mark the initials keep', () => {
    settles(
      [
        ['Т.В.Сч С.М.!', `<p>${nowrap('Т. В. Сч')} С.М.!</p>`],
        ['Т.В.Сч⍽С.М.!', `<p>${nowrap('Т. В. Сч С')}.М.!</p>`],
        ['Т.В.Сч⍽С.⍽М.?', `<p>${nowrap('Т. В. Сч С')}.⍽М.?</p>`],
        ['<b>это</b> С.М.!', '<p><b>это</b> С.М.</p>']
      ],
      { html: true, input: 'html' }
    );
    settles([['это С.М.!', 'это С.М.']]);
  });
});

describe('the last word of a paragraph the author left open', () => {
  test('is bound before the blank line the next paragraph starts behind', () => {
    const config = { html: true, input: 'html' };
    settles(
      [
        ['й м\n<p>', '<p>й⍽м\n\n<p></p>'],
        ['это слово м\n<p>а', '<p>это слово⍽м\n\n<p>а</p>'],
        ['й м\n<p>а</p>', '<p>й⍽м</p>\n\n<p>а</p>']
      ],
      config
    );
    settles([['й м\nа б', '<p>й м<br>\nа⍽б</p>']], { html: true });
  });

  test('is bound before a line break a block tag stands behind, as before the tag itself', () => {
    const config = { html: true, input: 'html' };
    settles(
      [
        ['й т\n</div>', '<p>й⍽т\n\n</div></p>'],
        ['<div>й т\n</div>', '<div>й⍽т\n</div>'],
        ['<div>й т</div>', '<div>й⍽т</div>'],
        ['й т\n<b>а</b>', '<p>й т<br>\n<b>а</b></p>']
      ],
      config
    );
    settles([['а м\n<h6>', 'а⍽м\n\n<h6>']], { ...config, render: { paragraphs: false } });
  });

  test('is bound at the end of a Markdown heading a paragraph follows, as before a blank line', () => {
    const config = {
      html: true,
      input: 'markdown',
      render: { paragraphs: true }
    };
    settles(
      [
        ['# о р\nК', '# о⍽р\n<p>К</p>'],
        ['# о р\n\nК', '# о⍽р\n\n<p>К</p>'],
        ['текст о р\nК', '<p>текст о р\nК</p>']
      ],
      config
    );
    settles([['# л О\na', '# л⍽О\n<p>a</p>']], { ...config, input: 'frontmatter' });
  });

  test('is bound behind the wrapper the engine writes round the word before it', () => {
    const config = { html: true, input: 'markdown' };
    settles(
      [
        ['Вот АМ к', nowrap('Вот АМ к')],
        ['Поди.\n\nВот АМ к\n\n-До', `Поди.\n\n${nowrap('Вот АМ к')}\n\n-До`],
        ['Поди.\n\n_[Вот](/x) АМ к_', 'Поди.\n\n_[Вот](/x)⍽АМ⍽к_']
      ],
      config
    );
    settles([['Вот АМ к.', `<p>${nowrap('Вот АМ к')}.</p>`]], {
      html: true
    });
    settles([['Вот АМ к', `<p>${nowrap('Вот АМ')}⍽к</p>`]], {
      html: true,
      rules: { 'other.strip_nbsp_in_nowrap': false }
    });
    settles([['Пишет Иванов Н. С. мне', `<p>Пишет ${nowrap('Иванов Н. С.')} мне</p>`]], {
      html: true
    });
  });

  test('is taken into that wrapper where only the paragraph the engine lays out ends it', () => {
    const config = { html: true, input: 'html' };
    settles([['Р.Р.Тн одно<!--', `<p>${nowrap('Р. Р. Тн одно')}</p><!--`]], config);
    settles([['Р.Р.Тн одно<!--', `<p>${nowrap('Р.⍽Р.⍽Тн⍽одно')}</p><!--`]], {
      ...config,
      rules: { 'other.nbsp_in_nowrap': true }
    });
    settles([['Р.Р.Тн одно<!--', `<p>${nowrap('Р.⍽Р.⍽Тн')}⍽одно</p><!--`]], {
      ...config,
      rules: { 'other.strip_nbsp_in_nowrap': false }
    });
  });
});

describe('a fraction before a prime written back as a reference', () => {
  test('stays as typed, as before the prime itself', () => {
    const config = { entities: true, input: 'xml' };
    settles(
      [
        ['<doc><p>7/8»</p><item></item></doc>', '<doc><p>7/8&#8243;</p><item></item></doc>'],
        ['<doc><p>7/8&#8243;</p></doc>', '<doc><p>7/8&#8243;</p></doc>'],
        ['<doc><p>7/8&amp;</p></doc>', '<doc><p>&#8542;&amp;</p></doc>'],
        ['<doc><p>7/8 дюйма</p></doc>', '<doc><p>&#8542;&#160;дюйма</p></doc>']
      ],
      config
    );
    settles([['7/8»', '7/8″']]);
  });
});

describe('an emphatic particle behind an opening quote or bracket', () => {
  test('binds the next word on the first pass, as it does after a space', () => {
    settles([
      ['«Поди кась так»', '«Поди-кась⍽так»'],
      ['(Поди-кась так)', '(Поди-кась⍽так)'],
      ['Поди-кась так', 'Поди-кась⍽так'],
      ['№поди-кась так', '№поди-кась так'],
      ['5поди-кась так', '5поди-кась так']
    ]);
    settles(
      [['# Возьми ка кубок\n\n- Возьми-ка кубок', '# Возьми-ка⍽кубок\n\n- Возьми-ка⍽кубок']],
      {
        input: 'markdown'
      }
    );
    settles(
      [
        ['"Поди кась так"', '<p><span style="margin-left:-0.44em;">«</span>Поди-кась⍽так»</p>'],
        ['"п кась н', '<p><span style="margin-left:-0.44em;">«</span>п-кась⍽н</p>']
      ],
      { html: true, rules: { 'hanging.quote': true } }
    );
  });
});

describe('a hyphenated word behind an opening bracket or quote', () => {
  test('is kept from breaking on the first pass, as it is after a space', () => {
    settles(
      [
        ['(кто-то т', `<p>(${nowrap('кто-то т')}</p>`],
        ['„где-то, и', `<p>«${nowrap('где-то')}, и</p>`],
        ['а-б-в-г т', '<p>а-б-в-г т</p>']
      ],
      { html: true, rules: { 'nobr.nowrap_hyphen': true } }
    );
    settles(
      [
        ['(г-о т', `<p><span style="margin-left:-0.3em;">(</span>${nowrap('г-о т')}</p>`],
        ['"кто-то т"', `<p><span style="margin-left:-0.44em;">«</span>${nowrap('кто-то т')}»</p>`]
      ],
      {
        html: true,
        rules: { 'nobr.nowrap_hyphen': true, 'hanging.bracket': true, 'hanging.quote': true }
      }
    );
  });
});

describe('a copyright shorthand after an enumeration item a hanging bracket is drawn round', () => {
  test('stays the next item, as without the bracket', () => {
    settles([['(б)(C) 2026', '<p><span style="margin-left:-0.3em;">(</span>б)(C) 2026</p>']], {
      html: true,
      input: 'html',
      rules: { 'hanging.bracket': true }
    });
    settles(
      [
        ['(б)(C) 2026', '<p>(б)(C) 2026</p>'],
        ['(C) 2026', '<p>©⍽2026</p>']
      ],
      { html: true, input: 'html' }
    );
  });
});

describe('an emphatic particle before the end of a no-break wrapper', () => {
  test('ends where the character behind the wrapper does', () => {
    settles(
      [
        ['24.06.27г⍽т⍽де`', `<p>${nowrap('24.06.27 г. т де')}\`</p>`],
        [`${nowrap('т де')}\``, `<p>${nowrap('т де')}\`</p>`],
        [`${nowrap('т де')} и`, `<p>${nowrap('т-де и')}</p>`],
        ['24.06.27г т де.', `<p>${nowrap('24.06.27 г.')} т-де.</p>`],
        ['<b>т де</b>`', '<p><b>т⍽де</b>`</p>']
      ],
      { html: true }
    );
    settles([['т де`', 'т⍽де`']]);
  });
});

describe('initials without periods behind a run of spaces', () => {
  test('bind as behind one space', () => {
    const config = { input: 'yaml', rules: { 'space.collapse_spaces': false } };
    settles(
      [
        ['Фа  Ж Е', 'Фа⍽Ж⍽Е'],
        ['Фа  Ж  Е', 'Фа⍽Ж⍽Е']
      ],
      config
    );
    settles([['Фа  Ж Е', `<p>${nowrap('Фа Ж Е')}</p>`]], {
      html: true,
      rules: { 'space.collapse_spaces': false }
    });
    settles([
      ['Фа Ж Е', 'Фа⍽Ж⍽Е'],
      ['Фа\n\nЖ Е', 'Фа\n\nЖ⍽Е']
    ]);
  });

  test('take their periods on the first pass, as behind one space', () => {
    const config = { rules: { 'nobr.initials_dots': true } };
    settles(
      [
        ['Ры ⍽АМ', 'Ры⍽А.⍽М.'],
        ['Ры ⍽А М', 'Ры⍽А.⍽М.'],
        ['⍽АМ ⍽Од.', 'А.⍽М.⍽Од.'],
        ['Ры АМ', 'Ры⍽А.⍽М.']
      ],
      config
    );
    settles([['Шй ⍽ВД', `<p>${nowrap('Шй В. Д.')}</p>`]], { ...config, html: true });
  });
});

describe('a no-break space beside a space inside a no-break wrapper', () => {
  test('is written back as one space, as the spaces collapse', () => {
    settles(
      [
        [nowrap('а ⍽б'), `<p>${nowrap('а б')}</p>`],
        [nowrap('а⍽б'), `<p>${nowrap('а б')}</p>`],
        ['а ⍽нэ.', `<p>а ⍽${nowrap('н. э.')}</p>`]
      ],
      { html: true }
    );
    settles([[nowrap('а ⍽б'), `<p>${nowrap('а  б')}</p>`]], {
      html: true,
      rules: { 'space.collapse_spaces': false }
    });
  });
});

describe('a postal index before its city behind a no-break space written as a reference', () => {
  test('keeps its digits as typed, as behind the space itself', () => {
    settles(
      [
        [
          '<doc><description>934386,⍽В</description></doc>',
          '<doc><description>934386,&#160;В</description></doc>'
        ],
        [
          '<doc><description>934386, В</description></doc>',
          '<doc><description>934386, В</description></doc>'
        ]
      ],
      { entities: true, input: 'xml' }
    );
    settles([
      ['934386,⍽В', '934386,⍽В'],
      ['934386,5', '934⎵386,5']
    ]);
  });
});

describe('a negative number after the end of a block', () => {
  test('gets its minus in the pass that starts its paragraph', () => {
    settles(
      [
        ['<pre></pre>-9', '<pre></pre>\n\n<p>−9</p>'],
        ['<p>а</p>-9', '<p>а</p>\n\n<p>−9</p>'],
        ['<p>а</p> -9', '<p>а</p>\n\n<p>−9</p>'],
        ['<p>а</p>-9-5', '<p>а</p>\n\n<p>-9-5</p>'],
        ['<b>а</b>-9', '<p><b>а</b>-9</p>']
      ],
      { html: true }
    );
  });
});

describe('a temperature behind the end of a date wrapper', () => {
  test('binds only where the number would start before the wrapper was written', () => {
    settles(
      [
        ['26.02.18г.2 °F', '<p><span style="white-space:nowrap;">26.02.18 г.</span>2 °F</p>'],
        ['26.02.18г. 2 °F', '<p><span style="white-space:nowrap;">26.02.18 г.</span> 2⍽°F</p>'],
        ['<b>г.</b>2 °F', '<p><b>г.</b>⍽2⍽°F</p>']
      ],
      { html: true, input: 'html' }
    );
    settles([['26.02.18г.2 °F', '26.02.18⍽г.2 °F']]);
  });
});

describe('a year glued to the period of an abbreviation', () => {
  test('is parted from its word in the pass that binds the abbreviation', () => {
    settles([['пр.917год', 'пр.⍽917⍽год']]);
    settles([['{"":"пр.917год"}', '{"":"пр.⍽917⍽год"}']], { input: 'json' });
    settles([
      ['пр.917год', 'пр.⍽917⍽год'],
      ['т.1917годом', 'т.1917 годом'],
      ['1.917год', '1.917год']
    ]);
  });
});

describe('a capital year mark closing a period', () => {
  test('is no initial: the house number after it binds in the same pass', () => {
    settles([
      ['ПО 1951-2032 Г. Д. 1', 'ПО⍽1951–2032⍽гг. Д.⍽1'],
      ['1951-2032 Г. Д. 1', '1951–2032⍽Г. Д.⍽1'],
      ['ПО 1951 Г. Д. 1', 'ПО⍽1951⍽Г. Д. 1'],
      ['Иванов Г. Д. 1', 'Иванов⍽Г.⍽Д. 1']
    ]);
  });
});

describe('a city after a postal index behind a run of gaps', () => {
  test('binds as behind one space', () => {
    settles([['036623 ⍽г.К', '036623⍽г.⍽К']], { input: 'markdown' });
    settles([
      ['036623 ⍽г.К', '036623⍽г.⍽К'],
      ['036623 г. Москва', '036623⍽г.⍽Москва'],
      ['123 ⍽г. Москва', '123⍽г. Москва']
    ]);
  });
});

describe('a wrapper a rule writes round the whole text of an element inside a no-break wrapper', () => {
  test('gives way to no-break spaces, as outside the wrapper: the wrappers do not grow', () => {
    settles(
      [
        [`<p>${nowrap('и <b>Тй П.Г.</b>')}</p>`, `<p>${nowrap('и <b>Тй П. Г.</b>')}</p>`],
        [
          `<p>${nowrap('и <b class="x">Тй П.Г.</b>')}</p>`,
          `<p>${nowrap('и <b class="x">Тй П. Г.</b>')}</p>`
        ],
        [
          `<p>${nowrap('и <span style="white-space:normal">Тй П.Г.</span>')}</p>`,
          `<p>${nowrap('и <span style="white-space:normal">Тй П. Г.</span>')}</p>`
        ]
      ],
      { html: true, input: 'html', rules: { 'other.drop_nested_nowrap': false } }
    );
  });
});

describe('an address bound behind a date wrapper', () => {
  test('stays whole when a later reread runs the wrapper rules again', () => {
    settles(
      [
        [
          '07.05.1989  г https://sub.domain.co.uk/?b=2\n15.11.17 7 293 и',
          `<p>${nowrap('07.05.1989 г.')}⍽https://sub.domain.co.uk/?b=2<br>\n${nowrap('15.11.17')} 7⎵293⍽и</p>`
        ]
      ],
      { html: true, input: 'html', render: { autolink: false } }
    );
  });
});

describe('a time range inside the wrapper grown round the words bound to it', () => {
  const rules = { 'other.drop_nested_nowrap': false };

  test('takes no wrapper of its own on the next pass, with nested wrappers kept', () => {
    settles([['оре⍽14:00-0:25⍽е', `<p>${nowrap('оре 14:00–0:25 е')}</p>`]], { html: true, rules });
    settles([['я⍽1:05-6:50⍽п', '<nobr>я⍽1:05–6:50⍽п</nobr>']], {
      html: true,
      input: 'markdown',
      render: { nowrap: 'nobr' },
      rules: { ...rules, 'other.nbsp_in_nowrap': true }
    });
    settles([['с 1:05-6:50 до', `<p>${nowrap('с 1:05–6:50')} до</p>`]], { html: true, rules });
  });
});

describe('an element of the author lying inside a range of the engine wrapper', () => {
  const rules = { 'other.drop_nested_nowrap': false };

  test('leaves the range covered: no rule wraps it again', () => {
    settles(
      [['<p>О <strong>Тй</strong> П.Г.</p>', `<p>${nowrap('О <strong>Тй</strong> П. Г.')}</p>`]],
      { html: true, input: 'html', rules }
    );
  });

  test('an element holding the range inside the wrapper uncovers it only with a style or a class', () => {
    settles(
      [
        [`<p>${nowrap('вот <b>Тй П.Г.</b>')}</p>`, `<p>${nowrap('вот <b>Тй П. Г.</b>')}</p>`],
        [
          `<p>${nowrap('вот <b class="x">Тй П.Г.</b>')}</p>`,
          `<p>${nowrap('вот <b class="x">Тй⍽П.⍽Г.</b>')}</p>`
        ],
        [
          `<p>${nowrap('вот <b style="color:red">Тй П.Г.</b>')}</p>`,
          `<p>${nowrap('вот <b style="color:red">Тй⍽П.⍽Г.</b>')}</p>`
        ]
      ],
      { html: true, input: 'html', rules: { ...rules, 'other.strip_nbsp_in_nowrap': false } }
    );
  });

  test('an element of the author left open inside a wrapper left open keeps the range covered', () => {
    settles(
      [
        [
          '<span style="white-space:nowrap;"><r> ⍽нэ.',
          '<p><span style="white-space:nowrap;"><r> ⍽н. э.</p>'
        ]
      ],
      { html: true }
    );
  });
});

describe('a word a no-break space glues to a no-break wrapper', () => {
  const open = '<span style="white-space:nowrap;">';

  test('joins it with no space the next pass takes again', () => {
    const md = { html: true, input: 'markdown' };
    settles(
      [
        [`н⍽${open}`, `${open}н`],
        [`н⍽${open} </span>`, `${open}н </span>`],
        [`н⍽${open}т. е.</span>`, `${open}н т. е.</span>`]
      ],
      md
    );
    settles([[`В⍽${open}`, `${open}В`]], { html: true, input: 'frontmatter' });
    settles([[`н⍽${open}`, `<p>${open}н</p>`]], { html: true, input: 'html' });
  });

  test('keeps the space where the space rules would leave it', () => {
    settles([[`н⍽${open}`, `${open}н `]], {
      html: true,
      input: 'markdown',
      rules: { 'space.trim_line_end': false }
    });
    settles([[`н⍽${open} </span>`, `${open}н  </span>`]], {
      html: true,
      input: 'markdown',
      rules: { 'space.collapse_spaces': false }
    });
  });
});

describe('a number before a word a no-break wrapper starts', () => {
  const next = { html: true };

  test('binds to it on the first pass, as to the word written without the wrapper', () => {
    settles(
      [
        ['Их 2 ВД Кй к д.', `<p>Их⍽2⍽${nowrap('ВД Кй')} к⍽д.</p>`],
        ['Их 2 т. е. к д.', `<p>Их⍽2⍽${nowrap('т. е.')} к⍽д.</p>`]
      ],
      next
    );
    settles([['Их 2 <b>ВД Кй</b> к д.', '<p>Их⍽2⍽<b>ВД⍽Кй</b> к⍽д.</p>']], {
      ...next,
      input: 'html'
    });
    settles([['Их 2 ВД Кй к д.', 'Их⍽2⍽ВД⍽Кй к⍽д.']]);
  });

  test('stays apart where the wrapper starts with what the number does not bind to', () => {
    settles(
      [
        ['Их 2 +7 999 123-45-67 к д.', `<p>Их⍽2 ${nowrap('+7 999 123-45-67')} к⍽д.</p>`],
        ['Их 2 у ВД Кй к д.', `<p>Их⍽2 ${nowrap('у ВД Кй')} к⍽д.</p>`]
      ],
      next
    );
  });

  test('stays apart from an element the author left open, in output without markup as with it', () => {
    for (const input of ['html', 'markdown', 'frontmatter']) {
      settles([['0 <b>в', '0 <b>в']], { input });
    }
    settles([['{"a":"5 <s>б"}', '{"a":"5 <s>б"}']], { input: 'json' });
    settles([['0 <b>в', '<p>0 <b>в</p>']], { ...next, input: 'html' });
  });
});

describe('a rule the engine reruns after the no-break wrappers are settled', () => {
  const next = { html: true, input: 'html' };

  test('leaves a plain space inside a wrapper, as the wrappers settle it', () => {
    settles(
      [
        [`${nowrap('5 лет назад')} ключик`, `<p>${nowrap('5 лет назад')} ключик</p>`],
        [`${nowrap('5 лет назад')} ключ`, `<p>${nowrap('5 лет назад ключ')}</p>`],
        [`${nowrap('1979 г. до н. э.')} ключ`, `<p>${nowrap('1979 г. до н. э.')} ключ</p>`]
      ],
      next
    );
    settles([['<p>С 4-26 ноября было</p>', `<p>${nowrap('С 4—26 ноября было')}</p>`]], {
      ...next,
      rules: { 'date.*': true }
    });
    settles(
      [['Мы Запомнить 5-17 марта кто пришли.', `Мы⍽Запомнить ${nowrap('5—17 марта')} кто пришли.`]],
      { html: true, input: 'markdown', rules: { 'date.*': true } }
    );
    settles([['<nobr>5 лет назад</nobr> ключ', '<p><nobr>5 лет назад ключ</nobr></p>']], {
      ...next,
      render: { nowrap: 'nobr' }
    });
  });

  test('keeps its no-break space where the wrappers keep theirs', () => {
    settles([[`${nowrap('5 лет назад')} ключ`, `<p>${nowrap('5⍽лет назад')}⍽ключ</p>`]], {
      ...next,
      rules: { 'other.strip_nbsp_in_nowrap': false }
    });
    settles([[`${nowrap('5 лет назад')} ключ`, `<p>${nowrap('5⍽лет⍽назад⍽ключ')}</p>`]], {
      ...next,
      rules: { 'other.nbsp_in_nowrap': true }
    });
  });
});

const wrappersIn = (text) => text.split('<span style="white-space:nowrap;">').length - 1;

describe("a phrase inside the engine's wrapper gets no wrapper of its own", () => {
  const NOWRAP = '<span style="white-space:nowrap;">';
  const PHRASES = [
    'т. к.',
    'т.н.',
    'и др.',
    'и пр.',
    'ГОСТ 5773-90',
    '+7 (999) 123 45 67',
    '8-800-555-35-35',
    '+7-999-123-45-67'
  ];
  const RULES = { 'abbr.nowrap_because': true, 'other.drop_nested_nowrap': false };

  for (const [name, rules] of [
    ['nested wrappers kept', RULES],
    ['nested wrappers kept, spaces in a wrapper bound', { ...RULES, 'other.nbsp_in_nowrap': true }]
  ]) {
    test(`a word bound to the phrase joins its wrapper and the next passes add none: ${name}`, () => {
      for (const body of PHRASES) {
        for (const text of [`а\u{00A0}${body} было`, `<p>а\u{00A0}${body}</p>`]) {
          const typo = new MicroTypo({ html: true, input: 'html', rules });
          const once = typo.process(text);
          const twice = typo.process(once);

          assert.equal(wrappersIn(once), 1, `${text} → ${once}`);
          assert.equal(twice, once, text);
          assert.equal(typo.process(twice), twice, text);
        }
      }
    });
  }

  test('initials after an element inside a wrapper stay in that wrapper', () => {
    const typo = new MicroTypo({
      html: true,
      input: 'html',
      rules: {
        'nobr.nowrap_initials': true,
        'other.drop_nested_nowrap': false,
        'other.nbsp_in_nowrap': true
      }
    });
    const once = typo.process(`<p>${NOWRAP}О <strong>Тй</strong> А. С. Пушкин слово</span></p>`);

    assert.equal(wrappersIn(once), 1, once);
    assert.equal(typo.process(once), once);
  });

  test('the same phrases outside a wrapper get one each', () => {
    for (const body of PHRASES) {
      const typo = new MicroTypo({ html: true, input: 'html', rules: RULES });
      const once = typo.process(`<p>Было ${body} и было</p>`);

      assert.equal(wrappersIn(once), 1, `${body} → ${once}`);
      assert.equal(typo.process(once), once, body);
    }
  });
});
