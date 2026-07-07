import { MicroTypoInputError } from '../errors/index.js';

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;

function parseQuotedLiteral(src, i, n) {
  const q = src[i];
  const start = i;

  if (src[i + 1] === q && src[i + 2] === q) {
    const delim = q + q + q;
    let j = i + 3;

    while (j < n) {
      if (q === '"' && src[j] === '\\') {
        j += 2;
        continue;
      }

      if (src.startsWith(delim, j)) {
        j += 3;
        // TOML permits up to 2 extra trailing quote chars right before the true close.
        while (src[j] === q) {
          j += 1;
        }

        return { end: j, span: null };
      }

      j += 1;
    }

    throw new MicroTypoInputError(`Unterminated TOML multiline string at offset ${start}`, {
      details: { offset: start }
    });
  }

  let j = i + 1;
  let hasBackslash = false;

  while (j < n) {
    const c = src[j];

    if (c === '\n') {
      break;
    }

    if (q === '"' && c === '\\') {
      hasBackslash = true;
      j += 2;
      continue;
    }

    if (c === q) {
      return {
        end: j + 1,
        span: { start, end: j + 1, quoteChar: q, eligible: q === "'" || !hasBackslash }
      };
    }

    j += 1;
  }

  throw new MicroTypoInputError(`Unterminated TOML string literal at offset ${start}`, {
    details: { offset: start }
  });
}

function assertNoTrailingLineContent(src, pos, n) {
  let p = pos;

  while (p < n && (src[p] === ' ' || src[p] === '\t' || src[p] === '\r')) {
    p += 1;
  }

  if (p < n && src[p] !== '\n' && src[p] !== '#') {
    throw new MicroTypoInputError(`Unexpected trailing content after TOML value at offset ${p}`, {
      details: { offset: p }
    });
  }
}

function decodeQuotedKey(raw, quoteChar) {
  if (quoteChar === "'") {
    return raw;
  }

  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function readKeySegment(src, i, n) {
  const ch = src[i];

  if (ch === '"' || ch === "'") {
    const { end, span } = parseQuotedLiteral(src, i, n);

    return {
      text: span ? decodeQuotedKey(src.slice(i + 1, end - 1), ch) : src.slice(i, end),
      end,
      quotedSpan: span
    };
  }

  let j = i;

  while (j < n && BARE_KEY_CHAR.test(src[j])) {
    j += 1;
  }

  return { text: src.slice(i, j), end: j, quotedSpan: null };
}

function scanKeyPath(src, i, n) {
  const segments = [];
  const quotedSpans = [];
  let pos = i;

  while (true) {
    while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) {
      pos += 1;
    }

    const seg = readKeySegment(src, pos, n);

    // An empty BARE segment (a..b, or no key before '=') is invalid TOML; a quoted empty string ("" = "x") is legal and must not be rejected.
    if (!seg.quotedSpan && seg.text === '') {
      throw new MicroTypoInputError(`Empty TOML key segment at offset ${pos}`, {
        details: { offset: pos }
      });
    }

    segments.push(seg.text);

    if (seg.quotedSpan) {
      quotedSpans.push(seg.quotedSpan);
    }

    pos = seg.end;

    while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) {
      pos += 1;
    }

    if (src[pos] !== '.') {
      break;
    }

    pos += 1;
  }

  return { path: segments.join('.'), segments, end: pos, quotedSpans };
}

// Skip inline arrays/tables whole; strings and '#' comments are consumed atomically so a ]/}/#/quote inside one never drives structure.
function skipStructuredValue(src, i, n) {
  let depth = 0;
  let j = i;

  while (j < n) {
    const c = src[j];

    if (c === '#') {
      while (j < n && src[j] !== '\n') {
        j += 1;
      }

      continue;
    }

    if (c === '"' || c === "'") {
      j = parseQuotedLiteral(src, j, n).end;
      continue;
    }

    if (c === '[' || c === '{') {
      depth += 1;
      j += 1;
      continue;
    }

    if (c === ']' || c === '}') {
      depth -= 1;
      j += 1;

      if (depth === 0) {
        break;
      }

      continue;
    }

    j += 1;
  }

  return j;
}

export function scanToml(src) {
  const spans = [];
  const n = src.length;
  let i = 0;
  let path = '';
  let segments = [];
  let atLineStart = true;
  const aotCounts = new Map();

  while (i < n) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '\n') {
      i += 1;
      atLineStart = true;
      continue;
    }

    if (ch === '#') {
      while (i < n && src[i] !== '\n') {
        i += 1;
      }

      continue;
    }

    if (atLineStart && ch === '[') {
      const isArrayHeader = src[i + 1] === '[';
      const {
        path: headerPath,
        segments: headerSegments,
        end,
        quotedSpans
      } = scanKeyPath(src, i + (isArrayHeader ? 2 : 1), n);

      if (isArrayHeader) {
        const occurrence = aotCounts.get(headerPath) ?? 0;
        aotCounts.set(headerPath, occurrence + 1);
        path = `${headerPath}.${occurrence}`;
        segments = [...headerSegments, occurrence];
      } else {
        path = headerPath;
        segments = headerSegments;
      }

      for (const qs of quotedSpans) {
        spans.push({
          start: qs.start,
          end: qs.end,
          isKey: true,
          eligible: qs.eligible,
          path,
          segments
        });
      }

      let pos = end;

      while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) {
        pos += 1;
      }

      if (isArrayHeader) {
        if (src[pos] === ']' && src[pos + 1] === ']') {
          pos += 2;
        } else {
          throw new MicroTypoInputError(`Unterminated TOML array-of-tables header at offset ${i}`, {
            details: { offset: i }
          });
        }
      } else if (src[pos] === ']') {
        pos += 1;
      } else {
        throw new MicroTypoInputError(`Unterminated TOML table header at offset ${i}`, {
          details: { offset: i }
        });
      }

      i = pos;
      atLineStart = false;
      continue;
    }

    atLineStart = false;

    const {
      path: keyPath,
      segments: keySegments,
      end: afterKey,
      quotedSpans: keyQuoted
    } = scanKeyPath(src, i, n);
    const fullPath = path === '' ? keyPath : `${path}.${keyPath}`;
    const fullSegments = [...segments, ...keySegments];

    for (const qs of keyQuoted) {
      spans.push({
        start: qs.start,
        end: qs.end,
        isKey: true,
        eligible: qs.eligible,
        path: fullPath,
        segments: fullSegments
      });
    }

    let pos = afterKey;

    while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) {
      pos += 1;
    }

    if (src[pos] !== '=') {
      while (pos < n && src[pos] !== '\n') {
        pos += 1;
      }

      i = pos;
      continue;
    }

    pos += 1;

    while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) {
      pos += 1;
    }

    const vch = src[pos];

    if (vch === '"' || vch === "'") {
      const { end: vEnd, span } = parseQuotedLiteral(src, pos, n);

      if (span) {
        spans.push({
          start: span.start,
          end: span.end,
          isKey: false,
          eligible: span.eligible,
          path: fullPath,
          segments: fullSegments
        });
      }

      assertNoTrailingLineContent(src, vEnd, n);
      pos = vEnd;
    } else if (vch === '[' || vch === '{') {
      pos = skipStructuredValue(src, pos, n);
      assertNoTrailingLineContent(src, pos, n);
    } else {
      while (pos < n && src[pos] !== '\n' && src[pos] !== '#') {
        pos += 1;
      }
    }

    i = pos;
  }

  return spans;
}
