import { CLOSE, OPEN } from '../protect/placeholders.js';
import { G } from './glyphs.js';

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

// The mirror question: what may stand immediately after the end of content. `<` is here because a
// vaulted tag begins with it, the placeholder opener because a vaulted region does, and `“` because
// it closes the Russian `„…“` pair.
const CONTENT_END = `\\s.,;:!?${G.PLUSMN}%<${OPEN})\\]}${G.RAQUO}${G.LDQUO}${G.HELLIP}`;

// Always a lookahead, never consumed: taking the character would eat the left boundary of whatever
// comes next, and a series like `2 м 40 см` would bind every other unit.
export const CONTENT_END_LOOKAHEAD = `(?=[${CONTENT_END}]|$)`;
