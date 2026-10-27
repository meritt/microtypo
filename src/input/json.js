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
      dotted: false,
      tail: wanted.at(-1),
      test: (span) => span.segmentsMatch(wanted)
    });
  }

  if (!raw.includes('.')) {
    return Object.freeze({
      raw,
      dotted: true,
      tail: raw,
      test: (span) => span.dottedTail === raw
    });
  }

  const wanted = Object.freeze(raw.split('.'));

  return Object.freeze({
    raw,
    dotted: true,
    tail: wanted.at(-1),
    test: (span) => span.dottedMatch(wanted)
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

function listMatches(span, selectors) {
  return selectors.some((selector) => selector.test(span));
}

function indexMatches(span, index, tail) {
  const group = index.get(tail);

  return group !== undefined && listMatches(span, group);
}

// Each index is asked with the tail its own selectors compare against, and only when it holds any.
function anyMatches(span, selectors) {
  if (Array.isArray(selectors)) {
    return listMatches(span, selectors);
  }

  const { byDottedTail, bySegmentTail, star } = selectors;

  if (byDottedTail.size > 0 && indexMatches(span, byDottedTail, span.dottedTail)) {
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

export function selectValueSpans(spans, selectors = {}, checkBudget) {
  const compiled = isCompiled(selectors) ? selectors : compileSpanSelectors(selectors);
  const { fields, exclude } = compiled;
  const restricted = firstSelector(fields) !== undefined || firstSelector(exclude) !== undefined;
  const selected = [];

  for (let i = 0; i < spans.length; i += 1) {
    if ((i & 0x3ff) === 0) {
      checkBudget?.('select');
    }

    const span = spans[i];

    // A span no path reaches is neither selected nor proven unexcluded by any selector.
    if (
      !span.isKey &&
      !(span.unaddressed && restricted) &&
      (!fields || anyMatches(span, fields)) &&
      !(exclude && anyMatches(span, exclude))
    ) {
      selected.push(span);
    }
  }

  return selected;
}
