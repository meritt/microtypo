import {
  DOTTED_INITIAL_PAIR,
  DOTTED_INITIALS,
  followsCompleteName,
  hasDottedLocationAfter,
  startsWithCompactName,
  SURNAME
} from '../lib/abbreviation-grammar.js';
import {
  BLOCK_CONTENT_START,
  CONTENT_END_LOOKAHEAD,
  CONTENT_OPEN_BRACKETS,
  CONTENT_START,
  NOT_AFTER_LONE_QUOTE
} from '../lib/boundaries.js';
import { FRACTION_GLYPHS, G } from '../lib/glyphs.js';
import { INDEFINITE_COLON_REGEXES, nowrapWithIndefiniteColon } from '../lib/indefinite-pronoun.js';
import { inlineTagStart } from '../lib/inline-boundaries.js';
import { TEMPERATURE_SCALES } from '../lib/measurement-units.js';
import {
  canonicalNowrapContentStart,
  canonicalNowrapOpen,
  heldBeforeNowrapEnd,
  nowrap
} from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import {
  BREAKLINE,
  CLOSE,
  INLINE_END,
  OPEN,
  PARAGRAPH_CLOSE,
  PARAGRAPH_OPEN,
  PARAGRAPH_TAG,
  vaultedReference
} from '../protect/placeholders.js';
import { EMPHATIC_HEAD, EMPHATIC_PARTICLE } from './dash.js';
import { PARTICLE } from './space.js';

// What a short word glues itself to: an optional second short word, then a word, a digit or a
// fraction the engine writes for one, `в ⅓` as `в 1/3`. The second may be the `и` that
// `abbr.nowrap_because` bound to `др.` or `пр.`: `Мы и⍽др.` glues as `Мы и др.` did.
const SHORT_WORD_TAIL = `([a-zа-яё]{1,2}[ \\t]+|и${G.NBSP}(?=[дп]р\\.))?(?!-+(?![a-zа-яё0-9-]))([a-zа-яё0-9-]{2,}|[0-9${FRACTION_GLYPHS}])`;
const LAST_WORD = `(?<![\\p{L}\\d_-])([А-ЯЁа-яё]+|>)[ \\t]+([А-ЯЁа-яё]{1,4})`;
const RUSSIAN_LETTER_RE = /[А-ЯЁа-яё]/u;
// The re-read after `text` sees the paragraph and line break markers the next pass reads as tags.
const NUMBER_WORD_END = `(?:${CONTENT_END_LOOKAHEAD}|(?=${PARAGRAPH_CLOSE}|${BREAKLINE}))`;
const FINAL_PUNCTUATION = `[.!?${G.HELLIP}${G.RAQUO}${G.LDQUO})\\]}]*[ \\t]*`;

