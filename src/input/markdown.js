import { MicroTypoInputError } from '../errors/index.js';
import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from '../lib/block-tags.js';
import { isFlowSpace, lineView, skipSpaces } from '../lib/strings.js';
import { CLOSE, OPEN } from '../protect/placeholders.js';
import {
  COMMENT_CLOSE,
  COMMENT_OPEN,
  emptyCommentClose,
  insideTag,
  namedAt,
  tagSpans
} from '../protect/tag-spans.js';
import { collectSpans } from './span-path.js';

// Per-attempt scan bound that keeps link-destination scanning linear; an overrun destination
// fails closed.
const MAX_LINK_SCAN = 8192;

// A scan stopped by the bound, as opposed to no close before EOF, where literal prose is correct.
const OVERLIMIT = Symbol('md-link-overlimit');

const FENCE_CHAR = { '`': true, '~': true };

// Markdown measures indentation in columns and a tab advances to the next multiple of four, so a
// character's index is not the column it stands in. CommonMark §2.2.
const TAB_STOP = 4;

function advance(text, at, column) {
  return text[at] === '\t' ? column + TAB_STOP - (column % TAB_STOP) : column + 1;
}

function skipIndent(text, i, end, column) {
  let at = i;
  let col = column;

  while (at < end && (text[at] === ' ' || text[at] === '\t')) {
    col = advance(text, at, col);
    at += 1;
  }

  return [at, col];
}

// Four columns of indent make a line code, so a block construct may carry at most three, counted
// from `base` — the container's content column, which is not always where the cursor stands, since a
// tab straddling that column carries the cursor past it.
function skipBlockIndent(text, i, end, column, base = column) {
  let at = i;
  let col = column;

  while (at < end && (text[at] === ' ' || text[at] === '\t')) {
    const next = advance(text, at, col);

    if (next > base + 3) {
      break;
    }

    col = next;
    at += 1;
  }

  return [at, col];
}

// Where a column falls, over whitespace only. A tab is never split, so the answer is the first index
// at or past the target column.
function indexAtColumn(text, i, end, column, target) {
  let at = i;
  let col = column;

  while (at < end && col < target && (text[at] === ' ' || text[at] === '\t')) {
    col = advance(text, at, col);
    at += 1;
  }

  return [at, col];
}

// Where a blockquote's content begins: the `>` plus one optional space, which a tab may be. A tab is
// never split, so where one straddles the column the cursor stays on it and only the column moves,
// leaving what the tab still spends as indentation. CommonMark §5.1, §2.2.
function afterQuoteMarker(text, mark, markColumn) {
  const next = text[mark + 1];

  if (next === ' ') {
    return [mark + 2, markColumn + 2];
  }

  if (next !== '\t') {
    return [mark + 1, markColumn + 1];
  }

  const stop = advance(text, mark + 1, markColumn + 1);

  return stop <= markColumn + 2 ? [mark + 2, stop] : [mark + 1, markColumn + 2];
}

// The `\r` of a CRLF pair belongs to the break, not to the line in front of it. CommonMark §2.1.
function contentEnd(text, start, stop) {
  return stop > start && text[stop - 1] === '\r' ? stop - 1 : stop;
}

// CRLF input reaches this layer before the pipeline normalises newlines, so a line ends at its
// content rather than at its `\r`.
function* eachLine(text, label, checkBudget) {
  const n = text.length;
  let i = 0;
  let lines = 0;

  while (i < n) {
    if ((lines++ & 0x3ff) === 0) {
      checkBudget?.(label);
    }

    const lineEnd = text.indexOf('\n', i);
    const next = lineEnd === -1 ? n : lineEnd + 1;

    yield [i, contentEnd(text, i, lineEnd === -1 ? n : lineEnd)];
    i = next;
  }
}

// Code spans, template expressions and raw HTML, an element or a comment, are opaque to one another,
// and which of them a stretch belongs to is settled by which opened first: one walk over the
// document, asking each reader for the first construct at or after the walk's own position. Only code
// spans and templates become spans here; raw HTML is protected by passes of its own and is read only
// so that a backtick inside it pairs with none outside. Every reader answers from the document's own
// bytes and never from a masked copy, where a blanked-out region reads as ordinary text to whichever
// scanner is handed it.
export function opaqueInline(codeReaderFor, templateReaderFor = null, owned = []) {
  return (text, checkBudget, resolve) => {
    const readers = [];

    for (const readerFor of [codeReaderFor, templateReaderFor]) {
      if (readerFor !== null) {
        const next = readerFor(text, checkBudget, resolve);

        readers.push({ next, at: next(0), report: true });
      }
    }

    // With nothing to report, what raw HTML owns changes nothing.
    if (readers.every(({ at }) => at === null)) {
      return [];
    }

    for (const readerFor of owned) {
      const next = readerFor(text, checkBudget);

      readers.push({ next, at: next(0), report: false });
    }

    const spans = [];
    let steps = 0;

    while (readers.some(({ at, report }) => report && at !== null)) {
      if ((steps++ & 0x3ff) === 0) {
        checkBudget?.('md-inline-opaque');
      }

      // A code span is reported by its content and the rest by the whole construct, so on equal
      // starts the code span's backticks opened first; its reader comes first.
      let won = null;

      for (const reader of readers) {
        if (reader.at !== null && (won === null || reader.at[0] < won.at[0])) {
          won = reader;
        }
      }

      if (won.report) {
        spans.push([won.at[0], won.at[1]]);
      }

      // Past the construct's last byte, which for a code span is behind the backticks that closed it.
      const cursor = won.at[2];

      for (const reader of readers) {
        if (reader.at !== null && reader.at[0] < cursor) {
          reader.at = reader.next(cursor);
        }
      }
    }

    return spans;
  };
}

// A backtick fence forbids a backtick in the rest of the opening line, its info string; a tilde
// fence does not. `pos` is already past the three columns a construct may carry and must not be
// advanced again: four columns in, the same run is indented code.
function fenceOpenAt(text, pos, lineEnd) {
  const i = pos;
  const char = text[i];

  if (!FENCE_CHAR[char]) {
    return null;
  }

  let j = i;

  while (text[j] === char) {
    j += 1;
  }

  const len = j - i;

  if (len < 3) {
    return null;
  }

  if (char === '`' && text.slice(j, lineEnd).includes('`')) {
    return null;
  }

  return { char, len };
}

function fenceCloseAt(text, pos, lineEnd, column, content, char, minLen) {
  const [i] = skipBlockIndent(text, pos, lineEnd, column, content);
  let j = i;

  while (j < lineEnd && text[j] === char) {
    j += 1;
  }

  if (j - i < minLen) {
    return -1;
  }

  // The trailing spaces belong to the closing line, so the block ends behind them.
  const after = skipSpaces(text, j, lineEnd);

  return after === lineEnd ? after : -1;
}

