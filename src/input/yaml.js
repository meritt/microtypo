import { MicroTypoInputError } from '../errors/index.js';

const join = (base, seg) => (base === '' ? String(seg) : `${base}.${seg}`);

function decodeQuotedKey(raw, quoteChar) {
  if (quoteChar === "'") {
    return raw.replaceAll("''", "'");
  }

  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function scanQuoted(src, i, lineEnd) {
  const q = src[i];
  let j = i + 1;
  let hasEscape = false;

  while (j < lineEnd) {
    const c = src[j];

    if (q === '"') {
      if (c === '\\') {
        hasEscape = true;
        j += 2;
        continue;
      }

      if (c === '"') {
        return { end: j + 1, eligible: !hasEscape };
      }
    } else if (c === "'") {
      if (src[j + 1] === "'") {
        hasEscape = true;
        j += 2;
        continue;
      }

      return { end: j + 1, eligible: !hasEscape };
    }

    j += 1;
  }

  return null;
}

function assertNoTrailingLineTokens(src, from, lineEnd) {
  let p = from;

  while (p < lineEnd && (src[p] === ' ' || src[p] === '\t')) {
    p += 1;
  }

  if (p < lineEnd && src[p] !== '#') {
    throw new MicroTypoInputError(`Unexpected trailing content after YAML scalar at offset ${p}`, {
      details: { offset: p }
    });
  }
}

// A quote opens a string only right after '[' '{' ',' ':' (tracked via prev), so a mid-token apostrophe like [don't, do] doesn't misfire a runaway scan past the true close.
function scanFlowCollection(src, start, n) {
  let depth = 0;
  let j = start;
  let prev = '';

  while (j < n) {
    const c = src[j];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      j += 1;
      continue;
    }

    if (
      (c === '"' || c === "'") &&
      (prev === '[' || prev === '{' || prev === ',' || prev === ':')
    ) {
      const q = scanQuoted(src, j, n);
      j = q ? q.end : n;
      prev = '"';
      continue;
    }

    if (c === '[' || c === '{') {
      depth += 1;
      j += 1;
      prev = c;
      continue;
    }

    if (c === ']' || c === '}') {
      depth -= 1;
      j += 1;
      prev = c;

      if (depth === 0) {
        return j;
      }

      continue;
    }

    prev = c === ',' || c === ':' ? c : 'x';
    j += 1;
  }

  return -1;
}

function assertFlowCollectionCloses(src, pos, n) {
  if (scanFlowCollection(src, pos, n) === -1) {
    throw new MicroTypoInputError(`Unclosed YAML flow collection at offset ${pos}`, {
      details: { offset: pos }
    });
  }
}

// ':' separates key from value only when followed by whitespace or end-of-line, so 'http://x' in a plain scalar isn't misread as a key.
function findKeyColon(src, pos, lineEnd) {
  for (let j = pos; j < lineEnd; j += 1) {
    if (src[j] === ':' && (j + 1 === lineEnd || src[j + 1] === ' ' || src[j + 1] === '\t')) {
      return j;
    }
  }

  return -1;
}

