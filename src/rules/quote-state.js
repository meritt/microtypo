import {
  OPEN_LEFT,
  WEAK_LEFT,
  dashQuotePunctuation,
  isQuoteDash,
  openingQuoteNeighbours
} from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import {
  inlineEndTagEndsAt,
  inlineTextStart,
  inlineTextEnd,
  nativeTagStart,
  nativeTagEnd,
  tokenTagRaw,
  NATIVE_TAG_REGEXES
} from '../lib/inline-boundaries.js';
import { PARAGRAPH_SPLIT_RE } from '../lib/paragraph-boundaries.js';
import { RDQUO, resolveAuthoredQuotePairs } from '../lib/quote-pairs.js';
import { sessionMap } from '../lib/session-maps.js';
import { lineView, skipSpaces } from '../lib/strings.js';
import {
  CLOSE,
  OPEN,
  PARAGRAPH_CLOSE,
  BLOCK_KIND,
  TAG_PLACEHOLDER_SOURCE,
  tagTokens
} from '../protect/placeholders.js';

// Every `buf` rewrite is a length-preserving in-place overwrite, so a substitution has to be a
// single BMP code point.

const { LAQUO } = G;
const { RAQUO } = G;
const { BDQUO } = G;
const { LDQUO } = G;

// What separates a quote from its content, as against what is content. A non-breaking space is the
// second: the author wrote it inside the quotation, so a quote in front of one has its word right
// there.
export const SEPARATOR = ' \\t\\r\\n';
export const SEPARATOR_RE = new RegExp(`[${SEPARATOR}]`, 'u');
export const QUOTE_CONTENT_REGEXES = [SEPARATOR_RE, ...NATIVE_TAG_REGEXES];

// Native block markup ends this paragraph. Inline markup can still lead to its first word,
// and a literal tag in a format that does not parse it remains text.
export function quoteContentAt(text, at, inlineContext) {
  return contentAt(text, inlineTextStart(inlineContext, text, at), inlineContext);
}

const blockAfterBreak = sessionMap();
const paragraphTags = sessionMap();
const inlinePadding = sessionMap();

export function bindQuoteInlinePadding(ctx, read) {
  inlinePadding.set(ctx, read);
}

function contentAt(text, visible, ctx) {
  if (text[visible] === OPEN && blockAfterBreak.get(ctx)?.blockAt(text, visible, false)) {
    return false;
  }
  if (visible >= text.length || SEPARATOR_RE.test(text[visible])) {
    return false;
  }
  if (text[visible] !== '<') {
    return true;
  }
  // Block markup supplies no word where it parts quote paragraphs; XML and plain text read it as an
  // element like any other, as `quoteParagraphs` does.
  if (text[visible + 1] !== '/') {
    return !(
      text[visible + 1] === OPEN &&
      text[visible + 2] === BLOCK_KIND &&
      paragraphTags.get(ctx) != null
    );
  }
  return nativeTagEnd(text, visible) === -1;
}

// The content of one quotation can begin behind inline markup, invisible comments
// and one soft break. A blank line, a Markdown block opener or EOF supplies no word.
export function openingContentStart(text, at, ctx) {
  const markdown = blockAfterBreak.get(ctx);
  let next = at;
  let crossedSourceLine = false;
  let crossedBr = false;
  let budgetAt = at + 0x4000;
  let lineStart = false;
  let skipPadding = false;
  while (next < text.length) {
    if (next >= budgetAt) {
      ctx?.checkBudget?.('quote:content');
      budgetAt = next + 0x4000;
    }
    if (skipPadding) {
      next = skipSpaces(text, next, text.length);
    }
    if (markdown && text[next] === OPEN) {
      const end = markdown.spaceEnd(text, next);
      if (end !== next) {
        next = end;
        skipPadding = true;
        continue;
      }
    }
    if (lineStart && markdown?.blockAt(text, next, true)) {
      return -1;
    }
    const visible = inlineTextStart(ctx, text, next);
    if (visible !== next) {
      lineStart = false;
      next = inlinePadding.get(ctx)?.(text, visible) ?? visible;
    }
    const tagEnd = text[next] === '<' ? nativeTagEnd(text, next) : -1;
    if (tagEnd !== -1) {
      const raw = text.slice(next + 1, tagEnd - 1);
      const token = Array.isArray(raw) ? raw.join('') : raw;
      if (tokenTagRaw(ctx, token)?.startsWith('!--')) {
        if (lineStart && markdown) {
          return -1;
        }
        next = tagEnd;
        skipPadding = true;
        continue;
      }
    }
    const br = tagEnd !== -1 && lineBreakAt(text, next, ctx);
    if (br) {
      next = tagEnd;
    }
    const physical = text[next] === '\n' || text[next] === '\r';
    if (!br && !physical) {
      return contentAt(text, next, ctx) ? next : -1;
    }
    if ((physical && crossedSourceLine) || (br && crossedBr)) {
      return -1;
    }
    if (physical && text[next++] === '\r' && text[next] === '\n') {
      next++;
    }
    crossedSourceLine ||= physical;
    crossedBr ||= br;
    lineStart = physical;
    skipPadding = true;
  }
  return -1;
}

export function openingContentAt(text, at, ctx) {
  return openingContentStart(text, at, ctx) !== -1;
}

// Up to this many quote marks, a chunk is cheaper to rescan than to index.
const SCAN_LIMIT = 32;

const breakTokens = sessionMap();
const PARAGRAPH_TAG_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'g');
const QUOTE_PARAGRAPH_TOKEN_RE = new RegExp(RegExp.escape(PARAGRAPH_CLOSE), 'g');

export function bindQuoteLineBlocks(ctx, opaqueBlock) {
  blockAfterBreak.set(ctx, opaqueBlock);
}

// A frontmatter header and its body are two runs over one tag vault, and the body vaults its own
// tags after the header's run, so each run reads its line breaks afresh.
export function bindQuoteParagraphs(ctx, tags) {
  paragraphTags.set(ctx, tags);
  if (tags) {
    breakTokens.delete(tags);
  }
}

export const quoteParagraphTags = (ctx) => paragraphTags.get(ctx);

// The placeholder tokens of the line breaks among `tags`. The quote group runs before any rule writes
// a tag, so the set read on first use holds for the whole group.
const NO_BREAKS = new Set();

function lineBreakTokens(tags) {
  if (tags === null || tags === undefined) {
    return NO_BREAKS;
  }
  let tokens = breakTokens.get(tags);
  if (tokens === undefined) {
    tokens = new Set(tagTokens(tags, 'br'));
    breakTokens.set(tags, tokens);
  }
  return tokens;
}

const TOKEN_MAX = 16;