// The lines of an HTML block are HTML, whatever they spell, so they open no fence. `readOpaque` is
// what `scanUnclosedHtmlBlock` is handed, so both agree on where a block opens.
export function scanFences(source, checkBudget, readOpaque) {
  const text = lineView(source);
  const n = text.length;
  const spans = [];
  const opensHtml = htmlBlockOpener(text, readOpaque);
  const ends = new Map();
  const tick = lineTicker(checkBudget, 'md-fence');
  let i = 0;
  // The containers still open where the walk stands: a fence opens at its own container's content
  // column, which is not always written on the fence's own line.
  const chain = [];
  let paragraphOpen = false;

  while (i < n) {
    tick();

    const nl = text.indexOf('\n', i);
    const lineEnd = contentEnd(text, i, nl === -1 ? n : nl);
    const before = paragraphOpen;
    const { place, fresh, paragraphOpen: after } = walkLine(text, i, lineEnd, chain, before);
    const open = fenceOpenAt(text, place.content, lineEnd);

    if (!open) {
      const html = opensHtml(place.content, !before || fresh);

      paragraphOpen = html === null && after;
      i = nl === -1 ? n : nl + 1;

      if (html !== null) {
        i = htmlBlockEnd(text, place.content, html, i, nl, lineEnd, chain, ends, tick).next;
      }

      continue;
    }

    // A fence is a block of its own, so what follows the block it closes starts fresh.
    paragraphOpen = false;

    const containers = [...chain];

    const start = i;
    let cursor = nl === -1 ? n : nl + 1;
    let end = n;
    // The last line still inside the opener's container: blank lines under it are the paragraph break
    // around what follows, not part of the block.
    let inside = nl === -1 ? n : nl;

    while (cursor < n) {
      tick();

      const brk = text.indexOf('\n', cursor);
      const stop = brk === -1 ? n : brk;
      const lineStop = contentEnd(text, cursor, stop);
      // A line that leaves any container of the chain the opening line wrote leaves the fence too.
      const line = matchContainers(text, cursor, lineStop, containers);

      if (line.matched < containers.length) {
        end = inside;
        break;
      }

      const blank = skipSpaces(text, line.at, lineStop) === lineStop;
      const closeEnd = blank
        ? -1
        : fenceCloseAt(text, line.at, lineStop, line.column, line.content, open.char, open.len);

      if (closeEnd !== -1) {
        end = closeEnd;
        break;
      }

      if (!blank) {
        inside = stop;
      }

      cursor = brk === -1 ? n : brk + 1;
    }

    spans.push([start, end]);
    i = end;
  }

  return spans;
}

// A code span closes on a backtick run of exactly the opener's length, so every run's closer is
// resolved once in a backward pass rather than by a forward rescan per opener.
function backtickRuns(text) {
  const n = text.length;
  const runs = [];
  const nextOfLength = new Map();
  let i = 0;
  // A code span lives inside one paragraph, so a run cannot pair with one across a blank line. The
  // boundaries are run indexes rather than a field on every run, which a document of one paragraph
  // would pay for on each of them.
  const paragraphs = [];

  while (i < n) {
    if (text[i] === '\n') {
      const after = skipSpaces(text, i + 1, n);

      if (
        after >= n ||
        text[after] === '\n' ||
        (text[after] === '\r' && text[after + 1] === '\n')
      ) {
        paragraphs.push(runs.length);
      }

      i += 1;
      continue;
    }

    if (text[i] !== '`') {
      i += 1;
      continue;
    }

    // A backslash escapes only the backtick behind it, so an escaped run opens with a delimiter one
    // shorter. It says nothing about closing: inside a span a backslash is literal content. Hence two
    // lengths per run, and the one a run is looked up by is not the one it is stored under.
    let slashes = 0;

    while (i - slashes - 1 >= 0 && text[i - slashes - 1] === '\\') {
      slashes += 1;
    }

    const start = i;

    while (i < n && text[i] === '`') {
      i += 1;
    }

    const len = i - start;

    runs.push({ start, len, openLen: slashes % 2 === 1 ? len - 1 : len, close: -1 });
  }

  let boundary = paragraphs.length - 1;

  for (let r = runs.length - 1; r >= 0; r -= 1) {
    while (boundary >= 0 && paragraphs[boundary] > r) {
      nextOfLength.clear();
      boundary -= 1;
    }

    runs[r].close = nextOfLength.get(runs[r].openLen) ?? -1;
    nextOfLength.set(runs[r].len, r);
  }

  return runs;
}

// The first code span at or past `from`, as `[start, end, after]` — its content, and the position
// behind the backticks that closed it. Which run closes which is a fact about the runs alone, so the
// document is read once and every later answer comes from that pass.
export function codeSpanReader(text, checkBudget) {
  if (!text.includes('`')) {
    return () => null;
  }

  checkBudget?.('md-code-span');

  const runs = backtickRuns(lineView(text));
  let i = 0;

  return (from) => {
    // Three kinds of run that can never open a span here: one the walk has passed, one whose only
    // backtick a backslash took, and one no later run of its length answers. The last two may still
    // close a span opened before them, which is read off that span's own run.
    while (
      i < runs.length &&
      (runs[i].start < from || runs[i].openLen === 0 || runs[i].close === -1)
    ) {
      i += 1;
    }

    if (i === runs.length) {
      return null;
    }

    const { start, len, close } = runs[i];
    const closer = runs[close];

    return [start + len, closer.start, closer.start + closer.len];
  };
}

export function scanCodeSpans(text, checkBudget) {
  return collectSpans(codeSpanReader(text, checkBudget));
}

// Three or more of `-`, `*` or `_` with nothing but whitespace between them is a thematic break
// wherever it stands, and a break is no container. A break is a tail of the line, so one walk from
// the right serves every container level: the region from `mark` is a break exactly between where
// the tail starts and where its third-from-last character stands.
function thematicTail(text, i, end) {
  let char = '';
  let seen = 0;
  let third = -1;
  let from = end;

  for (let j = end - 1; j >= i; j -= 1) {
    const c = text[j];

    if (c === ' ' || c === '\t') {
      from = j;
      continue;
    }

    if ((c !== '-' && c !== '*' && c !== '_') || (char !== '' && c !== char)) {
      break;
    }

    char = c;
    seen += 1;
    from = j;

    if (seen === 3) {
      third = j;
    }
  }

  return third === -1 ? null : { from, third };
}

function isThematicBreak(tail, mark) {
  return tail !== null && mark >= tail.from && mark <= tail.third;
}

// A list interrupts a paragraph only on its own terms: its first line has to carry content, and an
// ordered one has to start at 1.
function interruptsParagraph(text, mark, token, end) {
  if (skipSpaces(text, token, end) === end) {
    return false;
  }

  const c = text[mark];

  if (c === '-' || c === '*' || c === '+') {
    return true;
  }

  // The number the marker means, not the way it is spelled: `01.` and `001)` start at 1 too.
  // CommonMark §5.3.
  return /^0*1$/.test(text.slice(mark, token - 1));
}

// A list item's content column is where the spaces behind its marker end, but at most four columns
// past the marker: five or more make the rest an indented code block inside the item, whose column
// is not the item's. CommonMark §5.2.
function itemContentColumn(text, token, end, markerColumn) {
  const [at, column] = skipIndent(text, token, end, markerColumn);

  return at === end || column - markerColumn > TAB_STOP ? markerColumn + 1 : column;
}

// Where the first blockquote of the chain stands, carried on each container so a blank line is
// answered without a walk. A stack truncates from the end, so the value stays right for every
// surviving prefix. `length` is how much of `chain` is live rather than allocated: a line that may
// yet turn out to be a lazy continuation is answered before its tail is cut off.
function firstQuoteIn(chain, length, quote) {
  const before = length === 0 ? -1 : chain[length - 1].firstQuote;

  return before === -1 && quote ? length : before;
}

