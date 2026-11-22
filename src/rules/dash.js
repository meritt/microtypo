import { CONTENT_END_LOOKAHEAD, CONTENT_START, OPENING_GT } from '../lib/boundaries.js';
import { keptGlyphAt, keptReferenceTo } from '../lib/character-reference.js';
import { G } from '../lib/glyphs.js';
import { INDEFINITE_HEAD, INDEFINITE_TAIL } from '../lib/indefinite-pronoun.js';
import { inlineTextEnd } from '../lib/inline-boundaries.js';
import { measurementBeforeParticle } from '../lib/measurement-units.js';
import { canonicalNowrapOpen, insideCanonicalNowrap } from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import { CLOSE, INLINE_END, OPEN, vaultedReference } from '../protect/placeholders.js';
import { canStartQuote } from './quote-state.js';

// The trailing boundary is a lookahead, so there is nothing to put back on the right. The leading
// one is consumed and returned as it came: a non-breaking space in front of the head is one the dash
// rules above just wrote, and loosening it to an ordinary space unbinds the dash and destroys the
// exact form `abbr.currency` reads back.
const joinHyphen = (m) => {
  const [, p1, p2, , p4] = m;

  return `${p1}${p2}-${p4}`;
};

// A half-typed source may already carry the hyphen on either side of the gap, so each side is
// optional per form: `из за` never comes as `из- за`, and an emphatic particle carries none at all.
// `notBefore` narrows the shared trailing boundary where one form is written apart in that position.
// A word glued to the end of a sentence or an abbreviation starts a word as well: the space rules,
// three groups later, part `в.Кое кто` into `в. Кое кто`, and a rerun would read it there; so do
// they part `?..когда то` behind the question.
const HYPHEN_WORD_START = `(^|[${CONTENT_START}]|(?<=[\\p{L}\\d][.?!]|[?!]\\.\\.))`;

const hyphenJoin = (head, tail, { lead = '-?', trail = '-?', notBefore = '' } = {}) =>
  new RegExp(
    `${HYPHEN_WORD_START}(${head})${lead}( |\\t|${G.NBSP})+${trail}(${tail})${notBefore}${CONTENT_END_LOOKAHEAD}`,
    'giu'
  );

export const EMPHATIC_HEAD = '[а-яё]+(?:-[а-яё]+)*';
export const EMPHATIC_PARTICLE = 'кась|тка|тко|ка|де';
// A word glued to the period of a single letter starts a word as well: `nobr.nowrap_initials` parts
// `К.С.Бл кась` from its initials, and the space rules part `в.ну ка`.
const EMPHATIC_CHAIN_RE = new RegExp(
  `(^|[${CONTENT_START}]|(?<=(?<![\\p{L}\\d])[а-яё]\\.))(?<![а-яё]-)(${EMPHATIC_HEAD})((?:[ \t${G.NBSP}]+(?:${EMPHATIC_PARTICLE})${CONTENT_END_LOOKAHEAD})+)`,
  'giu'
);
const PARTICLE_GAPS_RE = /[ \t\u{00A0}]+/gu;

function joinEmphaticChain(m, ctx) {
  const [full, lead, head, tail, offset, source] = m;
  const start = offset + lead.length;
  if (
    measurementBeforeParticle(source, start, start + head.length) ||
    !endsPastWrapper(ctx, source, offset + full.length)
  ) {
    return full;
  }
  return `${lead}${head}${tail.replace(PARTICLE_GAPS_RE, '-')}`;
}

const WRAPPER_END_RE = new RegExp(INLINE_END, 'y');
const CONTENT_END_RE = new RegExp(CONTENT_END_LOOKAHEAD, 'y');

// The engine's own no-wrap wrapper is drawn after this group, so the particle that ends it ends where
// the character behind the wrapper does, `т де</span>\``.
function endsPastWrapper(ctx, source, end) {
  WRAPPER_END_RE.lastIndex = end;
  if (!WRAPPER_END_RE.test(source)) {
    return true;
  }
  const after = WRAPPER_END_RE.lastIndex;
  if (
    !insideCanonicalNowrap(ctx, source, end - 1, end) ||
    insideCanonicalNowrap(ctx, source, end - 1, after)
  ) {
    return true;
  }
  CONTENT_END_RE.lastIndex = after;
  return CONTENT_END_RE.test(source);
}

// The three forms a dash arrives in. The en dash is one of them because it is its own canonical
// form: it reaches every rule below unfolded, as the author typed it.
const AUTHORED_DASH = `${G.MDASH}${G.NDASH}-`;

