import { readScalarAt } from '../clear-special.js';
import { REFERENCE_HOLE } from '../protect/placeholders.js';
import { G } from './glyphs.js';

// The same reference head the XML protection owner recognizes, without its terminating semicolon.
export const CHARACTER_REFERENCE_HEAD = '&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*)';
const REFERENCE_AT_RE = new RegExp(`(${CHARACTER_REFERENCE_HEAD})(${REFERENCE_HOLE})?;`, 'uy');
const HOLE_END_RE = new RegExp(`${REFERENCE_HOLE}$`, 'u');
// OPEN + N + at most nine id digits + CLOSE, as REFERENCE_HOLE spells it.
const HOLE_MAX = 12;
const HEAD_CHAR_RE = /[0-9A-Za-z#]/u;

export const CHARACTER_REFERENCE_PATTERNS = [REFERENCE_AT_RE, HOLE_END_RE, HEAD_CHAR_RE];

export function readCharacterReferenceAt(text, at) {
  REFERENCE_AT_RE.lastIndex = at;
  const match = REFERENCE_AT_RE.exec(text);
  return match === null
    ? null
    : { head: match[1], end: REFERENCE_AT_RE.lastIndex, native: match[2] !== undefined };
}

// The glyph a character reference kept as written spells, or null. Only XML keeps one: every other
// format reads references as their characters before the rules run. Only the glyphs the engine
// itself writes as references are read; any other reference stays the syntax it is.
export function keptReferenceGlyph(reference) {
  return reference?.head.startsWith('&#') ? authoredReferenceGlyph(reference) : null;
}

export function authoredReferenceGlyph(reference, preserveQuoteDirection = false) {
  if (!reference?.native) {
    return null;
  }
  const spelled = `${reference.head};`;
  const { glyph, end } = readScalarAt(spelled, 0, preserveQuoteDirection);
  return end === spelled.length && glyph !== spelled ? glyph : null;
}

// A closing guillemet before a quote cannot introduce another quotation like a semicolon in prose.
// Named entities retain their authored spelling; no straight opening or closing role is assigned
// to an opaque `&quot;` by the quote planner.
export function quoteBoundaryGlyph(reference) {
  const glyph = authoredReferenceGlyph(reference);
  return reference?.head.startsWith('&#') || glyph === G.RAQUO ? glyph : null;
}

// A pattern for a reference to `glyph` kept as written, in every spelling a numeric reference has:
// decimal or hexadecimal, `x` and hex digits of either case, leading zeros.
export function keptReferenceTo(...glyphs) {
  const codes = glyphs.map((glyph) => glyph.codePointAt(0));
  const hex = codes.map((code) =>
    code.toString(16).replace(/[a-f]/gu, (c) => `[${c}${c.toUpperCase()}]`)
  );
  return `&#(?:0*(?:${codes.join('|')})|[xX]0*(?:${hex.join('|')}))${REFERENCE_HOLE};`;
}

// The character of `text` at `at` and where it ends, a reference kept as written read as that glyph.
export function keptGlyphAt(text, at) {
  const reference = text[at] === '&' ? readCharacterReferenceAt(text, at) : null;
  const glyph = keptReferenceGlyph(reference);

  return glyph === null ? { glyph: text[at], end: at + 1 } : { glyph, end: reference.end };
}

// The next `count` characters of `text` from `at`, each reference kept as written read as that glyph:
// what a lookahead sees once the engine has written its own glyph back as a reference.
export function keptGlyphsAt(text, at, count) {
  let out = '';
  let i = at;

  while (out.length < count && i < text.length) {
    const { glyph, end } = keptGlyphAt(text, i);

    out += glyph;
    i = end;
  }

  return out;
}

export function endsCharacterReference(text, semicolonAt, checkBudget) {
  return characterReferenceEndingAt(text, semicolonAt, checkBudget) !== null;
}

export function characterReferenceEndingAt(text, semicolonAt, checkBudget) {
  let end = semicolonAt;
  const hole = HOLE_END_RE.exec(text.slice(Math.max(0, end - HOLE_MAX), end));
  if (hole !== null) {
    end -= hole[0].length;
  }
  let from = end;
  while (from > 0 && HEAD_CHAR_RE.test(text[from - 1])) {
    from -= 1;
    if (checkBudget && ((end - from) & 1023) === 0) {
      checkBudget('punctuation:reference');
    }
  }
  const reference = text[from - 1] === '&' ? readCharacterReferenceAt(text, from - 1) : null;
  return reference?.end === semicolonAt + 1 ? reference : null;
}