// How much of an open container chain a line continues, and where its content begins past what
// matched. A blockquote is left by any line that does not repeat its `>`, blank or not — a blank
// line ends the quote. A list item is left only by a non-blank line short of its content column; a
// blank line stays inside it, which is how a fenced block spans the blank lines of its own item.
function matchContainers(text, start, end, containers) {
  // A blank line stays inside every list item and leaves every blockquote, so what it matches is the
  // run in front of the first quote — a number each container already carries.
  if (skipSpaces(text, start, end) === end) {
    const first = containers.length === 0 ? -1 : containers.at(-1).firstQuote;
    const [blankAt, blankColumn] = skipIndent(text, start, end, 0);

    return {
      matched: first === -1 ? containers.length : first,
      at: blankAt,
      column: blankColumn,
      content: blankColumn
    };
  }

  let at = start;
  let column = 0;
  // Where the chain says its content begins, which is not always where the cursor stands: a tab
  // straddling that column carries the cursor past it, and every column-measured bound counts from
  // the chain's answer.
  let content = 0;
  let matched = 0;

  while (matched < containers.length) {
    const container = containers[matched];

    if (container.quote) {
      const [mark, markColumn] = skipBlockIndent(text, at, end, column, content);

      if (mark >= end || text[mark] !== '>') {
        break;
      }

      [at, column] = afterQuoteMarker(text, mark, markColumn);
      content = column;
      matched += 1;
      continue;
    }

    // An offset from where this line's own container content starts, never an absolute column: a
    // blockquote prefix spelled with a different indent moves everything inside it.
    const target = content + container.column;

    // Only as far as that column, never to the end of the indent: each level starts where the one
    // above it stopped, so the whole prefix costs no more than the prefix.
    const [next, nextColumn] = indexAtColumn(text, at, end, column, target);

    // Content standing short of the column has left the item. A line with nothing but whitespace
    // left stays inside it — that is how a fenced block spans the blank lines of its own item.
    if (nextColumn < target && next < end) {
      break;
    }

    at = next;
    column = nextColumn;
    content = target;
    matched += 1;
  }

  return { matched, at, column, content };
}

// The containers this line opens past what an outer chain already matched, appended to `into` in the
// order the line writes them, plus where the line's own content begins.
//
// Containers alternate, and each carries the column its own content starts at as an offset from the
// container around it: a single depth and one summed indent could carry neither the order nor the
// offsets. A heading marker is deliberately not a container — `# [м]: url` is heading text, not a
// definition.
//
// `paragraphOpen` says whether these containers would have to interrupt a paragraph to exist, which
// a list may only do on its own terms (CommonMark §5.3). `from` is where this line's containers
// begin in `into`, and they are written from there rather than pushed: the chain past it belongs to
// the caller until the line has proved it does not continue the paragraph inside it.
function openContainers(text, at, end, column, into, from = 0, paragraphOpen = false) {
  let base = at;
  let baseColumn = column;
  let count = from;
  // The paragraph a list would have to interrupt is the one outside every container this line has
  // already opened: inside a blockquote just opened there is no paragraph left to refuse anything.
  let open = paragraphOpen;
  const tail = thematicTail(text, at, end);

  for (;;) {
    const [mark, markColumn] = skipBlockIndent(text, base, end, baseColumn);

    if (mark < end && text[mark] === '>') {
      const [next, nextColumn] = afterQuoteMarker(text, mark, markColumn);

      into[count] = {
        quote: true,
        column: nextColumn - baseColumn,
        firstQuote: firstQuoteIn(into, count, true)
      };
      count += 1;
      base = next;
      baseColumn = nextColumn;
      open = false;
      continue;
    }

    const container = mark < end && text[mark] !== '#' && !isThematicBreak(tail, mark);
    const token = container ? markerTokenEnd(text, mark, end) : mark;

    if (token === mark || (open && !interruptsParagraph(text, mark, token, end))) {
      return { base, baseColumn, content: mark, contentColumn: markColumn, opened: count - from };
    }

    const markerColumn = markColumn + (token - mark);
    const contentColumn = itemContentColumn(text, token, end, markerColumn);

    into[count] = {
      quote: false,
      column: contentColumn - baseColumn,
      firstQuote: firstQuoteIn(into, count, false)
    };
    count += 1;

    open = false;

    // Where the cursor actually lands, not the column asked for: a tab is never split, so one
    // straddling the content column carries the cursor past it and spends every column it covers.
    [base, baseColumn] = indexAtColumn(text, token, end, markerColumn, contentColumn);
  }
}

// A line that is nothing but a placeholder is a construct an earlier scanner vaulted whole. Its
// interior is opaque here, so it is read by its shape.
function placeholderLineEnd(text, i, end) {
  if (text[i] !== OPEN) {
    return -1;
  }

  let j = i + 1;

  while (j < end && text[j] !== CLOSE) {
    j += 1;
  }

  return j < end ? j + 1 : -1;
}

// Seven of them is prose again, so the run may not outgrow the six heading levels.
function hashRunEnd(text, i, end) {
  let j = i;

  while (j < end && j < i + 6 && text[j] === '#') {
    j += 1;
  }

  return j;
}

const RAW_BLOCK_NAMES = new Set(['pre', 'script', 'style', 'textarea']);

// The tags that open an HTML block of kind 6, wherever they stand, a paragraph's next line included.
// CommonMark 0.31.2 §4.6.
const BLOCK_KIND_6_NAMES = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul'
]);

// An HTML block opens with one of these, and a paragraph cannot continue past it. `pre`, `script`,
// `style` and `textarea` are the four whose block runs to their own closing tag; the rest are the
// elements HTML forbids inside `<p>`, which is the same question asked from the other side.
const HTML_BLOCK_NAMES = new Set([...RAW_BLOCK_NAMES, ...BLOCK_TAG_NAMES, ...VOID_BLOCK_TAG_NAMES]);

function opensHtmlBlock(text, i, end) {
  if (text[i] !== '<') {
    return false;
  }

  // `<!--`, `<!DOCTYPE`, `<?` open a block of their own, whatever follows them.
  if (text[i + 1] === '!' || text[i + 1] === '?') {
    return true;
  }

  const nameStart = text[i + 1] === '/' ? i + 2 : i + 1;
  let j = nameStart;

  while (j < end && /[a-zA-Z0-9-]/.test(text[j])) {
    j += 1;
  }

  return j > nameStart && HTML_BLOCK_NAMES.has(text.slice(nameStart, j).toLowerCase());
}

// A block that has finished, so the line under it opens a new one: a fence, an ATX heading, a
// thematic break or setext underline, an HTML block, and a construct an earlier scanner vaulted
// whole. `paragraphOpen` tells a setext underline from a list marker — `-` alone under a paragraph
// underlines it, and elsewhere it opens an empty list item.
function closesBlock(text, start, end, column, paragraphOpen) {
  // A fenced block interrupts a paragraph, so the line opening one is not a lazy continuation and the
  // containers it left stay left. Asked at the line's own content, never past a second indent: four
  // columns in, the same run is indented code, which interrupts nothing.
  if (fenceOpenAt(text, start, end) !== null) {
    return true;
  }

  const [i] = skipBlockIndent(text, start, end, column);
  const c = text[i];

  // A heading with no content still ends the block above it, unlike in the marker walk, where an
  // empty heading leaves no prefix to protect.
  if (c === '#') {
    const j = hashRunEnd(text, i, end);

    return j === end || text[j] === ' ' || text[j] === '\t';
  }

  if (c === OPEN) {
    const after = placeholderLineEnd(text, i, end);

    return after !== -1 && skipSpaces(text, after, end) === end;
  }

  if (c === '<') {
    return opensHtmlBlock(text, i, end);
  }

  // A reference definition is deliberately absent: it is taken from the front of a paragraph and
  // does not end one, so the line under it still continues that paragraph.
  if (isThematicBreak(thematicTail(text, i, end), i)) {
    return true;
  }

  // A run of `=` or `-` underlines the paragraph above it and means nothing without one: elsewhere
  // `-` opens an empty list item, and the line below belongs to its content column.
  if (!paragraphOpen || (c !== '-' && c !== '=')) {
    return false;
  }

  for (let j = i; j < end; j += 1) {
    if (text[j] !== c && text[j] !== ' ' && text[j] !== '\t') {
      return false;
    }
  }

  return true;
}

