import { MicroTypoInputError } from '../errors/index.js';
import { collectSpans } from './span-path.js';

const CODE = 0;
const HASH_COMMENTS = 1;
const COMMENT = 2;
const DASHED_COMMENT = 3;

const DELIMITERS = {
  handlebars: [
    ['{{{{', '}}}}'],
    ['{{{', '}}}'],
    ['{{!--', '}}', DASHED_COMMENT],
    ['{{~!--', '}}', DASHED_COMMENT],
    ['{{!', '}}', COMMENT],
    ['{{~!', '}}', COMMENT],
    ['{{', '}}']
  ],
  mustache: [
    ['{{{', '}}}'],
    ['{{!', '}}', COMMENT],
    ['{{', '}}']
  ],
  twig: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}', COMMENT]
  ],
  jinja: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}', COMMENT]
  ],
  nunjucks: [
    ['{%', '%}'],
    ['{{', '}}'],
    ['{#', '#}', COMMENT]
  ],
  liquid: [
    ['{%', '%}', HASH_COMMENTS],
    ['{{', '}}']
  ],
  erb: [
    ['<%#', '%>', COMMENT],
    ['<%', '%>', HASH_COMMENTS]
  ]
};

// Per-open scan bound: keeps delimiter-packed input O(n) total, not O(n^2).
const MAX_TEMPLATE_SCAN = 8192;

// Where `needle` next occurs at or after `from`, given where it was last found.
function nextIndex(text, needle, from, known) {
  return known !== undefined && (known === -1 || known >= from)
    ? known
    : text.indexOf(needle, from);
}

