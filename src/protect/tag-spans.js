// Single linear left-to-right scan (no backtracking) collecting each tag's [start, end] span;
// quote-aware, so a '>' inside a quoted attribute value doesn't end the span early.
export function tagSpans(text) {
  const spans = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    if (text[i] !== '<') {
      i++;
      continue;
    }

    let j = i + 1;

    if (text[j] === '/') {
      j++;
    }

    const c = text.codePointAt(j);
    const isTagStart =
      (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x21 || c === 0x3f;

    if (!isTagStart) {
      i++;
      continue;
    }

    const start = i;
    let quote = '';

    i = j;

    while (i < n) {
      const ch = text[i];

      if (quote) {
        if (ch === quote) {
          quote = '';
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }

      i++;
    }

    spans.push([start, i]);
    i++;
  }

  return spans;
}