// Whether a paragraph is open after this line, which decides what the next line may start. Indented
// code and an empty list item are blocks rather than prose.
//
// `paragraphOpen` is the same answer for the line before, and `fresh` says this line opened a
// container of its own. Indented code needs both: four columns under an open paragraph are that
// paragraph's lazy continuation, not code.
function paragraphOpenAfter(text, end, place, paragraphOpen, fresh) {
  const { base, baseColumn, content, contentColumn } = place;

  if (content === end) {
    return false;
  }

  const [, textColumn] = skipIndent(text, base, end, baseColumn);

  if ((!paragraphOpen || fresh) && textColumn - baseColumn >= TAB_STOP) {
    return false;
  }

  return !closesBlock(text, content, end, contentColumn, paragraphOpen && !fresh);
}

// One line's container bookkeeping; `open` is the live chain and is updated here.
//
// Laziness comes with it: a line that leaves a container, opens none of its own and is still
// paragraph text continues the paragraph inside that container, so the container stays open.
function walkLine(text, start, end, open, paragraphOpen) {
  const line = matchContainers(text, start, end, open);
  const left = line.matched < open.length;
  const place = openContainers(
    text,
    line.at,
    end,
    line.column,
    open,
    line.matched,
    paragraphOpen && !left
  );
  const fresh = place.opened > 0;
  const after = paragraphOpenAfter(text, end, place, paragraphOpen, fresh);
  // The chain is cut only once the line has proved it does not continue the paragraph inside what it
  // left; nothing was written over that tail, because a line opening a container of its own is never
  // the lazy one.
  if (!left || fresh || !paragraphOpen || !after) {
    open.length = line.matched + place.opened;
  }

  return { place, fresh, paragraphOpen: after };
}

// Indented code cannot interrupt a paragraph, so an indented line is code only where no paragraph is
// open: at the document start, after a blank line, continuing a code line, or under a block that has
// finished. The lines of an HTML block are HTML, whatever they spell, and `readOpaque` is what
// `scanUnclosedHtmlBlock` is handed to tell them.
export function scanIndentedCode(source, checkBudget, readOpaque) {
  // A span needs a tab or four spaces at a content column, and a structured document runs this once
  // per value, so the precondition is asked first.
  if (!source.includes('\t') && !source.includes('    ')) {
    return [];
  }

  const text = lineView(source);
  const n = text.length;
  const spans = [];
  const opensHtml = htmlBlockOpener(text, readOpaque);
  const ends = new Map();
  const tick = lineTicker(checkBudget, 'md-indented-code');
  let i = 0;
  // The chunk being accumulated. An indented code block is one or more chunks separated by blank
  // lines (CommonMark §4.4), so those blank lines are inside the block and must not fall outside the
  // span, where the newline collapse would rewrite them. Trailing blank lines are not part of it,
  // which is why the span is extended only when another code line arrives.
  let chunk = null;
  let paragraphOpen = false;
  // The containers still open where the walk stands. Indentation is measured from the innermost
  // one's content column, and a list item is one of them.
  const open = [];

  while (i < n) {
    tick();

    const nl = text.indexOf('\n', i);
    const end = contentEnd(text, i, nl === -1 ? n : nl);
    const { place, fresh, paragraphOpen: after } = walkLine(text, i, end, open, paragraphOpen);
    const [, textColumn] = skipIndent(text, place.base, end, place.baseColumn);
    // A container opened on this line starts a block of its own, so what follows it starts fresh. A
    // line that leaves one is a lazy continuation, which indented code still cannot interrupt.
    const blank = place.content === end;
    const code = !blank && (fresh || !paragraphOpen) && textColumn - place.baseColumn >= TAB_STOP;
    const html = code || blank ? null : opensHtml(place.content, !paragraphOpen || fresh);

    if (code) {
      if (chunk) {
        chunk[1] = end;
      } else {
        chunk = [place.base, end];
        spans.push(chunk);
      }
    } else if (!blank) {
      chunk = null;
    }

    paragraphOpen = html === null && after;
    i = nl === -1 ? n : nl + 1;

    if (html !== null) {
      i = htmlBlockEnd(text, place.content, html, i, nl, end, open, ends, tick).next;
    }
  }

  return spans;
}

// The marker's own characters, with nothing said about what follows: whether whitespace has to come
// after is `markerTokenEnd`'s question. Returns `i` unchanged when the line carries no marker.
function markerRunEnd(text, i, end) {
  let j = i;

  if (text[j] === '-' || text[j] === '*' || text[j] === '+') {
    j += 1;
  } else if (text[j] === '#') {
    j = hashRunEnd(text, i, end);
  } else {
    while (j < end && j < i + 9 && text[j] >= '0' && text[j] <= '9') {
      j += 1;
    }

    if (j === i || (text[j] !== '.' && text[j] !== ')')) {
      return i;
    }

    j += 1;
  }

  return j;
}

// A marker counts when whitespace follows it, or when nothing does: an item whose first line is
// empty is still an item and still sets a content column. CommonMark §5.2.
function markerTokenEnd(text, i, end) {
  const j = markerRunEnd(text, i, end);

  return j !== i && (j === end || text[j] === ' ' || text[j] === '\t') ? j : i;
}

function markerEnd(text, i, end) {
  const token = markerTokenEnd(text, i, end);

  return token === i ? i : skipSpaces(text, token, end);
}

// The whole line prefix is structure and every space inside it counts, since collapsing a run moves
// the content column under it and unmakes indented code. One span per line covers the indent, the
// blockquote chain, the list or heading marker and the spaces between them, which also keeps the
// marker opaque to the dash rules — `> -` is a list, not an em dash.
export function scanLinePrefix(source, checkBudget) {
  const text = lineView(source);
  const spans = [];

  for (const [start, end] of eachLine(text, 'md-line-prefix', checkBudget)) {
    let i = skipSpaces(text, start, end);
    let cut = i;
    let structural = false;

    // Containers alternate, and the prefix is all of them: `- > - проза` is a list holding a quote
    // holding a list.
    for (;;) {
      if (i < end && text[i] === '>') {
        const after = skipSpaces(text, i + 1, end);

        // The whole run, tab and all: a character left outside the span as a left boundary for the
        // rules could be a tab, and collapsing that to one column moves the content column under it.
        // The end of a protected span is that boundary instead.
        cut = after;
        i = after;
        structural = true;
        continue;
      }

      const marker = markerEnd(text, i, end);

      if (marker === i) {
        break;
      }

      // A marker leaves no space behind: a visible one would put `em_after_content` immediately
      // after the placeholder, and a thematic break `- - -` would come out as dashes.
      cut = marker;
      i = marker;
      structural = true;
    }

    // A whitespace-only line carries no content to indent; leave it to the blank-line trim. A line
    // carrying a container marker is not one of those, even when nothing follows the marker.
    if (cut > start && (structural || i < end)) {
      spans.push([start, cut]);
    }
  }

  return spans;
}

function referenceDestinationEnd(text, i, lineEnd) {
  if (text[i] === '<') {
    let j = i + 1;

    while (j < lineEnd) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }

      if (text[j] === '>') {
        return j + 1;
      }

      if (text[j] === '<') {
        return -1;
      }

      j += 1;
    }

    return -1;
  }

  let j = i;

  while (j < lineEnd && text[j] !== ' ' && text[j] !== '\t') {
    j += text[j] === '\\' ? 2 : 1;
  }

  return j === i ? -1 : Math.min(j, lineEnd);
}

