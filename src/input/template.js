import { MicroTypoInputError } from '../errors/index.js';
import { collectSpans } from './span-path.js';

const DELIMITERS = {
  handlebars: [
    ['{{{', '}}}'],
    ['{{', '}}']
  ],
  mustache: [
    ['{{{', '}}}'],
    ['{{', '}}']
  ],
  twig: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}']
  ],
  jinja: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}']
  ],
  nunjucks: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}']
  ],
  liquid: [
    ['{%', '%}'],
    ['{{', '}}']
  ],
  erb: [['<%', '%>']]
};

// Per-open scan bound: keeps delimiter-packed input O(n) total, not O(n^2).
const MAX_TEMPLATE_SCAN = 8192;

// String literals are stepped over, so a close sequence inside a quoted expression — `{{ "a }}" }}`
// — cannot end the span early.
function findClose(text, i, close, limit) {
  let j = i;

  while (j < limit) {
    const c = text[j];

    if (c === '"' || c === "'") {
      j += 1;

      while (j < limit && text[j] !== c) {
        j += text[j] === '\\' ? 2 : 1;
      }

      j += 1;
      continue;
    }

    if (text.startsWith(close, j)) {
      return j + close.length;
    }

    j += 1;
  }

  return -1;
}

// The first matching pair wins in registration order, triple before double, so `{{{` is not read as
// `{{` plus a brace. An unclosed open is prose; an open past the cap fails closed.
//
// The reader answers with the first expression at or past a given position and nothing else. Which
// close answers an opener is read forward from that opener alone, so where a walk starts changes
// nothing about what it finds — and a walk sharing the document with another kind of opaque region
// can resume behind one without the document being rewritten for it.
export function templateReader(name) {
  const pairs = DELIMITERS[name];

  if (!pairs) {
    return null;
  }

  return function readTemplates(text, checkBudget) {
    const n = text.length;
    let hasOpen = false;

    for (const [open] of pairs) {
      hasOpen ||= text.includes(open);
    }

    if (!hasOpen) {
      return () => null;
    }

    // One `lastClose` per distinct close delimiter: a close that never appears after an opener makes
    // that opener literal prose rather than a fail-open.
    const lastClose = new Map();
    let hasClose = false;

    for (const [, close] of pairs) {
      if (!lastClose.has(close)) {
        const at = text.lastIndexOf(close);
        lastClose.set(close, at);
        hasClose ||= at !== -1;
      }
    }

    if (!hasClose) {
      return () => null;
    }

    return (from) => {
      let i = from;
      // A threshold rather than a mask on `i`: a match jumps `i` by a whole expression, so a fixed
      // mask could stride past every check.
      let nextCheck = from;

      while (i < n) {
        if (i >= nextCheck) {
          checkBudget?.('template-scan');
          nextCheck = i + 0x4000;
        }

        for (const [open, close] of pairs) {
          if (!text.startsWith(open, i)) {
            continue;
          }

          // With no close at or after the opener the bounded scan is skipped entirely, or
          // `findClose` per such opener is quadratic on delimiter-packed input.
          if (lastClose.get(close) < i + open.length) {
            break;
          }

          const limit = Math.min(n, i + open.length + MAX_TEMPLATE_SCAN);
          const end = findClose(text, i + open.length, close, limit);

          if (end !== -1) {
            return [i, end, end];
          }

          if (limit < n) {
            // A raw close exists ahead but beyond the scan bound, so this fails closed rather than
            // falling through to prose.
            throw new MicroTypoInputError(
              `Template expression exceeds the ${MAX_TEMPLATE_SCAN}-char scan bound at offset ${i}`,
              { details: { offset: i, max: MAX_TEMPLATE_SCAN, reason: 'template-overlimit' } }
            );
          }

          break;
        }

        i += 1;
      }

      return null;
    };
  };
}

// The one place a positional reader becomes a span scanner: the engine holds a reader of its own
// for `opaqueInline` and would otherwise compose the protocol a second time.
export function scannerFor(reader) {
  return reader === null ? null : (text, checkBudget) => collectSpans(reader(text, checkBudget));
}

export function templateScanner(name) {
  return scannerFor(templateReader(name));
}
