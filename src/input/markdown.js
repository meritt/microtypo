import { MicroTypoInputError } from '../errors/index.js';

// Per-attempt scan bound: keeps total link-destination scanning O(n) on many never-closing "](" starts; an overrun destination fails closed.
const MAX_LINK_SCAN = 8192;

// Distinguishes a cap-bounded scan (fail closed) from a genuine no-close-before-EOF (literal prose is correct).
const OVERLIMIT = Symbol('md-link-overlimit');

const FENCE_CHAR = { '`': true, '~': true };

// A backtick fence forbids a backtick in the rest of the opening line (info string); tilde fences don't.
function fenceOpenAt(text, pos, lineEnd) {
  let i = pos;
  let indent = 0;

  while (indent < 3 && text[i] === ' ') {
    i += 1;
    indent += 1;
  }

  const char = text[i];

  if (!FENCE_CHAR[char]) {
    return null;
  }

  let j = i;

  while (text[j] === char) {
    j += 1;
  }

  const len = j - i;

  if (len < 3) {
    return null;
  }

  if (char === '`' && text.slice(j, lineEnd).includes('`')) {
    return null;
  }

  return { char, len };
}

function fenceCloseAt(text, pos, char, minLen) {
  let i = pos;
  let indent = 0;

  while (indent < 3 && text[i] === ' ') {
    i += 1;
    indent += 1;
  }

  let j = i;

  while (text[j] === char) {
    j += 1;
  }

  if (j - i < minLen) {
    return -1;
  }

  while (text[j] === ' ' || text[j] === '\t') {
    j += 1;
  }

  return text[j] === undefined || text[j] === '\n' ? j : -1;
}

export function scanFences(text) {
  const n = text.length;
  const spans = [];
  let i = 0;

  while (i < n) {
    let lineEnd = text.indexOf('\n', i);

    if (lineEnd === -1) {
      lineEnd = n;
    }

    const open = fenceOpenAt(text, i, lineEnd);

    if (!open) {
      i = lineEnd < n ? lineEnd + 1 : n;
      continue;
    }

    const start = i;
    let cursor = lineEnd < n ? lineEnd + 1 : n;
    let end = n;

    while (cursor < n) {
      const closeEnd = fenceCloseAt(text, cursor, open.char, open.len);

      if (closeEnd !== -1) {
        end = closeEnd;
        break;
      }

      const nl = text.indexOf('\n', cursor);
      cursor = nl === -1 ? n : nl + 1;
    }

    spans.push([start, end]);
    i = end;
  }

  return spans;
}

function scanBareDestination(text, i, limit, capped) {
  let depth = 0;
  let j = i;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === '(') {
      depth += 1;
      j += 1;
      continue;
    }

    if (c === ')') {
      if (depth === 0) {
        return { end: j + 1, closed: true };
      }

      depth -= 1;
      j += 1;
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\n') {
      return depth === 0 ? { end: j, closed: false } : null;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : null;
}

function scanAngleDestination(text, i, limit, capped) {
  let j = i + 1;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === '>') {
      return { end: j + 1, closed: false };
    }

    if (c === '\n') {
      return null;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : null;
}

function scanTitle(text, i, limit, capped) {
  const open = text[i];
  const close = open === '(' ? ')' : open;
  let j = i + 1;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === close) {
      return j + 1;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : -1;
}

function scanLinkTail(text, i, n) {
  const limit = Math.min(n, i + MAX_LINK_SCAN);
  const capped = limit < n;
  let j = i;

  while (j < limit && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) {
    j += 1;
  }

  const dest =
    text[j] === '<'
      ? scanAngleDestination(text, j, limit, capped)
      : scanBareDestination(text, j, limit, capped);

  if (dest === OVERLIMIT) {
    return OVERLIMIT;
  }

  if (!dest) {
    return -1;
  }

  if (dest.closed) {
    return dest.end;
  }

  j = dest.end;

  while (j < limit && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) {
    j += 1;
  }

  if (text[j] === '"' || text[j] === "'" || text[j] === '(') {
    const titleEnd = scanTitle(text, j, limit, capped);

    if (titleEnd === OVERLIMIT) {
      return OVERLIMIT;
    }

    if (titleEnd === -1) {
      return -1;
    }

    j = titleEnd;

    while (j < limit && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) {
      j += 1;
    }
  }

  return text[j] === ')' ? j + 1 : -1;
}

// Spans cover only the interior between `](` and `)`, never the delimiters, so downstream rules still see them as literal text.
export function scanLinkDestinations(text, checkBudget) {
  const n = text.length;
  const spans = [];
  // lastClose precomputed once: no ')' at/after a destination start means this '](' can never close (literal, not fail-open), and avoids a per-attempt rescan.
  const lastClose = text.lastIndexOf(')');
  let i = 0;
  // Threshold, not an i-bitmask: a match jumps i by a whole destination, so a fixed mask could stride past every budget check.
  let nextCheck = 0;

  while (i < n - 1) {
    if (i >= nextCheck) {
      checkBudget?.('md-link-scan');
      nextCheck = i + 0x4000;
    }

    if (text[i] !== ']' || text[i + 1] !== '(') {
      i += 1;
      continue;
    }

    const end = scanLinkTail(text, i + 2, n);

    if (end === OVERLIMIT) {
      // Once no ')' remains at/after this start, none will for any later '(' either: return now instead of rescanning, keeping this O(n).
      if (lastClose < i + 2) {
        return spans;
      }

      throw new MicroTypoInputError(
        `Markdown link destination/title exceeds the ${MAX_LINK_SCAN}-char scan bound at offset ${i}`,
        { details: { offset: i, max: MAX_LINK_SCAN, reason: 'link-overlimit' } }
      );
    }

    if (end === -1) {
      i += 1;
      continue;
    }

    spans.push([i + 2, end - 1]);
    i = end;
  }

  return spans;
}
