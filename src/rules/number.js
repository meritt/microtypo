import { CONTENT_END_LOOKAHEAD, CONTENT_START } from '../lib/boundaries.js';
import {
  characterReferenceEndingAt,
  keptGlyphAt,
  keptGlyphsAt,
  keptReferenceGlyph,
  keptReferenceTo,
  readCharacterReferenceAt
} from '../lib/character-reference.js';
import { FRACTION_GLYPHS, G } from '../lib/glyphs.js';
import {
  inlineTextEnd,
  inlineTextStart,
  nativeTagEnd,
  nativeTagStart
} from '../lib/inline-boundaries.js';
import { heldBeforeNowrapEnd } from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import { BLOCK_KIND, OPEN, CLOSE, tagTokens, vaultedReference } from '../protect/placeholders.js';
import { NUMERIC_DATE_RE } from './date.js';
import {
  EXTENDED_PHONE,
  FORMATTED_PHONE_PATTERNS,
  COMPACT_PHONE_PATTERNS,
  ALT_PHONE_PATTERN,
  IP_ADDRESS
} from './nobr.js';

const GAP_RE = /[ \t]+/g;
const DIMENSION_CHAIN = new RegExp(
  String.raw`(?<!\d)\d+(?:[ \t]*(?:[xх${G.TIMES}]|${keptReferenceTo(G.TIMES)})[ \t]*\d+)+`,
  'gu'
);
const DIMENSION_IDENTIFIER = /[a-zA-Z\d_<>]/u;

function numericReferenceCode(head) {
  return head[2].toLowerCase() === 'x'
    ? Number.parseInt(head.slice(3), 16)
    : Number.parseInt(head.slice(2), 10);
}

// At the edge of a part number, XML may spell an ASCII identifier character as a reference.
// Read that one value for the boundary check and leave its authored bytes in the document.
function referenceContinuesIdentifier(reference) {
  if (!reference?.native || !reference.head.startsWith('&#')) {
    return false;
  }
  const code = numericReferenceCode(reference.head);
  return code <= 0x7f && DIMENSION_IDENTIFIER.test(String.fromCodePoint(code));
}

function normalizeDimensions([chain, at, source], ctx) {
  const start = inlineTextEnd(ctx, source, at, true);
  const end = inlineTextStart(ctx, source, at + chain.length, true);
  const left = nativeTagStart(source, start) === -1 ? (source[start - 1] ?? '') : '';
  const right = nativeTagEnd(source, end) === -1 ? (source[end] ?? '') : '';
  if (
    DIMENSION_IDENTIFIER.test(left) ||
    DIMENSION_IDENTIFIER.test(right) ||
    (left === ';' && referenceContinuesIdentifier(characterReferenceEndingAt(source, start - 1))) ||
    (right === '&' && referenceContinuesIdentifier(readCharacterReferenceAt(source, end)))
  ) {
    return chain;
  }
  // The x of a hexadecimal reference belongs to its original spelling.
  return chain.replaceAll(GAP_RE, '').replaceAll(/(?<=\d)[xх](?=\d)/gu, G.TIMES);
}
// What keeps a number behind a hyphen from being a negative one: it goes on, or a range, a dash or
// an ellipsis follows it.
const NUMBER_STOP = `[\\d${FRACTION_GLYPHS}${G.NDASH}${G.MDASH}${G.MINUS}\\-${G.HELLIP}]|[.,]\\d|\\.\\.`;
const NUMBER_STOP_RE = new RegExp(`^(?:${NUMBER_STOP})`, 'u');
const TRIAD_RE = /^\d{3}(?!\d)/u;
const DECIMAL_NUMBER = '\\d+(?:[.,]\\d+)?';
const NEGATIVE_NUMBER = `(${DECIMAL_NUMBER}[${FRACTION_GLYPHS}]?|[${FRACTION_GLYPHS}])(?!${NUMBER_STOP})`;
const MINUS_PATTERNS = [
  `((?:^|\\n)[ \\t${G.NBSP}]*)`,
  `([(${G.LAQUO}${G.BDQUO}:][ \\t${G.NBSP}]*)`,
  `((?<=[А-ЯЁа-яё]{3})[ \\t${G.NBSP}]+)`,
  // The end of a block starts the text after it, which the next pass finds in a paragraph of its own.
  `((?:<${OPEN}[TAL]|<\\/${OPEN}${BLOCK_KIND})\\d{1,9}${CLOSE}>[ \\t${G.NBSP}]*)`,
  `((?<!${CLOSE})(?<!&#\\d{1,7});[ \\t${G.NBSP}]*)`
].map((start) => new RegExp(`${start}-${NEGATIVE_NUMBER}`, 'gu'));
const MATH_TAG_RE = /^(?:small|sup|sub)$/u;

