import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clearSpecialChars } from '../../src/clear-special.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { G, GLYPH_TO_ENTITY, unicodeToEntities } from '../../src/lib/glyphs.js';

const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const HTML_ONLY = { html: true, render: { paragraphs: false } };
const NBSP = '\u{00A0}';

const around = (middle) => `Дворкин ${middle} Оберон`;
const middleOf = (out) => out.slice('Дворкин '.length, -' Оберон'.length);

describe('entity decode and round-trip', () => {
  test('single-encoded entities decode to their glyph', () => {
    assert.equal(microtypo('&trade;', { html: true, entities: false }), '<p>™</p>');
    assert.equal(microtypo('&copy;', { html: true, entities: false }), '<p>©</p>');
    assert.equal(microtypo('&reg;', { html: true, entities: false }), '<p>®</p>');
  });

  // `&amp;` is deliberately absent from the decode table, so it round-trips rather than collapsing
  // to a bare `&`.
  test('&amp; and &#38; are preserved verbatim, never decoded to a bare &', () => {
    assert.equal(clearSpecialChars('&amp;'), '&amp;');
    assert.equal(clearSpecialChars('&#38;'), '&#38;');
  });

  test('&amp;copy; stays escaped through the pipeline, not decoded to &copy;', () => {
    assert.equal(
      microtypo('&amp;copy;', { input: { format: 'html' }, entities: true }),
      '&amp;copy;'
    );
  });

  test('ampersand-joined text keeps &amp;', () => {
    assert.equal(
      microtypo('Корвин &amp; Эрик', { html: true, render: { paragraphs: false } }),
      'Корвин &amp; Эрик'
    );
  });

  test('double-encoded entity is never decoded, stays literal', () => {
    assert.equal(clearSpecialChars('&amp;trade;'), '&amp;trade;');
    assert.equal(clearSpecialChars('&amp;reg;'), '&amp;reg;');
    assert.equal(clearSpecialChars('&amp;copy;'), '&amp;copy;');
  });

  test('double-encoded entity is identical literal in both output modes', () => {
    assert.equal(microtypo('&amp;trade;', { html: true, entities: false }), '<p>&amp;trade;</p>');
    assert.equal(microtypo('&amp;trade;', { html: true, entities: true }), '<p>&amp;trade;</p>');
  });

  test('&#769; decodes to the combining acute accent, not a backtick', () => {
    const out = clearSpecialChars('Корви&#769;н');
    assert.ok(!out.includes('`'), `backtick leaked: ${out}`);
    assert.ok(out.includes('́'), `combining acute missing: ${JSON.stringify(out)}`);
  });

  test('combining acute round-trips through the entity form', () => {
    const decoded = clearSpecialChars('Корви&#769;н');
    assert.equal(unicodeToEntities(decoded), 'Корви&#769;н');
  });
});

