import { G } from '../lib/glyphs.js';
import { PARAGRAPH_CLOSE } from '../protect/placeholders.js';

// Every buf rewrite is a length-preserving in-place overwrite; substitutions must be single BMP code points.

const { LAQUO } = G;
const { RAQUO } = G;
const { BDQUO } = G;
const { LDQUO } = G;

function nextQuote(buf, off) {
  for (let i = off; i < buf.length; i++) {
    const c = buf[i];

    if (c === LAQUO || c === RAQUO) {
      return { pos: i, ch: c };
    }
  }

  return null;
}

// Assumes outer "..." pairs were already converted to «...».
export function processQuotes(text, options = {}) {
  const allowNested = options.allowNested !== false;
  const convertInches = options.convertInches !== false;
  const { checkBudget } = options;

  // Split at paragraph / double-newline boundaries so quote state can't leak across paragraphs.
  let separator;

  if (text.includes(PARAGRAPH_CLOSE)) {
    separator = PARAGRAPH_CLOSE;
  } else if (text.includes('\r\n')) {
    separator = '\r\n\r\n';
  } else {
    separator = '\n\n';
  }

  const chunks = text.split(separator);
  const out = [];

  for (const chunk of chunks) {
    out.push(processChunk(chunk, allowNested, convertInches, checkBudget));
  }

  return out.join(separator);
}

// Worst case is O(n^2) on nested-then-unmatched-close payloads; bounded by maxInputLength.
function processChunk(chunk, allowNested, convertInches, checkBudget) {
  const buf = [...chunk];
  const balancedStack = [0];
  let lastBalanced = 0;
  let level = 0;
  let off = 0;
  let iter = 0;

  while (true) {
    if (checkBudget && (iter++ & 0x3ff) === 0) {
      checkBudget('quote:processChunk');
    }

    const p = nextQuote(buf, off);

    if (p === null) {
      break;
    }

    if (p.ch === LAQUO) {
      if (level > 0 && allowNested) {
        buf[p.pos] = BDQUO;
      }

      level++;
    } else {
      level--;

      if (level > 0 && allowNested) {
        buf[p.pos] = LDQUO;
      }
    }

    off = p.pos + 1;

    if (level === 0) {
      lastBalanced = off;
      balancedStack.push(lastBalanced);
      continue;
    }

    if (level < 0 && convertInches) {
      const result = tryConvertInches(buf, off, balancedStack);

      if (result.kind === 'converted') {
        ({ off } = result);
        level = 0;
        continue;
      }

      if (result.kind === 'fallback') {
        ({ off } = result);
        level = 0;
        balancedStack.length = 0;
        balancedStack.push(off);
        continue;
      }
    }
  }

  if (level > 0) {
    for (let i = lastBalanced; i < buf.length; i++) {
      if (buf[i] === BDQUO) {
        buf[i] = LAQUO;
      } else if (buf[i] === LDQUO) {
        buf[i] = RAQUO;
      }
    }
  }

  return buf.join('');
}

function tryConvertInches(buf, off, balancedStack) {
  do {
    const candidateStart = balancedStack.pop() ?? 0;
    const hadNestedMarks = hasNestedMarks(buf, candidateStart, off);
    const quotePos = findLastInchQuote(buf, candidateStart, off, hadNestedMarks);

    if (quotePos !== -1) {
      if (hadNestedMarks) {
        restoreNestedMarks(buf, candidateStart, off);
      }

      buf[quotePos] = G.PRIME;

      if (hadNestedMarks) {
        return { kind: 'converted', off: candidateStart };
      }

      balancedStack.push(off);

      return { kind: 'converted', off };
    }
  } while (balancedStack.length);

  const fallbackPos = off - 1;
  buf[fallbackPos] = '"';

  return { kind: 'fallback', off: fallbackPos + 1 };
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function hasNestedMarks(buf, start, end) {
  for (let i = start; i < end; i++) {
    if (buf[i] === BDQUO || buf[i] === LDQUO) {
      return true;
    }
  }

  return false;
}

function findLastInchQuote(buf, start, end, includeNestedClose) {
  for (let i = end - 1; i > start; i--) {
    const ch = buf[i];

    if (ch !== RAQUO && (!includeNestedClose || ch !== LDQUO)) {
      continue;
    }

    if (!isDigit(buf[i - 1])) {
      continue;
    }

    return i;
  }

  return -1;
}

function restoreNestedMarks(buf, start, end) {
  for (let i = start; i < end; i++) {
    if (buf[i] === BDQUO) {
      buf[i] = LAQUO;
    } else if (buf[i] === LDQUO) {
      buf[i] = RAQUO;
    }
  }
}