const WORD_START_RE = /[\p{L}\p{N}]/uy;
const ACRONYM_AHEAD_RE = /[A-ZА-ЯЁ]{2}(?=[\s;.?!:("»“]|$)/uy;
const SHORT_WORD_AHEAD_RE = new RegExp(`[a-zа-яё]{1,2}[ \\t]+${SHORT_WORD_TAIL}`, 'iuy');
// The end tag of the engine's own wrapper starts a short word only where what the wrapper holds last
// does: `3:15–9:05</span>с пр` glues no more than `9:05с пр` did before `other.en_time_range` wrapped it.
const SHORT_WORD_LEAD_RE = new RegExp(`[ \\t\\n\\r${CONTENT_OPEN_BRACKETS}>${CLOSE}]`, 'u');
const TEMPERATURE_LEAD_RE = new RegExp(`[${CONTENT_START}+${G.PLUSMN}]`, 'u');
const INITIAL_LEAD_RE = new RegExp(`[${CONTENT_START}]`, 'u');
const INITIAL_GAP_CHAR_RE = new RegExp(`[ \\t${G.NBSP}]`, 'u');
const DIGIT_RE = /\d/u;

const startsWith = (re, source, at) => {
  re.lastIndex = at;

  return re.test(source);
};

// A particle binds to the word before it, so the no-break space `nbsp_short_word` glued it to the
// next word with goes back to a space. Not one in front of a dash or an acronym, which binds them to
// the particle, and not one in front of a short word the space would leave for `nbsp_short_word` to
// glue on the next pass.
function takesGlueBack(source, at) {
  return (
    startsWith(WORD_START_RE, source, at) &&
    !startsWith(ACRONYM_AHEAD_RE, source, at) &&
    !startsWith(SHORT_WORD_AHEAD_RE, source, at)
  );
}

function wrapPhone(ctx, m) {
  const [, p1, p2, , p4, , p6, , p8, , p10] = m;
  const inner = `${p2} ${p4} ${p6}-${p8}-${p10}`;

  return tagPhone(ctx, p1, inner, m);
}

// A phone glued to a digit is no phone, and inline tags between them change nothing: on the next pass
// the engine's own wrapper around the phone before stands there.
function digitBehindTags(source, end) {
  let at = end;
  for (let start = inlineTagStart(source, at); start !== -1; start = inlineTagStart(source, at)) {
    at = start;
  }
  return /\d/u.test(source[at - 1] ?? '');
}

function tagPhone(ctx, left, inner, m, guardEdges = true) {
  const source = m.at(-1);
  const start = m.at(-2) + left.length;
  const end = m.at(-2) + m[0].length;
  if (left === '>' && digitBehindTags(source, start)) {
    return m[0];
  }
  if (ctx.html && guardEdges && (left === '>' || source[end] === '<')) {
    return `${left}${inner}`;
  }

  return `${left}${nowrap(ctx, inner, source, start, end)}`;
}

function wrapCompactPlusPhone(ctx, m) {
  const [, p1, area, lead, mid, tail] = m;

  return tagPhone(ctx, p1, `+7 ${area} ${lead}-${mid}-${tail}`, m);
}

function wrapCompactLocalPhone(ctx, m) {
  const [, p1, label, area, lead, mid, tail] = m;
  const inner = `8 ${area} ${lead}-${mid}-${tail}`;
  const source = m.at(-1);
  const start = m.at(-2) + p1.length + label.length;
  const end = m.at(-2) + m[0].length;
  if (ctx.html && source[end] === '<') {
    return `${p1}${label}${inner}`;
  }

  return `${p1}${label}${nowrap(ctx, inner, source, start, end)}`;
}

function ipNowrap(ctx, m) {
  const ip = m[2];
  for (const part of ip.split('.')) {
    if (Number.parseInt(part, 10) > 255) {
      return m[0];
    }
  }

  return wrapOwned(m, ctx, ip);
}

function degreeUnit(unit) {
  return unit === 'С' ? 'C' : unit;
}

// A letter glued after the last octet makes the whole run one token, which a wrapper would cut in two
// for the next pass to read apart.
export const IP_ADDRESS = '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(?![\\d\\p{L}]|\\.\\d)';

export const EXTENDED_PHONE = new RegExp(
  `(^|[\\s(${G.LAQUO}${G.BDQUO},;:]|${BLOCK_CONTENT_START})(\\+7[ \\t${G.NBSP}]+\\(\\d{3}\\)[ \\t${G.NBSP}]+\\d{3}[ \\t${G.NBSP}]+\\d{2}[ \\t${G.NBSP}]+\\d{2}|(?:8|\\+7)-\\d{3}-\\d{3}-\\d{2}-\\d{2})${CONTENT_END_LOOKAHEAD}`,
  'gu'
);

// A word already bound to the number after it labels that one, `гл. 5 гл.⍽7`, not the number in
// front: bound by a no-break space, spelled as one in XML, or held with it in the engine's wrapper.
// The number may open a wrapper of its own, `8 Д⍽<span>05.05.29 г.</span>`, and may be a fraction,
// `⅓ и⍽⅞` as `3 и⍽7`.
const BOUND_LABEL = '[А-ЯЁа-яё]+\\.?';
const BOUND_LABEL_AHEAD = `(?!${BOUND_LABEL}(?:${G.NBSP}|${vaultedReference(G.NBSP)})(?:<${OPEN}T\\d{1,9}${CLOSE}>)*[\\d${FRACTION_GLYPHS}])`;
const WRAPPED_LABEL_RE = new RegExp(`${BOUND_LABEL}[ \\t${G.NBSP}][\\d${FRACTION_GLYPHS}]`, 'uy');

// The engine's no-break wrapper starts the word it holds; no other tag stands between a number and
// its word.
function bindNumber(m, ctx) {
  const [full, number] = m;
  const source = m.at(-1);
  const at = m.at(-2) + full.length;
  if (source[at] === '<') {
    const body = canonicalNowrapContentStart(ctx, source, at);
    if (body === -1 || source[body] === '<' || startsWith(WRAPPED_LABEL_RE, source, body)) {
      return full;
    }
  }
  return `${number}${G.NBSP}`;
}

const SINGLE_INITIAL = '(?:[А-ЯЁ]|Дж)';
const INITIAL_GAP = `[ \\t${G.NBSP}]+`;
const NEXT_INITIAL_RE = new RegExp(`${SINGLE_INITIAL}\\.${INITIAL_GAP}`, 'uy');
const FAMILY_NAME_RE = new RegExp(`${SURNAME}${CONTENT_END_LOOKAHEAD}`, 'uy');
const FAMILY_AFTER_GAP_RE = new RegExp(`${INITIAL_GAP}${SURNAME}${CONTENT_END_LOOKAHEAD}`, 'uy');

function surnameBeforeInitials(m, ctx) {
  const [, , surname, gap, first, dot, , second] = m;
  // Across a wider gap an already complete pair can belong to the surname immediately after it.
  // The plain form of that name carries the same no-break spaces as a name supplied by the author.
  if (
    gap.length > 1 &&
    dot &&
    m[0].endsWith('.') &&
    startsWith(FAMILY_AFTER_GAP_RE, m.at(-1), m.at(-2) + m[0].length)
  ) {
    return m[0];
  }
  return wrapName(m, ctx, `${surname} ${first}. ${second}.`, true);
}

function bindSingleInitial(m, ctx) {
  const [full, initial, offset, source] = m;
  // The end tag of the engine's own wrapper reads as what the wrapper holds last: `8:30</span>Е. Об`
  // and `8:30</span> Е. Об` bind no more than `8:30Е. Об` and `8:30 Е. Об` did before
  // `other.en_time_range` wrapped the time.
  let before = offset - 1;
  while (INITIAL_GAP_CHAR_RE.test(source[before] ?? '')) {
    before -= 1;
  }
  const held = heldBeforeNowrapEnd(ctx, source, before);
  if (
    held !== null &&
    (before === offset - 1 ? !INITIAL_LEAD_RE.test(held) : DIGIT_RE.test(held))
  ) {
    return full;
  }
  let at = offset + full.length;
  for (let count = 0; count <= 3; count++) {
    if (ctx.html && source[at] === '<') {
      at = canonicalNowrapContentStart(ctx, source, at);
      if (at === -1) {
        break;
      }
    }
    FAMILY_NAME_RE.lastIndex = at;
    if (FAMILY_NAME_RE.test(source)) {
      return `${initial}.${G.NBSP}`;
    }
    NEXT_INITIAL_RE.lastIndex = at;
    if (!NEXT_INITIAL_RE.test(source)) {
      break;
    }
    at = NEXT_INITIAL_RE.lastIndex;
  }
  return full;
}

function wrapName(m, ctx, body, addsDots = false) {
  // The engine's own open tag is a name boundary as well, even before an adjacent
  // word joins it across a no-break space. Other markup keeps its original boundaries.
  if (m[1] === '>') {
    const open = ctx.html && canonicalNowrapOpen(ctx);
    const source = m.at(-1);
    const start = m.at(-2) + 1;
    if (
      !open ||
      !source.endsWith(open, start) ||
      (addsDots && startsWithCompactName(source, start))
    ) {
      return m[0];
    }
  }
  return wrapOwned(m, ctx, body);
}

function wrapOwned(m, ctx, body, tail = '') {
  const start = m.at(-2) + m[1].length;
  const end = m.at(-2) + m[0].length - tail.length;
  return `${m[1]}${nowrap(ctx, body, m.at(-1), start, end)}${tail}`;
}

// The gap this rule writes reads back in its serialized form too: a phone it cannot find again leaves
// its last group for the next pass to take as the country code of whatever follows.
const PHONE_GAP = `( |${G.NBSP}|${G.THINSP}|${vaultedReference(G.NBSP)})`;

// Each phone ends on a lookahead: the character after it is the left boundary of the next one.
export const FORMATTED_PHONE_PATTERNS = [
  new RegExp(
    `([^\\d+]|^)(\\+?[0-9]{1,3})${PHONE_GAP}([0-9]{3,4}|\\([0-9]{3,4}\\))${PHONE_GAP}([0-9]{2,3})([-${G.MINUS}])([0-9]{2})([-${G.MINUS}])([0-9]{2})(?!\\d)`,
    'gu'
  ),
  new RegExp(
    `([^\\d+]|^)(\\+?[0-9]{1,3})${PHONE_GAP}([0-9]{3,4})${PHONE_GAP}([0-9]{2,3})([-${G.MINUS}])([0-9]{2})([-${G.MINUS}])([0-9]{2})(?!\\d)`,
    'gu'
  )
];

export const COMPACT_PHONE_PATTERNS = [
  /([^\d+]|^)\+7([0-9]{3})([0-9]{3})([0-9]{2})([0-9]{2})(?!\d)/gu,
  /(^|[^a-zа-яё0-9+])((?:тел|телефон)\.?:?\s*)8([0-9]{3})([0-9]{3})([0-9]{2})([0-9]{2})(?!\d)/giu
];
export const ALT_PHONE_PATTERN =
  /([^\d]|^)\+\s?([0-9]{1})\s?\(([0-9]{3,4})\)\s?(\d{3})(\d{2})(\d{2})(?!\d)/gi;

export const nobrGroup = {
  title: 'Неразрывные конструкции',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_short_word',
      projectSpacedYears: 'gaps',
      requires: F.SPACE,
      description: 'Привязка союзов и предлогов к следующему слову',
      // Not `CONTENT_START`: that one starts with `\s`, which matches a non-breaking space, and this
      // rule must not glue across one it already wrote. So the whitespace half stays ASCII-only and
      // the openers come from the shared bracket half, plus the two ends a protected region and a
      // tag leave in front of content. Trailing gaps stay horizontal, so the glue never crosses a
      // line break.
      //
      // Deliberately broad: any one- or two-letter word is glued, false positives accepted. Not a
      // particle `nbsp_particle` bound to the dash before it: that dash keeps its own no-break space
      // in front of the particle, and the particle took its glue to the next word back.
      pattern: new RegExp(
        `([ \\t\\n\\r]|^|[${CONTENT_OPEN_BRACKETS}]|>|${CLOSE}|${G.MDASH}${G.NBSP})([a-zа-яё]{1,2}(?<!${G.NBSP}${G.MDASH}${G.NBSP}(?:${PARTICLE}))[ \\t]+)${SHORT_WORD_TAIL}`,
        'giu'
      ),
      replacement: (m, ctx) => {
        const [full, p1, p3, p4, p5] = m;
        const held = p1 === '>' ? heldBeforeNowrapEnd(ctx, m.at(-1), m.at(-2)) : null;
        // The word glued to the end of a wrapper is not a short one, but the short word after it is
        // still glued to the next: the match took that one in, so no later match reaches it.
        if (held !== null && !SHORT_WORD_LEAD_RE.test(held)) {
          return p4 ? `${p1}${p3}${p4.trim()}${G.NBSP}${p5}` : full;
        }

        return `${p1}${p3.trim()}${G.NBSP}${p4 ? p4.trim() + G.NBSP : ''}${p5}`;
      }
    },
    {
      id: 'nbsp_final_word',
      requires: F.SPACE | F.PERIOD,
      description: 'Привязка предлогов к предыдущему слову в конце предложения',
      // An abbreviation keeps its period before the sentence's own `?` or `!`.
      pattern: /((?<![a-zа-яё0-9-])[a-zа-яё0-9-]{3,}) ([a-zа-яё]{1,2})\.([?!]?(?: [A-ZА-ЯЁ]|$))/gu,
      replacement: `$1${G.NBSP}$2.$3`
    },
    {
      id: 'nowrap_phone',
      requires: F.DIGIT,
      requiresPattern: /[-−+]|тел/iu,
      description: 'Неразрывные номера телефонов',
      pattern: [...FORMATTED_PHONE_PATTERNS, ...COMPACT_PHONE_PATTERNS],
      replacement: [
        (m, ctx) => wrapPhone(ctx, m),
        (m, ctx) => wrapPhone(ctx, m),
        (m, ctx) => wrapCompactPlusPhone(ctx, m),
        (m, ctx) => wrapCompactLocalPhone(ctx, m)
      ]
    },
    {
      id: 'nowrap_phone_alt',
      requires: F.DIGIT | F.MATH | F.PAREN,
      description: 'Доп. формат номеров телефонов',
      pattern: ALT_PHONE_PATTERN,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4, p5, p6] = m;

        return tagPhone(ctx, p1, `+${p2} ${p3} ${p4}-${p5}-${p6}`, m, false);
      }
    },
    {
      id: 'nowrap_ip',
      requires: F.DIGIT | F.PERIOD,
      description: 'Объединение IP-адресов',
      pattern: new RegExp(`(\\s|${G.NBSP}|^)(${IP_ADDRESS})`, 'gu'),
      replacement: (m, ctx) => ipNowrap(ctx, m)
    },
    {
      id: 'initials_dots',
      requires: F.SPACE,
      requiresPattern: /[А-ЯЁ](?![а-яёА-ЯЁ])/u,
      description: 'Простановка точек к инициалам у фамилии',
      enabled: false,
      // A run of spaces is one gap, as `nowrap_initials` reads it.
      pattern: [
        /(\s|^|[.,;:?!>])([А-ЯЁ])\.?(\s[ \t\u{00A0}]*)?([А-ЯЁ])(\s[ \t\u{00A0}]*)([А-ЯЁ][а-яё]+)(?=\s|$|[.,;:?!)\]»“<])/gu,
        /(\s|^|[.,;:?!>])([А-ЯЁ][а-яё]+)(\s[ \t\u{00A0}]*)([А-ЯЁ])(\.?)(\s[ \t\u{00A0}]*)?([А-ЯЁ])(?:\.|(?!\.))(?=\s|$|[.,;:?!)\]»“<])/gu
      ],
      replacement: [
        (m, ctx) => wrapName(m, ctx, `${m[2]}. ${m[4]}. ${m[6]}`, true),
        surnameBeforeInitials
      ]
    },
    {
      id: 'nowrap_initials',
      requiresAny: F.SPACE | F.PERIOD,
      requiresPattern: /[А-ЯЁ](?![а-яёА-ЯЁ])/u,
      description: 'Привязка инициалов к фамилиям',
      pattern: [
        // The surname takes the emphatic particle `dash.emphatic_particle` joined to it, `К.С.Бл-кась`,
        // as it stood beside the particle written apart.
        new RegExp(
          `(\\s|^|[.,;:?!>])${DOTTED_INITIAL_PAIR}([А-ЯЁ][а-яё]+(?:-(?:${EMPHATIC_PARTICLE}))?)(?=\\s|$|[.,;:?!)\\]${G.RAQUO}${G.LDQUO}<])`,
          'gu'
        ),
        new RegExp(
          `(\\s|^|[.,;:?!>])(${SURNAME})(\\s)${DOTTED_INITIALS}(?=\\s|$|[.,;:?!)\\]${G.RAQUO}${G.LDQUO}<])`,
          'gu'
        ),
        // A run of spaces is one gap, as between dotted initials.
        /(\s|^|\.|,|;|:|\?|!|>)([А-ЯЁ])(\s[ \t\u{00A0}]*)?([А-ЯЁ])(\s[ \t\u{00A0}]*)([А-ЯЁ][а-яё]+)(?=\s|$|\.|,|;|:|\?|!)/gu,
        /(\s|^|\.|,|;|:|\?|!|>)([А-ЯЁ][а-яё]+)(\s[ \t\u{00A0}]*)([А-ЯЁ])(\s[ \t\u{00A0}]*)?([А-ЯЁ])(?=\s|$|\.|,|;|:|\?|!)/gu
      ],
      replacement: [
        (m, ctx) => wrapName(m, ctx, `${m[2]}. ${m[4]}. ${m[6]}`),
        (m, ctx) => wrapName(m, ctx, `${m[2]} ${m[4]}. ${m[6]}.`),
        (m, ctx) => wrapName(m, ctx, `${m[2]}${m[3] ? ' ' : ''}${m[4]}${m[5] ? ' ' : ''}${m[6]}`),
        (m, ctx) => wrapName(m, ctx, `${m[2]} ${m[4]}${m[5] ? ' ' : ''}${m[6]}`)
      ]
    },
    {
      id: 'nbsp_particle',
      requires: F.SPACE,
      description: 'Неразрывный пробел перед частицей',
      // At the end of the text, before `!` and before `)` only a lowercase particle after a word
      // binds: `а - б` and `зон А и Б` end in a letter, not the particle.
      // Cycled: a particle the glue it took back leaves after a space binds too, `ли ли он`.
      cycled: true,
      pattern: [
        new RegExp(
          `(?<![ \\t])${NOT_AFTER_LONE_QUOTE}( |\\t)+(${PARTICLE})(?:(${G.NBSP})|(?=[.,:;${G.HELLIP}?\\s]))`,
          'gu'
        ),
        /(?<=\p{L})[ \t]+(ли|бы|б|же|ж)(?=!|\)|$)/gu
      ],
      replacement: [
        (m, ctx) => {
          const [match, , particle, glue, offset, source] = m;
          if (
            particle === 'Б' &&
            hasDottedLocationAfter(source, offset + match.length) &&
            followsCompleteName(ctx, source, offset)
          ) {
            return match;
          }
          const after = glue === undefined ? '' : G.NBSP;
          // `nbsp_short_word` leaves a particle alone only behind a dash in its em form, `⍽—`; a dash
          // written apart or opening a line keeps the particle glued on, as the next pass reads it.
          const keepsGlue = source[offset - 1] === G.MDASH && source[offset - 2] !== G.NBSP;

          return `${G.NBSP}${particle}${glue !== undefined && !keepsGlue && takesGlueBack(source, offset + match.length) ? ' ' : after}`;
        },
        `${G.NBSP}$1`
      ]
    },
    {
      id: 'nbsp_after_particle',
      requires: F.SPACE | F.DASH,
      requiresPattern: /-/u,
      description: 'Неразрывный пробел после усилительной частицы: Поди-кась так → Поди-кась так',
      // The left boundary is the one `dash.emphatic_particle` joins the chain behind, `«Поди-кась так»`
      // included. It anchors the match start, and a hyphen after a letter is inside the head rather
      // than before it, so the greedy `[а-яё]+` cannot retry from every offset. Both boundaries are
      // only looked at: the word after the gap may be the next particle word, `е-ка ь-ка к`, and it
      // needs the gap as its own left boundary.
      pattern: new RegExp(
        `(?<=^|[${CONTENT_START}])(?<![а-яё]-)(${EMPHATIC_HEAD}-(?:${EMPHATIC_PARTICLE})) (?=[а-яё]|<${OPEN}T\\d{1,9}${CLOSE}>)`,
        'giu'
      ),
      replacement: ([match, word, offset, source], ctx) => {
        const next = offset + match.length;
        if (source[next] === '<') {
          const start = canonicalNowrapContentStart(ctx, source, next, { skipPadding: false });
          if (start === -1 || !RUSSIAN_LETTER_RE.test(source[start])) {
            return match;
          }
        }
        return `${word}${G.NBSP}`;
      }
    },
    {
      id: 'nbsp_namely',
      requires: F.SPACE | F.COLON,
      description: 'Неразрывный пробел в "как то"',
      pattern: /как то:/giu,
      replacement: `как${G.NBSP}то:`
    },
    {
      id: 'nbsp_celsius',
      requires: F.DIGIT | F.DEGREE,
      description: 'Привязка градусов к числу (включая ±, +, − перед числом)',
      // A temperature is a measurement like any other, so it shares the boundary sets and `(20 °C)`
      // gets the non-breaking space a bare `20 °C` does. `+` and `±` are extra here — a signed
      // reading is still a reading, and `±` opens content nowhere else — and the closer stays a
      // lookahead so a range binds both ends.
      pattern: new RegExp(
        `(^|[${CONTENT_START}+${G.PLUSMN}])(\\d+)( |${G.NBSP})?${G.DEG}(${TEMPERATURE_SCALES})${CONTENT_END_LOOKAHEAD}`,
        'gu'
      ),
      // Behind the end of the engine's wrapper the number starts only where what the wrapper holds
      // last would start it: a later group writes the wrapper, `26.02.18г.2 °F`.
      replacement: (m, ctx) => {
        const held = m[1] === '>' ? heldBeforeNowrapEnd(ctx, m.at(-1), m.at(-2)) : null;
        return held !== null && !TEMPERATURE_LEAD_RE.test(held)
          ? m[0]
          : `${m[1]}${m[2]}${G.NBSP}${G.DEG}${degreeUnit(m[4])}`;
      }
    },
    {
      id: 'nowrap_hyphen_short',
      requires: F.DASH,
      description: 'Пятисимвольные слова с дефисом в неразрывные блоки',
      enabled: false,
      cycled: true,
      pattern:
        /(\s|>|^)([a-zа-яё]{1}-[a-zа-яё]{4}|[a-zа-яё]{2}-[a-zа-яё]{3}|[a-zа-яё]{3}-[a-zа-яё]{2}|[a-zа-яё]{4}-[a-zа-яё]{1}|когда-то|кое-как|кой-кого|вс[её]-таки|[а-яё]+-(кась|ка|де))(\s|\.|,|!|\?|…|$)/giu,
      replacement: (m, ctx) => wrapOwned(m, ctx, m[2], m[4])
    },
    {
      id: 'nowrap_hyphen',
      requires: F.DASH,
      description: 'Отмена переноса слова с дефисом',
      enabled: false,
      cycled: true,
      // An opening bracket or quote starts the word as a gap does: the hanging punctuation drawn round
      // it later leaves a `>` there, which starts it on the next pass.
      pattern: new RegExp(
        `(${G.NBSP}|\\s|>|^|[${CONTENT_OPEN_BRACKETS}])([a-zа-яё]+)((-([a-zа-яё]+)){1,2})(\\s|\\.|,|!|\\?|${G.NBSP}|${G.HELLIP}|$)`,
        'giu'
      ),
      replacement: (m, ctx) => wrapOwned(m, ctx, `${m[2]}${m[3]}`, m[6])
    },
    {
      id: 'nowrap_phone_extended',
      requires: F.DIGIT,
      requiresAny: F.DASH | F.PAREN,
      description: 'Неразрывные полные российские телефоны с пробелами или дефисами',
      regexes: [EXTENDED_PHONE, ...INDEFINITE_COLON_REGEXES],
      handler: (ctx) => nowrapWithIndefiniteColon(ctx, EXTENDED_PHONE, (m) => m[2])
    },
    {
      id: 'nbsp_last_word',
      requires: F.SPACE,
      description: 'Привязка последнего русского слова длиной до четырёх букв в абзаце',
      // A paragraph the author left open ends at the blank line `text` writes before the next one,
      // which the next pass reads as the `\n\n` it stands for; so does a line break before a block
      // tag, which `text.breakline` writes as one, and before the paragraph `text.paragraphs` opens
      // under a Markdown heading, which the next pass reads as that tag.
      pattern: [
        `(?:\\n[ \\t]*\\n|$)`,
        `\\n[ \\t]*$`,
        `(?:(?:${PARAGRAPH_TAG})?${PARAGRAPH_CLOSE}|<\\/${OPEN}L\\d+${CLOSE}>|${OPEN}H\\d+${CLOSE}${PARAGRAPH_OPEN})`,
        `[\\r\\n][\\r\\n \\t]*(?:<\\/?${OPEN}L\\d+${CLOSE}>|${PARAGRAPH_OPEN})`
      ].map((end) => new RegExp(`${LAST_WORD}(?=${FINAL_PUNCTUATION}${end})`, 'gu')),
      // Behind the end of the engine's wrapper the word before the last is the one it holds.
      replacement: (m, ctx) => {
        if (m[1] === '>') {
          const held = heldBeforeNowrapEnd(ctx, m.at(-1), m.at(-2));
          if (held === null || !RUSSIAN_LETTER_RE.test(held)) {
            return m[0];
          }
        }
        return `${m[1]}${G.NBSP}${m[2]}`;
      }
    },
    {
      id: 'nbsp_after_number',
      requires: F.SPACE,
      requiresAny: F.DIGIT | F.FRACTION,
      projectSpacedYears: 'gaps',
      description: 'Привязка числа к следующему русскому слову',
      // A fraction is a number too, `½ стакана` as `1,5 стакана`.
      pattern: new RegExp(
        `(?<=^|[${CONTENT_START}])(?<![.,${G.NNBSP}])(?<!\\d-)(?<!${INLINE_END})(\\d+(?:[.,]\\d+|[${FRACTION_GLYPHS}])?|[${FRACTION_GLYPHS}])[ \\t${G.NBSP}]+(?=(?:<${OPEN}T\\d{1,9}${CLOSE}>)*(?![Уу](?:[Ее])?${NUMBER_WORD_END})${BOUND_LABEL_AHEAD}[А-ЯЁа-яё]+${NUMBER_WORD_END})`,
        'gu'
      ),
      replacement: (m, ctx) => bindNumber(m, ctx)
    },
    {
      id: 'nbsp_single_initial',
      requires: F.PERIOD | F.SPACE,
      description: 'Привязка одиночного инициала и цепочки инициалов к фамилии',
      // A capital right after a number is its unit, `220 В. Далее`, not an initial, and so it is after
      // the end tags of a number set in markup, `<sup>2</sup> А.`.
      pattern: new RegExp(
        `(?<=^|[${CONTENT_START}])(?<!\\d(?:${INLINE_END})*${INITIAL_GAP})(${SINGLE_INITIAL})\\.${INITIAL_GAP}`,
        'gu'
      ),
      replacement: bindSingleInitial
    }
  ]
};
