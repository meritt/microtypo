import { BLOCK_KIND, CLOSE, OPEN, TRANSPARENT_TAG_KINDS } from '../protect/placeholders.js';
import { G } from './glyphs.js';
import { WHITESPACE } from './strings.js';

// What may stand immediately before the start of content, as one character-class fragment. Every
// rule that asks the question reads it from here, or `(5 км)` and `«5 км»` go without the
// non-breaking space a bare `5 км` gets.
//
// `\s` already covers the non-breaking space, so it is not listed again. `“` is deliberately absent:
// in the Russian `„…“` pair it closes rather than opens.
//
// The bracket-and-quote half is separate because `nobr.nbsp_short_word` needs those openers without
// the `\s` that would let it glue across a non-breaking space it wrote itself.
export const CONTENT_OPEN_BRACKETS = `(\\[{${G.LAQUO}${G.BDQUO}`;

// Everything except the tag boundary. A rule whose replacement is plain text may open right after a
// `>`; a rule that wraps its match in a span may not, because the phrase would then be wrapped as
// the first thing inside an element the engine deliberately does not read, and reprocessing such a
// document nests one span per pass — `etc.drop_nested_nowrap` collapses only the wrappers this
// engine emitted in the current layout, never the ones already in the source.
//
// The end of a protected region is here rather than beside the `>`: what it closes is a stretch of
// bytes this engine keeps, never an element it declined to read, so a rule that wraps its match may
// open behind one. The Markdown line prefix needs it — a blockquote marker and the indentation
// behind it are one protected span, and a rule asking for a left boundary finds a placeholder there.
const CONTENT_START_INSIDE = `\\s,\\-${CLOSE}${G.MINUS}${G.MDASH}${G.NDASH}${CONTENT_OPEN_BRACKETS}`;

export const CONTENT_START = `>${CONTENT_START_INSIDE}`;

// The start of a line counts too, so the whole left boundary is this alternation.
export const CONTENT_START_GROUP = `(^|[${CONTENT_START}])`;

export const WRAPPER_START_GROUP = `(^|[${CONTENT_START_INSIDE}])`;
export const BLOCK_CONTENT_START = `(?<=<${OPEN}${BLOCK_KIND}\\d{1,9}${CLOSE}>)`;
export const BLOCK_WRAPPER_START_GROUP = `(^|[${CONTENT_START_INSIDE}]|${BLOCK_CONTENT_START})`;

// The mirror question: what may stand immediately after the end of content. `<` is here because a
// vaulted tag begins with it, the placeholder opener because a vaulted region does, and `“` because
// it closes the Russian `„…“` pair.
const CONTENT_END_SIGNS = `.,;:!?${G.PLUSMN}%<)]}${G.RAQUO}${G.LDQUO}${G.HELLIP}`;
const CONTENT_END = `\\s${RegExp.escape(CONTENT_END_SIGNS)}${OPEN}`;

// Always a lookahead, never consumed: taking the character would eat the left boundary of whatever
// comes next, and a series like `2 м 40 см` would bind every other unit.
export const CONTENT_END_LOOKAHEAD = `(?=[${CONTENT_END}]|$)`;

// A rule that reads XML character references also reads the spelling of its right boundary.
export function writtenContentEndLookahead(referenceTo) {
  return `(?:${CONTENT_END_LOOKAHEAD}|(?=${referenceTo(...WHITESPACE, ...CONTENT_END_SIGNS)}))`;
}

// Not right behind a straight quote standing where a quote opens: first in the text, or behind a
// strong neighbour of `quote.open` other than the end of an inline element, behind which a quote
// before a non-word closes. The quote rules leave such a quote undecided, and it is no word: a rule
// that binds what follows to the word before, or takes the gap after it, would hand the next pass an
// opening quote glued to that follower.
const STRONG_QUOTE_LEFT = `\\s([${G.LAQUO}${G.MDASH}${G.NDASH}\\-`;
export const OPEN_LEFT = `${STRONG_QUOTE_LEFT}>`;
export const WEAK_LEFT = ',;:*_~`';
export const WEAK_STOP = `\\s.,;:!?\\p{Pe}${G.RAQUO}${G.HELLIP}`;
const STRONG_LEFT_RE = new RegExp(`[${OPEN_LEFT}]`, 'u');
const WEAK_LEFT_RE = new RegExp(`[${WEAK_LEFT}${CLOSE}]`, 'u');
const WEAK_STOP_RE = new RegExp(`[${WEAK_STOP}]`, 'u');

// Sentence punctuation after a dash and quote can end the enclosing phrase.
export const QUOTE_PUNCTUATION = `\\p{Terminal_Punctuation}\\p{Pe}${G.HELLIP}`;
const QUOTE_PUNCTUATION_RE = new RegExp(`[${QUOTE_PUNCTUATION}]+`, 'uy');

export function isQuoteDash(glyph) {
  return glyph === G.MDASH || glyph === G.NDASH;
}

export function dashQuotePunctuation(text, after, left, nextInline) {
  if (!isQuoteDash(left)) {
    return false;
  }
  let at = after;
  while (at < text.length) {
    if (text[at] === '<' && nextInline) {
      const next = nextInline(at);
      if (next === -1) {
        return true;
      }
      if (next !== at) {
        at = next;
        continue;
      }
    }
    QUOTE_PUNCTUATION_RE.lastIndex = at;
    if (!QUOTE_PUNCTUATION_RE.test(text)) {
      return at > after && /\s/u.test(text[at]);
    }
    at = QUOTE_PUNCTUATION_RE.lastIndex;
  }
  return at > after;
}

export function openingQuoteNeighbours(left, right) {
  return (
    left === '' ||
    STRONG_LEFT_RE.test(left) ||
    (WEAK_LEFT_RE.test(left) && !WEAK_STOP_RE.test(right))
  );
}
export const OPENING_GT = `(?<!<\\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d+${CLOSE})>`;
export const NOT_AFTER_LONE_QUOTE = `(?<!(?:^|[${STRONG_QUOTE_LEFT}]|${OPENING_GT})")`;

// quote.close cannot close speech immediately before a letter or digit from its word alphabet.
export const QUOTE_WORD = '[a-zа-яё0-9]';
const QUOTE_WORD_RE = new RegExp(QUOTE_WORD, 'iu');

export function insideQuoteWord(left, right) {
  return QUOTE_WORD_RE.test(left) && QUOTE_WORD_RE.test(right);
}

// A glued neutral quotation mark before Cyrillic starts speech after a letter or digit.
export const OPEN_CYRILLIC_RE = /([a-zа-яё0-9])"([а-яё])/giu;
const GLUED_OPEN = new RegExp(OPEN_CYRILLIC_RE.source, 'iu');
export function opensGluedCyrillic(left, right) {
  return GLUED_OPEN.test(`${left}"${right}`);
}