// Whether a line break tag starts at `at`: the `\n` that `text.breakline` writes it for on the pass
// before, so it parts a quote from what follows as the newline did.
function lineBreakAt(text, at, ctx) {
  if (text[at + 1] !== OPEN) {
    return false;
  }
  const breaks = lineBreakTokens(paragraphTags.get(ctx));
  if (breaks.size === 0) {
    return false;
  }
  let token = OPEN;
  for (let i = at + 2; i < text.length && token.length < TOKEN_MAX; i += 1) {
    token += text[i];
    if (text[i] === CLOSE) {
      return text[i + 1] === '>' && breaks.has(token);
    }
  }
  return false;
}

// A line's indent is vaulted, and what the vault holds is the spaces in front of the line.
const INDENT_RE = new RegExp(`${OPEN}W\\d{1,9}${CLOSE}`, 'uy');

// A paragraph that `text.paragraphs` wraps later in this pass parts the quotes of its lines from the
// block line in front of it and behind it, as its markup does on the next pass. The engine binds the
// reader of its edges for a fragment, and it is asked only where a stretch runs over a line break and
// holds a quote mark.
const blockEdges = sessionMap();
// Every quote mark the quote rules read or write, as a character-class body.
export const QUOTE_MARKS = `"${LAQUO}${RAQUO}${BDQUO}${LDQUO}${RDQUO}`;
const QUOTE_MARK_AHEAD_RE = new RegExp(`[${QUOTE_MARKS}]`, 'gu');

export function bindQuoteBlockEdges(tags, edgesOf) {
  blockEdges.set(tags, edgesOf);
}

function partedAtBlocks(text, ranges, edgesOf) {
  const parted = [];
  let edges = null;
  let e = 0;
  let breakAt = -1;
  let quoteAt = -1;

  for (const [from, to] of ranges) {
    if (breakAt < from) {
      breakAt = text.indexOf('\n', from);
      breakAt = breakAt === -1 ? text.length : breakAt;
    }
    if (breakAt < to && quoteAt < from) {
      QUOTE_MARK_AHEAD_RE.lastIndex = from;
      quoteAt = QUOTE_MARK_AHEAD_RE.exec(text)?.index ?? text.length;
    }
    if (breakAt >= to || quoteAt >= to) {
      parted.push([from, to]);
      continue;
    }

    edges ??= edgesOf(text);

    let cursor = from;

    while (e < edges.length && edges[e] <= from) {
      e += 1;
    }
    for (; e < edges.length && edges[e] < to; e += 1) {
      parted.push([cursor, edges[e]]);
      cursor = edges[e];
    }
    parted.push([cursor, to]);
  }

  return parted;
}

// Two native br tags serialize a blank line. Only the quote owner's ASCII separators are empty;
// NBSP is content. The tag layer owns names/attributes, so no HTML syntax is parsed here.
export function quoteParagraphs(text, tags, checkBudget) {
  const plain = [];
  let seen = 0;
  const lines = text.includes('\r') ? lineView(text).replaceAll('\r', ' ') : text;
  const gap = text.includes(PARAGRAPH_CLOSE) ? QUOTE_PARAGRAPH_TOKEN_RE : PARAGRAPH_SPLIT_RE;
  for (const m of lines.matchAll(gap)) {
    if (checkBudget && (++seen & 1023) === 0) {
      checkBudget('quote:paragraphs');
    }
    plain.push([m.index, m.index + m[0].length]);
  }
  const breaks = text.includes(OPEN) ? lineBreakTokens(tags) : NO_BREAKS;
  const markup = [];
  let previous = null;
  let chain = null;
  if (tags !== null && tags !== undefined && text.includes(OPEN)) {
    for (const m of text.matchAll(PARAGRAPH_TAG_RE)) {
      if (checkBudget && (++seen & 1023) === 0) {
        checkBudget('quote:paragraphs');
      }
      if (m[2][1] === BLOCK_KIND && !breaks.has(m[2])) {
        markup.push([m.index, m.index + m[0].length]);
      }
      if (m[1] !== '' || !breaks.has(m[2])) {
        previous = null;
        chain = null;
        continue;
      }
      let empty = previous !== null;
      if (empty) {
        for (let at = previous[1]; at < m.index; at += 1) {
          if (checkBudget && (at & 1023) === 0) {
            checkBudget('quote:paragraphs');
          }
          INDENT_RE.lastIndex = at;
          if (INDENT_RE.test(text)) {
            at = INDENT_RE.lastIndex - 1;
            continue;
          }
          if (!SEPARATOR_RE.test(text[at])) {
            empty = false;
            break;
          }
        }
      }
      const end = m.index + m[0].length;
      if (empty) {
        if (chain === null) {
          chain = [previous[0], end];
          markup.push(chain);
        } else {
          chain[1] = end;
        }
      } else {
        chain = null;
      }
      previous = [m.index, end];
    }
  }
  const ranges = [];
  let cursor = 0;
  for (let a = 0, b = 0; a < plain.length || b < markup.length;) {
    const boundary =
      b >= markup.length || (a < plain.length && plain[a][0] <= markup[b][0])
        ? plain[a++]
        : markup[b++];
    if (boundary[0] >= cursor) {
      ranges.push([cursor, boundary[0]]);
    }
    cursor = Math.max(cursor, boundary[1]);
  }
  ranges.push([cursor, text.length]);
  const edgesOf = tags === null || tags === undefined ? undefined : blockEdges.get(tags);
  return edgesOf === undefined ? ranges : partedAtBlocks(text, ranges, edgesOf);
}

