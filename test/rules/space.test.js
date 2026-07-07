import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NNBSP = '\u{202F}';
const FLAT = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const HTML = { html: true, render: { paragraphs: false } };

const ent = (text) => new MicroTypo({ ...FLAT, entities: true }).process(text);

// html:false skips the text group, so the nowrap tag and nbsp rewrite layer in via separate applyOptions() calls.
function plainNoWrap() {
  const instance = new MicroTypo({ html: false, entities: false });
  instance.applyOptions({ render: { nowrap: 'span' } });
  instance.applyOptions({ rules: { 'other.nbsp_in_nowrap': true } });
  return instance;
}

function assertNoWrap(out, label) {
  assert.doesNotMatch(out, /<nobr[\s>]/i, `${label}: literal <nobr> leaked. Got: ${out}`);
  assert.doesNotMatch(out, /&lt;nobr/i, `${label}: escaped &lt;nobr&gt; leaked. Got: ${out}`);
}

describe('IP no-wrap', () => {
  test('valid IPv4 wraps in a nowrap span', () => {
    assert.equal(
      microtypo('тропа 192.168.1.1 Амбера', HTML),
      'тропа <span style="white-space:nowrap;">192.168.1.1</span> Амбера'
    );
  });

  test('octet over 255 stays plain', () => {
    assert.equal(microtypo('тропа 999.1.1.1 Амбера', HTML), 'тропа 999.1.1.1 Амбера');
  });

  test('empty leading octet stays plain', () => {
    const out = microtypo('тень .2.3.4 там', { html: true });
    assert.ok(!/nowrap|nobr/.test(out), out);
  });

  test('valid address still wraps', () => {
    const out = microtypo('тропа 10.0.0.1 там', { html: true });
    assert.ok(/nowrap|nobr/.test(out), out);
  });
});

describe('short-word gluing and paragraph breaks', () => {
  test('trailing short word stays in its paragraph', () => {
    const html = microtypo('Корвин шёл. и\n\nАмбер ждал.', { html: true });
    assert.match(html, /шёл\.\s*и<\/p>/u);
    assert.match(html, /<p>Амбер ждал\./u);
  });

  test('blank-line separator survives', () => {
    const plain = microtypo('Корвин шёл. и\n\nАмбер ждал.', { html: false });
    assert.match(plain, /\n\n/u);
  });

  test('short word glues to the next word on the same line', () => {
    const plain = microtypo('Корвин и Эрик.', { html: false });
    assert.ok(plain.includes(`и${NBSP}Эрик`));
  });
});

describe('no-wrap suppression', () => {
  test('phone number emits no nobr', () => {
    assertNoWrap(plainNoWrap().process('Звоните Корвину +7 495 123-45-67 сегодня'), 'phone');
  });

  test('P.S. abbreviation emits no nobr', () => {
    assertNoWrap(plainNoWrap().process('Корвин ушёл. P.S. Эрик ждёт'), 'P.S.');
  });

  test('date with year suffix emits no nobr', () => {
    assertNoWrap(plainNoWrap().process('Битва была 01.02.2024 года'), 'date');
  });

  test('standard number emits no nobr', () => {
    assertNoWrap(plainNoWrap().process('Согласно ГОСТ 8.417 решено'), 'gost');
  });

  test('phone digits survive nbsp-joined', () => {
    const out = plainNoWrap().process('Звоните Корвину +7 495 123-45-67 сегодня');
    assert.match(out, /\+7[\s\u{00A0}]495/u, out);
  });
});

describe('compact Russian phone numbers (EF2)', () => {
  test('formats a compact +7 phone number', () => {
    assert.equal(
      microtypo('Козырь: +74951004888.', HTML),
      'Козырь: <span style="white-space:nowrap;">+7 495 100-48-88</span>.'
    );
  });

  test('formats a compact 8 phone number after a tel label', () => {
    assert.equal(
      microtypo('тел.: 88001004888.', HTML),
      'тел.: <span style="white-space:nowrap;">8 800 100-48-88</span>.'
    );
  });
});

describe('nbsp at a word boundary', () => {
  // The lookbehind is scoped to each rule's character class, so a letter outside it (non-Russian, underscore) still matches.
  test('word with a non-Russian letter gets nbsp before the dash', () => {
    const out = microtypo('Ђерард — Амбер', { entities: false });
    assert.ok(out.includes(`д${NBSP}—`), out);
  });

  test('word after an underscore gets nbsp before the dash', () => {
    const out = microtypo('_corwin — Amber', { entities: false });
    assert.ok(out.includes(`n${NBSP}—`), out);
  });

  test('plain word gets nbsp before the dash', () => {
    const out = microtypo('Корвин — Амбер', { entities: false });
    assert.ok(out.includes(`н${NBSP}—`), out);
  });

  test('word after an underscore gets nbsp before a final preposition', () => {
    const out = microtypo('_тень в. Амбер', { entities: false });
    assert.ok(out.includes(`ь${NBSP}в.`), out);
  });
});