function negativeNumbers(ctx) {
  const mathTags = new Set(tagTokens(ctx.tags, MATH_TAG_RE).map((token) => `<${token}>`));
  for (const pattern of MINUS_PATTERNS) {
    ctx.text = ctx.text.replace(pattern, (match, start, number, offset, source) =>
      mathTags.has(start.trimEnd()) || stopsNumber(source, offset + match.length)
        ? match
        : `${start}${G.MINUS}${number}`
    );
  }
}

// Whether what follows a number keeps it from being negative, read past the triads `split_triads`
// writes into it and through the references the output writes its glyphs as: `-80235...` is
// `-80⎵235…` on the next pass.
function stopsNumber(source, at) {
  let end = at;

  for (;;) {
    const gap = keptGlyphAt(source, end);

    if (gap.glyph !== G.NNBSP || !TRIAD_RE.test(source.slice(gap.end, gap.end + 4))) {
      return NUMBER_STOP_RE.test(keptGlyphsAt(source, end, 2));
    }

    end = gap.end + 3;
  }
}

const EXTENDED_FRACTIONS = {
  '1/3': G.FRAC13,
  '2/3': G.FRAC23,
  '1/8': G.FRAC18,
  '3/8': G.FRAC38,
  '5/8': G.FRAC58,
  '7/8': G.FRAC78
};
// What goes on with the digits, a prime written back as a reference in XML included.
const FRACTION_TAIL = `[\\p{L}\\d_/"${G.PRIME}${G.SINGLE_PRIME}]`;
const FRACTION_TAIL_RE = new RegExp(FRACTION_TAIL, 'u');
// What goes on before the digits; the end of the engine's wrapper reads as what it holds last,
// `28 г.</span>1/3`.
const FRACTION_LEAD = '[\\p{L}\\d_./]';
const FRACTION_LEAD_RE = new RegExp(FRACTION_LEAD, 'u');

const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;

export function joinedNumericToken(ctx, source, offset) {
  const before = inlineTextEnd(ctx, source, offset);
  const width = before >= 2 && source.codePointAt(before - 2) > 0xffff ? 2 : 1;
  return (
    before < offset && LETTER_OR_NUMBER_RE.test(source.slice(Math.max(0, before - width), before))
  );
}

// Whether a digit stands before the run of spaces and tabs that ends at `at`, the run not empty.
function digitBeforeGap(str, at) {
  let i = at;

  while (str[i - 1] === ' ' || str[i - 1] === '\t') {
    i -= 1;
  }

  if (i === at || !/[0-9]/u.test(str[i - 1] ?? '')) {
    return false;
  }
  let before = i - 1;
  while (before >= 0 && /[0-9]/u.test(str[before])) {
    before -= 1;
  }
  return !/\p{L}/u.test(str[before] ?? '');
}

const RANGE_DASH = `(?:[${G.MDASH}${G.MINUS}-]|${keptReferenceTo(G.MINUS, G.MDASH)})`;
const RANGE_DASH_GLYPHS = new Set(['-', G.MDASH, G.MINUS]);

function normalizeRange([match, from, to, at, source]) {
  const left =
    source[at - 1] === ';'
      ? keptReferenceGlyph(characterReferenceEndingAt(source, at - 1))
      : source[at - 1];
  const right = keptGlyphAt(source, at + match.length).glyph;
  return RANGE_DASH_GLYPHS.has(left) || RANGE_DASH_GLYPHS.has(right)
    ? match
    : `${from}${G.NDASH}${to}`;
}

