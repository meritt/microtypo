const OPEN_TOKENS = new Set(['---', '+++']);

const MALFORMED = Object.freeze({ malformed: true });

// Tri-state return: null = no opening delimiter (caller falls back to Markdown); MALFORMED = opener found but no close (caller must reject, never reparse as a body); else the split.
export function splitFrontmatter(src) {
  const n = src.length;
  const offset = src.startsWith('\u{FEFF}') ? 1 : 0;

  let firstLineEnd = src.indexOf('\n', offset);
  if (firstLineEnd === -1) {
    firstLineEnd = n;
  }

  let firstContentEnd = firstLineEnd;
  if (firstContentEnd > offset && src[firstContentEnd - 1] === '\r') {
    firstContentEnd -= 1;
  }

  const open = src.slice(offset, firstContentEnd);
  if (!OPEN_TOKENS.has(open)) {
    return null;
  }

  if (firstLineEnd >= n) {
    return MALFORMED;
  }

  const headerStart = firstLineEnd + 1;
  const closeTokens = open === '+++' ? new Set(['+++']) : new Set(['---', '...']);

  let i = headerStart;

  while (i <= n) {
    let lineEnd = src.indexOf('\n', i);
    if (lineEnd === -1) {
      lineEnd = n;
    }

    let contentEnd = lineEnd;
    if (contentEnd > i && src[contentEnd - 1] === '\r') {
      contentEnd -= 1;
    }

    const lineContent = src.slice(i, contentEnd);

    if (closeTokens.has(lineContent)) {
      const bodyStart = lineEnd < n ? lineEnd + 1 : lineEnd;

      return {
        open,
        header: src.slice(headerStart, i),
        close: lineContent,
        body: src.slice(bodyStart),
        headerStart,
        bodyStart
      };
    }

    if (lineEnd >= n) {
      break;
    }

    i = lineEnd + 1;
  }

  return MALFORMED;
}
