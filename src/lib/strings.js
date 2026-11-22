export const WHITESPACE =
  ' \t\n\r\v\f\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}';

export function isBackslashEscaped(text, at) {
  let start = at;
  while (start > 0 && text[start - 1] === '\\') {
    start -= 1;
  }
  return (at - start) % 2 === 1;
}

export function cycle(text, fn, maxIter = 100, onLimit, checkBudget) {
  let current = text;
  checkBudget?.('cycle');

  for (let i = 0; i < maxIter; i++) {
    const next = fn(current);
    checkBudget?.('cycle');

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
  const pieces = text.split(/(\r\n?|\n)/u);
  let start = 0;
  let end = pieces.length - 1;

  while (start < pieces.length && isBlank(pieces[start])) {
    start += 2;
  }

  while (end >= start && isBlank(pieces[end])) {
    end -= 2;
  }

  return pieces.slice(start, end + 1).join('');
}

export function isWhitespaceCode(code) {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
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

// The raw `[start, end)` of the spaces and tabs opening the first content line. A wholly blank
// source is removed as one range; it has no content line whose indent needs preserving.
export function leadingIndent(text, readScalar, checkBudget) {
  let end = 0;
  let start = 0;
  let opensLine = true;
  let previous = '';
  let steps = 0;

  while (end < text.length) {
    if ((steps++ & 1023) === 0) {
      checkBudget?.('leadingIndent');
    }
    const scalar = readScalar(text, end);
    if (scalar.glyph.length !== 1 || !isWhitespaceCode(scalar.glyph.codePointAt(0))) {
      break;
    }
    const ascii = scalar.glyph === ' ' || scalar.glyph === '\t';

    if (!ascii || (previous !== ' ' && previous !== '\t')) {
      start = ascii ? end : scalar.end;
      opensLine = ascii && (end === 0 || previous === '\n' || previous === '\r');
    }

    previous = scalar.glyph;
    ({ end } = scalar);
  }

  // No content means there is no first-line indent to preserve, but the empty core still runs.
  if (end === text.length) {
    return [0, end];
  }
  return opensLine ? [start, end] : [end, end];
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