// String literals are stepped over, so a close sequence inside a quoted expression — `{{ "a }}" }}`
// — cannot end the span early. Quotes inside a comment are prose and open nothing. ERB and Liquid
// split tags on the raw close, so a close inside a `#` line comment still ends the span.
function findClose(text, i, close, limit, mode, checkBudget) {
  let j = i;
  let inComment = mode === COMMENT;
  let nextCheck = i;

  while (j < limit) {
    if (j >= nextCheck) {
      checkBudget?.('template-scan');
      nextCheck = j + 0x4000;
    }
    const c = text[j];

    if (!inComment && (c === '"' || c === "'")) {
      j += 1;

      while (j < limit && text[j] !== c) {
        if (j >= nextCheck) {
          checkBudget?.('template-scan');
          nextCheck = j + 0x4000;
        }
        j += text[j] === '\\' ? 2 : 1;
      }

      j += 1;
      continue;
    }

    if (text.startsWith(close, j)) {
      return j + close.length;
    }

    if (mode === HASH_COMMENTS) {
      inComment = c === '#' || (inComment && c !== '\n');
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
export function templateReader(name, bodiesOnly = false) {
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

    // Where `--}}` and `--~}}` next occur. Openers are met in document order, so a search never
    // starts behind a close already found, and one that found nothing never finds anything.
    let dashedPlain;
    let dashedTilde;
    const bodyEnds = new Map();
    // Every opener of an engine starts with the same character, so the scan jumps between those
    // instead of trying each opener at every position.
    const first = pairs[0][0][0];

    const headerEnds = new Map();
    let dashedHeaders;
    const read = (from, onlyAt = false, headerOnly = false) => {
      let i = from;
      // A threshold rather than a mask on `i`: a match jumps `i` by a whole expression, so a fixed
      // mask could stride past every check.
      let nextCheck = from;

      while (i < n) {
        if (i >= nextCheck) {
          checkBudget?.('template-scan');
          nextCheck = i + 0x4000;
        }

        i = text.indexOf(first, i);

        if (i === -1 || (onlyAt && i !== from)) {
          break;
        }

        for (const [open, close, mode = CODE] of pairs) {
          if (!text.startsWith(open, i)) {
            continue;
          }

          // With no close at or after the opener the bounded scan is skipped entirely, or
          // `findClose` per such opener is quadratic on delimiter-packed input.
          if (lastClose.get(close) < i + open.length) {
            break;
          }

          let scanMode = mode;

          // A dashed comment holds neither strings nor expressions, so its end is found directly,
          // past any length and any plain `}}`; the opener's own dashes may be the closer's
          // (`{{!--}}`). Handlebars rejects one that never closes; vaulting it to the first `}}`
          // like a short comment still keeps its body out of typography.
          if (mode === DASHED_COMMENT) {
            const dashes = i + open.length - 2;

            if (headerOnly) {
              if (dashedHeaders === undefined) {
                dashedHeaders = new Map();
                let plain;
                let tilde;
                for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) {
                  checkBudget?.('template-comment-headers');
                  const pair = pairs.find(
                    ([prefix, , kind]) => kind === DASHED_COMMENT && text.startsWith(prefix, at)
                  );
                  if (pair === undefined) {
                    continue;
                  }
                  const commentStart = at + pair[0].length - 2;
                  plain = nextIndex(text, '--}}', commentStart, plain);
                  tilde = nextIndex(text, '--~}}', commentStart, tilde);
                  dashedHeaders.set(
                    at,
                    Math.min(
                      plain === -1 ? Infinity : plain + 4,
                      tilde === -1 ? Infinity : tilde + 5
                    )
                  );
                }
              }
              const end = dashedHeaders.get(i);
              if (end !== Infinity) {
                return [i, end, end];
              }
              const fallback = findClose(
                text,
                i + open.length,
                close,
                Math.min(n, i + open.length + MAX_TEMPLATE_SCAN),
                COMMENT,
                checkBudget
              );
              return fallback === -1 ? null : [i, fallback, fallback];
            }

            dashedPlain = nextIndex(text, '--}}', dashes, dashedPlain);
            dashedTilde = nextIndex(text, '--~}}', dashes, dashedTilde);

            const end = Math.min(
              dashedPlain === -1 ? Infinity : dashedPlain + 4,
              dashedTilde === -1 ? Infinity : dashedTilde + 5
            );

            if (end !== Infinity) {
              if (bodiesOnly) {
                if (onlyAt) {
                  return [i, end, end, null, false];
                }
                i = end - 1;
                break;
              }
              return [i, end, end];
            }

            scanMode = COMMENT;
          }

          const limit =
            bodiesOnly && !headerOnly ? n : Math.min(n, i + open.length + MAX_TEMPLATE_SCAN);
          const end = findClose(text, i + open.length, close, limit, scanMode, checkBudget);

          if (end !== -1) {
            if (headerOnly) {
              return [i, end, end];
            }
            const head = text.slice(i + open.length, end - close.length);
            let block;
            if (name === 'handlebars' && open === '{{{{' && /^\s*raw(?:\s|$)/.test(head)) {
              block = 'raw';
            } else if (
              open === '{%' &&
              (name === 'liquid' || name === 'jinja' || name === 'nunjucks')
            ) {
              block = /^-?\s*(raw|comment)\s*-?$/.exec(head)?.[1];
            }
            if (block !== undefined && (block !== 'comment' || name === 'liquid')) {
              let ending = bodyEnds.get(block);
              if (ending === undefined || (ending !== null && ending[0] < end)) {
                const pattern =
                  name === 'handlebars'
                    ? /\{\{\{\{\s*\/raw\s*\}\}\}\}/g
                    : new RegExp(`\\{%[-]?[ \\t\\r\\n]*end${block}[ \\t\\r\\n]*[-]?%\\}`, 'g');
                pattern.lastIndex = end;
                const match = pattern.exec(text);
                ending = match === null ? null : [match.index, pattern.lastIndex];
                bodyEnds.set(block, ending);
              }
              const through = ending === null ? n : ending[1];
              return ending === null ? [i, through, through, 'tail'] : [i, through, through];
            }
            if (bodiesOnly) {
              if (onlyAt) {
                return [i, end, end, null, false];
              }
              i = end - 1;
              break;
            }
            return [i, end, end];
          }

          if (headerOnly) {
            return null;
          }
          if (bodiesOnly) {
            return onlyAt ? [i, n, n, null, false] : null;
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
    read.next = (from) => {
      for (let at = text.indexOf(first, from); at !== -1; at = text.indexOf(first, at + 1)) {
        checkBudget?.('template-opener');
        if (pairs.some(([open]) => text.startsWith(open, at))) {
          return [at, at, at];
        }
      }
      return null;
    };
    read.read = (at) => read(at, true) ?? [at, at + 1, at + 1, null, false];
    read.header = (at) => {
      if (text[at] !== first || !pairs.some(([open]) => text.startsWith(open, at))) {
        return -1;
      }
      if (!headerEnds.has(at)) {
        headerEnds.set(at, read(at, true, true)?.[1] ?? -1);
      }
      return headerEnds.get(at);
    };
    return read;
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