const PHONE_NBSP_RE = new RegExp(vaultedReference(G.NBSP), 'gu');
const PHONE_NBSP_END_RE = new RegExp(`${vaultedReference(G.NBSP)}$`, 'u');
const PHONE_NBSP_START_RE = new RegExp(vaultedReference(G.NBSP), 'uy');
// &#160 + OPEN + N + up to nine id digits + CLOSE + semicolon.
const PHONE_REFERENCE_LENGTH = 18;
const phoneSpaces = (text) => text.replaceAll(PHONE_NBSP_RE, G.NBSP).replaceAll(GAP_RE, ' ');

const PHONE_CONTEXT_PATTERNS = [
  ...FORMATTED_PHONE_PATTERNS,
  ...COMPACT_PHONE_PATTERNS,
  ALT_PHONE_PATTERN,
  EXTENDED_PHONE
];

// What each of PHONE_CONTEXT_PATTERNS cannot match without: a `+`, the word `тел`, or the
// dash-separated last two pairs.
const PHONE_MARK_RE = new RegExp(`\\+|тел|[-${G.MINUS}]\\d{2}[-${G.MINUS}]\\d{2}`, 'iu');

export function phoneContextAt(source, offset) {
  // A serialized phone uses at most 21 non-gap characters. Keep 32 to include its left
  // boundary in either direction; native encoded gaps remain one logical gap. Skipping plain
  // gaps also sees the one-space form collapse_spaces will create.
  let from = offset;
  let characters = 0;
  while (from > 0 && characters < 32) {
    if (source[from - 1] === ';') {
      const reference = PHONE_NBSP_END_RE.exec(
        source.slice(Math.max(0, from - PHONE_REFERENCE_LENGTH), from)
      );
      if (reference !== null) {
        from -= reference[0].length;
        continue;
      }
    }
    from -= 1;
    if (source[from] !== ' ' && source[from] !== '\t') {
      characters += 1;
    }
  }
  let to = offset;
  characters = 0;
  while (to < source.length && characters < 32) {
    if (source[to] === '&') {
      PHONE_NBSP_START_RE.lastIndex = to;
      const reference = PHONE_NBSP_START_RE.exec(source);
      if (reference !== null) {
        to += reference[0].length;
        continue;
      }
    }
    if (source[to] !== ' ' && source[to] !== '\t') {
      characters += 1;
    }
    to += 1;
  }
  // The gaps and references phoneSpaces rewrites neither make nor break these marks.
  if (!PHONE_MARK_RE.test(source.slice(from, to))) {
    return 0;
  }
  const head = phoneSpaces(source.slice(from, offset));
  const window = head + phoneSpaces(source.slice(offset, to));
  const at = head.length;
  for (const pattern of PHONE_CONTEXT_PATTERNS) {
    for (const match of window.matchAll(pattern)) {
      const start = match.index + match[1].length;
      const end = match.index + match[0].length;
      if (start <= at && at < end) {
        return 1;
      }
      if (end === head.trimEnd().length) {
        return -1;
      }
    }
  }
  return 0;
}

const DATE_FOLLOW_RE = new RegExp(NUMERIC_DATE_RE.source, NUMERIC_DATE_RE.flags.replace('g', 'y'));

// Two digits followed by a triad lead a grouped number, `43 138`, as typed or as
// `other.split_triads` writes it, in XML through the reference it writes. The first octet of an
// IP address is not a triad: `nobr.nowrap_ip` wraps the address, and the next pass reads the time
// before that wrapper.
const TRIAD_AHEAD_RE = new RegExp(
  `(?:[ \\t]+|[${G.NBSP}${G.NNBSP}${G.THINSP}]|${vaultedReference(G.NBSP)}|${vaultedReference(G.NNBSP)}|${vaultedReference(G.THINSP)})(?!${IP_ADDRESS})\\d{3}(?!\\d)`,
  'uy'
);

const FOOT_PATTERN = new RegExp(
  `(?<=^|[${CONTENT_START}])(?<![.,])(?<!(?:${G.NUMERO}|${vaultedReference(G.NUMERO)})(?:\\s|${vaultedReference(G.NNBSP)}){0,2})(${DECIMAL_NUMBER})'${CONTENT_END_LOOKAHEAD}`,
  'gu'
);
const FOOT_AT = new RegExp(FOOT_PATTERN.source, 'uy');

