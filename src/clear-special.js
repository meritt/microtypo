import { CHARS_TABLE } from './lib/chars-table.js';
import { NUMERIC_REFERENCE_HEAD } from './lib/glyphs.js';
import { RDQUO } from './lib/quote-pairs.js';
import { canonicalQuoteRoles } from './rules/quote-state.js';

const ENTRIES = (() => {
  const out = [];

  for (const [canonical, vals] of Object.entries(CHARS_TABLE)) {
    for (const v of vals.utf8 ?? []) {
      out.push([typeof v === 'number' ? String.fromCodePoint(v) : v, canonical]);
    }

    for (const v of vals.html ?? []) {
      if (typeof v === 'string') {
        out.push([v, canonical]);
      }
    }
  }

  return out;
})();

// A spelling that decodes to itself decides nothing, and it is what already-typeset text is made of,
// so each one costs a match and a lookup on every re-run for a result identical to the input.
//
// Only a single code unit may be dropped. A longer needle wins its position by sorting first, so
// removing one would hand that position to a shorter needle and decode differently; a one-unit
// needle can be beaten by nothing and shadows nothing.
const IDENTITY = ([needle, canonical]) => needle === canonical && needle.length === 1;

// Longest-first so multi-char needles (&amp;, ...) win over their prefixes in one pass.
const SORTED = ENTRIES.filter((entry) => !IDENTITY(entry)).toSorted(
  (a, b) => b[0].length - a[0].length
);
const LOOKUP = new Map(SORTED);

// A numeric reference names one code point however it is spelled — hex with either `x`, decimal
// with leading zeros — and the table lists each by its plain decimal spelling. A code point with
// none there, `&#38;` and `&#60;` among them, stays as written.
const SCAN_RE = new RegExp(
  [`${NUMERIC_REFERENCE_HEAD};`, ...SORTED.map(([needle]) => RegExp.escape(needle))].join('|'),
  'gu'
);
const SCALAR_RE = new RegExp(SCAN_RE.source, 'uy');

const decoder = (lookup) => (m, hex, decimal) => {
  if (hex === undefined && decimal === undefined) {
    return lookup.get(m) ?? m;
  }

  const code = hex === undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);

  return lookup.get(`&#${code};`) ?? m;
};

const decode = decoder(LOOKUP);

// `”` decodes to `»`, but the quote-role owner reads it first: whether the next high quote is `”` or
// `“` is what tells an English pair inside a nested quotation from the nested pair's own closer.
const decodeForRoles = decoder(
  new Map([...LOOKUP, [RDQUO, RDQUO], ['&rdquo;', RDQUO], [`&#${RDQUO.codePointAt(0)};`, RDQUO]])
);

// The same single-pass spelling reader, at one original offset. Unknown references remain literal.
export function readScalarAt(text, offset, preserveQuoteDirection = false) {
  SCALAR_RE.lastIndex = offset;
  const match = SCALAR_RE.exec(text);

  if (match !== null) {
    const decodeScalar = preserveQuoteDirection ? decodeForRoles : decode;
    return { glyph: decodeScalar(match[0], match[1], match[2]), end: SCALAR_RE.lastIndex };
  }

  const glyph = String.fromCodePoint(text.codePointAt(offset));
  return { glyph, end: offset + glyph.length };
}

// Decode once, retaining the direction the quote-role owner still needs.
export function decodeSpecialChars(text) {
  return text.replace(SCAN_RE, decodeForRoles);
}

export function clearSpecialChars(text, tags, checkBudget, inlineContext, turnsOpeners = false) {
  return canonicalQuoteRoles(
    decodeSpecialChars(text),
    tags,
    checkBudget,
    inlineContext,
    turnsOpeners
  );
}