// CommonMark matches a use to its definition on the label stripped, its internal whitespace runs
// collapsed and its case folded, and on nothing else, so a label is an identifier here and never
// prose.
//
// `trim` also drops the non-ASCII spaces CommonMark keeps. Both sides pass through here, so at worst
// two labels match that the parser keeps apart: a bracketed phrase left untypeset, never a link that
// stops resolving.
const LABEL_WHITESPACE_RE = /[ \t\r\n]+/g;
// A `>` behind a line ending inside a paragraph is a blockquote marker, never label text: a label
// broken across lines in a quote repeats the quote's prefix, which the paragraph's text does not
// hold. A `>` behind four columns of lazy indent is text, and dropping it errs the same safe way.
const LABEL_LINE_PREFIX_RE = /\n[ \t>]*/g;

// Case folding through three passes, because neither mapping alone is one: `ß` uppercases to `SS`,
// so upper-then-lower folds it, while `ẞ` is already uppercase and only lower reaches the `ß` the
// following upper expands. Lower, upper, lower folds both and leaves a folded string where it was.
//
// `resolve` gives back the bytes an earlier protect layer replaced: comparing placeholders compares
// vault ids rather than what the author wrote.
function normalizeLabel(raw, resolve) {
  const source = resolve ? resolve(raw) : raw;

  return source
    .replace(LABEL_LINE_PREFIX_RE, '\n')
    .trim()
    .replace(LABEL_WHITESPACE_RE, ' ')
    .toLowerCase()
    .toUpperCase()
    .toLowerCase();
}

// The ranges replaced by spaces, so every other offset survives.
function blankRanges(text, ranges) {
  const parts = [];
  let cursor = 0;

  for (const [start, end] of ranges) {
    parts.push(text.slice(cursor, start), ' '.repeat(end - start));
    cursor = end;
  }

  parts.push(text.slice(cursor));

  return parts.join('');
}

// A label ends at its first unescaped `]` and may hold no unescaped `[`, so a scan stops at
// whichever comes first and two scans never cover the same stretch twice. Both sides of the feature
// read a label through here: recognised differently on one side, a definition and its uses protect
// different bytes and the reference stops resolving with nothing failing.
//
// `codeSpans` are stepped over, not stopped at. Inline code inside a label is part of the label and
// its bytes are not label syntax, while a span the label runs into carries the `]` away with it,
// code binding tighter than a link. `from` indexes the first span that can still matter.
//
// Read from `start`, the answer is the `]`, -1 at a `[`, or `limit` where the stretch runs out first:
// a definition's label may go on on its paragraph's next line.
function labelEnd(text, start, limit, codeSpans = [], from = 0) {
  let j = start;
  let span = from;

  while (j < limit) {
    while (span < codeSpans.length && codeSpans[span][1] <= j) {
      span += 1;
    }

    if (span < codeSpans.length && j >= codeSpans[span][0]) {
      j = codeSpans[span][1];
      continue;
    }

    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === '[') {
      return -1;
    }

    if (c === ']') {
      return j;
    }

    j += 1;
  }

  return limit;
}

// The paragraph line behind the one whose content ends at `stop`, as where its content begins and
// where it ends, or null where that line ends the paragraph: a blank line, a container the line opens
// for itself, or a block that interrupts a paragraph. Repeating the containers it stands in is not
// required, since a continuation line may drop the prefixes it stands under. CommonMark §5.1.
//
// Past the whole indent, not just the three columns a container may carry: a definition is read from
// its paragraph's text with every line's leading white space stripped.
function paragraphLine(text, stop, n, containers) {
  const brk = text[stop] === '\r' ? stop + 1 : stop;

  if (text[brk] !== '\n') {
    return null;
  }

  const start = brk + 1;
  const next = text.indexOf('\n', start);
  const end = contentEnd(text, start, next === -1 ? n : next);
  const line = matchContainers(text, start, end, containers);

  if (skipSpaces(text, line.at, end) === end) {
    return null;
  }

  const place = openContainers(text, line.at, end, line.column, [], 0, true);

  if (place.opened > 0 || closesBlock(text, place.content, end, place.contentColumn, true)) {
    return null;
  }

  return { at: skipSpaces(text, place.content, end), stop: end };
}

const TITLE_OPEN = { '"': '"', "'": "'", '(': ')' };

// Where a title opened at `open` closes, and the end of the line it closes on; null where the
// paragraph ends first.
function titleClose(text, open, stop, nextLine) {
  const close = TITLE_OPEN[text[open]];
  let j = open + 1;
  let limit = stop;

  for (;;) {
    while (j < limit && text[j] !== close) {
      j += text[j] === '\\' ? 2 : 1;
    }

    if (j < limit) {
      return { end: j + 1, stop: limit };
    }

    const line = nextLine(limit);

    if (line === null) {
      return null;
    }

    j = line.at;
    limit = line.stop;
  }
}

// A title with nothing but white space behind it on the line it closes on, or null.
function wholeTitle(text, at, stop, nextLine) {
  const title = TITLE_OPEN[text[at]] ? titleClose(text, at, stop, nextLine) : null;

  return title !== null && skipSpaces(text, title.end, title.stop) === title.stop ? title : null;
}

// Label through title, each of which may continue on the paragraph's next line, which `nextLine`
// gives from where the current one ends. A title on a line of its own that is no title leaves the
// definition without one, and that line to the paragraph; one that starts behind the destination
// unmakes the definition.
//
// `i` is where the line's own content begins, read by the caller that already walked the line;
// re-deriving it from column zero here would lose the container chain in effect there.
function referenceDefinition(text, i, lineEnd, resolve, nextLine) {
  // A footnote definition shares the shape but its body is prose, so it stays typeset.
  if (text[i] !== '[' || text[i + 1] === '^') {
    return null;
  }

  let stop = lineEnd;
  let j = labelEnd(text, i + 1, stop);

  while (j === stop) {
    const line = nextLine(stop);

    if (line === null) {
      return null;
    }

    ({ stop } = line);
    j = labelEnd(text, line.at, stop);
  }

  const label = j === -1 ? '' : normalizeLabel(text.slice(i + 1, j), resolve);

  if (label === '' || text[j + 1] !== ':') {
    return null;
  }

  let at = skipSpaces(text, j + 2, stop);

  if (at === stop) {
    const line = nextLine(stop);

    if (line === null) {
      return null;
    }

    ({ at, stop } = line);
  }

  const end = referenceDestinationEnd(text, at, stop);

  if (end === -1) {
    return null;
  }

  // The span starts at the container's content, not at the line: a `>` or list marker in front
  // belongs to the container, which `scanLinePrefix` protects as it does any other line's prefix.
  const after = skipSpaces(text, end, stop);

  if (after < stop) {
    // A title needs whitespace after the destination.
    const title = after > end ? wholeTitle(text, after, stop, nextLine) : null;

    return title === null ? null : { start: i, end: title.end, label };
  }

  const line = nextLine(stop);
  const title = line === null ? null : wholeTitle(text, line.at, line.stop, nextLine);

  return { start: i, end: title === null ? end : title.end, label };
}