// The quote pass sees the original spelling before number.prime writes it.
export function authoredFootAt(text, at, visit) {
  let start = at;
  while (start > 0 && /[\d.,]/u.test(text[start - 1])) {
    visit?.();
    start--;
  }
  FOOT_AT.lastIndex = start;
  return FOOT_AT.test(text) && FOOT_AT.lastIndex === at + 1 && phoneContextAt(text, start) !== 1;
}

const AMOUNT_GAP = `[ \\t${G.NBSP}${G.NNBSP}${G.THINSP}]`;
const AMOUNT_GAP_RE = new RegExp(AMOUNT_GAP, 'u');
const AMOUNT_PART = new RegExp(`[\\d.,/⁄ \\t${G.NBSP}${G.NNBSP}${G.THINSP}${G.MINUS}-]`, 'u');
const GROUPED_NUMBER = `\\d{1,3}(?:${AMOUNT_GAP}+\\d{3})+(?:[.,]\\d+)?`;
const FRACTION_NUMBER = `(?:\\d+${AMOUNT_GAP}+)?\\d+[/⁄]\\d+`;
const INCH_AMOUNT = new RegExp(
  `^[-${G.MINUS}]?(?:${DECIMAL_NUMBER}|${GROUPED_NUMBER}|${FRACTION_NUMBER})$`,
  'u'
);

// XML keeps its references marked. Only numeric references specify these values in XML
// without a DTD. Other formats also admit HTML names for the measure's alphabet.
const AMOUNT_ENTITIES = new Map([
  ['&prime', G.SINGLE_PRIME],
  ['&comma', ','],
  ['&period', '.'],
  ['&sol', '/'],
  ['&frasl', '⁄'],
  ['&minus', G.MINUS],
  ['&nbsp', G.NBSP],
  ['&NonBreakingSpace', G.NBSP],
  ['&thinsp', G.THINSP],
  ['&ThinSpace', G.THINSP],
  ['&Tab', '\t']
]);

function amountGlyphBefore(text, offset, ctx, visit) {
  const end = text[offset - 1] === '>' ? inlineTextEnd(ctx, text, offset, true, visit) : offset;
  let start = end - 1;
  let glyph = text[start];
  if (glyph === ';') {
    const ref = characterReferenceEndingAt(text, start, ctx.checkBudget);
    if (ref === null) {
      return null;
    }
    start = text.lastIndexOf('&', start);
    if (ref.head.startsWith('&#')) {
      const code = numericReferenceCode(ref.head);
      // Every member of the measurement alphabet fits in a single code unit.
      glyph = code <= 0xffff ? String.fromCodePoint(code) : undefined;
    } else {
      glyph = ref.native ? undefined : AMOUNT_ENTITIES.get(ref.head);
    }
  }
  return glyph === undefined ? null : { glyph, start, end };
}

// Read evidence for the unit without editing any part of the source. A quote
// interrupts the walk, so separate candidates cannot rescan the same amount.
export function followsFeet(text, digit, ctx, visit, readFoot) {
  const pieces = [];
  let end = digit + 1;
  let tail = end;
  while (end > 0) {
    visit?.();
    const part = amountGlyphBefore(text, end, ctx, visit);
    if (part === null) {
      return false;
    }
    if (part.end < end) {
      pieces.push(text.slice(end, tail));
      tail = part.end;
    }
    const { glyph, start } = part;
    if (glyph === G.SINGLE_PRIME || glyph === "'") {
      let before = amountGlyphBefore(text, start, ctx, visit);
      while (before !== null && AMOUNT_GAP_RE.test(before.glyph)) {
        visit?.();
        before = amountGlyphBefore(text, before.start, ctx, visit);
      }
      return (
        /\d/u.test(before?.glyph ?? '') &&
        (glyph === G.SINGLE_PRIME || readFoot?.(text, start, visit) === true) &&
        INCH_AMOUNT.test((text.slice(part.end, tail) + pieces.toReversed().join('')).trim())
      );
    }
    if (!AMOUNT_PART.test(glyph)) {
      return false;
    }
    if (start < part.end - 1) {
      pieces.push(text.slice(part.end, tail), glyph);
      tail = start;
    }
    end = start;
  }
  return false;
}