describe('space.nbsp_two_letter — serial acronyms (XTEST-META)', () => {
  test('binds each acronym in a run to the preceding token', () => {
    const out = microtypo('Корвин миновал заставы US UK за день', FLAT);
    assert.ok(out.includes(`заставы${NBSP}US`), `first unbound: ${out}`);
    assert.ok(out.includes(`US${NBSP}UK`), `second unbound: ${out}`);
  });
});

describe('narrow no-break space for № and §', () => {
  test('№ uses a narrow no-break space', () => {
    const out = microtypo('№ 5', FLAT);
    assert.ok(out.includes(`№${NNBSP}5`), JSON.stringify(out));
  });

  test('§ uses a narrow no-break space', () => {
    const out = microtypo('§ 12', FLAT);
    assert.ok(out.includes(`§${NNBSP}12`), JSON.stringify(out));
  });

  test('narrow no-break space entitises to &#8239;', () => {
    assert.equal(ent('№ 5'), '&#8470;&#8239;5');
  });
});

describe('space presets', () => {
  test('short prepositions glue with nbsp', () => {
    assert.ok(microtypo('я в тени', HTML).includes(`я${NBSP}в${NBSP}тени`));
  });

  test('repeated spaces collapse by default', () => {
    const out = microtypo('Corwin    Amber', HTML);
    assert.ok(out.includes('Corwin Amber'));
    assert.ok(!/Corwin {2,}Amber/.test(out));
  });

  test('collapse off leaves repeated spaces', () => {
    const out = microtypo('Corwin    Amber', {
      ...HTML,
      rules: { 'space.collapse_spaces': false }
    });
    assert.ok(/Corwin {2,}Amber/.test(out));
  });
});

describe('space.strip_quote_padding (GAP-W2)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('inner padding inside quotes is stripped', () => {
    assert.equal(microtypo('«   текст   »', NOP), '«текст»');
  });

  test('adjacent quoted words keep their separating space', () => {
    assert.equal(microtypo('«Корвин» «Эрик»', NOP), '«Корвин» «Эрик»');
  });

  test('multi-phrase angle quotes both get stripped', () => {
    // The space before the second «» becomes NBSP (one-letter "и" glued to the opener), unrelated to strip_quote_padding.
    assert.equal(microtypo('«  a  » и «  b  »', NOP), `«a» и${NBSP}«b»`);
  });

  test('KNOWN LIMITATION: padded straight quotes are not converted or stripped', () => {
    // This rule targets the angle quotes the engine emits, not the ambiguous raw straight input.
    assert.equal(microtypo('"   текст   "', NOP), '" текст "');
  });

  test('quote.* disabled: close class does not glue a straight quote to the word before it', () => {
    const out = new MicroTypo({
      html: true,
      render: { paragraphs: false },
      rules: { 'quote.*': false }
    }).process('слово " текст " ещё');
    assert.equal(out, 'слово " текст " ещё');
  });
});

describe('nobr.nbsp_after_particle (GAP-D)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('emphatic particle binds forward with nbsp', () => {
    assert.equal(microtypo('Поди-кась так', NOP), `Поди-кась${NBSP}так`);
  });

  test('non-particle hyphen words are untouched', () => {
    assert.equal(microtypo('что-то там', NOP), 'что-то там');
  });
});

describe('nobr.nbsp_celsius — Cyrillic Celsius unit (EF3)', () => {
  test('normalizes Cyrillic С after degrees to Latin C', () => {
    assert.equal(microtypo('Холод у Паттерна 485 °С', HTML), `Холод у${NBSP}Паттерна 485${NBSP}°C`);
  });
});

describe('parenthetical ellipsis spacing (EF4)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('removes the space after an opening parenthetical ellipsis', () => {
    assert.equal(microtypo('Корвин увидел ( ... Паттерн)', NOP), 'Корвин увидел (…Паттерн)');
  });

  test('removes the space before an ellipsis at the end of a parenthetical', () => {
    assert.equal(microtypo('Корвин видел (тени ... )', NOP), 'Корвин видел (тени…)');
  });
});

describe('space.trim_before_punctuation (XTEST-4)', () => {
  test('trim_before_punctuation handles mark runs, spares emoticons', () => {
    assert.equal(microtypo('Амбер !!!'), 'Амбер!!!');
    assert.equal(microtypo('Амбер !?'), 'Амбер?!');
    assert.equal(microtypo('Корвин !..'), 'Корвин!..');
    assert.equal(microtypo('Рэндом усмехнулся :)'), 'Рэндом усмехнулся :)'); // emoticon untouched
  });

  test('trims the space before a medial ellipsis (REAL-1)', () => {
    assert.equal(microtypo('Корвин … Эрик'), 'Корвин… Эрик');
  });

  test('preserves the space between two adjacent suspension-mark runs (REAL-3)', () => {
    // mark_ellipsis turns each run into a `..` suspension mark; the lone space between them must survive.
    assert.equal(microtypo('Корвин?… !…'), 'Корвин?.. !..');
  });

  test('still trims the space before punctuation after an abbreviation period (regression)', () => {
    assert.equal(microtypo('и т.д. , доспехи'), `и${NBSP}т.${NBSP}д., доспехи`);
  });
});
