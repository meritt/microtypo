import { G } from '../lib/glyphs.js';
import { PARAGRAPH_CLOSE } from '../protect/placeholders.js';

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
const SEPARATOR_RE = new RegExp(`[${SEPARATOR}]`, 'u');

// What may stand immediately before a quote that opens a quotation, as one character-class fragment.
// The straight-quote patterns in `quote.js` and the walk below decide the same thing about the same
// position, so they read one set.
export const OPEN_LEFT = `\\s([${G.LAQUO}${G.MDASH}${G.NDASH}>-`;
const OPEN_LEFT_RE = new RegExp(`[${OPEN_LEFT}]`, 'u');

// Up to this many quote marks, a chunk is cheaper to rescan than to index.
const SCAN_LIMIT = 32;

// Quote state does not cross a paragraph. The state machine below splits on this boundary before it
// reads a single quote, and the role assignment in `quote.js` decides the same question one pass
// earlier — so both ask here where a paragraph ends, or the two disagree about which quotations are
// open and the earlier pass hands the later one roles it cannot honour.
export function paragraphSeparator(text) {
  if (text.includes(PARAGRAPH_CLOSE)) {
    return PARAGRAPH_CLOSE;
  }

  return text.includes('\r\n') ? '\r\n\r\n' : '\n\n';
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

// Assumes outer "..." pairs were already converted to «...».
export function processQuotes(text, options = {}) {
  // Every rewrite below is triggered by an angle quote, so text without one comes back unchanged —
  // and the split plus the code-point array are the whole cost on a short data value.
  if (!text.includes(LAQUO) && !text.includes(RAQUO)) {
    return text;
  }

  const allowNested = options.allowNested !== false;
  const convertInches = options.convertInches !== false;
  const { checkBudget } = options;

  const separator = paragraphSeparator(text);
  const chunks = text.split(separator);
  const out = [];

  for (const chunk of chunks) {
    out.push(processChunk(chunk, allowNested, convertInches, checkBudget));
  }

  return out.join(separator);
}

// One pass in reading order. An inch conversion resumes from a balanced point and reads the quotes
// after it again: with few quote marks in the chunk that costs a few scans of it, so the pass does
// it in place; with more, `walkBack` takes over.
function processChunk(chunk, allowNested, convertInches, checkBudget) {
  const buf = [...chunk];
  const balancedStack = [0];
  let lastBalanced = 0;
  let level = 0;
  let off = 0;
  let iter = 0;
  let many;

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

    if (level < 0 && opensHere(buf, p.pos)) {
      buf[p.pos] = LAQUO;
      level = 1;
      continue;
    }

    if (level < 0 && convertInches) {
      many ??= countQuoteMarks(chunk) > SCAN_LIMIT;

      if (many) {
        return walkBack(chunk, buf, balancedStack, lastBalanced, off, allowNested, checkBudget);
      }

      const result = scanConvertInches(buf, off, balancedStack);
      ({ off } = result);
      level = 0;

      if (result.kind === 'fallback') {
        balancedStack.length = 0;
        balancedStack.push(off);
      }
    }
  }

  if (level > 0) {
    restoreNestedMarks(buf, lastBalanced, buf.length);
  }

  return buf.join('');
}

// A closing quote where no quotation stands open, with a boundary in front of it and a word behind,
// is an opening one written the wrong way round: no rule of this engine puts a closer there, and read
// as one it has no pair. A measurement never reaches here — its quote follows a digit.
function opensHere(buf, at) {
  if (at > 0 && !OPEN_LEFT_RE.test(buf[at - 1])) {
    return false;
  }

  let i = at + 1;

  while (buf[i] === ' ' || buf[i] === '\t') {
    i += 1;
  }

  return i < buf.length && !SEPARATOR_RE.test(buf[i]);
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
function scanConvertInches(buf, off, balancedStack) {
  do {
    const candidateStart = balancedStack.pop() ?? 0;
    const hadNestedMarks = hasNestedMarks(buf, candidateStart, off);
    const quotePos = findLastInchQuote(buf, candidateStart, off, hadNestedMarks);

    if (quotePos !== -1) {
      if (hadNestedMarks) {
        restoreNestedMarks(buf, candidateStart, off);
      }

      buf[quotePos] = G.PRIME;

      if (hadNestedMarks) {
        return { kind: 'converted', off: candidateStart };
      }

      balancedStack.push(off);

      return { kind: 'converted', off };
    }
  } while (balancedStack.length);

  const fallbackPos = off - 1;
  buf[fallbackPos] = '"';

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

function findLastInchQuote(buf, start, end, includeNestedClose) {
  for (let i = end - 1; i > start; i--) {
    const ch = buf[i];

    if (ch !== RAQUO && (!includeNestedClose || ch !== LDQUO)) {
      continue;
    }

    if (!isDigit(buf[i - 1])) {
      continue;
    }

    return i;
  }

  return -1;
}

function isQuoteMark(ch) {
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
  constructor(buf, source) {
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
      this.candidate[k] = closes && isDigit(buf[at[k] - 1]) ? k : k - 1;
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
function walkBack(chunk, buf, balancedPoints, lastBalancedAt, offAt, allowNested, checkBudget) {
  // Without astral characters a string index is a code-point index, and the copy is the whole cost
  // of a short chunk.
  const marks = new QuoteMarks(buf, chunk.length === buf.length ? chunk : [...chunk]);
  const balancedStack = balancedPoints.map((pos) => marks.indexAt(pos));
  let lastBalanced = marks.indexAt(lastBalancedAt);
  let off = tryConvertInches(marks, marks.indexAt(offAt), balancedStack);
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

    if (opensHere(buf, marks.at[p])) {
      marks.write(p, LAQUO, 1);
      level = 1;
    } else {
      off = tryConvertInches(marks, off, balancedStack);
      level = 0;
    }
  }

  if (level > 0) {
    marks.restore(lastBalanced);
  }

  return buf.join('');
}

// Settles the unmatched closer just before `off` and returns the offset the walk resumes from, at
// level zero. The character before a balanced point is a quote, never a digit, so no inch candidate
// stands on one: a candidate past `candidateStart` is one at its index or later. Candidates only drop
// out, so the last one before the closer answers every start the stack offers, and the start is the
// latest balanced point at or before it. An empty stack offers the chunk start once.
function tryConvertInches(marks, off, balancedStack) {
  const quotePos = marks.lastInchQuote(off - 1);
  const candidateStart = balancedStack.length ? popBalanced(marks, balancedStack, quotePos) : 0;

  if (candidateStart !== -1 && quotePos >= candidateStart) {
    const hadNestedMarks = marks.hasNested(candidateStart, off);

    // The walk resumes from `candidateStart` and rewrites every quote it passes, so of the restore
    // only the nested marks it has never read are left to do: they become quotes it reads.
    if (hadNestedMarks) {
      marks.activate(candidateStart, off);
    }

    marks.write(quotePos, G.PRIME, 0);

    if (hadNestedMarks) {
      return candidateStart;
    }

    balancedStack.push(off);

    return off;
  }

  marks.write(off - 1, '"', 0);
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
