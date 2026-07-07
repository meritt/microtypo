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

// Longest-first so multi-char needles (&amp;, ...) win over their prefixes in one pass.
const SORTED = ENTRIES.toSorted((a, b) => b[0].length - a[0].length);
const LOOKUP = new Map(SORTED);
const SCAN_RE = new RegExp(SORTED.map(([needle]) => RegExp.escape(needle)).join('|'), 'gu');

// Single-pass: never rescans its own output, so a decoded result can't be re-decoded.
export function clearSpecialChars(text) {
  return text.replace(SCAN_RE, (m) => LOOKUP.get(m) ?? m);
}