// The label of every use of a defined reference, so it stays the same bytes as the definition. The
// visible text of a full reference is not a label and keeps its typography; in a shortcut or
// collapsed reference the label is the visible text, and there the identifier wins.
function scanReferenceUses(text, labels, definitions, codeSpans, resolve, checkBudget) {
  const n = text.length;
  const spans = [];
  let definition = 0;
  let code = 0;
  let i = 0;
  // A threshold rather than a mask on `i`: the walk jumps whole labels, so a fixed mask could stride
  // past every check.
  let nextCheck = 0;

  const defined = (span) =>
    span !== null && labels.has(normalizeLabel(text.slice(...span), resolve));

  // The code spans are ascending and the walk only moves forward, so one cursor answers where the
  // span containing a position ends. `-1` means the position is outside every span.
  const codeEnd = (at) => {
    while (code < codeSpans.length && codeSpans[code][1] <= at) {
      code += 1;
    }

    return code < codeSpans.length && at >= codeSpans[code][0] ? codeSpans[code][1] : -1;
  };

  while (i < n) {
    if (i >= nextCheck) {
      checkBudget?.('md-reference-definition');
      nextCheck = i + 0x4000;
    }

    while (definition < definitions.length && definitions[definition][1] <= i) {
      definition += 1;
    }

    if (definition < definitions.length && i >= definitions[definition][0]) {
      i = definitions[definition][1];
      continue;
    }

    // Inside inline code nothing is a label: the brackets there are the code's own bytes.
    const inCode = codeEnd(i);

    if (inCode !== -1) {
      i = inCode;
      continue;
    }

    if (text[i] === '\\') {
      i += 2;
      continue;
    }

    if (text[i] !== '[') {
      i += 1;
      continue;
    }

    // `code` is the first span that can still matter here: everything before it ends at or before `i`.
    const close = labelEnd(text, i + 1, n, codeSpans, code);

    if (text[close] !== ']') {
      i += 1;
      continue;
    }

    // `[текст](…)` is an inline link: what stands in the brackets is the visible text, not a label.
    // Only a destination that actually parses makes it one — `[Амбер](не ссылка)` is no link, and
    // the brackets in front of it may still be a shortcut reference.
    if (text[close + 1] === '(') {
      const inlineEnd = scanLinkTail(text, close + 2, n);

      if (inlineEnd !== -1) {
        i = inlineEnd === OVERLIMIT ? close + 1 : inlineEnd;
        continue;
      }
    }

    const first = [i + 1, close];
    let second = null;

    if (text[close + 1] === '[') {
      const secondClose = labelEnd(text, close + 2, n, codeSpans, code);

      if (text[secondClose] === ']') {
        second = [close + 2, secondClose];
      }
    }

    // `[текст][метка]` names its definition in the second label. An undefined second label leaves the
    // first to be read as a shortcut reference, which is the fallback CommonMark takes too.
    if (defined(second)) {
      spans.push(second);
    } else if (defined(first)) {
      spans.push(first);
    }

    i = (second ? second[1] : close) + 1;
  }

  return spans;
}

// The label, destination and title of a link reference definition are structure: typesetting the
// title's quotes turns the definition back into an ordinary paragraph, and typesetting a label on
// one side of the pair leaves the two spellings no longer matching, so the reference stops resolving.
//
// `scanInline` is how this reader sees the opaque inline constructs, and has to give the same answer
// the pipeline reaches a step later.
export function scanReferenceDefinitions(source, checkBudget, resolve, scanInline = scanCodeSpans) {
  if (!source.includes(']:')) {
    return [];
  }

  const text = lineView(source);
  const definitions = [];
  const labels = new Set();
  const n = text.length;
  // A definition cannot interrupt a paragraph: under one the same bytes are ordinary prose and stay
  // typeset. The paragraph belongs to its own container, and a line that opens one starts a block the
  // outer paragraph cannot reach into, so a single flag cannot carry the answer.
  const open = [];
  let mayDefine = true;
  let paragraphOpen = false;
  let consumed = 0;
  let crossed = 0;
  // Read while `open` is still the chain of the line the definition starts on.
  const nextLine = (stop) => {
    if ((crossed++ & 0x3ff) === 0) {
      checkBudget?.('md-reference-definition');
    }

    return paragraphLine(text, stop, n, open);
  };

  for (const [start, end] of eachLine(text, 'md-reference-definition', checkBudget)) {
    if (start < consumed) {
      continue;
    }

    const { place, fresh, paragraphOpen: after } = walkLine(text, start, end, open, paragraphOpen);
    const definition =
      mayDefine || fresh ? referenceDefinition(text, place.content, end, resolve, nextLine) : null;

    if (definition) {
      definitions.push([definition.start, definition.end]);
      labels.add(definition.label);
      consumed = definition.end;
    }

    // Two answers, not one: a definition is taken from the front of a paragraph, so another may
    // follow it, while the paragraph itself stays open and a list that could not interrupt it before
    // still cannot.
    mayDefine = definition !== null || !after;
    paragraphOpen = after;
  }

  if (definitions.length === 0) {
    return definitions;
  }

  // Block structure is resolved before inline: the definitions are blanked out so a backtick inside
  // one cannot pair with a backtick in the prose around it, and what is left pairs exactly as the
  // code-span scanner reads it a step later. A label may not cross into one of those spans, because
  // inline code outranks link grouping.
  //
  // No backtick in the document means no code span in any masking of it, and the mask is a copy of
  // the whole document, so the question is asked before the copy rather than inside the scanner.
  const codeSpans = text.includes('`')
    ? scanInline(blankRanges(text, definitions), checkBudget, resolve)
    : [];
  const uses = scanReferenceUses(text, labels, definitions, codeSpans, resolve, checkBudget);

  return uses.length === 0
    ? definitions
    : [...definitions, ...uses].toSorted((a, b) => a[0] - b[0]);
}

function scanBareDestination(text, i, limit, capped) {
  let depth = 0;
  let j = i;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === '(') {
      depth += 1;
      j += 1;
      continue;
    }

    if (c === ')') {
      if (depth === 0) {
        return { end: j + 1, closed: true };
      }

      depth -= 1;
      j += 1;
      continue;
    }

    if (isFlowSpace(c)) {
      return depth === 0 ? { end: j, closed: false } : null;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : null;
}

function scanAngleDestination(text, i, limit, capped) {
  let j = i + 1;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === '>') {
      return { end: j + 1, closed: false };
    }

    if (c === '\n' || c === '\r') {
      return null;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : null;
}

// Whitespace inside a link's parentheses spans line endings, and CRLF is one ending rather than a
// `\r` of its own. CommonMark §2.1.
function skipLinkSpace(text, i, limit) {
  let j = i;

  while (j < limit && isFlowSpace(text[j])) {
    j += 1;
  }

  return j;
}

function scanTitle(text, i, limit, capped) {
  const open = text[i];
  const close = open === '(' ? ')' : open;
  let j = i + 1;

  while (j < limit) {
    const c = text[j];

    if (c === '\\') {
      j += 2;
      continue;
    }

    if (c === close) {
      return j + 1;
    }

    j += 1;
  }

  return capped ? OVERLIMIT : -1;
}

function scanLinkTail(text, i, n) {
  const limit = Math.min(n, i + MAX_LINK_SCAN);
  const capped = limit < n;
  let j = skipLinkSpace(text, i, limit);

  const dest =
    text[j] === '<'
      ? scanAngleDestination(text, j, limit, capped)
      : scanBareDestination(text, j, limit, capped);

  if (dest === OVERLIMIT) {
    return OVERLIMIT;
  }

  if (!dest) {
    return -1;
  }

  if (dest.closed) {
    return dest.end;
  }

  j = dest.end;

  j = skipLinkSpace(text, j, limit);

  if (text[j] === '"' || text[j] === "'" || text[j] === '(') {
    const titleEnd = scanTitle(text, j, limit, capped);

    if (titleEnd === OVERLIMIT) {
      return OVERLIMIT;
    }

    if (titleEnd === -1) {
      return -1;
    }

    j = titleEnd;

    j = skipLinkSpace(text, j, limit);
  }

  return text[j] === ')' ? j + 1 : -1;
}

