import { MicroTypoInputError } from '../errors/index.js';
import { chainAppend, LocatedSpan } from './span-path.js';

const chainOf = (frame) =>
  frame ? chainAppend(frame.base, frame.type === 'object' ? frame.key : frame.index) : null;

export function scanJson(src, checkBudget) {
  const spans = [];
  const stack = [];
  const n = src.length;
  let i = 0;
  let steps = 0;

  while (i < n) {
    if ((steps++ & 0x3fff) === 0) {
      checkBudget?.('json-scan');
    }

    const ch = src[i];

    if (ch === '"') {
      const start = i;
      i += 1;
      let closed = false;
      let hasEscape = false;

      while (i < n) {
        const c = src[i];

        if (c === '\\') {
          hasEscape = true;
          i += 2; // safe for \uXXXX too: the hex digits are inert
          continue;
        }

        if (c === '"') {
          i += 1;
          closed = true;
          break;
        }

        i += 1;
      }

      if (!closed) {
        throw new MicroTypoInputError(`Unterminated JSON string literal at offset ${start}`, {
          details: { offset: start }
        });
      }

      const end = i;
      const frame = stack.at(-1);

      if (!frame) {
        spans.push(new LocatedSpan(start, end, false, null));
      } else if (frame.expect === 'key') {
        // A key names its container, so it stops short of its own position.
        spans.push(new LocatedSpan(start, end, true, frame.base));

        if (hasEscape) {
          try {
            frame.key = JSON.parse(src.slice(start, end));
          } catch (error) {
            throw new MicroTypoInputError(`Malformed JSON object key: ${error.message}`, {
              details: { start, end }
            });
          }
        } else {
          // Nothing to decode, and every key is decoded whether or not a path is ever read: the walk
          // above already knows there was no backslash, so the interior is the key.
          frame.key = src.slice(start + 1, end - 1);
        }
      } else {
        spans.push(new LocatedSpan(start, end, false, chainOf(frame)));
      }

      continue;
    }

    if (ch === '{') {
      stack.push({ type: 'object', key: null, expect: 'key', base: chainOf(stack.at(-1)) });
      i += 1;
      continue;
    }

    if (ch === '[') {
      stack.push({ type: 'array', index: 0, base: chainOf(stack.at(-1)) });
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      const wantType = ch === '}' ? 'object' : 'array';
      const frame = stack.pop();

      if (!frame || frame.type !== wantType) {
        throw new MicroTypoInputError(`Unbalanced JSON structure at offset ${i}`, {
          details: { offset: i }
        });
      }

      i += 1;
      continue;
    }

    if (ch === ':') {
      const frame = stack.at(-1);

      if (frame && frame.type === 'object') {
        frame.expect = 'value';
      }

      i += 1;
      continue;
    }

    if (ch === ',') {
      const frame = stack.at(-1);

      if (frame && frame.type === 'object') {
        frame.expect = 'key';
        frame.key = null;
      } else if (frame) {
        frame.index += 1;
      }

      i += 1;
      continue;
    }

    i += 1;
  }

  if (stack.length > 0) {
    throw new MicroTypoInputError('Unbalanced JSON structure: unclosed object or array', {
      details: { depth: stack.length }
    });
  }

  return spans;
}

function lastPathSegment(path) {
  const dot = path.lastIndexOf('.');

  return dot === -1 ? path : path.slice(dot + 1);
}

// `dotted` says which spelling of a span's tail this selector compares against: the last piece of
// the dot-joined path, or the last real structural segment. They part exactly where a key carries a
// literal dot, and the bucket index below has to key spans by the same one — an index keyed by the
// other spelling hides matches the plain list finds.
function compileSelector(raw) {
  if (raw.startsWith('/')) {
    const wanted = Object.freeze(
      raw
        .slice(1)
        .split('/')
        .map((seg) => seg.replaceAll('~1', '/').replaceAll('~0', '~'))
    );

    return Object.freeze({
      raw,
      kind: 'pointer',
      dotted: false,
      size: wanted.length,
      tail: wanted.at(-1),
      test: (segments) =>
        segments.length === wanted.length &&
        wanted.every((seg, i) => seg === '*' || seg === String(segments[i]))
    });
  }

  if (!raw.includes('.')) {
    return Object.freeze({
      raw,
      kind: 'bare',
      dotted: true,
      tail: raw,
      test: (path) => lastPathSegment(path) === raw
    });
  }

  const wanted = Object.freeze(raw.split('.'));

  return Object.freeze({
    raw,
    kind: 'glob',
    dotted: true,
    size: wanted.length,
    tail: wanted.at(-1),
    test: (segments) =>
      segments.length === wanted.length &&
      wanted.every((seg, i) => seg === '*' || seg === segments[i])
  });
}

