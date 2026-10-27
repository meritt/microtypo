const OPEN_TOKENS = new Set(['---', '+++']);

const MALFORMED = Object.freeze({ malformed: true });

// A line ends at LF, CRLF or a CR of its own, YAML §5.4 and CommonMark §2.1, so a delimiter line is
// told apart whichever of the three the document is written with.
const LINE_BREAK_RE = /\r\n?|\n/g;

// Where the line from `i` ends: its content end, and where the next line starts.
function lineAt(src, i) {
  LINE_BREAK_RE.lastIndex = i;

  const m = LINE_BREAK_RE.exec(src);

  return m === null ? [src.length, src.length] : [m.index, m.index + m[0].length];
}

// A tri-state answer: `null` where there is no opening delimiter and the caller falls back to
// Markdown, MALFORMED where an opener has no close and the caller must reject rather than reparse it
// as a body, and otherwise the split.
export function splitFrontmatter(src) {
  const n = src.length;
  const offset = src.startsWith('\u{FEFF}') ? 1 : 0;
  const [openEnd, headerStart] = lineAt(src, offset);
  const open = src.slice(offset, openEnd);

  if (!OPEN_TOKENS.has(open)) {
    return null;
  }

  if (openEnd >= n) {
    return MALFORMED;
  }

  const closeTokens = open === '+++' ? new Set(['+++']) : new Set(['---', '...']);

  let i = headerStart;

  while (i < n) {
    const [contentEnd, next] = lineAt(src, i);
    const lineContent = src.slice(i, contentEnd);

    if (closeTokens.has(lineContent)) {
      return {
        open,
        header: src.slice(headerStart, i),
        close: lineContent,
        body: src.slice(next),
        headerStart,
        bodyStart: next
      };
    }

    i = next;
  }

  return MALFORMED;
}
