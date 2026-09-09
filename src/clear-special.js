import { CHARS_TABLE } from './lib/chars-table.js';

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
const SCAN_RE = new RegExp(SORTED.map(([needle]) => RegExp.escape(needle)).join('|'), 'gu');

// Single-pass: never rescans its own output, so a decoded result can't be re-decoded.
export function clearSpecialChars(text) {
  return text.replace(SCAN_RE, (m) => LOOKUP.get(m) ?? m);
}
