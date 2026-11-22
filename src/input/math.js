import { quotedAttributeSpans, tagSpans } from '../protect/tag-spans.js';

const whitespace = (value) => value !== undefined && /\s/u.test(value);
const digit = (value) => value >= '0' && value <= '9';
const SLASH_KIND = { '(': 2, ')': 2, '[': 3, ']': 3 };

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
    if (width <= 2) {
      tokens.push({
        at: i,
        width,
        kind: width - 1,
        line,
        open: width === 2 || (end < text.length && !whitespace(text[end])),
        close: width === 2 || (i > 0 && !whitespace(text[i - 1]) && !digit(text[end])),
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
