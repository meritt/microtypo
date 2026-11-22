// A line's indent reaches this group whole, so a run of spaces can be long here. A match starting
// inside one also starts at its first character, which is found first, and the lookbehind spares
// every later start a rescan of the rest of the run.
export const PARAGRAPH_SPLIT_RE = /(?<![ \t])([ \t]+)?(\n)+([ \t]*)(\n)+/g;
export const PARAGRAPH_INDENT_SPLIT_RE = new RegExp(`${PARAGRAPH_SPLIT_RE.source}([ \\t]*)`, 'g');
