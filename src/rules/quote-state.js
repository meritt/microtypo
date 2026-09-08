import { G } from '../lib/glyphs.js';
import { PARAGRAPH_CLOSE } from '../protect/placeholders.js';

// Every `buf` rewrite is a length-preserving in-place overwrite, so a substitution has to be a
// single BMP code point.

const { LAQUO } = G;
const { RAQUO } = G;
const { BDQUO } = G;
const { LDQUO } = G;

// What separates a quote from its content, as against what is content. A non-breaking space is the
// second: the author wrote it inside the quotation, so a quote in front of one has its word right
// there.
export const SEPARATOR = ' \\t\\r\\n';
const SEPARATOR_RE = new RegExp(`[${SEPARATOR}]`, 'u');

// What may stand immediately before a quote that opens a quotation, as one character-class fragment.
// The straight-quote patterns in `quote.js` and the walk below decide the same thing about the same
// position, so they read one set.
export const OPEN_LEFT = `\\s([${G.LAQUO}${G.MDASH}${G.NDASH}>-`;
const OPEN_LEFT_RE = new RegExp(`[${OPEN_LEFT}]`, 'u');

// Quote state does not cross a paragraph. The state machine below splits on this boundary before it
// reads a single quote, and the role assignment in `quote.js` decides the same question one pass
// earlier — so both ask here where a paragraph ends, or the two disagree about which quotations are
// open and the earlier pass hands the later one roles it cannot honour.
export function paragraphSeparator(text) {
  if (text.includes(PARAGRAPH_CLOSE)) {
    return PARAGRAPH_CLOSE;
  }

  return text.includes('\r\n') ? '\r\n\r\n' : '\n\n';
}

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
  // Every rewrite below is triggered by an angle quote, so text without one comes back unchanged —
  // and the split plus the code-point array are the whole cost on a short data value.
  if (!text.includes(LAQUO) && !text.includes(RAQUO)) {
    return text;
  }

  const allowNested = options.allowNested !== false;
  const convertInches = options.convertInches !== false;
  const { checkBudget } = options;

  const separator = paragraphSeparator(text);
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

    if (level < 0 && opensHere(buf, p.pos)) {
      buf[p.pos] = LAQUO;
      level = 1;
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
    restoreNestedMarks(buf, lastBalanced, buf.length);
  }

  return buf.join('');
}

// A closing quote where no quotation stands open, with a boundary in front of it and a word behind,
// is an opening one written the wrong way round: no rule of this engine puts a closer there, and read
// as one it has no pair. A measurement never reaches here — its quote follows a digit.
function opensHere(buf, at) {
  if (at > 0 && !OPEN_LEFT_RE.test(buf[at - 1])) {
    return false;
  }

  let i = at + 1;

  while (buf[i] === ' ' || buf[i] === '\t') {
    i += 1;
  }

  return i < buf.length && !SEPARATOR_RE.test(buf[i]);
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

// What makes a straight quote a measurement rather than a delimiter. The role assignment in
// `quote.js` asks the same question before this state machine runs, and the two have to agree: a
// mark counted as a closer there is one this pass will turn into a prime.
export function isDigit(ch) {
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