export const numberGroup = {
  title: 'Числа, дроби, математические знаки',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'prime',
      requires: F.DIGIT | F.APOSTROPHE,
      changesInlineBoundary: true,
      description: 'Штрих после числа для футов и угловых минут',
      pattern: FOOT_PATTERN,
      // The last group of a phone number measures nothing, as its grouping by `nobr` shows a pass later.
      replacement: (m) =>
        phoneContextAt(m.at(-1), m.at(-2)) === 1 ? m[0] : `${m[1]}${G.SINGLE_PRIME}`
    },
    {
      id: 'fraction_extended',
      requires: F.DIGIT | F.SLASH,
      description: 'Дополнительные дроби: ⅓ ⅔ ⅛ ⅜ ⅝ ⅞',
      pattern: new RegExp(`(?<!${FRACTION_LEAD})([12]\\/3|[1357]\\/8)(?!${FRACTION_TAIL})`, 'gu'),
      replacement: (m, ctx) => {
        const [full, fraction, offset, source] = m;
        const end = offset + full.length;
        const held = heldBeforeNowrapEnd(ctx, source, offset - 1);

        return (held !== null && FRACTION_LEAD_RE.test(held)) ||
          (source[end] === '&' && FRACTION_TAIL_RE.test(keptGlyphAt(source, end).glyph))
          ? full
          : EXTENDED_FRACTIONS[fraction];
      }
    },
    {
      id: 'minus',
      requires: F.DASH,
      description: 'Знак отрицательного числа вне диапазона и вычитания',
      regexes: [...MINUS_PATTERNS, MATH_TAG_RE],
      handler: negativeNumbers
    },
    {
      id: 'time',
      requires: F.DIGIT | F.COLON,
      description: 'Нормализация времени: 08 : 59 → 08:59, 9:30 не трогаем',
      // Runs before `space.trim_before_punctuation`, so both sides collapse at once.
      pattern: /(?<![\d:])(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?(?![\d:])/g,
      replacement: (m) => {
        const [full, h, mm, ss, offset, source] = m;
        const time = ss != null ? `${h}:${mm}:${ss}` : `${h}:${mm}`;
        if (time === full) {
          return full;
        }
        TRIAD_AHEAD_RE.lastIndex = offset + full.length;

        if (TRIAD_AHEAD_RE.test(source) || phoneContextAt(source, offset) === 1) {
          return full;
        }

        return time;
      }
    },
    {
      id: 'en_range',
      projectSpacedYears: 'gaps',
      requires: F.DIGIT,
      requiresAny: F.DASH | F.SEMICOLON,
      description: 'Среднее тире для диапазонов чисел: 100-500 → 100–500',
      pattern: new RegExp(`(?<!\\d)(\\d+)${RANGE_DASH}(\\d+)(?!\\d)`, 'gu'),
      replacement: normalizeRange
    },
    {
      id: 'minus_range',
      requires: F.DIGIT | F.DASH,
      description: 'Минус между диапазоном чисел',
      // A run of spaces reads as the one space `space.collapse_spaces` leaves of it.
      pattern: /(^|\s)([−-])(\d+)(\.\.\.|…)([ \t]+|\s)?(\+|-|−)?(\d+)/gu,
      replacement: (m) => {
        const [, p1, , p3, p4, p5 = '', p6, p7] = m;
        const sign = p6 === '-' ? G.MINUS : (p6 ?? '');

        return `${p1}${G.MINUS}${p3}${p4}${p5}${sign}${p7}`;
      }
    },
    {
      id: 'times',
      requires: F.DIGIT,
      requiresPattern: /[xх×]|&#/u,
      description: 'x на × в размерных единицах',
      // Decide the boundaries after reading all digits: a partial operand is never a dimension.
      pattern: DIMENSION_CHAIN,
      replacement: normalizeDimensions
    },
    {
      id: 'sub',
      requires: F.DIGIT | F.UNDERSCORE,
      description: 'Нижний индекс',
      // Under `html: false` the consumed `_` marker would vanish and corrupt the input.
      htmlOnly: true,
      pattern: /(?<![\p{L}\d_])([a-zа-яё])_(\d{1,3})([^@а-яёa-z0-9]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3] = m;

        return `${p1}${ctx.tag(ctx.tag(p2, 'small'), 'sub')}${p3}`;
      }
    },
    {
      id: 'sup',
      requires: F.DIGIT | F.CARET,
      description: 'Верхний индекс',
      htmlOnly: true,
      pattern: /([a-zа-яё0-9])\^(\d{1,3})([^а-яёa-z0-9]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3] = m;

        return `${p1}${ctx.tag(ctx.tag(p2, 'small'), 'sup')}${p3}`;
      }
    },
    {
      id: 'fraction',
      requires: F.DIGIT | F.SLASH,
      description: 'Дроби 1/2, 1/4, 3/4 → символы (кроме дюймов)',
      // Trailing negative lookahead keeps longer numbers (1/24) and inch marks (3/4″) intact.
      pattern: [/(^|\D)1\/2(?![\d"″′])/g, /(^|\D)1\/4(?![\d"″′])/g, /(^|\D)3\/4(?![\d"″′])/g],
      replacement: [`$1${G.FRAC12}`, `$1${G.FRAC14}`, `$1${G.FRAC34}`]
    },
    {
      id: 'math',
      requires: F.MATH,
      description: 'Математические знаки: !=, <=, >=, ~=, +-',
      // >= excludes PUA chars so it can't eat a tag-placeholder > (CLOSE precedes it).
      // No == → ≡: it would eat a Markdown setext underline and ==highlight== markers. ≡ needs no
      // rule anyway — it is its own canonical form in CHARS_TABLE.
      // The `!` of a run of them is the run's: `!!!=` keeps its three marks.
      pattern: [
        /(?<!!)!=/g,
        /<=(?![>=])/g,
        new RegExp(`([^=${OPEN}${CLOSE}]|^)>=`, 'gu'),
        /~=/g,
        /(?<![-+])\+-(?![-+])/g
      ],
      replacement: [G.NE, G.LE, `$1${G.GE}`, G.CONG, G.PLUSMN]
    },
    {
      id: 'thin_space_triads',
      requires: F.DIGIT | F.SPACE,
      requiresPattern: /[0-9][ \t]+[0-9]{3}/u,
      description: 'Триады чисел через узкий неразрывный пробел',
      // The lookarounds skip digit-space chains, so phone numbers and IBANs — non-triadic groups —
      // are left whole. The letter guard is the one `split_triads` already carries: digits stuck to a
      // word are part of that word, not a quantity, and without it `ab12 345678` never settles.
      //
      // A gap is a run of spaces and tabs: `space.collapse_spaces` makes it one space later, and the
      // number it leaves is the one read here. The gap in front of the match is read in the
      // replacement, once per match: a lookbehind over a run is reread from every start by a
      // backtracking engine.
      pattern: /(?<![\p{L}\p{N}])([0-9]{1,3}([ \t]+[0-9]{3}){1,})(?!\p{N})(?=([\s\S]|$))/gu,
      replacement: (m, ctx) => {
        const [m0, p1, , p4, offset, str] = m;

        const phone = phoneContextAt(str, offset);
        if (
          p4 === '-' ||
          joinedNumericToken(ctx, str, offset) ||
          phone === 1 ||
          (digitBeforeGap(str, offset) && phone !== -1)
        ) {
          return m0;
        }

        // The greedy `{1,}` already took every legitimate space-triad, so a digit one space further
        // is the tail of a phone number or an IBAN and stays whole.
        if (p4 === ' ' && /\d/.test(str[offset + m0.length + 1] ?? '')) {
          DATE_FOLLOW_RE.lastIndex = offset + m0.length;
          if (!DATE_FOLLOW_RE.test(str)) {
            return m0;
          }
        }

        return p1.replace(GAP_RE, G.NNBSP);
      }
    },
    {
      id: 'nbsp_numero',
      requires: F.DIGIT | F.NUMERO,
      description: 'Узкий неразрывный пробел между № и числом',
      pattern: /[№]\s*(\d)/gu,
      replacement: `${G.NUMERO}${G.NNBSP}$1`
    },
    {
      id: 'nbsp_section',
      requires: F.SECTION,
      description: 'Узкий неразрывный пробел между § и числом',
      pattern: /§\s*(\d+|[IVX]+|[a-zа-яё]+)/giu,
      replacement: `${G.SECT}${G.NNBSP}$1`
    }
  ]
};
