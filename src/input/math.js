import { readScalarAt } from '../clear-special.js';
import { CHARACTER_REFERENCE_HEAD } from '../lib/character-reference.js';
import { isWhitespaceCode } from '../lib/strings.js';
import { quotedAttributeSpans, tagSpans } from '../protect/tag-spans.js';

const digit = (value) => value >= '0' && value <= '9';
const SLASH_KIND = { '(': 2, ')': 2, '[': 3, ']': 3 };
const REFERENCE_BEFORE_RE = new RegExp(`${CHARACTER_REFERENCE_HEAD};$`, 'u');
// The longest reference a space is spelled with, `&#x000000A0;` and the like, with room to spare.
const REFERENCE_REACH = 40;

// A space spelled as a reference, `$&nbsp;2`, keeps a `$` from delimiting a formula as the space
// itself does: the engine's output reads the same with `entities` on as with it off.
function spaceAt(text, at) {
  if (isWhitespaceCode(text.codePointAt(at))) {
    return true;
  }
  if (text[at] !== '&') {
    return false;
  }
  const { glyph, end } = readScalarAt(text, at);
  return end > at + 1 && isWhitespaceCode(glyph.codePointAt(0));
}

function spaceBefore(text, at) {
  if (isWhitespaceCode(text.codePointAt(at - 1))) {
    return true;
  }
  const reference =
    text[at - 1] === ';'
      ? REFERENCE_BEFORE_RE.exec(text.slice(Math.max(0, at - REFERENCE_REACH), at))
      : null;
  return reference !== null && spaceAt(reference[0], 0);
}

// A `$` bound to the amount before it by a no-break space is the currency sign `abbr.currency`
// writes, `5 $.`, and opens no formula on the next pass over that output.
function boundCurrency(text, at) {
  let before = at - 1;
  if (text[before] === ';') {
    const reference = REFERENCE_BEFORE_RE.exec(text.slice(Math.max(0, at - REFERENCE_REACH), at));
    if (reference === null || readScalarAt(reference[0], 0).glyph !== '\u{00A0}') {
      return false;
    }
    before -= reference[0].length;
  } else if (text[before] === '\u{00A0}') {
    before -= 1;
  } else {
    return false;
  }
  return digit(text[before]);
}

// The `$` of a positional printf argument, `%1$s`, delimits no formula: in TeX `%` opens a comment.
function printfPosition(text, at) {
  let i = at - 1;
  while (i >= 0 && digit(text[i])) {
    i -= 1;
  }
  return i < at - 1 && text[i] === '%';
}

export function scanMath(text, checkBudget) {
  const tokens = [];
  const tags = text.includes('<') ? tagSpans(text) : [];
  const quoted = quotedAttributeSpans(text, tags, checkBudget);
  let inputQuote = 0;
  let line = 0;

  for (let i = 0; i < text.length; i += 1) {
    if ((i & 1023) === 0) {
      checkBudget?.('markdown-math');
    }
    const char = text[i];
    if (char === '\r' || char === '\n') {
      line += 1;
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      continue;
    }
    while (inputQuote < quoted.length && quoted[inputQuote][1] <= i) {
      inputQuote += 1;
    }
    if (inputQuote < quoted.length && quoted[inputQuote][0] <= i) {
      continue;
    }
    if (char === '\\') {
      const next = text[i + 1];
      const kind = SLASH_KIND[next] ?? -1;
      if (kind !== -1) {
        tokens.push({
          at: i,
          width: 2,
          kind,
          line,
          open: next === '(' || next === '[',
          close: next === ')' || next === ']',
          end: null
        });
      }
      if (next !== '\n' && next !== '\r') {
        i += 1;
      }
      continue;
    }
    if (char !== '$') {
      continue;
    }
    let end = i + 1;
    while (text[end] === '$') {
      if ((end & 1023) === 0) {
        checkBudget?.('markdown-math');
      }
      end += 1;
    }
    const width = end - i;
    if (width === 2 || (width === 1 && !printfPosition(text, i))) {
      tokens.push({
        at: i,
        width,
        kind: width - 1,
        line,
        open: width === 2 || (end < text.length && !spaceAt(text, end) && !boundCurrency(text, i)),
        close: width === 2 || (i > 0 && !spaceBefore(text, i) && !digit(text[end])),
        end: null
      });
    }
    i = end - 1;
  }

  const next = [null, null, null, null];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if ((i & 1023) === 0) {
      checkBudget?.('markdown-math');
    }
    const token = tokens[i];
    const closer = next[token.kind];
    if (
      token.open &&
      closer !== null &&
      closer.at > token.at + token.width &&
      ((token.kind !== 0 && token.kind !== 2) || closer.line === token.line)
    ) {
      token.end = closer.at + closer.width;
    }
    if (token.close) {
      next[token.kind] = token;
    }
  }

  const spans = [];
  let cursor = 0;
  let tag = 0;
  for (const token of tokens) {
    while (tag < tags.length && (tags[tag][1] < token.at || tags[tag][0] < cursor)) {
      tag += 1;
    }
    if (tag < tags.length && tags[tag][0] < token.at && token.at <= tags[tag][1]) {
      continue;
    }
    if (token.at >= cursor && token.end !== null) {
      spans.push([token.at, token.end]);
      cursor = token.end;
    }
  }
  return spans;
}
