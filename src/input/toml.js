import { MicroTypoInputError } from '../errors/index.js';
import { decodeEscapes } from '../lib/escape-decoder.js';
import { isFlowSpace, skipSpaces } from '../lib/strings.js';
import { chainAppend, LocatedSpan } from './span-path.js';

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;

function parseQuotedLiteral(src, i, n) {
  const q = src[i];
  const start = i;

  if (src[i + 1] === q && src[i + 2] === q) {
    const delim = q + q + q;
    let j = i + 3;
    let hasBackslash = false;

    while (j < n) {
      if (q === '"' && src[j] === '\\') {
        hasBackslash = true;
        j += 2;
        continue;
      }

      if (src.startsWith(delim, j)) {
        j += 3;
        // TOML permits up to 2 extra trailing quote chars right before the true close.
        while (src[j] === q) {
          j += 1;
        }

        // The eligibility rule is the single-line one: a literal has no escapes at all, and a basic
        // string without a backslash has none either, so the interior is exactly what it says. The
        // splice refuses any result that would contain the three-character delimiter.
        return {
          start,
          end: j,
          delim,
          multiline: true,
          eligible: q === "'" || !hasBackslash
        };
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
        start,
        end: j + 1,
        delim: q,
        multiline: false,
        eligible: q === "'" || !hasBackslash
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

// TOML's basic-string escapes. Three of them — `\U` for a codepoint past the BMP, `\x`, `\e` — JSON
// does not have, so `JSON.parse` throws on a key that carries one.
const TOML_ESCAPE = Object.freeze({
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  e: '',
  '"': '"',
  '\\': '\\'
});

const TOML_HEX = Object.freeze({ x: 2, u: 4, U: 8 });

function decodeQuotedKey(raw, quoteChar) {
  return quoteChar === "'" ? raw : decodeEscapes(raw, TOML_ESCAPE, TOML_HEX);
}

// A header names a path through the tables already open, and a leading segment that names an array
// of tables means that array's current element: resolved against the document root, `[posts.meta]`
// under `[[posts]]` would address `posts.meta`, which no pointer to this document can name.
// TOML §3.3.
//
// The counters live in a tree, one node per segment, so a header of k segments costs k lookups and
// nothing more, where one accumulated key carrying every ancestor and its index would build k
// strings of growing length. A node's children are dropped when its own index advances: that is what
// makes a new parent element start the arrays nested under it over, and why no ancestor index has to
// appear in a key.
function resolveHeader(segments, isArrayHeader, root) {
  let chain = null;
  let node = root;

  for (let k = 0; k < segments.length; k += 1) {
    chain = chainAppend(chain, segments[k]);

    let entry = node.get(segments[k]);

    if (entry === undefined) {
      entry = { index: -1, children: new Map() };
      node.set(segments[k], entry);
    }

    if (isArrayHeader && k === segments.length - 1) {
      entry.index += 1;
      entry.children = new Map();

      return chainAppend(chain, entry.index);
    }

    if (entry.index !== -1) {
      chain = chainAppend(chain, entry.index);
    }

    node = entry.children;
  }

  return chain;
}

function readKeySegment(src, i, n) {
  const ch = src[i];

  if (ch === '"' || ch === "'") {
    const span = parseQuotedLiteral(src, i, n);
    const { end } = span;

    // A key is never multi-line in TOML, so a triple delimiter here is malformed input: it is taken
    // verbatim as the segment text and reports no span.
    if (span.multiline) {
      return { text: src.slice(i, end), end, quotedSpan: null };
    }

    return {
      text: decodeQuotedKey(src.slice(i + 1, end - 1), ch),
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
    pos = skipSpaces(src, pos, n);

    const seg = readKeySegment(src, pos, n);

    // An empty bare segment — `a..b`, or no key before `=` — is invalid TOML, while a quoted empty
    // string (`"" = "x"`) is legal and must not be rejected.
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

    pos = skipSpaces(src, pos, n);

    if (src[pos] !== '.') {
      break;
    }

    pos += 1;
  }

  return { segments, end: pos, quotedSpans };
}

// A table frame still waiting for its key names its own base: malformed TOML puts a value where the
// key belongs, and a scanner that looks for spans reports no span there rather than crashing.
const elementChain = (frame) =>
  frame.type === 'array'
    ? chainAppend(frame.base, frame.index)
    : chainAppend(frame.base, ...(frame.keySegments ?? []));

// Walk inline arrays/tables for their string values; comments and strings are consumed atomically so
// a ]/}/#/quote inside one never drives structure. Protect-or-reject: a recognized opener that never
// closes is rejected, not silently swallowed together with every value after it.
function scanInlineCollection(src, i, n, base, spans, checkBudget) {
  const stack = [];
  let j = i;
  let steps = 0;

  while (j < n) {
    if ((steps++ & 0x3fff) === 0) {
      checkBudget?.('toml-inline-scan');
    }

    const c = src[j];

    if (c === '#') {
      while (j < n && src[j] !== '\n') {
        j += 1;
      }

      continue;
    }

    if (isFlowSpace(c)) {
      j += 1;
      continue;
    }

    const frame = stack.at(-1);

    if (c === '[' || c === '{') {
      stack.push({
        type: c === '[' ? 'array' : 'table',
        index: 0,
        keySegments: null,
        base: frame ? elementChain(frame) : base
      });
      j += 1;
      continue;
    }

    if (c === ']' || c === '}') {
      // The closer has to be the one this frame opened. Popping on either of them accepted
      // `a = [ 1 }` and typeset the values inside it, while `a = [ 1` — the same malformation, spelled
      // the other way — was rejected. Protect-or-reject admits only one answer for both.
      if (frame.type !== (c === ']' ? 'array' : 'table')) {
        throw new MicroTypoInputError(
          `Mismatched TOML inline collection closer '${c}' at offset ${j}`,
          { details: { offset: j } }
        );
      }

      stack.pop();
      j += 1;

      if (stack.length === 0) {
        return j;
      }

      continue;
    }

    if (c === ',') {
      if (frame.type === 'array') {
        frame.index += 1;
      } else {
        frame.keySegments = null;
      }

      j += 1;
      continue;
    }

    if (frame.type === 'table' && frame.keySegments === null) {
      const key = scanKeyPath(src, j, n);
      frame.keySegments = key.segments;

      for (const qs of key.quotedSpans) {
        spans.push(new LocatedSpan(qs.start, qs.end, true, elementChain(frame), qs.eligible));
      }

      j = key.end;
      continue;
    }

    if (c === '"' || c === "'") {
      const span = parseQuotedLiteral(src, j, n);
      const { end } = span;

      spans.push(
        new LocatedSpan(span.start, span.end, false, elementChain(frame), span.eligible, span.delim)
      );

      j = end;
      continue;
    }

    j += 1;
  }

  throw new MicroTypoInputError(`Unterminated TOML inline collection at offset ${i}`, {
    details: { offset: i }
  });
}

export function scanToml(src, checkBudget) {
  const spans = [];
  const n = src.length;
  let i = 0;
  let tableChain = null;
  let atLineStart = true;
  let steps = 0;
  const aotTree = new Map();

  while (i < n) {
    if ((steps++ & 0x3fff) === 0) {
      checkBudget?.('toml-scan');
    }

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
        segments: headerSegments,
        end,
        quotedSpans
      } = scanKeyPath(src, i + (isArrayHeader ? 2 : 1), n);

      tableChain = resolveHeader(headerSegments, isArrayHeader, aotTree);

      for (const qs of quotedSpans) {
        spans.push(new LocatedSpan(qs.start, qs.end, true, tableChain, qs.eligible));
      }

      let pos = skipSpaces(src, end, n);

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

    const { segments: keySegments, end: afterKey, quotedSpans: keyQuoted } = scanKeyPath(src, i, n);
    const fullChain = chainAppend(tableChain, ...keySegments);

    for (const qs of keyQuoted) {
      spans.push(new LocatedSpan(qs.start, qs.end, true, fullChain, qs.eligible));
    }

    let pos = skipSpaces(src, afterKey, n);

    if (src[pos] !== '=') {
      while (pos < n && src[pos] !== '\n') {
        pos += 1;
      }

      i = pos;
      continue;
    }

    pos += 1;

    pos = skipSpaces(src, pos, n);

    const vch = src[pos];

    if (vch === '"' || vch === "'") {
      const span = parseQuotedLiteral(src, pos, n);

      spans.push(
        new LocatedSpan(span.start, span.end, false, fullChain, span.eligible, span.delim)
      );

      assertNoTrailingLineContent(src, span.end, n);
      pos = span.end;
    } else if (vch === '[' || vch === '{') {
      pos = scanInlineCollection(src, pos, n, fullChain, spans, checkBudget);
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
