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

// Removes only entirely-blank edge lines; leading indentation on surviving lines is preserved.
export function trimBlankLines(text) {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length - 1;

  while (start < lines.length && lines[start].trim() === '') {
    start += 1;
  }

  while (end >= start && lines[end].trim() === '') {
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
