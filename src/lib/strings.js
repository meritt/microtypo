export function cycle(text, fn, maxIter = 100, onLimit, checkBudget) {
  let current = text;

  for (let i = 0; i < maxIter; i++) {
    checkBudget?.('cycle');

    const next = fn(current);

    if (next === current) {
      return current;
    }

    current = next;
  }

  if (typeof onLimit === 'function') {
    onLimit(maxIter);
  }

  return current;
}

// Removes only the edge lines `isBlank` accepts; leading indentation on surviving lines is preserved.
export function trimBlankLines(text, isBlank) {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length - 1;

  while (start < lines.length && isBlank(lines[start])) {
    start += 1;
  }

  while (end >= start && isBlank(lines[end])) {
    end -= 1;
  }

  return lines.slice(start, end + 1).join('\n');
}

function isWhitespaceCode(code) {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

export function edgeWhitespace(text) {
  let start = 0;

  while (start < text.length && isWhitespaceCode(text.codePointAt(start))) {
    start += 1;
  }

  let end = text.length;

  while (end > start && isWhitespaceCode(text.codePointAt(end - 1))) {
    end -= 1;
  }

  return { start, end };
}

// The `[start, end)` of the spaces and tabs that open the line of the first character with content,
// empty at that character when it has none.
export function leadingIndent(text) {
  const { start: end } = edgeWhitespace(text);
  let start = end;

  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
    start -= 1;
  }

  const opensLine = start === 0 || text[start - 1] === '\n' || text[start - 1] === '\r';

  return opensLine && end < text.length ? [start, end] : [end, end];
}

const LONE_CR_RE = /\r(?!\n)/g;

// A CR of its own ends a line too, CommonMark §2.1 and YAML §5.4, while every line walk splits at
// LF. A walk reads this copy, where each such CR is a LF: it is as long as the document, so every
// offset it yields addresses the document's own bytes, and a protected span or a value keeps the CR
// it was written with.
export function lineView(text) {
  return text.includes('\r') ? text.replace(LONE_CR_RE, '\n') : text;
}

// Whitespace inside a collection that is not line-structured — a YAML flow collection, a TOML inline
// table — where a line break separates nothing and is just another space.
export function isFlowSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

// Horizontal whitespace only: every format scanner walks past spaces and tabs without crossing a
// line break.
export function skipSpaces(text, i, limit) {
  let j = i;

  while (j < limit && (text[j] === ' ' || text[j] === '\t')) {
    j += 1;
  }

  return j;
}

export function count(haystack, needle) {
  if (!needle) {
    return 0;
  }

  let n = 0;
  let pos = 0;

  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    n++;
    pos += needle.length;
  }

  return n;
}