// XML keeps a dash as the reference it was written as, the author's or the one the engine wrote:
// `&#8212`, `&#x2014` or another spelling, a hole and `;`. The rules here read it as the dash it is,
// and write it back as it was where they write that same dash.
const DASH_REFERENCE = `(?:${keptReferenceTo(G.NDASH)}|${keptReferenceTo(G.MDASH)})`;
const A_DASH = `(?:[${AUTHORED_DASH}]|${DASH_REFERENCE})`;
const emDash = (dash) => (keptGlyphAt(dash, 0).glyph === G.MDASH ? dash : G.MDASH);
const enDash = (dash) => (keptGlyphAt(dash, 0).glyph === G.NDASH ? dash : G.NDASH);
// A text holding its dash only as a reference has none of the dash characters.
const DASH_FEATURES = F.DASH | F.SEMICOLON;

// The end tag of an inline element stands after the words of that element, so what a dash follows is
// what ends inside it, and the tag opens no line: `<span>2020 г.</span> -` ends in a period.
//
// Anything that ends content takes the dash: an enumerated allowlist would leave `]`, `*`, `%` and a
// vault placeholder without one. Sentence marks stay out — `em_after_sentence` spaces those the
// other way round — and so do openers and dashes, which would turn a `- - -` break or a `( - x)`
// into an em dash. `“` is not an opener here: in the Russian `„…“` pair it closes.
//
// The separator may already be a non-breaking space, since a half-typeset source glues short words
// before anyone converts its dashes. A spaced `–` between words still means an em dash; glued
// (`отец–сын`) it stays what it is.
//
// The start of a line before the gap takes the dash as the start of an element does: the paragraph
// `text.paragraphs` wraps a line in puts its `<p>` there, and the next pass reads that `>`.
//
// A hyphen glued to the start of an element whose text opens with a digit is the minus it is glued
// to that digit without one: `-<span>7 °F</span>` is what `symbol.fahrenheit` makes of `-7F`.
//
// A dash kept as a reference is a dash: its `;` is no content, or a second pass turns the `- -` break
// the first one left into two em dashes.
const DASH_REFERENCE_END = `(?<!${DASH_REFERENCE})`;
const EM_AFTER_CONTENT_RE = new RegExp(
  `((?:[^\\s(\\[{<>.!?${G.LAQUO}${G.BDQUO}${G.HELLIP}${G.NDASH}${G.MDASH}-]${DASH_REFERENCE_END}|${OPENING_GT}|(?<=^|[\\n\\r]))(?:${INLINE_END})*)( |\\t|${G.NBSP})+(${A_DASH})(\\s|$|<(?!${OPEN}[A-Za-z]+\\d+${CLOSE}>\\d))`,
  'giu'
);

const EM_GLUED_RE = new RegExp(`(,|:|\\)|")(${A_DASH})(\\s|$|<)`, 'giu');

// What `em_after_sentence` leaves behind the mark it read as a sentence end: the inline end tags it
// read through, captured, then this exact form, with the dash, captured, as it was written.
// `abbr.currency` reads it back — it removes the abbreviation period this rule mistook for that mark,
// so it has to undo the spacing too — and reads it from here, because a literal copy there would stop
// matching silently the first time this changed.
export const SENTENCE_DASH = ` ${G.MDASH}${G.NBSP}`;
export const SENTENCE_DASH_TAIL = `((?:${INLINE_END})*) (${G.MDASH}|${keptReferenceTo(G.MDASH)})${G.NBSP}`;

// A dash in its gaps after a sentence mark, as `em_after_sentence` reads it.
export const DASH_IN_GAPS = `(?: |\\t|${G.NBSP})+[${AUTHORED_DASH}](?: |\\t|${G.NBSP})+`;

// Same separator set as em, and still ahead of it, so a spaced range stays a range. The en dash is
// accepted as written, or `12 – 19` falls through to `em`, which raises the range's own dash to an em
// dash — the one glyph a range never takes. The separator is a run for the same reason `em` reads
// one: the two rules have to agree on what separates a dash from its neighbour.
const RANGE_DASH = `${G.NDASH}-`;
const DASH_GAP = `(?: |\\t|${G.NBSP})+`;
const EN_RANGE_RE = new RegExp(
  `(?<![\\d${RANGE_DASH}])(\\d+)${DASH_GAP}([${RANGE_DASH}]|${keptReferenceTo(G.NDASH)})${DASH_GAP}(\\d+)(?![\\d${RANGE_DASH}])`,
  'gu'
);