// Spans cover only the interior between `](` and `)`, never the delimiters, so the rules downstream
// still see those as literal text.
export function scanLinkDestinations(text, checkBudget) {
  const n = text.length;
  const spans = [];
  // No `)` at or after a destination start means this `](` can never close, which is literal prose
  // rather than a fail-open; computed once instead of once per attempt.
  const lastClose = text.lastIndexOf(')');
  let i = 0;
  // A threshold rather than a mask on `i`: a match jumps `i` by a whole destination, so a fixed mask
  // could stride past every check.
  let nextCheck = 0;

  while (i < n - 1) {
    if (i >= nextCheck) {
      checkBudget?.('md-link-scan');
      nextCheck = i + 0x4000;
    }

    if (text[i] !== ']' || text[i + 1] !== '(') {
      i += 1;
      continue;
    }

    const end = scanLinkTail(text, i + 2, n);

    if (end === OVERLIMIT) {
      // With no `)` left at or after this start, no later `(` has one either.
      if (lastClose < i + 2) {
        return spans;
      }

      throw new MicroTypoInputError(
        `Markdown link destination/title exceeds the ${MAX_LINK_SCAN}-char scan bound at offset ${i}`,
        { details: { offset: i, max: MAX_LINK_SCAN, reason: 'link-overlimit' } }
      );
    }

    if (end === -1) {
      i += 1;
      continue;
    }

    spans.push([i + 2, end - 1]);
    i = end;
  }

  return spans;
}

// How a line's content opens an HTML block, CommonMark §4.6: kind 1 with `pre`, `script`, `style`
// or `textarea`, kind 2 with a comment, and with any other tag name possibly kind 6 or 7, which
// `endsAtBlank` tells apart from inline HTML.
const HTML_BLOCK_OPEN_RE =
  /<(?:(pre|script|style|textarea)(?=[\s>]|$)|(!--)|\/?([A-Za-z][A-Za-z0-9-]*))/iy;
// Kind 7: one complete open or closing tag and nothing but spaces after it on its line.
const LONE_TAG_RE =
  /(?:<([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^ \t\n\v\f\r"'=<>`]+|'[^'\n\r]*'|"[^"\n\r]*"))?)*[ \t]*\/?|<\/([A-Za-z][A-Za-z0-9-]*)[ \t]*)>[ \t]*$/my;
// A line that may open one behind whatever container prefix: a document without such a line pays
// for no container walk.
const HTML_BLOCK_LINE_RE = /^[ \t>*+0-9.)-]*<[!/A-Za-z]/m;
// Kind 1 ends on a line holding any of its four end tags, whichever tag opened it.
const RAW_BLOCK_END_RE = /<\/(?:pre|script|style|textarea)>/gi;
const COMMENT_END = /-->/g;
const BLANK_LINE_RE = /\n[ \t]*\r?\n/g;

// Whether the tag `m` read at `at` opens a block that ends at a blank line: kind 6 by its name, with
// only white space, `>` or `/>` behind it, or kind 7, which may not interrupt a paragraph. Kind 7
// leaves the four kind-1 names to kind 1 only in an open tag: a closing one is kind 7 like any other.
function endsAtBlank(text, at, m, mayInterrupt) {
  const next = at + m[0].length;
  const c = text[next];

  if (
    BLOCK_KIND_6_NAMES.has(m[3].toLowerCase()) &&
    (next === text.length || isFlowSpace(c) || c === '>' || (c === '/' && text[next + 1] === '>'))
  ) {
    return true;
  }

  if (!mayInterrupt) {
    return false;
  }

  LONE_TAG_RE.lastIndex = at;

  const tag = LONE_TAG_RE.exec(text);

  return tag !== null && (tag[2] !== undefined || !RAW_BLOCK_NAMES.has(tag[1].toLowerCase()));
}

// The document's tags as HTML reads them, raw text included, built once per scan and kept with the
// scan's other answers.
const RAW_TEXT_NAMES = new Set(['script', 'style', 'textarea']);
const BLOCK_TAGS = Symbol('block tags');

function blockTags(text, ends) {
  let tags = ends.get(BLOCK_TAGS);

  if (tags === undefined) {
    tags = tagSpans(text, RAW_TEXT_NAMES);
    ends.set(BLOCK_TAGS, tags);
  }

  return tags;
}

// Where the protected part of the kind-1 block opened at `at` ends on the line `lineStop` closes, the
// one holding its end condition. The element ends at its own end tag as the document's tags read
// it — not one written in an attribute value or a comment, nor the closer of a `<pre>` nested inside
// — and past it the line is prose, as the lines of a kind-6 block are. Where that line holds no such
// end tag the element is still open, and the whole line is the block's.
function rawBlockEnd(text, name, at, lineStop, ends) {
  const tags = blockTags(text, ends);
  let lo = 0;
  let hi = tags.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (tags[mid][0] < at) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (tags[lo]?.[0] !== at) {
    return lineStop;
  }

  let depth = 0;

  for (let k = lo; k < tags.length && tags[k][0] < lineStop; k++) {
    const [start, gt, empty] = tags[k];
    const closing = text[start + 1] === '/';

    if (namedAt(text, closing ? start + 2 : start + 1, name)) {
      if (!closing) {
        depth += empty === true ? 0 : 1;
      } else if (--depth === 0) {
        return gt < lineStop ? gt + 1 : lineStop;
      }
    }
  }

  return lineStop;
}

// A block opener stands at the start of a line, behind at most three spaces.
function opensLine(text, at) {
  let i = at;

  while (i > 0 && at - i < 3 && text[i - 1] === ' ') {
    i -= 1;
  }

  return i === 0 || text[i - 1] === '\n';
}

// Whether `at` falls inside one of `spans`, ascending `[start, end)` ranges; `at` only grows between
// calls, so `cursor` never moves back.
function covered(spans, cursor, at) {
  while (cursor.i < spans.length && spans[cursor.i][1] <= at) {
    cursor.i++;
  }

  return cursor.i < spans.length && spans[cursor.i][0] <= at;
}

// A budget check once per 1024 lines of one walk.
function lineTicker(checkBudget, label) {
  let lines = 0;

  return () => {
    if ((lines++ & 0x3ff) === 0) {
      checkBudget?.(label);
    }
  };
}

// The HTML block, if any, that opens where a line's content begins, asked in document order. An
// opener inside a tag, or inside one of the spans `readOpaque()` returns, such as template
// expressions, opens nothing. Which lines a block owns is decided before what they spell, so the
// code-block scanners ask this same question: a line inside a block opens no code block, and a line
// inside a code block is never asked.
function htmlBlockOpener(text, readOpaque) {
  let tags;
  let opaque;
  const tagCursor = { i: 0 };
  const opaqueCursor = { i: 0 };

  return (at, mayInterrupt) => {
    if (text[at] !== '<') {
      return null;
    }

    HTML_BLOCK_OPEN_RE.lastIndex = at;

    const m = HTML_BLOCK_OPEN_RE.exec(text);

    if (m === null || (m[3] !== undefined && !endsAtBlank(text, at, m, mayInterrupt))) {
      return null;
    }

    tags ??= tagSpans(text);
    opaque ??= readOpaque?.() ?? [];

    return insideTag(text, tags, tagCursor, at) || covered(opaque, opaqueCursor, at) ? null : m;
  };
}