describe('author space preservation', () => {
  test('author &nbsp; round-trips to real NBSP (U+00A0), not plain space', () => {
    const out = microtypo('a&nbsp;b', PARAMS);
    assert.ok(out.includes(NBSP), `Expected U+00A0 in output. Got: ${JSON.stringify(out)}`);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author &#160; round-trips to real NBSP (U+00A0), not plain space', () => {
    const out = microtypo('a&#160;b', PARAMS);
    assert.ok(out.includes(NBSP), `Expected U+00A0 in output. Got: ${JSON.stringify(out)}`);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author raw U+00A0 NBSP survives normalisation unchanged', () => {
    const out = microtypo(`a${NBSP}b`, PARAMS);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author &thinsp; round-trips to real thin space (U+2009), not plain space', () => {
    const out = microtypo('a&thinsp;b', PARAMS);
    assert.equal(out.codePointAt(1), 0x2009, `Got: ${JSON.stringify(out)}`);
  });

  test('author U+2002 (en space) collapses to a canonical Unicode glyph, not ASCII space', () => {
    const out = microtypo('a\u{2002}b', PARAMS);
    assert.notEqual(out.codePointAt(1), 0x20, `Got: ${JSON.stringify(out)}`);
  });

  test('MicroTypo class preserves author &nbsp; as U+00A0', () => {
    const typo = new MicroTypo(PARAMS);
    const out = typo.process('До&nbsp;Амбера');
    const idx = out.indexOf('Амбера');
    assert.equal(out.codePointAt(idx - 1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('entity mode: author &nbsp; round-trips once, not lost, not doubled', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('a&nbsp;b');
    assert.ok(out.includes('&nbsp;'), `Got: ${JSON.stringify(out)}`);
    assert.equal((out.match(/&nbsp;/g) ?? []).length, 1, `Got: ${JSON.stringify(out)}`);
  });

  test('engine-inserted NBSP before a unit still works', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.ok(typo.process('7 ГБ Козырей').includes('7&nbsp;ГБ'));
  });
});

// One character, two spellings. Whichever way an author writes it, the engine must reach the same
// output — otherwise the same document typesets differently after an unrelated entity rewrite.
describe('named and numeric references of one character agree', () => {
  const PAIRS = [
    ['&mdash;', '&#8212;'],
    ['&ndash;', '&#8211;'],
    ['&minus;', '&#8722;'],
    ['&hellip;', '&#8230;'],
    ['&trade;', '&#8482;'],
    ['&equiv;', '&#8801;'],
    ['&thinsp;', '&#8201;'],
    ['&copy;', '&#169;'],
    ['&reg;', '&#174;'],
    ['&nbsp;', '&#160;'],
    ['&laquo;', '&#171;'],
    ['&ldquo;', '&#8220;'],
    ['&rdquo;', '&#8221;'],
    ['&bdquo;', '&#8222;'],
    ['&quot;', '&#34;'],
    ['&rsquo;', '&#8217;'],
    ['&lsquo;', '&#8216;'],
    ['&sect;', '&#167;'],
    ['&euro;', '&#8364;'],
    ['&times;', '&#215;'],
    ['&plusmn;', '&#177;'],
    ['&frac12;', '&#189;'],
    ['&le;', '&#8804;'],
    ['&ge;', '&#8805;'],
    ['&ne;', '&#8800;']
  ];

  const CONTEXTS = [(x) => `Амбер ${x} Оберон`, (x) => `<b>${x}</b>`, (x) => `Амбер(${x})`];

  for (const [named, numeric] of PAIRS) {
    test(`${named} typesets like ${numeric}`, () => {
      for (const make of CONTEXTS) {
        assert.equal(
          microtypo(make(named), HTML_ONLY),
          microtypo(make(numeric), HTML_ONLY),
          `${named} and ${numeric} diverge in ${make('X')}`
        );
      }
    });
  }
});

// The bracket trimmer strips stray ",;" before ")". A reference terminator is markup, not stray
// punctuation: cutting it leaves a bare &amp, which the decode table promises never to produce.
describe('character references survive the bracket trimmer', () => {
  test('&amp; keeps its terminator before a closing bracket', () => {
    assert.equal(microtypo('Козырь (&amp;) Амбер', HTML_ONLY), 'Козырь (&amp;) Амбер');
    assert.equal(microtypo('Козырь (&lt;) Амбер', HTML_ONLY), 'Козырь (&lt;) Амбер');
  });

  test('a numeric reference outside the decode table keeps its terminator', () => {
    assert.equal(microtypo('Козырь (&#960;) Амбер', HTML_ONLY), 'Козырь (&#960;) Амбер');
  });

  test('a stray semicolon before a closing bracket is still trimmed', () => {
    assert.equal(microtypo('Козырь (Корвин;) Амбер', HTML_ONLY), 'Козырь (Корвин) Амбер');
    assert.equal(microtypo('Козырь (Корвин,) Амбер', HTML_ONLY), 'Козырь (Корвин) Амбер');
  });
});

describe('protected regions', () => {
  test('glyphs inside <script> survive entity mode byte-for-byte', () => {
    const src = '<script>re=/«Козырь»/;s="Корвин — Эрик"</script>';
    assert.equal(microtypo(src, { input: { format: 'html' }, entities: true }), src);
  });

  test('entity mode does not rewrite protected tag attributes', () => {
    const out = microtypo('<a title="— «Амбер»">Корвин - Эрик</a>', {
      entities: true,
      render: { paragraphs: false }
    });
    assert.ok(out.includes('title="— «Амбер»"'), out);
  });

  // The inch mark is emitted as `&Prime;`, so it has to decode back, or the engine cannot read its
  // own output and the fraction guard finds a literal `&` after the digits.
  test('the inch mark entity decodes back to its glyph', () => {
    assert.equal(microtypo('Клинок 36&Prime; длиной'), 'Клинок 36″ длиной');
    assert.equal(microtypo('Клинок 36&#8243; длиной'), 'Клинок 36″ длиной');
  });

  test('an inch mark survives a round trip through entity mode', () => {
    const once = microtypo('Труба 3/4" и доска 5"', { html: true, entities: true });

    assert.ok(once.includes('3/4&Prime;'), once);
    assert.equal(microtypo(once, { html: true, entities: true }), once);
  });

  // The narrow no-break space is emitted as `&#8239;`, so it has to decode back, or the engine
  // cannot read its own output.
  test('the narrow no-break space entity decodes back to its glyph', () => {
    const NN = '\u{202F}';

    assert.equal(microtypo('Казна 12&#8239;500 монет'), `Казна 12${NN}500 монет`);
    assert.equal(microtypo('Казна 12&#x202F;500 монет'), `Казна 12${NN}500 монет`);
  });

  test('a semicolon after a narrow no-break space survives a round trip', () => {
    const config = { entities: true };
    const once = microtypo('И «это»\u{202F}; конец', config);

    assert.ok(once.includes(';'), once);
    assert.ok(
      microtypo(once, config).includes(';'),
      "the author's semicolon was eaten on reprocessing"
    );
  });

  test('a thousands separator survives reprocessing in entity mode', () => {
    const config = { entities: true };
    const once = microtypo('Казна 12500 монет', config);

    assert.ok(once.includes('12&#8239;500'), once);
    assert.equal(microtypo(once, config), once);
  });

  // Both halves of one contract, checked against the engine rather than against the table: a glyph
  // the author wrote must survive when nothing is registered to re-derive it, and an entity the
  // engine emits must read back as that glyph.
  describe('every produced glyph survives with no rule registered', () => {
    // presets:false registers no rule group, so only glyph normalisation and protect/restore run.
    const bare = new MicroTypo({ presets: false });

    // `«»` aside, the straight-quote family folds on purpose: which way a quote faces inside a
    // quotation is the quote state machine's decision, so those two are not in this contract.
    const FOLDS_TO_QUOTE = new Set([G.BDQUO, G.LDQUO]);

    test('an authored glyph is not decomposed', () => {
      for (const [name, glyph] of Object.entries(G)) {
        if (FOLDS_TO_QUOTE.has(glyph)) {
          continue;
        }

        assert.equal(middleOf(bare.process(around(glyph))), glyph, `G.${name} was decomposed`);
      }
    });

    test('an emitted entity reads back as its glyph', () => {
      for (const [glyph, entity] of Object.entries(GLYPH_TO_ENTITY)) {
        if (FOLDS_TO_QUOTE.has(glyph)) {
          continue;
        }

        assert.equal(middleOf(bare.process(around(entity))), glyph, `${entity} did not decode`);
      }
    });
  });
});