// An operand is a number or a word. It is read only up to the first other character, so `$W` is no
// operand and `3` stays one after a later rule glues `)`, `%` or `…` to it.
const OPERAND_CHAR_RE = /[\p{L}\p{N}_.,]/u;
const isOperandChar = (c) => c !== undefined && OPERAND_CHAR_RE.test(c);
const isGap = (c) => c === ' ' || c === '\t' || c === G.NBSP;

// `==`, `<=`, `>=`, `!=` and `=>` compare or point; only a lone `=` makes an equation. The `>` that
// closes a tag placeholder is no part of a sign.
function isEqualsSign(source, at) {
  const before = source[at - 1] === '>' && source[at - 2] === CLOSE ? ' ' : (source[at - 1] ?? ' ');

  return source[at] === '=' && !'=<>!'.includes(before) && !'=>'.includes(source[at + 1] ?? ' ');
}

// A hyphen in spaces between two operands of an equation, `x = 5 - 3` or `10 - 2 = 8`, is the minus
// as the author typed it. `leftEnd` is where the operand before the hyphen ends, `dashEnd` where the
// hyphen does.
function inEquation(source, leftEnd, dashEnd) {
  if (!isGap(source[dashEnd])) {
    return false;
  }

  let rightStart = dashEnd;

  while (isGap(source[rightStart])) {
    rightStart++;
  }

  let rightEnd = rightStart;

  while (isOperandChar(source[rightEnd])) {
    rightEnd++;
  }

  let leftStart = leftEnd;

  while (isOperandChar(source[leftStart - 1])) {
    leftStart--;
  }

  return (
    leftStart < leftEnd &&
    rightStart < rightEnd &&
    (equalsBefore(source, leftStart) || equalsAfter(source, rightEnd))
  );
}

// One space, tab or no-break space within a line, the no-break space included as XML writes it: the
// gap between an operand and `=`, and the one `abbr` and `other` read between words of an address.
export const LINE_GAP = `(?:[ \\t${G.NBSP}]|${vaultedReference(G.NBSP)})`;
const GAP_AFTER_RE = new RegExp(`${LINE_GAP}+`, 'uy');
const GAP_BEFORE_RE = new RegExp(`${LINE_GAP}+$`, 'u');
const GAP_BEFORE_REACH = 64;

function equalsAfter(source, at) {
  GAP_AFTER_RE.lastIndex = at;

  const gap = GAP_AFTER_RE.exec(source);

  return gap !== null && isEqualsSign(source, at + gap[0].length);
}

function equalsBefore(source, end) {
  const gap = GAP_BEFORE_RE.exec(source.slice(Math.max(0, end - GAP_BEFORE_REACH), end));

  return gap !== null && isEqualsSign(source, end - gap[0].length - 1);
}

function gluedToNowrap(m, ctx, after) {
  if (after !== '<' || !ctx.html) {
    return false;
  }
  const open = canonicalNowrapOpen(ctx);
  const at = m.at(-2) + m[0].length - after.length;
  const source = m.at(-1);
  return source.startsWith(open, at) && /\p{L}/u.test(source[at + open.length] ?? '');
}

