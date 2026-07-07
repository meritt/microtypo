import { MicroTypoInputError } from '../errors/index.js';

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

// Skips '…'/"…" string literals so a close sequence inside a quoted expression (like {{ "a }}" }}) can't end the span early.
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

// First matching pair wins in registration order (triple before double, so '{{{' isn't read as '{{' + brace); an unclosed open is prose, an over-cap open fails closed.
export function templateScanner(name) {
  const pairs = DELIMITERS[name];

  if (!pairs) {
    return null;
  }

  return function scanTemplate(text, checkBudget) {
    const n = text.length;
    const spans = [];
    let hasOpen = false;

    for (const [open] of pairs) {
      hasOpen ||= text.includes(open);
    }

    if (!hasOpen) {
      return spans;
    }

    // lastClose per distinct close delimiter: a close that never appears after an opener means that opener is literal prose, not fail-open.
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
      return spans;
    }

    let i = 0;
    // Threshold, not an i-bitmask: a match jumps i by a whole expression, so a fixed mask could stride past every budget check.
    let nextCheck = 0;

    while (i < n) {
      if (i >= nextCheck) {
        checkBudget?.('template-scan');
        nextCheck = i + 0x4000;
      }

      let matched = false;

      for (const [open, close] of pairs) {
        if (!text.startsWith(open, i)) {
          continue;
        }

        // No close at/after the opener: skip the bounded scan entirely, else findClose per such opener would be quadratic on delimiter-packed input.
        if (lastClose.get(close) < i + open.length) {
          break;
        }

        const limit = Math.min(n, i + open.length + MAX_TEMPLATE_SCAN);
        const end = findClose(text, i + open.length, close, limit);

        if (end !== -1) {
          spans.push([i, end]);
          i = end;
          matched = true;
        } else if (limit < n) {
          // A raw close exists ahead but beyond the scan bound: fail closed, never fall through to prose.
          throw new MicroTypoInputError(
            `Template expression exceeds the ${MAX_TEMPLATE_SCAN}-char scan bound at offset ${i}`,
            { details: { offset: i, max: MAX_TEMPLATE_SCAN, reason: 'template-overlimit' } }
          );
        }

        break;
      }

      if (!matched) {
        i += 1;
      }
    }

    return spans;
  };
}
