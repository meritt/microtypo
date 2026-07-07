import { MicroTypoInputError } from '../errors/index.js';

const join = (base, segment) => (base === '' ? String(segment) : `${base}.${segment}`);

function containerPath(stack) {
  if (stack.length === 0) {
    return '';
  }

  const parent = stack.at(-1);

  return parent.type === 'object'
    ? join(parent.basePath, parent.key)
    : join(parent.basePath, parent.index);
}

// Segment array, not the dot-joined path: the path string is lossy — a literal '.' or numeric key collides with nesting.
function containerSegments(stack) {
  if (stack.length === 0) {
    return [];
  }

  const parent = stack.at(-1);

  return parent.type === 'object'
    ? [...parent.baseSegments, parent.key]
    : [...parent.baseSegments, parent.index];
}

export function scanJson(src) {
  const spans = [];
  const stack = [];
  const n = src.length;
  let i = 0;

  while (i < n) {
    const ch = src[i];

    if (ch === '"') {
      const start = i;
      i += 1;
      let closed = false;

      while (i < n) {
        const c = src[i];

        if (c === '\\') {
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
        spans.push({ start, end, isKey: false, path: '', segments: [] });
      } else if (frame.type === 'array') {
        spans.push({
          start,
          end,
          isKey: false,
          path: join(frame.basePath, frame.index),
          segments: [...frame.baseSegments, frame.index]
        });
      } else if (frame.expect === 'key') {
        spans.push({ start, end, isKey: true, path: frame.basePath, segments: frame.baseSegments });

        try {
          frame.key = JSON.parse(src.slice(start, end));
        } catch (error) {
          throw new MicroTypoInputError(`Malformed JSON object key: ${error.message}`, {
            details: { start, end }
          });
        }
      } else {
        spans.push({
          start,
          end,
          isKey: false,
          path: join(frame.basePath, frame.key),
          segments: [...frame.baseSegments, frame.key]
        });
      }

      continue;
    }

    if (ch === '{') {
      stack.push({
        type: 'object',
        key: null,
        expect: 'key',
        basePath: containerPath(stack),
        baseSegments: containerSegments(stack)
      });
      i += 1;
      continue;
    }

    if (ch === '[') {
      stack.push({
        type: 'array',
        index: 0,
        basePath: containerPath(stack),
        baseSegments: containerSegments(stack)
      });
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
      tail: raw,
      test: (_segments, path) => lastPathSegment(path) === raw
    });
  }

  const wanted = Object.freeze(raw.split('.'));

  return Object.freeze({
    raw,
    kind: 'glob',
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

  const byTail = new Map();
  const star = [];

  for (const selector of list) {
    if (selector.tail === '*') {
      star.push(selector);
      continue;
    }

    const group = byTail.get(selector.tail);

    if (group) {
      group.push(selector);
    } else {
      byTail.set(selector.tail, [selector]);
    }
  }

  for (const [tail, group] of byTail) {
    byTail.set(tail, Object.freeze(group));
  }

  return Object.freeze({
    list,
    byTail,
    star: Object.freeze(star)
  });
}

function pathMatches(span, selector, dottedSegments) {
  if (selector.size !== undefined) {
    const segments = selector.kind === 'glob' ? dottedSegments : span.segments;

    if (segments.length !== selector.size) {
      return false;
    }
  }

  if (selector.tail !== '*') {
    const segments = selector.kind === 'glob' ? dottedSegments : span.segments;
    const tail =
      selector.kind === 'bare'
        ? lastPathSegment(span.path)
        : String(segments.length === 0 ? '' : segments.at(-1));

    if (tail !== selector.tail) {
      return false;
    }
  }

  if (selector.kind === 'glob') {
    return selector.test(dottedSegments, span.path);
  }

  return selector.test(span.segments, span.path);
}

function spanTail(span) {
  const tail = span.segments.at(-1);

  return tail === undefined ? lastPathSegment(span.path) : String(tail);
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

function anyMatches(span, selectors) {
  if (Array.isArray(selectors)) {
    return listMatches(span, selectors);
  }

  const matchingTail = selectors.byTail.get(spanTail(span));

  if (matchingTail && listMatches(span, matchingTail)) {
    return true;
  }

  if (selectors.star.length > 0) {
    if (listMatches(span, selectors.star)) {
      return true;
    }
  }

  return false;
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