export function compileSpanSelectors({ fields, exclude } = {}) {
  const selectors = {};

  if (fields) {
    selectors.fields = compileSelectorBucket(fields);
  }

  if (exclude) {
    selectors.exclude = compileSelectorBucket(exclude);
  }

  return Object.freeze(selectors);
}

function compileSelectorBucket(raws) {
  const list = Object.freeze(raws.map(compileSelector));

  if (list.length <= 8) {
    return list;
  }

  const byDottedTail = new Map();
  const bySegmentTail = new Map();
  const star = [];

  for (const selector of list) {
    if (selector.tail === '*') {
      star.push(selector);
      continue;
    }

    const index = selector.dotted ? byDottedTail : bySegmentTail;
    const group = index.get(selector.tail);

    if (group) {
      group.push(selector);
    } else {
      index.set(selector.tail, [selector]);
    }
  }

  for (const index of [byDottedTail, bySegmentTail]) {
    for (const [tail, group] of index) {
      index.set(tail, Object.freeze(group));
    }
  }

  return Object.freeze({
    list,
    byDottedTail,
    bySegmentTail,
    star: Object.freeze(star)
  });
}

// Each kind is handed only the spelling of the span its own test reads: a pointer reads the real
// segments and nothing else, so passing the dot-joined path beside them builds a string per span for
// a predicate that never looks at it.
function pathMatches(span, selector, dottedSegments) {
  if (selector.kind === 'bare') {
    return selector.test(span.path);
  }

  // A structural tail that cannot match makes the whole pointer impossible, and the chain answers
  // that from its own head, before the segment array is built — where a run of k nested values would
  // materialize k(k+1)/2 positions to reject every one of them.
  if (selector.kind === 'pointer' && selector.tail !== '*' && span.tail !== selector.tail) {
    return false;
  }

  const segments = selector.kind === 'glob' ? dottedSegments : span.segments;

  if (segments.length !== selector.size) {
    return false;
  }

  if (selector.tail !== '*' && String(segments.at(-1) ?? '') !== selector.tail) {
    return false;
  }

  return selector.test(segments);
}

function listMatches(span, selectors) {
  let dottedSegments;

  for (const selector of selectors) {
    if (selector.kind === 'glob') {
      dottedSegments ??= span.path.split('.');
    }

    if (pathMatches(span, selector, dottedSegments)) {
      return true;
    }
  }

  return false;
}

function indexMatches(span, index, tail) {
  const group = index.get(tail);

  return group !== undefined && listMatches(span, group);
}

// Each index is asked with the tail its own selectors compare against, and only when it holds any:
// materializing the dot-joined path is what the index is there to avoid.
function anyMatches(span, selectors) {
  if (Array.isArray(selectors)) {
    return listMatches(span, selectors);
  }

  const { byDottedTail, bySegmentTail, star } = selectors;

  if (byDottedTail.size > 0 && indexMatches(span, byDottedTail, lastPathSegment(span.path))) {
    return true;
  }

  if (bySegmentTail.size > 0 && indexMatches(span, bySegmentTail, span.tail)) {
    return true;
  }

  return star.length > 0 && listMatches(span, star);
}

function firstSelector(selectors) {
  return Array.isArray(selectors) ? selectors[0] : selectors?.list?.[0];
}

function isCompiled(selectors) {
  const first = firstSelector(selectors.fields) ?? firstSelector(selectors.exclude);

  return typeof first?.test === 'function';
}

export function selectValueSpans(spans, selectors = {}) {
  const compiled = isCompiled(selectors) ? selectors : compileSpanSelectors(selectors);
  const { fields, exclude } = compiled;
  let selected = spans.filter((span) => !span.isKey);

  if (fields) {
    selected = selected.filter((span) => anyMatches(span, fields));
  }

  if (exclude) {
    selected = selected.filter((span) => !anyMatches(span, exclude));
  }

  return selected;
}
