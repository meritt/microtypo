import { isTagNameStart } from '../lib/tag-name.js';

// What HTML allows between a tag name and the rest of the tag. `/` is deliberately absent from the
// opener test below: `<script/>` is not an opener SafeBlocks matches, so it must not open raw text
// here either — the two readers of that question have to give one answer.
const AFTER_NAME = ' \t\n\r\f';

function nameMatchesAt(text, at, name, terminators) {
  const end = at + name.length;

  for (let k = 0; k < name.length; k++) {
    const expected = name.codePointAt(k);
    const ch = text.codePointAt(at + k);

    // name is lower-case ASCII, so folding case is the 0x20 bit and nothing else.
    if (ch !== expected && (ch | 0x20) !== expected) {
      return false;
    }
  }

  return end >= text.length || terminators.includes(text[end]);
}

// The raw-text element that opens at `at`, or '' — no element is named by the empty string.
function rawTextNameAt(text, at, rawText) {
  for (const name of rawText) {
    if (nameMatchesAt(text, at, name, `${AFTER_NAME}>`)) {
      return name;
    }
  }

  return '';
}

// The end tag that closes a raw-text element, or -1 when the document never closes it.
function rawTextClose(text, from, name) {
  let i = from;

  while (i < text.length) {
    const lt = text.indexOf('</', i);

    if (lt === -1) {
      return -1;
    }

    if (nameMatchesAt(text, lt + 2, name, `${AFTER_NAME}>/`)) {
      return lt;
    }

    i = lt + 2;
  }

  return -1;
}

// One linear left-to-right scan with no backtracking, collecting each tag's `[start, end]` span and
// quote-aware, so a `>` inside a quoted attribute value does not end the span early.
//
// `rawText` names the elements whose content HTML parses as text and nothing else: inside one of
// them the tag grammar does not apply, so the scan jumps from the opener to its end tag. Read as
// ordinary markup, a quote in a script's own source opens an attribute value running past the
// element's end and every opener behind it stops being a tag span. An opener the document never
// closes is not raw text, because `SafeBlocks` does not protect that one either.
export function tagSpans(text, rawText) {
  const spans = [];
  const n = text.length;
  const scanRaw = rawText !== undefined && rawText.size > 0;
  // The names this scan has already failed to find a closer for. `rawTextClose` reads forward from
  // the opener it is given and nothing else, and this walk's cursor only moves right, so a name
  // answered `-1` once is answered `-1` for every later opener. Per call and per name: nothing
  // crosses a document, and a name that does have a closer is looked up as before.
  let absentClosers;
  let i = 0;

  while (i < n) {
    if (text[i] !== '<') {
      i++;
      continue;
    }

    let j = i + 1;
    const closing = text[j] === '/';

    if (closing) {
      j++;
    }

    if (!isTagNameStart(text.codePointAt(j))) {
      i++;
      continue;
    }

    const start = i;
    const nameStart = j;
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

    if (scanRaw && !closing) {
      const name = rawTextNameAt(text, nameStart, rawText);

      if (name !== '' && !absentClosers?.has(name)) {
        const close = rawTextClose(text, i, name);

        if (close === -1) {
          (absentClosers ??= new Set()).add(name);
        } else {
          i = close;
        }
      }
    }
  }

  return spans;
}