export function scanYaml(src) {
  const spans = [];
  const n = src.length;
  const stack = [{ indent: 0, path: '', seqIndex: 0, segments: [] }];
  let pendingPath = '';
  let pendingSegments = [];
  let blockScalarIndent = -1;
  let skipTo = -1;

  function checkBlockScalar(ch, indent) {
    if (ch === '|' || ch === '>') {
      blockScalarIndent = indent;
    }
  }

  function parseValueAfterColon(pos, lineEnd, path, segments, indent) {
    if (pos >= lineEnd || src[pos] === '#') {
      return false;
    }

    const ch = src[pos];

    if (ch === '"' || ch === "'") {
      const result = scanQuoted(src, pos, lineEnd);

      if (result) {
        assertNoTrailingLineTokens(src, result.end, lineEnd);
        spans.push({
          start: pos,
          end: result.end,
          isKey: false,
          eligible: result.eligible,
          path,
          segments
        });
      } else {
        skipTo = scanQuoted(src, pos, n)?.end ?? n;
      }

      return true;
    }

    if (ch === '[' || ch === '{') {
      assertFlowCollectionCloses(src, pos, n);
    }

    checkBlockScalar(ch, indent);

    // Everything else — bare/plain scalar, anchor, alias, tag, flow collection — stays byte-verbatim: the scalar-style safety rail.
    return true;
  }

  function parseKeyOrValue(pos, lineEnd, path, segments, indent) {
    const ch = src[pos];

    if (ch === '"' || ch === "'") {
      const result = scanQuoted(src, pos, lineEnd);

      if (!result) {
        skipTo = scanQuoted(src, pos, n)?.end ?? n;
        pendingPath = path;
        pendingSegments = segments;

        return false;
      }

      let cp = result.end;

      while (cp < lineEnd && (src[cp] === ' ' || src[cp] === '\t')) {
        cp += 1;
      }

      const isKeyHere =
        src[cp] === ':' && (cp + 1 === lineEnd || src[cp + 1] === ' ' || src[cp + 1] === '\t');

      if (!isKeyHere) {
        assertNoTrailingLineTokens(src, result.end, lineEnd);
        spans.push({
          start: pos,
          end: result.end,
          isKey: false,
          eligible: result.eligible,
          path,
          segments
        });

        return false;
      }

      const rawKey = src.slice(pos + 1, result.end - 1);
      const decodedKey = decodeQuotedKey(rawKey, src[pos]);
      const fullPath = join(path, decodedKey);
      const fullSegments = [...segments, decodedKey];

      spans.push({
        start: pos,
        end: result.end,
        isKey: true,
        eligible: result.eligible,
        path: fullPath,
        segments: fullSegments
      });
      pendingPath = fullPath;
      pendingSegments = fullSegments;

      let vp = cp + 1;

      while (vp < lineEnd && (src[vp] === ' ' || src[vp] === '\t')) {
        vp += 1;
      }

      return parseValueAfterColon(vp, lineEnd, fullPath, fullSegments, indent);
    }

    const colon = findKeyColon(src, pos, lineEnd);

    if (colon === -1) {
      if (ch === '[' || ch === '{') {
        assertFlowCollectionCloses(src, pos, n);
      }

      checkBlockScalar(ch, indent);
      pendingPath = path;
      pendingSegments = segments;

      return false;
    }

    const keyText = src.slice(pos, colon).trimEnd();
    const fullPath = join(path, keyText);
    const fullSegments = [...segments, keyText];
    pendingPath = fullPath;
    pendingSegments = fullSegments;

    let vp = colon + 1;

    while (vp < lineEnd && (src[vp] === ' ' || src[vp] === '\t')) {
      vp += 1;
    }

    return parseValueAfterColon(vp, lineEnd, fullPath, fullSegments, indent);
  }

  function processLine(lineStart, lineEnd, indent) {
    const p = lineStart + indent;

    if (
      (src.startsWith('---', p) || src.startsWith('...', p)) &&
      (p + 3 === lineEnd || src[p + 3] === ' ' || src[p + 3] === '\t')
    ) {
      stack.length = 1;
      stack[0] = { indent: 0, path: '', seqIndex: 0, segments: [] };
      pendingPath = '';
      pendingSegments = [];

      let vp = p + 3;

      while (vp < lineEnd && (src[vp] === ' ' || src[vp] === '\t')) {
        vp += 1;
      }

      parseValueAfterColon(vp, lineEnd, '', [], 0);

      return;
    }

    while (stack.length > 1 && stack.at(-1).indent > indent) {
      stack.pop();
    }

    if (stack.at(-1).indent < indent) {
      stack.push({ indent, path: pendingPath, seqIndex: 0, segments: pendingSegments });
    }

    const frame = stack.at(-1);

    if (src[p] === '-' && (p + 1 === lineEnd || src[p + 1] === ' ' || src[p + 1] === '\t')) {
      let vp = p + 1;

      while (vp < lineEnd && (src[vp] === ' ' || src[vp] === '\t')) {
        vp += 1;
      }

      const itemPath = join(frame.path, frame.seqIndex);
      const itemSegments = [...frame.segments, frame.seqIndex];
      frame.seqIndex += 1;

      if (vp >= lineEnd) {
        pendingPath = itemPath;
        pendingSegments = itemSegments;

        return;
      }

      if (parseKeyOrValue(vp, lineEnd, itemPath, itemSegments, indent)) {
        pendingPath = itemPath;
        pendingSegments = itemSegments;
      }

      return;
    }

    parseKeyOrValue(p, lineEnd, frame.path, frame.segments, indent);
  }

  let i = 0;

  while (i < n) {
    let lineEnd = src.indexOf('\n', i);

    if (lineEnd === -1) {
      lineEnd = n;
    }

    let end = lineEnd;

    if (end > i && src[end - 1] === '\r') {
      end -= 1;
    }

    let p = i;

    while (p < end && (src[p] === ' ' || src[p] === '\t')) {
      p += 1;
    }

    const indent = p - i;
    const blank = p === end;

    if (blockScalarIndent !== -1) {
      if (blank || indent > blockScalarIndent) {
        i = lineEnd < n ? lineEnd + 1 : lineEnd;
        continue;
      }

      blockScalarIndent = -1;
    }

    if (!blank && src[p] !== '#') {
      processLine(i, end, indent);
    }

    if (skipTo !== -1) {
      i = skipTo;
      skipTo = -1;
      continue;
    }

    i = lineEnd < n ? lineEnd + 1 : lineEnd;
  }

  return spans;
}