// Where the block `m` opened at `at` ends: `next` is where the line walk resumes, and `span` what
// `SafeBlocks` has to vault — a block the document or its container never ends, from its opener to
// the end of the document or to the container's last line, or a closed block of kind 1, through the
// line holding its end tag, since `SafeBlocks` vaults only a pair of one name, or the body of a
// comment spanning lines in a container, whose blank lines `commentReader` cannot tell from a
// paragraph's — or null. `next` is the line under the opener's, at its break `nl` and content end
// `lineEnd`; `chain` holds the containers the opener stands in. `ends` remembers where each end
// condition next matches: blocks come in document order, so a search never starts behind a match it
// has already found.
function htmlBlockEnd(text, at, m, next, nl, lineEnd, chain, ends, tick) {
  const n = text.length;

  // Kinds 1 and 2 end on the line holding their end condition, or never. Kinds 6 and 7 end at the
  // next blank line, and that line may open the next block.
  const raw = m[1] !== undefined;
  const toBlank = m[3] !== undefined;
  const endRe = raw ? RAW_BLOCK_END_RE : COMMENT_END;
  const empty = raw || toBlank ? -1 : emptyCommentClose(text, at);
  const end = toBlank || empty !== -1 ? empty : nextMatch(endRe, text, at + m[0].length, ends);
  const rawSpan = (lineStop) => [at, rawBlockEnd(text, m[1].toLowerCase(), at, lineStop, ends)];

  if (chain.length === 0) {
    if (toBlank) {
      const blank = nextMatch(BLANK_LINE_RE, text, at, ends);

      return { next: blank === -1 ? n : blank + 1, span: null };
    }

    if (end === -1) {
      return { next: n, span: [at, n] };
    }

    const stop = endOfLine(text, end);

    return { next: stop + 1, span: raw ? rawSpan(contentEnd(text, at, stop)) : null };
  }

  if (end !== -1 && end < lineEnd) {
    return { next, span: raw ? rawSpan(lineEnd) : null };
  }

  // The last line still inside the container, at its break: blank lines under it are the break
  // around what follows, not part of the block.
  let inside = nl === -1 ? n : nl;
  let i = next;
  let left = false;

  while (i < n) {
    tick();

    const brk = text.indexOf('\n', i);
    const stop = brk === -1 ? n : brk;
    const lineStop = contentEnd(text, i, stop);
    const line = matchContainers(text, i, lineStop, chain);

    if (line.matched < chain.length) {
      left = true;
      break;
    }

    const blank = skipSpaces(text, line.at, lineStop) === lineStop;

    if (toBlank && blank) {
      break;
    }

    i = brk === -1 ? n : brk + 1;

    if (!blank) {
      inside = stop;
    }

    if (end !== -1 && end < lineStop) {
      return { next: i, span: raw ? rawSpan(lineStop) : [at + COMMENT_OPEN.length, end] };
    }
  }

  return { next: i, span: toBlank ? null : [at, left ? inside : n] };
}

// The HTML blocks `SafeBlocks` has to vault, as `htmlBlockEnd` gives them. Blocks are read in order,
// each from the line that opens it to the line that ends it, so a line inside an open block opens
// nothing.
export function scanUnclosedHtmlBlock(source, checkBudget, readOpaque) {
  if (!HTML_BLOCK_LINE_RE.test(source)) {
    return [];
  }

  const text = lineView(source);
  const n = text.length;
  const spans = [];
  const opens = htmlBlockOpener(text, readOpaque);
  const ends = new Map();
  // The containers still open where the walk stands: a block opens at its container's content
  // column and ends with that container.
  const chain = [];
  const tick = lineTicker(checkBudget, 'md-html-block');
  let paragraphOpen = false;
  let i = 0;

  while (i < n) {
    tick();

    const nl = text.indexOf('\n', i);
    const lineEnd = contentEnd(text, i, nl === -1 ? n : nl);
    const before = paragraphOpen;
    const { place, fresh, paragraphOpen: after } = walkLine(text, i, lineEnd, chain, before);
    const m = opens(place.content, !before || fresh);

    // A block is no paragraph, so the line under it is no lazy continuation.
    paragraphOpen = m === null && after;
    i = nl === -1 ? n : nl + 1;

    if (m !== null) {
      const block = htmlBlockEnd(text, place.content, m, i, nl, lineEnd, chain, ends, tick);

      if (block.span !== null) {
        spans.push(block.span);
      }

      i = block.next;
    }
  }

  return spans;
}

function endOfLine(text, at) {
  const newline = text.indexOf('\n', at);

  return newline === -1 ? text.length : newline;
}

// Where `re` next matches at or after `from`, remembered in `seen` per pattern: queries come in
// document order, so a search never starts behind a match it has already found, and once a pattern
// stops matching it never matches again.
function nextMatch(re, text, from, seen) {
  const known = seen.get(re);

  if (known !== undefined && (known === -1 || known >= from)) {
    return known;
  }

  re.lastIndex = from;

  const at = re.exec(text)?.index ?? -1;

  seen.set(re, at);

  return at;
}

// Where the comment opened at `at` ends, or -1 when it is no comment. One that opens a line is an
// HTML block and runs to the first `-->`; one inside a line is inline HTML, which ends with its
// paragraph, so a `-->` past a blank line does not close it.
function commentEnd(text, at, seen) {
  const empty = emptyCommentClose(text, at);

  if (empty !== -1) {
    return empty;
  }

  const close = nextMatch(COMMENT_END, text, at + COMMENT_OPEN.length, seen);

  if (close === -1 || opensLine(text, at)) {
    return close;
  }

  const blank = nextMatch(BLANK_LINE_RE, text, at, seen);

  return blank === -1 || close < blank ? close : -1;
}

// The first of Markdown's closed HTML comments opening at or past `from`, as `[start, end, end]`
// through its `-->`. A `<!--` inside a tag, such as in a quoted attribute value, is part of that tag
// and opens nothing.
export function commentReader(source, checkBudget) {
  const text = lineView(source);
  const seen = new Map();
  const tagCursor = { i: 0 };
  let tags;
  let count = 0;

  return (from) => {
    for (let at = text.indexOf(COMMENT_OPEN, from); at !== -1;) {
      if ((count++ & 0x3fff) === 0) {
        checkBudget?.('md-comment');
      }

      tags ??= tagSpans(text);

      if (insideTag(text, tags, tagCursor, at)) {
        at = text.indexOf(COMMENT_OPEN, at + COMMENT_OPEN.length);
        continue;
      }

      const close = commentEnd(text, at, seen);

      if (close !== -1) {
        return [at, close + COMMENT_CLOSE.length, close + COMMENT_CLOSE.length];
      }

      if (seen.get(COMMENT_END) === -1) {
        return null;
      }

      at = text.indexOf(COMMENT_OPEN, at + COMMENT_OPEN.length);
    }

    return null;
  };
}

// The bodies of Markdown's closed HTML comments; the delimiters stay in the text.
export function scanMarkdownComments(source, checkBudget) {
  const next = commentReader(source, checkBudget);
  const spans = [];

  for (let comment = next(0); comment !== null; comment = next(comment[2])) {
    const start = comment[0] + COMMENT_OPEN.length;
    const end = comment[1] - COMMENT_CLOSE.length;

    // `<!-->` and `<!--->` close on their own dashes and hold nothing.
    if (end >= start) {
      spans.push([start, end]);
    }
  }

  return spans;
}
