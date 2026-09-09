import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NNBSP = '\u{202F}';
const FLAT = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const HTML = { html: true, render: { paragraphs: false } };

const ent = (text) => new MicroTypo({ ...FLAT, entities: true }).process(text);

// `html: false` skips the text group, so the nowrap tag and the nbsp rewrite layer in through
// separate `applyOptions()` calls.
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
  // The lookbehind is scoped to each rule's character class, so a letter outside it — non-Russian,
  // an underscore — still matches.
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

describe('space.nbsp_two_letter — serial acronyms', () => {
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
    // The space before the second «» becomes an NBSP, the one-letter `и` gluing to the opener, which
    // has nothing to do with `strip_quote_padding`.
    assert.equal(microtypo('«  a  » и «  b  »', NOP), `«a» и${NBSP}«b»`);
  });

  // The gap is a horizontal run, so a padded pair converts and this rule strips the padding as it
  // does for any other.
  test('padded straight quotes convert and lose their padding', () => {
    assert.equal(microtypo('"   текст   "', NOP), '«текст»');
    assert.equal(microtypo('"  текст  "', NOP), '«текст»');
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

describe('space.trim_before_punctuation', () => {
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
    // `mark_ellipsis` turns each run into a `..` suspension mark, and the lone space between them has
    // to survive.
    assert.equal(microtypo('Корвин?… !…'), 'Корвин?.. !..');
  });

  test('still trims the space before punctuation after an abbreviation period (regression)', () => {
    assert.equal(microtypo('и т.д. , доспехи'), `и${NBSP}т.${NBSP}д., доспехи`);
  });

  // The rule splits on the length of the word after the dot, and both branches have to ask whether
  // that word is a domain zone.
  test('a bare host with a long zone keeps its dot', () => {
    assert.equal(microtypo('Пиши на arden.online сегодня'), 'Пиши на\u{00A0}arden.online сегодня');
    assert.equal(
      microtypo('Пиши на arden.technology сегодня'),
      'Пиши на\u{00A0}arden.technology сегодня'
    );
  });

  test('a real sentence boundary still gets its space', () => {
    assert.equal(microtypo('Корвин ушёл.Рэндом остался'), 'Корвин ушёл. Рэндом остался');
  });

  // The zone list can never be complete, so what it must carry is what documents actually write: the
  // zones RFC 2606 reserves for documentation, the Russian ccTLD beside its `ру` and `ком`
  // neighbours, and this project's own domain.
  test('a host in a zone written examples use keeps its dot', () => {
    for (const host of [
      'simonenko.xyz',
      'amber.example',
      'амбер.рф',
      'shadow.test',
      'arden.invalid'
    ]) {
      assert.equal(
        microtypo(`Пиши на ${host} сегодня`),
        `Пиши на\u{00A0}${host} сегодня`,
        `${host} lost its dot`
      );
    }
  });

  // The trim closes a gap between two marks, and the punctuation group — which runs four groups
  // earlier — swallows the pairs it owns. A pair glued together here therefore survives this pass and
  // is rewritten on the next one, a mark short of what the author typed. The pairs it swallows come
  // from that group, so this rule and that one cannot drift apart.
  test('the trim does not glue two runs of the same mark', () => {
    const once = microtypo('Знаки подряд:!? ?!. Дальше');

    assert.ok(once.includes('!? ?!.'), once);
    assert.equal(microtypo(once), once);
  });

  test('the trim does not glue an exclamation onto a question', () => {
    const once = microtypo('текст ! ? знак');

    assert.equal(once, 'текст! ? знак');
    assert.equal(microtypo(once), once);
  });

  // `?!` is not a pair the punctuation group takes apart, so gluing it loses nothing.
  test('the trim still joins two marks that survive together', () => {
    assert.equal(
      microtypo('Корвин крикнул: что? ! потом ушёл'),
      'Корвин крикнул: что?! потом ушёл'
    );
  });

  test('a period and an ellipsis survive being glued', () => {
    const once = microtypo('Точка и многоточие. … конец');

    assert.equal(once, `Точка и${NBSP}многоточие.… конец`);
    assert.equal(microtypo(once), once);
  });

  test('a period already glued to an ellipsis is left as the author had it', () => {
    const once = microtypo('Корвин ушёл.… и всё');

    assert.equal(microtypo(once), once);
  });

  // The period of an abbreviation belongs to the word, and `abbr` may take it away four groups
  // later, so reading it as a sentence mark turns this decision on a character about to disappear.
  test('an abbreviation period is not a mark this rule refuses to glue onto', () => {
    const once = microtypo('100 руб. .');

    assert.equal(once, `100${NBSP}₽.`);
    assert.equal(microtypo(once), once);
  });

  // A port behind the zone is structure a sentence does not have, and DNS names are case-insensitive,
  // so the capital letter alone must not break the address apart.
  test('a capitalized zone with a port is still a host', () => {
    assert.equal(microtypo('amber.Com:443'), 'amber.Com:443');
    assert.equal(microtypo('Пиши на amber.Com:443 сегодня'), `Пиши на${NBSP}amber.Com:443 сегодня`);
  });

  test('a capitalized zone with no port still opens a sentence', () => {
    assert.equal(microtypo('Это конец.Москва встретила'), 'Это конец. Москва встретила');
  });

  test('a sum before an ellipsis settles in one pass', () => {
    const once = microtypo('100 руб. ...');

    assert.equal(once, `100${NBSP}₽…`);
    assert.equal(microtypo(once), once);
  });
});

// An opener list without brackets loses the binding a bare form gets for the very forms an author
// brackets — an aside, a citation — and one without a newline leaves a short word opening a second
// line with a breakable space.
describe('short-word binding across every opener', () => {
  const NB = '\u{00A0}';
  const wraps = [
    (s) => `Текст (${s}) конец`,
    (s) => `Текст [${s}] конец`,
    (s) => `Текст {${s}} конец`,
    (s) => `Первая строка\n${s} конец`
  ];

  test('nobr.nbsp_short_word binds inside every bracket', () => {
    for (const wrap of wraps) {
      const out = microtypo(wrap('в Ардене'), FLAT);

      assert.ok(out.includes(`в${NB}Ардене`), `${JSON.stringify(wrap('в Ардене'))} → ${out}`);
    }
  });

  test('space.nbsp_before_quote binds inside every bracket and after a newline', () => {
    for (const wrap of wraps) {
      const out = microtypo(wrap('в «Амбере»'), FLAT);

      assert.ok(out.includes(`в${NB}«`), `${JSON.stringify(wrap('в «Амбере»'))} → ${out}`);
    }
  });
});