function mapQuoteParagraphs(text, tags, checkBudget, transform) {
  const parts = [];
  let cursor = 0;
  for (const [from, to] of quoteParagraphs(text, tags, checkBudget)) {
    parts.push(text.slice(cursor, from), transform(text.slice(from, to), text[to] ?? ''));
    cursor = to;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

function nextQuote(buf, off) {
  for (let i = off; i < buf.length; i++) {
    const c = buf[i];

    if (c === LAQUO || c === RAQUO) {
      return { pos: i, ch: c };
    }
  }

  return null;
}

// Glued between a word and a Cyrillic letter, a straight quote is one `quote.open_cyrillic` opens, so
// a closer there taken back to one would open on the next pass.
const WORD_BEFORE_RE = /[a-zа-яё0-9]/iu;
const CYRILLIC_AFTER_RE = /[а-яё]/iu;

const PADDING = new Set([' ', '\t', G.NBSP]);

const keptGlued = (kept) => (buf, at) =>
  (WORD_BEFORE_RE.test(buf[at - 1] ?? '') && CYRILLIC_AFTER_RE.test(buf[at + 1] ?? '')) ||
  kept(buf, at);

// A closer first among a paragraph's quotes, where `quote.nested` turns it into an opener, is turned
// before the rules read it: a straight quote glued behind it opens behind `«` on the next pass, so it
// opens behind it on this one.
const OPENER_LEFT_RE = new RegExp(`[${WEAK_LEFT}${CLOSE}${OPEN_LEFT}]`, 'u');
// One scan for the three high quotes: searching Cyrillic text for any one of them alone costs as much,
// because each shares its low byte with a common capital letter.
const HIGH_QUOTE_RE = new RegExp(`[${BDQUO}${LDQUO}${RDQUO}]`, 'u');

function closerWhereOpenerStands(text, high) {
  for (const closer of high ? [RAQUO, RDQUO] : [RAQUO]) {
    for (let at = text.indexOf(closer); at !== -1; at = text.indexOf(closer, at + 1)) {
      if (at === 0 || OPENER_LEFT_RE.test(text[at - 1])) {
        return true;
      }
    }
  }
  return false;
}
const ANY_QUOTE_RE = new RegExp(`["${LAQUO}${RAQUO}${BDQUO}${LDQUO}${RDQUO}]`, 'u');

function turnWrongWayOpener(buf, inlineContext) {
  const at = buf.findIndex((ch) => ANY_QUOTE_RE.test(ch));
  if ((buf[at] === RAQUO || buf[at] === RDQUO) && opensHere(buf, at, inlineContext)) {
    buf[at] = LAQUO;
  }
}

// The engine writes a nested quotation as `„…“` at every depth and never writes `”`, so its own
// output reads back by one rule: `„` opens, and `“` closes the `„` standing innermost. Elsewhere `“`
// is the English opening quote, left neutral for the straight-quote rules to place — and so is one
// inside `„` that pairs with the author's `”` at the same nesting depth.
export function canonicalQuoteRoles(text, tags, checkBudget, inlineContext, turnsOpeners) {
  const high = HIGH_QUOTE_RE.test(text);
  const nested = high && (text.includes(BDQUO) || text.includes(LDQUO));
  const turns = turnsOpeners && closerWhereOpenerStands(text, high);
  if (!nested && !turns) {
    return high ? text.replaceAll(RDQUO, RAQUO) : text;
  }
  return mapQuoteParagraphs(text, tags, checkBudget, (chunk) => {
    if (!nested) {
      const first = chunk.search(ANY_QUOTE_RE);
      if (chunk[first] !== RAQUO && chunk[first] !== RDQUO) {
        return high ? chunk.replaceAll(RDQUO, RAQUO) : chunk;
      }
    }
    const buf = [...chunk];
    if (turns) {
      turnWrongWayOpener(buf, inlineContext);
    }
    if (!nested) {
      return buf.join('').replaceAll(RDQUO, RAQUO);
    }
    resolveAuthoredQuotePairs(buf, (i, afterLow) =>
      authoredOpeningAt(buf, i, afterLow, inlineContext)
    );
    return buf.join('');
  });
}

// Assumes outer "..." pairs were already converted to «...».
export function processQuotes(text, options = {}) {
  // Every rewrite below is triggered by an angle quote, so text without one comes back unchanged —
  // and the split plus the code-point array are the whole cost on a short data value.
  if (!text.includes(LAQUO) && !text.includes(RAQUO)) {
    return text;
  }

  const allowNested = options.allowNested !== false;
  const convertInches = options.convertInches !== false;
  const padded = options.stripsPadding === true;
  const { checkBudget } = options;
  const kept = keptGlued(options.keptCloser ?? nothingKept);

  return mapQuoteParagraphs(text, options.tags, checkBudget, (chunk, follower) =>
    processChunk(
      chunk,
      allowNested,
      convertInches
        ? inchReader(chunk, padded, follower, options.pairRemainder, allowNested, checkBudget)
        : null,
      checkBudget,
      kept,
      options.inlineContext,
      options.openedBehind ?? null
    )
  );
}

// What a straight quote spaced on both sides closes behind, as one character-class fragment: the
// closing pattern in `quote.js` and the fallback below read one set.
// An ellipsis typed as dots is the `…` that `punctuation.ellipsis` writes after the quote rules.
export const SPACED_CLOSER_LEFT = `(?:[a-zа-яё0-9${G.HELLIP}!?%)]|\\.{3})`;
const SPACED_CLOSER_LEFT_RE = new RegExp(`${SPACED_CLOSER_LEFT}$`, 'iu');
const SPACE_RE = /\s/u;

// A measurement's quote follows a digit: glued to it, or, while `space.strip_quote_padding` runs,
// behind the padding that rule takes from a closing quote, `«Диагональ 15 » и корпус»` read as the
// `15»` it becomes. The padding goes with the quote turned into a prime, once the walk is over, so
// every overwrite during the walk still keeps its length.
function beforeQuotePadding(buf, at, padded) {
  let i = at - 1;
  if (padded) {
    while (i >= 0 && PADDING.has(buf[i])) {
      i -= 1;
    }
  }
  return i;
}

export function digitBeforeQuote(buf, at, padded) {
  const i = beforeQuotePadding(buf, at, padded);
  return i >= 0 && isDigit(buf[i]) ? i : -1;
}

const TITLE_WORD_START = /[\p{L}\p{N}]/u;
export const TITLE_WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const TITLE_CONTENT_END = /[\p{L}\p{M}\p{N}\p{S}\p{Pe}\p{Pf}\p{Terminal_Punctuation}]/u;
export const TITLE_CONTENT_CHAR = /[\p{L}\p{M}\p{N}\p{P}\p{S}]/u;

function dividesContent(buf, at) {
  const before = buf[at - 2] ?? ' ';
  const after = buf[at + 1] ?? ' ';
  return (
    buf[at - 1] === '"' &&
    before !== '"' &&
    !isQuoteMark(before) &&
    !isDigit(before) &&
    TITLE_CONTENT_CHAR.test(before) &&
    after !== '"' &&
    TITLE_CONTENT_CHAR.test(after) &&
    (!/\p{Quotation_Mark}/u.test(after) || TITLE_WORD_START.test(buf[at + 2] ?? ' '))
  );
}

// Two neutral marks can remain inside a quotation whose endpoints became known
// only after the depth walk corrected an opener or assigned a measurement. Its
// actual closer supplies both the right endpoint and the level of the two titles.
function divideTitles(buf, owners, padded, checkBudget) {
  const closers = [];
  for (let i = buf.length - 1; i >= 0; i--) {
    if (checkBudget && (i & 1023) === 0) {
      checkBudget('quote:followingTitle');
    }
    const c = buf[i];
    if (c === RAQUO || c === LDQUO) {
      closers.push(
        owners.has(i) &&
          TITLE_CONTENT_CHAR.test(buf[beforeQuotePadding(buf, i, padded)] ?? ' ') &&
          !TITLE_WORD_CHAR.test(buf[i + 1] ?? ' ')
          ? c
          : null
      );
    } else if (c === LAQUO || c === BDQUO) {
      closers.pop();
    } else if (c === '"' && closers.length) {
      const close = closers.at(-1);
      if (close && dividesContent(buf, i)) {
        buf[i] = close === RAQUO ? LAQUO : BDQUO;
        i--;
        buf[i] = close;
      } else {
        closers[closers.length - 1] = null;
      }
    } else if (c === '\n' || c === '\r') {
      closers.length = 0;
    }
  }
}

function writeSibling(buf, open, end, close, allowNested) {
  buf[open] = close === RAQUO ? LAQUO : BDQUO;
  buf[end] = close;
  if (allowNested) {
    for (let i = open + 1; i < end; i++) {
      if (buf[i] === LAQUO) {
        buf[i] = BDQUO;
      } else if (buf[i] === RAQUO) {
        buf[i] = LDQUO;
      }
    }
  }
}

// When the depth walk leaves a typed opening at a word and another typed
// mark at its end, these endpoints can name the sibling the text contains.
// The first unassigned mark ends this search even when it cannot close the
// title, so prospective siblings never rescan the same stretch of prose.
function writeFollowingTitle(buf, open, close, allowNested, padded, checkBudget) {
  if (buf[open] !== '"') {
    return;
  }
  let first = open + 1;
  while (buf[first] === LAQUO || buf[first] === BDQUO) {
    first++;
    if (padded) {
      while (PADDING.has(buf[first])) {
        first++;
      }
    }
  }
  if (buf[first] === "'" || buf[first] === G.RSQUO || buf[first] === G.LSQUO) {
    first++;
  }
  if (!TITLE_WORD_START.test(buf[first] ?? ' ')) {
    return;
  }
  let depth = 0;
  let enclosingEnd = -1;
  for (let i = open + 1; i < buf.length; i++) {
    if (checkBudget && (i & 1023) === 0) {
      checkBudget('quote:followingTitle');
    }
    const ch = buf[i];
    if (ch === '\n' || ch === '\r') {
      return;
    }
    if (ch === LAQUO || ch === BDQUO) {
      depth++;
    } else if (ch === RAQUO || ch === LDQUO) {
      if (depth) {
        depth--;
      } else if (close === LDQUO && ch === RAQUO && enclosingEnd === -1) {
        // Two titles inside an outer quotation need a closing mark each. The
        // apparent outer closer can end the second title if another otherwise
        // unclaimed endpoint closes the outer frame farther on.
        enclosingEnd = i;
      } else {
        return;
      }
    } else if (ch === '"') {
      if (depth || !TITLE_CONTENT_END.test(buf[i - 1]) || TITLE_WORD_CHAR.test(buf[i + 1] ?? ' ')) {
        return;
      }
      writeSibling(buf, open, i, close, allowNested);
      if (enclosingEnd !== -1) {
        buf[enclosingEnd] = close;
        buf[i] = RAQUO;
      }
      return;
    }
  }
}

// After inch resolution, any two unclaimed neutral marks after a substantive
// closer spell an empty sibling at its level. A mark before possible speech
// remains available to its word. Only recorded positions need revisiting.
function writeSiblings(buf, at, owners, allowNested, padded, checkBudget) {
  let close = buf[at];
  if (close !== RAQUO && close !== LDQUO) {
    return at;
  }
  if (buf[at - 1] === LAQUO || buf[at - 1] === BDQUO) {
    writeFollowingTitle(buf, at + 1, close, allowNested, padded, checkBudget);
    return at;
  }
  let end = at + 1;
  while (buf[end] === '"' || isQuoteMark(buf[end])) {
    end++;
  }
  const mayStartWord = openingQuoteNeighbours(';', buf[end] ?? ' ');
  let depth = 0;
  let pending = -1;
  for (let i = at + 1; i < end; i++) {
    const ch = buf[i];
    if (ch === LAQUO || ch === BDQUO) {
      depth++;
    } else if (ch === RAQUO || ch === LDQUO) {
      if (depth) {
        depth--;
      } else {
        // This closer belongs to an enclosing title. A kept, unpaired glyph
        // (for example one in a URL) cannot start another sequence of siblings.
        if (!owners.has(i)) {
          return i;
        }
        close = ch;
        pending = -1;
      }
    } else if (!depth && !(i + 1 === end && mayStartWord)) {
      if (pending === -1) {
        pending = i;
      } else {
        writeSibling(buf, pending, i, close, allowNested);
        pending = -1;
      }
    }
  }
  // A title consisting of another quotation has its typed opener before the
  // child's directional opener. The content walk validates both closing marks.
  const open = buf[end - 1] === '"' ? end - 1 : pending;
  if (open !== -1) {
    writeFollowingTitle(buf, open, close, allowNested, padded, checkBudget);
  }
  return end;
}

function inchReader(chunk, padded, follower, pairRemainder, allowNested, checkBudget) {
  let ends;
  const hasDivision = pairRemainder && chunk.includes('""');
  const gaps = [];
  const digitBefore = (buf, at) => digitBeforeQuote(buf, at, padded);

  return {
    digitBefore,
    hasDivision,
    rememberClose(buf, at) {
      if (pairRemainder && (hasDivision || buf[at + 1] === '"' || isQuoteMark(buf[at + 1]))) {
        (ends ??= new Set()).add(at);
      }
    },
    forgetClose(at) {
      ends?.delete(at);
    },
    release(buf, at) {
      const digit = digitBefore(buf, at);

      if (digit < at - 1) {
        gaps.push(digit + 1, at);
      }
    },
    // An unmatched closer taken back to a straight quote is one `quote.close` reads again: spaced on
    // both sides behind a word end, with the straight quotes beside it, it closes there and takes
    // the gap before the run. The gap goes now, with the padding of a prime.
    // The follower is read first: closers still unread stand there, so only the last of a run looks
    // back over the run, once. Past the end of the paragraph it is what stands behind the paragraph,
    // which `quote.close` reads there.
    demote(buf, at) {
      let after = at + 1;

      while (buf[after] === '"') {
        after += 1;
      }

      if (!SPACE_RE.test(buf[after] ?? follower)) {
        return;
      }

      let end = at;

      while (end > 0 && buf[end - 1] === '"') {
        end -= 1;
      }

      let start = end;

      while (start > 0 && SPACE_RE.test(buf[start - 1])) {
        start -= 1;
      }

      if (
        start > 0 &&
        start < end &&
        SPACED_CLOSER_LEFT_RE.test(buf.slice(Math.max(0, start - 3), start).join(''))
      ) {
        gaps.push(start, end);
      }
    },
    settle(buf) {
      if (ends) {
        if (hasDivision) {
          divideTitles(buf, ends, padded, checkBudget);
        }
        let settled = -1;
        for (const at of ends) {
          if (at >= settled) {
            settled = writeSiblings(buf, at, ends, allowNested, padded, checkBudget);
          }
        }
      }
      for (let g = 0; g < gaps.length; g += 2) {
        for (let i = gaps[g]; i < gaps[g + 1]; i++) {
          buf[i] = '';
        }
      }

      return buf.join('');
    }
  };
}

// Whether an unmatched closer stays as written, neither turned round into an opener nor taken back to
// a straight quote. Asked with the closer's position in the code points of its paragraph.
function nothingKept() {
  return false;
}

// Where each character of `buf` starts in the string it was spread from.
function unitOffsets(buf) {
  const units = new Uint32Array(buf.length + 1);
  for (let i = 0; i < buf.length; i++) {
    units[i + 1] = units[i] + buf[i].length;
  }
  return units;
}

// One pass in reading order. An inch conversion resumes from a balanced point and reads the quotes
// after it again: with few quote marks in the chunk that costs a few scans of it, so the pass does
// it in place; with more, `walkBack` takes over.
function processChunk(chunk, allowNested, inches, checkBudget, kept, inlineContext, openedBehind) {
  const open = chunk.indexOf(LAQUO);
  const close = chunk.indexOf(RAQUO);
  if (
    open !== -1 &&
    close > open &&
    !chunk.includes(LAQUO, open + 1) &&
    !chunk.includes(RAQUO, close + 1) &&
    chunk[close + 1] !== '"' &&
    !inches?.hasDivision
  ) {
    if (checkBudget) {
      checkBudget('quote:processChunk');
    }
    return chunk;
  }

  const buf = [...chunk];
  const balancedStack = [0];
  let lastBalanced = 0;
  let level = 0;
  let off = 0;
  let iter = 0;
  let many;
  let units = null;

  while (true) {
    if (checkBudget && (iter++ & 0x3ff) === 0) {
      checkBudget('quote:processChunk');
    }

    const p = nextQuote(buf, off);

    if (p === null) {
      break;
    }

    if (p.ch === LAQUO) {
      if (level > 0 && allowNested) {
        buf[p.pos] = BDQUO;
      }

      level++;
    } else {
      level--;
      if (level >= 0) {
        inches?.rememberClose(buf, p.pos);
      }

      if (level > 0 && allowNested) {
        buf[p.pos] = LDQUO;
      }
    }

    off = p.pos + 1;

    if (level === 0) {
      lastBalanced = off;
      balancedStack.push(lastBalanced);
      continue;
    }

    if (level < 0 && !kept(buf, p.pos) && opensHere(buf, p.pos, inlineContext)) {
      buf[p.pos] = LAQUO;
      level = 1;
      if (openedBehind !== null && buf[p.pos + 1] === '"') {
        // The walk writes a quote in place of a quote and nothing past the one it stands on, so the
        // chunk holds what follows that one as the buffer does, at the same place.
        units ??= unitOffsets(buf);
        const written = openedBehind(chunk, units[p.pos]) ?? '';
        for (let k = 0; k < written.length; k++) {
          buf[p.pos + 1 + k] = written[k];
        }
      }
      continue;
    }

    if (level < 0 && inches) {
      many ??= countQuoteMarks(chunk) > SCAN_LIMIT;

      if (many) {
        return walkBack(
          chunk,
          buf,
          balancedStack,
          lastBalanced,
          off,
          allowNested,
          checkBudget,
          kept,
          inlineContext,
          inches
        );
      }

      const result = scanConvertInches(buf, off, balancedStack, kept, inches);
      ({ off } = result);
      level = 0;

      // The walk goes on from a balanced point either way, and a later closer may look back to it.
      if (result.kind === 'fallback') {
        balancedStack.length = 0;
      }
      balancedStack.push(off);
    }
  }

  if (level > 0) {
    restoreNestedMarks(buf, lastBalanced, buf.length);
  }

  return inches ? inches.settle(buf) : buf.join('');
}

// A closing quote where no quotation stands open, with a boundary in front of it and a word behind,
// is an opening one written the wrong way round: no rule of this engine puts a closer there, and read
// as one it has no pair. A measurement never reaches here — its quote follows a digit.
// An inline end tag stands after the words of its element, as a word end does, so no quotation opens
// behind it. Behind a weak neighbour it opens where a straight quote there opens on the next pass:
// glued to what it quotes. A closer glued behind it has nothing to close either, so the walk writes
// that one as an opener or a straight quote, and neither stops a quotation from opening.
export function authoredOpeningAt(buf, at, afterLow, ctx, left) {
  return (
    (left ?? buf[at - 1]) === '"' ||
    (afterLow && WORD_BEFORE_RE.test(buf[at + 1] ?? '')) ||
    opensHere(buf, at, ctx, left)
  );
}

function opensHere(buf, at, inlineContext, left) {
  const right = quoteFollower(buf, at + 1, inlineContext);
  return (
    canStartQuote(buf, at, right === RAQUO ? '"' : right, inlineContext, left) &&
    openingContentAt(buf, skipSpaces(buf, at + 1, buf.length), inlineContext)
  );
}

export function canStartQuote(source, at, right, ctx, left = glyphBefore(source, at, ctx)) {
  return (
    openingQuoteNeighbours(left, right) &&
    !(
      left === '>' &&
      (inlineEndTagEndsAt(source, at - 1) || blockEndTagStart(source, at, ctx) !== -1) &&
      !WORD_BEFORE_RE.test(right)
    )
  );
}

// Where block markup parts no quote paragraph, as in XML, its end tag is an element's like any
// other: the start of a block end tag ending at `end` there, or -1.
export function blockEndTagStart(text, end, ctx) {
  if (paragraphTags.get(ctx) != null) {
    return -1;
  }
  const start = nativeTagStart(text, end);
  return start !== -1 && text[start + 1] === '/' && text[start + 3] === BLOCK_KIND ? start : -1;
}

// Whether this pass can open a quotation at this quote at all — the shape `OPEN_BEFORE_SPACE_RE`
// looks for, minus the one the walk rejects anyway: a `«` in front is one the opening patterns
// minted a step ago, and what follows it is that quotation's closer. A quote failing this goes to
// the closing rules whatever stands around it, so it is not undecided and is not counted as one.

// Where the quote at `at` begins. A quote written `\"` is one token and the backslash belongs to it,
// so every question about what stands beside a quote is asked from here — the plan and the walk that
// applies it must not answer it two ways.
export function tokenStart(text, at) {
  return text[at - 1] === '\\' ? at - 1 : at;
}

// A comment can adjoin an arbitrary run of transparent native elements.
function quoteInlineEdge(ctx, text, offset, right) {
  let at = offset;
  while (true) {
    const edge = right ? inlineTextStart(ctx, text, at, true) : inlineTextEnd(ctx, text, at, true);
    const start = right ? edge : nativeTagStart(text, edge);
    const end = right ? nativeTagEnd(text, edge) : edge;
    if (start < 0 || end < 0) {
      return edge;
    }
    const head = start + (text[start + 1] === '/' ? 2 : 1);
    if (
      right &&
      ((text[head] === OPEN && text[head + 1] === BLOCK_KIND) || lineBreakAt(text, start, ctx))
    ) {
      return -1;
    }
    const token = text.slice(start + 1, end - 1);
    if (!tokenTagRaw(ctx, typeof token === 'string' ? token : token.join(''))?.startsWith('!--')) {
      return edge;
    }
    at = right ? end : start;
  }
}

export function quoteLeftDash(text, at, ctx) {
  const before = text[at - 1] === '>' ? quoteInlineEdge(ctx, text, at, false) : at;
  return isQuoteDash(text[before - 1]) ? text[before - 1] : undefined;
}

export function dashQuoteAt(text, after, left, ctx) {
  return dashQuotePunctuation(text, after, left, (offset) =>
    quoteInlineEdge(ctx, text, offset, true)
  );
}

export function couldOpen(text, at, ctx, after = at + 1, previousGlyph) {
  const left = tokenStart(text, at) - 1;

  const previous = previousGlyph ?? quoteLeftDash(text, left + 1, ctx) ?? text[left];
  if (previous === LAQUO) {
    return false;
  }

  if (dashQuoteAt(text, after, previous, ctx)) {
    return true;
  }
  let i = after;

  const padding = isQuoteDash(previous) ? ` \t${G.NBSP}` : ' \t';
  while (i < text.length && padding.includes(text[i])) {
    i += 1;
  }

  return (
    i > after &&
    canStartQuote(text, left + 1, text[after], ctx, previousGlyph) &&
    quoteContentAt(text, i, ctx)
  );
}

const REFERENCE_BEHIND = 64;
const referenceGlyphs = sessionMap();

export function quoteFollower(source, after, ctx) {
  const visible = inlineTextStart(ctx, source, after);
  if (source[visible] !== '&') {
    return source[visible] ?? ' ';
  }
  const read = referenceGlyphs.get(ctx)?.starting;
  if (read === undefined) {
    return '&';
  }
  return (
    (typeof source === 'string'
      ? read(source, visible)
      : read(source.slice(visible, visible + REFERENCE_BEHIND).join(''), 0)) ?? '&'
  );
}

// In XML a glyph stays the reference that spells it, and the `;` closing that reference is the glyph,
// not a weak neighbour: `&#187;»` reads as `»»` does. The engine binds the reader, since the reference
// grammar reads the scalar tables and those read this module. The look behind is bounded by the
// longest reference the vault leaves in the text.
export function bindReferenceGlyph(ctx, ending, starting) {
  referenceGlyphs.set(ctx, { ending, starting });
}

// A line's indent is vaulted, and what the vault holds is the spaces in front of the line.
export const INDENT_END_RE = new RegExp(`${OPEN}W\\d{1,9}${CLOSE}$`, 'u');

function glyphBefore(buf, at, inlineContext) {
  if (at === 0) {
    return '';
  }
  if (buf[at - 1] === CLOSE) {
    const token = buf.slice(Math.max(0, at - TOKEN_MAX), at);
    if (INDENT_END_RE.test(typeof token === 'string' ? token : token.join(''))) {
      return ' ';
    }
  }
  const glyphEndingAt =
    buf[at - 1] === ';' ? referenceGlyphs.get(inlineContext)?.ending : undefined;

  if (glyphEndingAt === undefined) {
    return buf[at - 1];
  }

  if (typeof buf === 'string') {
    return glyphEndingAt(buf, at - 1) ?? ';';
  }
  const behind = buf.slice(Math.max(0, at - REFERENCE_BEHIND), at).join('');

  return glyphEndingAt(behind, behind.length - 1) ?? ';';
}

function countQuoteMarks(chunk) {
  let count = 0;

  for (let i = 0; i < chunk.length; i++) {
    if (isQuoteMark(chunk[i])) {
      count += 1;
    }
  }

  return count;
}

// `tryConvertInches` over characters: rescans the range from each balanced point it takes off the
// stack.
function scanConvertInches(buf, off, balancedStack, kept, inches) {
  do {
    const candidateStart = balancedStack.pop() ?? 0;
    const hadNestedMarks = hasNestedMarks(buf, candidateStart, off);
    const quotePos = findLastInchQuote(buf, candidateStart, off, hadNestedMarks, inches);

    if (quotePos !== -1) {
      if (hadNestedMarks) {
        restoreNestedMarks(buf, candidateStart, off);
      }

      inches.release(buf, quotePos);
      buf[quotePos] = G.PRIME;

      // Removing a balanced closer changes the depth of following pairs even if none was
      // previously nested. Resume from that balanced point with the new inch role.
      return { kind: 'converted', off: candidateStart };
    }
  } while (balancedStack.length);

  const fallbackPos = off - 1;

  inches.forgetClose(fallbackPos);
  if (!kept(buf, fallbackPos)) {
    buf[fallbackPos] = '"';
    inches.demote(buf, fallbackPos);
  }

  return { kind: 'fallback', off: fallbackPos + 1 };
}

function hasNestedMarks(buf, start, end) {
  for (let i = start; i < end; i++) {
    if (buf[i] === BDQUO || buf[i] === LDQUO) {
      return true;
    }
  }

  return false;
}

function findLastInchQuote(buf, start, end, includeNestedClose, inches) {
  for (let i = end - 1; i > start; i--) {
    const ch = buf[i];

    if (ch !== RAQUO && (!includeNestedClose || ch !== LDQUO)) {
      continue;
    }

    if (inches.digitBefore(buf, i) === -1) {
      continue;
    }

    return i;
  }

  return -1;
}

export function isQuoteMark(ch) {
  return ch === LAQUO || ch === RAQUO || ch === BDQUO || ch === LDQUO;
}

const QUOTE_MARK_RE = new RegExp(`[${LAQUO}${RAQUO}${BDQUO}${LDQUO}]`, 'gu');

// Stands for "no such mark" in a min or max over running sums. A running sum stays within the
// chunk's length, so FAR shifted by one stays above FAR / 2 and inside an Int32.
const FAR = 2 ** 29;

// The chunk's quote marks in reading order, each with its role in the walk: +1 opens, -1 closes, 0 is
// not a quote (a prime, a straight quote, or a nested mark the walk has not read yet). A segment tree
// over the roles answers in O(log n) where the level first drops below a bound, which closers bring it
// back to a given one, and which quotes in a range do not have the form their level gives them; two
// path-compressed links find the last inch candidate and the next unread nested mark.
class QuoteMarks {
  // `source` is the chunk as written. The pass before has nested some quotes and turned some closers
  // into openers, so a quote's role comes from what it is now; the nested marks the author typed it
  // has not read, so they have none yet.
  constructor(buf, source, inches, fromAt) {
    const at = [];

    if (typeof source === 'string') {
      for (const m of source.matchAll(QUOTE_MARK_RE)) {
        at.push(m.index);
      }
    } else {
      for (let i = 0; i < buf.length; i++) {
        if (isQuoteMark(buf[i])) {
          at.push(i);
        }
      }
    }

    const { length } = at;
    let size = 1;

    while (size < length) {
      size *= 2;
    }

    this.buf = buf;
    this.inches = inches;
    this.at = at;
    this.length = length;
    this.size = size;
    this.role = new Int8Array(size);
    // Per node, over its marks: the sum of roles; the lowest running sum; the lowest running sum
    // right after a closer; the highest level offset of a quote in its plain form and the lowest of
    // one in its nested form (an opener counts the sum before it, a closer the sum after it); how
    // many nested marks of any role.
    this.sum = new Int32Array(2 * size);
    this.low = new Int32Array(2 * size);
    this.lowClose = new Int32Array(2 * size);
    this.highPlain = new Int32Array(2 * size);
    this.lowNested = new Int32Array(2 * size);
    this.marked = new Int32Array(2 * size);
    this.candidate = new Int32Array(length);
    this.unread = new Int32Array(length + 1);
    this.acc = 0;
    this.base = 0;
    this.nest = true;

    for (let k = 0; k < length; k++) {
      const ch = buf[at[k]];
      const typed = source[at[k]];

      if (typed === LAQUO || typed === RAQUO) {
        this.role[k] = ch === LAQUO || ch === BDQUO ? 1 : -1;
      }

      const closes = ch === RAQUO || ch === LDQUO;
      if (at[k] >= fromAt && this.role[k] < 0) {
        inches.rememberClose(buf, at[k]);
      }
      this.candidate[k] = closes && inches.digitBefore(buf, at[k]) !== -1 ? k : k - 1;
      this.unread[k] = typed === BDQUO || typed === LDQUO ? k : k + 1;
    }

    this.unread[length] = length;

    for (let k = 0; k < size; k++) {
      this.leaf(k);
    }

    for (let node = size - 1; node > 0; node--) {
      this.pull(node);
    }
  }

  // The index of the first mark at or after character `pos`: the balanced point right after a quote
  // is the index of the mark that follows it.
  indexAt(pos) {
    let lo = 0;
    let hi = this.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (this.at[mid] < pos) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }

  write(k, ch, role = this.role[k]) {
    const pos = this.at[k];

    if (this.buf[pos] === ch && this.role[k] === role) {
      return;
    }

    this.buf[pos] = ch;
    this.role[k] = role;

    if (ch !== RAQUO && ch !== LDQUO && this.candidate[k] === k) {
      this.candidate[k] = k - 1;
    }

    this.update(k);
  }

  // The first closer at or after `from` that takes `level` below zero, or -1.
  closerBelow(from, level) {
    this.acc = 0;

    return this.drop(1, 0, this.size - 1, from, -level - 1);
  }

  // The closers in [from, to) that bring `level` at `from` back to zero, as one stack entry, or null:
  // the closers whose running sum from the chunk start is at most `target`, each standing for the
  // balanced point right after it.
  zeros(from, to, level) {
    const target = this.total(0, from) - level;
    const last = this.lastAtMost(from, to, target);

    return last === -1 ? null : { from, to: last + 1, target };
  }

  // The last closer in [from, to) whose running sum from the chunk start is at most `target`, or -1.
  lastAtMost(from, to, target) {
    return this.lastClose(1, 0, this.size - 1, 0, from, to, target);
  }

  // Gives every quote in [from, to) the form its level gives it, `level` being the one at `from`.
  restyle(from, to, level, nest) {
    this.nest = nest;

    for (let k = from, base = level; ;) {
      this.acc = 0;
      this.base = base;
      const j = this.wrong(1, 0, this.size - 1, k);

      if (j === -1 || j >= to) {
        return;
      }

      const before = base + this.acc;

      if (this.role[j] > 0) {
        this.write(j, nest && before > 0 ? BDQUO : LAQUO);
      } else {
        this.write(j, nest && before > 1 ? LDQUO : RAQUO);
      }

      base = before + this.role[j];
      k = j + 1;
    }
  }

  total(from, to) {
    let sum = 0;

    for (let l = from + this.size, r = to + this.size; l < r; l >>= 1, r >>= 1) {
      if (l & 1) {
        sum += this.sum[l++];
      }

      if (r & 1) {
        sum += this.sum[--r];
      }
    }

    return sum;
  }

  hasNested(from, to) {
    let count = 0;

    for (let l = from + this.size, r = to + this.size; l < r; l >>= 1, r >>= 1) {
      if (l & 1) {
        count += this.marked[l++];
      }

      if (r & 1) {
        count += this.marked[--r];
      }
    }

    return count > 0;
  }

  // The last closer at or before `k` that follows a digit, or -1.
  lastInchQuote(k) {
    let root = k;

    while (root >= 0 && this.candidate[root] !== root) {
      root = this.candidate[root];
    }

    for (let i = k; i > root;) {
      const next = this.candidate[i];
      this.candidate[i] = root;
      i = next;
    }

    return root;
  }

  // Turns the unread nested marks in [from, to) into quotes the walk reads.
  activate(from, to) {
    for (let k = this.firstUnread(from); k < to; k = this.firstUnread(k + 1)) {
      this.unread[k] = k + 1;
      this.role[k] = this.buf[this.at[k]] === BDQUO ? 1 : -1;
      this.update(k);
    }
  }

  restore(from) {
    for (let k = from; k < this.length; k++) {
      const pos = this.at[k];

      if (this.buf[pos] === BDQUO) {
        this.buf[pos] = LAQUO;
      } else if (this.buf[pos] === LDQUO) {
        this.buf[pos] = RAQUO;
      }
    }
  }

  firstUnread(from) {
    let root = from;

    while (this.unread[root] !== root) {
      root = this.unread[root];
    }

    for (let i = from; i < root;) {
      const next = this.unread[i];
      this.unread[i] = root;
      i = next;
    }

    return root;
  }

  drop(node, lo, hi, from, target) {
    if (hi < from) {
      return -1;
    }

    if (lo >= from) {
      if (this.acc + this.low[node] > target) {
        this.acc += this.sum[node];

        return -1;
      }

      if (lo === hi) {
        return lo;
      }
    }

    const mid = (lo + hi) >> 1;
    const left = this.drop(2 * node, lo, mid, from, target);

    return left === -1 ? this.drop(2 * node + 1, mid + 1, hi, from, target) : left;
  }

  lastClose(node, lo, hi, before, from, to, target) {
    if (hi < from || lo >= to || before + this.lowClose[node] > target) {
      return -1;
    }

    if (lo === hi) {
      return lo;
    }

    const mid = (lo + hi) >> 1;
    const l = 2 * node;
    const right = this.lastClose(l + 1, mid + 1, hi, before + this.sum[l], from, to, target);

    return right === -1 ? this.lastClose(l, lo, mid, before, from, to, target) : right;
  }

  wrong(node, lo, hi, from) {
    if (hi < from) {
      return -1;
    }

    if (lo >= from) {
      const level = this.base + this.acc;
      const wrong = this.nest
        ? level + this.highPlain[node] > 0 || level + this.lowNested[node] < 1
        : this.lowNested[node] < FAR / 2;

      if (!wrong) {
        this.acc += this.sum[node];

        return -1;
      }

      if (lo === hi) {
        return lo;
      }
    }

    const mid = (lo + hi) >> 1;
    const left = this.wrong(2 * node, lo, mid, from);

    return left === -1 ? this.wrong(2 * node + 1, mid + 1, hi, from) : left;
  }

  leaf(k) {
    const node = this.size + k;
    const role = this.role[k];
    const ch = k < this.length ? this.buf[this.at[k]] : '';
    const nestedForm = ch === BDQUO || ch === LDQUO;
    const offset = role > 0 ? 0 : -1;

    this.sum[node] = role;
    this.low[node] = role;
    this.lowClose[node] = role < 0 ? -1 : FAR;
    this.highPlain[node] = role !== 0 && !nestedForm ? offset : -FAR;
    this.lowNested[node] = role !== 0 && nestedForm ? offset : FAR;
    this.marked[node] = nestedForm ? 1 : 0;
  }

  pull(node) {
    const l = 2 * node;
    const r = l + 1;
    const left = this.sum[l];

    this.sum[node] = left + this.sum[r];
    this.low[node] = Math.min(this.low[l], left + this.low[r]);
    this.lowClose[node] = Math.min(this.lowClose[l], left + this.lowClose[r]);
    this.highPlain[node] = Math.max(this.highPlain[l], left + this.highPlain[r]);
    this.lowNested[node] = Math.min(this.lowNested[l], left + this.lowNested[r]);
    this.marked[node] = this.marked[l] + this.marked[r];
  }

  update(k) {
    this.leaf(k);

    for (let node = (this.size + k) >> 1; node > 0; node >>= 1) {
      this.pull(node);
    }
  }
}

// The rest of `processChunk` from the unmatched closer just before `off`, a character offset like
// the stack and `lastBalanced` it hands over. Each conversion resumes from a balanced point and reads
// the quotes after it again, so here offsets count quote marks instead, and up to the first closer
// that finds no quotation open (the level never drops below zero there) the whole run is one step:
// every quote takes the form its level gives it, and the closers that bring the level to zero go on
// the stack as one entry. Every unmatched closer turns a mark for good — a candidate into a prime,
// itself into an opener or a straight quote — so there are O(n) steps, each O(log n) plus O(log n)
// per mark it rewrites.
function walkBack(
  chunk,
  buf,
  balancedPoints,
  lastBalancedAt,
  offAt,
  allowNested,
  checkBudget,
  kept,
  inlineContext,
  inches
) {
  // Without astral characters a string index is a code-point index, and the copy is the whole cost
  // of a short chunk.
  const marks = new QuoteMarks(
    buf,
    chunk.length === buf.length ? chunk : [...chunk],
    inches,
    offAt - 1
  );
  const balancedStack = balancedPoints.map((pos) => marks.indexAt(pos));
  let lastBalanced = marks.indexAt(lastBalancedAt);
  let off = tryConvertInches(marks, marks.indexAt(offAt), balancedStack, kept);
  let level = 0;
  let iter = 0;

  while (true) {
    if (checkBudget && (iter++ & 0x3ff) === 0) {
      checkBudget('quote:processChunk');
    }

    const p = marks.closerBelow(off, level);
    const end = p === -1 ? marks.length : p;
    const zeros = marks.zeros(off, end, level);

    marks.restyle(off, end, level, allowNested);

    if (zeros) {
      lastBalanced = zeros.to;
      balancedStack.push(zeros);
    }

    if (p === -1) {
      level += marks.total(off, end);
      break;
    }

    marks.write(p, RAQUO);
    off = p + 1;

    if (!kept(buf, marks.at[p]) && opensHere(buf, marks.at[p], inlineContext)) {
      marks.write(p, LAQUO, 1);
      level = 1;
    } else {
      off = tryConvertInches(marks, off, balancedStack, kept);
      level = 0;
    }
  }

  if (level > 0) {
    marks.restore(lastBalanced);
  }

  return inches.settle(buf);
}

// Settles the unmatched closer just before `off` and returns the offset the walk resumes from, at
// level zero. The character before a balanced point is a quote, never a digit, so no inch candidate
// stands on one: a candidate past `candidateStart` is one at its index or later. Candidates only drop
// out, so the last one before the closer answers every start the stack offers, and the start is the
// latest balanced point at or before it. An empty stack offers the chunk start once.
function tryConvertInches(marks, off, balancedStack, kept) {
  const quotePos = marks.lastInchQuote(off - 1);
  const candidateStart = balancedStack.length ? popBalanced(marks, balancedStack, quotePos) : 0;

  if (candidateStart !== -1 && quotePos >= candidateStart) {
    const hadNestedMarks = marks.hasNested(candidateStart, off);

    // The walk resumes from `candidateStart` and rewrites every quote it passes, so of the restore
    // only the nested marks it has never read are left to do: they become quotes it reads.
    if (hadNestedMarks) {
      marks.activate(candidateStart, off);
    }

    marks.inches.release(marks.buf, marks.at[quotePos]);
    marks.write(quotePos, G.PRIME, 0);
    balancedStack.push(candidateStart);

    return candidateStart;
  }

  marks.inches.forgetClose(marks.at[off - 1]);
  if (kept(marks.buf, marks.at[off - 1])) {
    marks.write(off - 1, RAQUO, 0);
  } else {
    marks.write(off - 1, '"', 0);
    marks.inches.demote(marks.buf, marks.at[off - 1]);
  }
  balancedStack.length = 0;
  balancedStack.push(off);

  return off;
}

// Takes balanced points off the stack down to the latest one at or before `limit` and returns it, or
// -1 once the stack runs out. An entry is a single point or the run `zeros` made of one step; a run
// gives up its points above the one returned and keeps the rest.
function popBalanced(marks, balancedStack, limit) {
  while (balancedStack.length) {
    const top = balancedStack.at(-1);

    if (typeof top === 'number') {
      balancedStack.pop();

      if (top <= limit) {
        return top;
      }

      continue;
    }

    const closer = marks.lastAtMost(top.from, Math.min(top.to, limit), top.target);

    if (closer === -1) {
      balancedStack.pop();
      continue;
    }

    top.to = closer;

    if (marks.lastAtMost(top.from, closer, top.target) === -1) {
      balancedStack.pop();
    }

    return closer + 1;
  }

  return -1;
}

// What makes a straight quote a measurement rather than a delimiter. The role assignment in
// `quote.js` asks the same question before this state machine runs, and the two have to agree: a
// mark counted as a closer there is one this pass will turn into a prime.
export function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function restoreNestedMarks(buf, start, end) {
  for (let i = start; i < end; i++) {
    if (buf[i] === BDQUO) {
      buf[i] = LAQUO;
    } else if (buf[i] === LDQUO) {
      buf[i] = RAQUO;
    }
  }
}