export const dashGroup = {
  title: 'Дефисы и тире',
  rules: [
    {
      id: 'em_double_hyphen',
      projectSpacedYears: true,
      requires: F.DASH,
      description: 'Двойной дефис → тире (как в markdown/AsciiDoc)',
      // The closing boundary is a lookahead: consuming the space would eat the one the next `--`
      // needs as its own opening boundary, so `-- -- --` would convert every other one.
      //
      // The end of a protected region opens content as a space does — that is what stands in front
      // of `--` behind a Markdown blockquote or list marker.
      pattern: new RegExp(`(\\s|^|${CLOSE})--(?=\\s)`, 'gu'),
      replacement: `$1${G.MDASH}`
    },
    {
      id: 'en_range',
      projectSpacedYears: true,
      requires: F.DIGIT,
      requiresAny: DASH_FEATURES,
      description: 'Диапазон чисел с пробелами вокруг дефиса: «12 - 19» → «12–19»',
      // Runs before em, so `dash.em` cannot take `12 - 19` for a text em dash.
      pattern: EN_RANGE_RE,
      replacement: (m) => {
        const [match, from, written, to, offset, source] = m;
        let dash = from.length;

        while (isGap(match[dash])) {
          dash++;
        }

        if (match[dash] === '-' && inEquation(source, offset + from.length, offset + dash + 1)) {
          return match;
        }

        return `${from}${enDash(written)}${to}`;
      }
    },
    {
      id: 'em',
      projectSpacedYears: true,
      requiresAny: DASH_FEATURES,
      description: 'Тире после слов, кавычек, скобочек, пунктуации',
      pattern: [EM_AFTER_CONTENT_RE, EM_GLUED_RE],
      replacement: [
        (m, ctx) => {
          const [match, before, , dash, after, offset, source] = m;
          if (gluedToNowrap(m, ctx, after)) {
            return match;
          }
          const dashEnd = offset + match.length - after.length;

          if (source[dashEnd - 1] === '-' && inEquation(source, offset + before.length, dashEnd)) {
            return match;
          }
          // A straight quote standing where a quote opens is no word to bind the dash to, through the
          // inline tags behind it too: the quote rules left it undecided, and glued to the dash it
          // would read as an opening quote on the next pass.
          const at = inlineTextEnd(ctx, source, offset + before.length) - 1;
          const lone = source[at] === '"' && canStartQuote(source, at, G.NBSP, ctx);

          return `${before}${lone ? ' ' : G.NBSP}${emDash(dash)}${after}`;
        },
        (m, ctx) => (gluedToNowrap(m, ctx, m[3]) ? m[0] : `${m[1]}${G.NBSP}${emDash(m[2])}${m[3]}`)
      ]
    },
    {
      id: 'em_line_start',
      requiresAny: DASH_FEATURES,
      description: 'Тире после переноса строки',
      pattern: new RegExp(`(\\n|\\r|^|${OPENING_GT}|${CLOSE})(${A_DASH})(\\t| )`, 'gu'),
      replacement: (m) => `${m[1]}${emDash(m[2])}${G.NBSP}`
    },
    {
      id: 'em_after_sentence',
      requiresAny: DASH_FEATURES,
      description: 'Тире после знаков восклицания, троеточия и прочее',
      // The separators are runs, and both are discarded: requiring exactly one would make the binding
      // wait for `space.collapse_spaces`, four groups later, so the same document came out two ways.
      //
      // A dash that ends the text has no next clause to open, so it binds backwards instead — the
      // form `em` gives every other dangling dash.
      pattern: [
        new RegExp(`([.!?${G.HELLIP}](?:${INLINE_END})*)${DASH_GAP}(${A_DASH})${DASH_GAP}`, 'gu'),
        new RegExp(`([.!?${G.HELLIP}](?:${INLINE_END})*)${DASH_GAP}(${A_DASH})$`, 'gu')
      ],
      replacement: [
        (m) => `${m[1]} ${emDash(m[2])}${G.NBSP}`,
        (m) => `${m[1]}${G.NBSP}${emDash(m[2])}`
      ]
    },
    // The four hyphen-joining rules take the shared left boundary, so `(кто то)`, `«всё таки»` and
    // `[из за]` lose the same space a bare `кто то` does.
    {
      id: 'compound_preposition',
      requires: F.SPACE,
      description: 'Дефис между из-за, из-под',
      pattern: hyphenJoin('из', 'за|под', { lead: '' }),
      replacement: joinHyphen
    },
    {
      id: 'indefinite_pronoun',
      requires: F.SPACE,
      description: 'Дефисы в обезличенных местоимениях',
      // The shared trailing set carries a colon, and claiming it would take `как то:` — the
      // enumeration idiom written apart, which `nobr.nbsp_namely` owns and which `dash`, two groups
      // earlier, would reach first. Declining the colon is how the form reaches its own rule. The
      // colon is read past the end of an inline element too: a no-break wrapper drawn round the
      // idiom later ends before it.
      pattern: hyphenJoin(INDEFINITE_HEAD, INDEFINITE_TAIL, {
        notBefore: `(?!(?:${INLINE_END})*:)`
      }),
      replacement: joinHyphen
    },
    {
      id: 'hyphenated_particle',
      requires: F.SPACE,
      description: 'Кое-как, кой-кого, всё-таки',
      pattern: [
        hyphenJoin(
          'кое',
          'как|что|кто|кого|кому|чей|чья|чьё|чьи|где|куда|откуда|когда|какой|какая|какое|какие|каких|каким'
        ),
        hyphenJoin('кой', 'кого'),
        hyphenJoin('вс[её]', 'таки')
      ],
      replacement: joinHyphen
    },
    {
      id: 'emphatic_particle',
      requires: F.SPACE,
      // The last particle of a chain and the gap before it.
      requiresPattern: new RegExp(
        `[ \t${G.NBSP}](?:${EMPHATIC_PARTICLE})${CONTENT_END_LOOKAHEAD}`,
        'iu'
      ),
      description: 'Дефис с усилительными частицами ка, кась, тка, тко, де',
      pattern: EMPHATIC_CHAIN_RE,
      replacement: joinEmphaticChain
    }
  ]
};
