import { VOID_TAG_NAMES } from './lib/block-tags.js';
import { G } from './lib/glyphs.js';
import { executeRule } from './lib/rule-budget.js';
import { hasRequiredFeatures } from './lib/rule-features.js';
import { ruleTraceOf } from './lib/rule-trace.js';
import { CLOSE, OPEN } from './protect/placeholders.js';

// Inline markup lifted out of the text a builtin rule reads, so that a rule binding words sees them
// as the reader does: `в <em>доме</em>` is `в доме` to it. A rule runs on the lifted text first;
// where it changed nothing but white space, the markup goes back by the count of the characters
// around it. Where it rewrote words within reach of lifted markup, that markup goes back into the
// text and the rule runs again, so it reads the markup next to the words it rewrites as it always
// did and the rest of the text through it; where that does not settle, the rule runs on the
// marked-up text as it always did.

const OPEN_CODE = 0xe000;
const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const NL = 0x0a;
const BACKTICK = 0x60;
const BACKSLASH = 0x5c;
const UNDERSCORE = 0x5f;
const STAR = 0x2a;
const TILDE = 0x7e;
// The emphasis delimiters, in the order the openers bottom of each is kept.
const DELIMITERS = [STAR, UNDERSCORE, TILDE];
const LBRACKET = 0x5b;
const RBRACKET = 0x5d;
const LPAREN = 0x28;
const RPAREN = 0x29;
const BANG = 0x21;

// A protected inline element — a `<code>` span, a Markdown code span — is one word to a rule binding
// words, and this is the word it reads in its place.
export const STAND_IN = 'слово';

const CLOSER = 1;
const STANDS_IN = 2;

// A neighbour that forbids lifting whatever touches it: an inline block, which carries words no rule
// may read across.
const PIN = -2;
const EDGE = -1;

const VOID_NAMES = new Set(VOID_TAG_NAMES);

// The white space a rule's `\s` reads.
export function isSpace(c) {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

const WORD_RE = /[\p{L}\p{N}\p{M}]/u;

function isWordChar(c) {
  if (c < 0) {
    return false;
  }

  if (c < 128) {
    return (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 122);
  }

  if (c >= 0x400 && c <= 0x4ff) {
    return true;
  }

  if (c < 0xc0 || (c >= 0xe000 && c <= 0xf8ff)) {
    return false;
  }

  return WORD_RE.test(String.fromCodePoint(c));
}

const QUOTES = new Set(
  ['"', "'", G.LAQUO, G.RAQUO, G.BDQUO, G.LDQUO, G.LSQUO, G.RSQUO, '”', '‚', '‹', '›', G.PRIME].map(
    (q) => q.codePointAt(0)
  )
);

const isEdge = (c) => c === EDGE || isSpace(c);
const isPua = (c) => c >= 0xe000 && c <= 0xf8ff;

// ---------------------------------------------------------------------------------------------
// Markdown: the emphasis markers and link brackets a reader never sees.

const ASCII_PUNCT = new Set([...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'].map((c) => c.codePointAt(0)));
const PUNCT_RE = /[\p{P}\p{S}]/u;

// Flanking reads a placeholder — a list marker, a line break — as the edge of the line it stands
// for.
function mdSpace(c) {
  return c < 0 || isSpace(c) || (c >= 0xe000 && c <= 0xf8ff);
}

function mdPunct(c) {
  if (c < 128) {
    return ASCII_PUNCT.has(c);
  }

  return !mdSpace(c) && !isWordChar(c) && PUNCT_RE.test(String.fromCodePoint(c));
}

function escaped(text, at, from) {
  let n = 0;

  for (let i = at - 1; i >= from && text.codePointAt(i) === BACKSLASH; i--) {
    n++;
  }

  return n % 2 === 1;
}

// Links whose text a reader sees: `[text](⟦B⟧)` and `[text][⟦B⟧]`, the target vaulted by the
// Markdown reader. An image is left whole.
// Brackets pair as they nest, and a link's text opens at the bracket its closing one pairs with.
function findLinks(text, from, to, out) {
  const opens = [];

  for (let i = from; i < to; i++) {
    const c = text.codePointAt(i);

    if ((c !== LBRACKET && c !== RBRACKET) || escaped(text, i, from)) {
      continue;
    }

    if (c === LBRACKET) {
      opens.push(i);
      continue;
    }

    const open = opens.length > 0 ? opens.pop() : -1;
    const next = text.codePointAt(i + 1);

    if ((next !== LPAREN && next !== LBRACKET) || text.codePointAt(i + 2) !== OPEN_CODE) {
      continue;
    }

    const shut = text.indexOf(CLOSE, i + 3);
    const end = next === LPAREN ? RPAREN : RBRACKET;

    if (shut === -1 || shut >= to || text.codePointAt(shut + 1) !== end) {
      continue;
    }

    if (open !== -1) {
      out.push({ open, close: i, end: shut + 2, image: text.codePointAt(open - 1) === BANG });
    }

    i = shut + 1;
  }
}

// One shape for every piece of markup a lift reads, so the loops over them stay monomorphic.
function piece(start, end, tag, close, kind = '', id = 0, shut = 0) {
  return {
    start,
    end,
    tag,
    close,
    kind,
    id,
    shut,
    pinned: false,
    unit: false,
    lift: false,
    standIn: false,
    mate: null,
    index: -1
  };
}

function pair(marks, os, oe, cs, ce) {
  const open = piece(os, oe, false, false, 'M');
  const close = piece(cs, ce, false, true, 'M');

  open.mate = close;
  close.mate = open;
  marks.push(open, close);
}

function mergePieces(left, right) {
  if (right.length === 0) {
    return left;
  }
  if (left.length === 0) {
    return right;
  }
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i].start <= right[j].start) {
      merged.push(left[i++]);
    } else {
      merged.push(right[j++]);
    }
  }
  while (i < left.length) {
    merged.push(left[i++]);
  }
  while (j < right.length) {
    merged.push(right[j++]);
  }
  return merged;
}

const OPENS = 1;
const CLOSES = 2;

// What CommonMark lets a run of delimiter `c` between the characters `before` and `after` do: open,
// close, both or neither, as `OPENS | CLOSES`.
function delimiterRole(c, before, after) {
  const left = !mdSpace(after) && (!mdPunct(after) || mdSpace(before) || mdPunct(before));
  const right = !mdSpace(before) && (!mdPunct(before) || mdSpace(after) || mdPunct(after));

  if (c === UNDERSCORE) {
    return (
      (left && (!right || mdPunct(before)) ? OPENS : 0) |
      (right && (!left || mdPunct(after)) ? CLOSES : 0)
    );
  }

  return (left ? OPENS : 0) | (right ? CLOSES : 0);
}

// CommonMark's delimiter runs over [from, to), links' text taken as scopes of their own: `skip`,
// `[start, end)` of the links right inside [from, to), in the order they start.
function matchEmphasis(text, from, to, skip, marks) {
  const stack = [];
  let bottom = null;
  const special = /[*_~]/g;
  let h = 0;
  let startOfSegment = from;
  let segment = text.slice(from, skip.length === 0 ? to : skip[0][0]);

  for (;;) {
    const found = special.exec(segment);
    if (found === null) {
      if (h === skip.length) {
        break;
      }
      startOfSegment = skip[h][1];
      h++;
      segment = text.slice(startOfSegment, h === skip.length ? to : skip[h][0]);
      special.lastIndex = 0;
      continue;
    }
    const i = startOfSegment + found.index;

    const c = text.codePointAt(i);

    if (escaped(text, i, from)) {
      continue;
    }

    let j = i + 1;

    while (j < to && text.codePointAt(j) === c) {
      j++;
    }

    const length = j - i;
    const before = i > 0 ? text.codePointAt(i - 1) : -1;
    const after = j < text.length ? text.codePointAt(j) : -1;
    special.lastIndex = j - startOfSegment;

    if (c === TILDE && length !== 2) {
      continue;
    }

    const role = delimiterRole(c, before, after);
    if (role === 0) {
      continue;
    }
    bottom ??= Array(18).fill(0);
    const canOpen = (role & OPENS) !== 0;
    const canClose = (role & CLOSES) !== 0;

    let start = j - length;
    let rest = length;
    // CommonMark's openers bottom: whether an opener fits a closer depends on its run and on the
    // closer's character, whether it can open and its length modulo 3 alone, so a closer like one that
    // found none below a depth looks no deeper.
    const key = DELIMITERS.indexOf(c) * 6 + (canOpen ? 3 : 0) + (length % 3);

    if (canClose) {
      for (let k = stack.length - 1; k >= bottom[key] && rest > 0; k--) {
        const op = stack[k];

        if (op.char !== c || op.rest === 0) {
          continue;
        }

        // A tilde run is two long, so the rule of three never parts two of them.
        if (
          (op.canClose || canOpen) &&
          (op.length + length) % 3 === 0 &&
          !(op.length % 3 === 0 && length % 3 === 0)
        ) {
          continue;
        }

        const used = Math.min(op.rest, rest, 2);

        op.rest -= used;
        pair(marks, op.start + op.rest, op.start + op.rest + used, start, start + used);
        start += used;
        rest -= used;
        stack.length = op.rest > 0 ? k + 1 : k;

        for (let b = 0; b < bottom.length; b++) {
          bottom[b] = Math.min(bottom[b], stack.length);
        }

        if (rest > 0) {
          k = stack.length;
        }
      }

      if (rest > 0) {
        bottom[key] = stack.length;
      }
    }

    if (rest > 0 && canOpen) {
      stack.push({ char: c, start, rest, length, canClose });
    }
  }
}

// Every marker a reader of the rendered Markdown never sees, each with the one it pairs with.
function markdownMarks(text) {
  const marks = [];
  const special = /[*_~\]]/g;

  for (let from = 0; from <= text.length;) {
    // Straight to the next line that holds a marker.
    special.lastIndex = from;

    const found = special.exec(text);

    if (found === null) {
      break;
    }

    from = text.lastIndexOf('\n', found.index) + 1;

    let to = text.indexOf('\n', found.index);

    if (to === -1) {
      to = text.length;
    }

    if (to > from) {
      const links = [];
      const emphasis = /[*_~]/.test(text.slice(from, to));

      findLinks(text, from, to, links);

      // Link text is a scope of its own, and an emphasis cannot run in or out of it. Links come in
      // the order they close, so the outermost ones closed so far that start inside a link are the
      // ones right inside its text.
      const outer = [];

      for (const l of links) {
        let k = outer.length;

        while (k > 0 && outer[k - 1][0] > l.open) {
          k--;
        }

        if (!l.image) {
          if (emphasis) {
            matchEmphasis(text, l.open + 1, l.close, outer.slice(k), marks);
          }
          pair(marks, l.open, l.open + 1, l.close, l.end);
        }

        outer.length = k;
        outer.push([l.open, l.end]);
      }

      if (emphasis) {
        matchEmphasis(text, from, to, outer, marks);
      }
    }

    from = to + 1;
  }

  for (let i = 1; i < marks.length; i++) {
    if (marks[i - 1].start > marks[i].start) {
      return marks.toSorted((x, y) => x.start - y.start);
    }
  }
  return marks;
}

// ---------------------------------------------------------------------------------------------
// Lifting.

// Every placeholder in the text: tags `<⟦T0⟧>`, `</⟦A1⟧>` and bare ones `⟦B0⟧`.
function scanPlaceholders(text) {
  const items = [];

  for (let j = text.indexOf(OPEN); j !== -1; j = text.indexOf(OPEN, j + 1)) {
    const shut = text.indexOf(CLOSE, j + 1);

    if (shut === -1) {
      break;
    }

    const kind = text[j + 1];
    const tagged = text.codePointAt(shut + 1) === GT;

    if (tagged && text.codePointAt(j - 1) === LT) {
      items.push(piece(j - 1, shut + 2, true, false, kind, j + 1, shut));
    } else if (tagged && text.codePointAt(j - 1) === SLASH && text.codePointAt(j - 2) === LT) {
      items.push(piece(j - 2, shut + 2, true, true, kind, j + 1, shut));
    } else {
      items.push(piece(j, shut + 1, false, false, kind, j + 1, shut));
    }

    j = shut;
  }

  return items;
}

function tagName(text, item, cx) {
  return cx.nameOf(item.kind, Number(text.slice(item.id + 1, item.shut)));
}

const ADDRESS_RE = /^a href="(?:(?:https?|ftp):\/\/|mailto:)([^"]*)"$/u;
const AMP_RE = /&amp;/gu;

// The tags of markup written in the form the engine writes it — a superscript or a subscript around
// `<small>`, a link whose text is its own address — are taken for the engine's, as minting them
// takes them: a second pass over the engine's output reads them as the pass that wrote them.
function noteEngineForms(text, items, cx) {
  for (let k = 0; k + 1 < items.length; k++) {
    const item = items[k];
    const next = items[k + 1];

    if (!item.tag || item.close || !next.tag) {
      continue;
    }

    const name = tagName(text, item, cx);

    if (name !== 'a' && name !== 'sup' && name !== 'sub') {
      continue;
    }

    const raw = cx.rawOf(item.kind, Number(text.slice(item.id + 1, item.shut)));
    const after = cx.rawOf(next.kind, Number(text.slice(next.id + 1, next.shut)));
    const open = text.slice(item.start, item.end);

    if (name !== 'a') {
      if (raw === name && !next.close && next.start === item.end && after === 'small') {
        cx.engineOpeners.set(open, false);
        cx.engineOpeners.set(text.slice(next.start, next.end), false);
      }

      continue;
    }

    const address = ADDRESS_RE.exec(cx.restoreSequences(raw ?? ''));
    const body = cx.restoreSequences(text.slice(item.end, next.start));

    if (
      address !== null &&
      next.close &&
      after === 'a' &&
      address[1].replaceAll(AMP_RE, '&') === body.replaceAll(AMP_RE, '&')
    ) {
      cx.engineOpeners.set(open, false);
    }
  }
}

// The open elements: a closing tag ends the latest open element of its name, or none, and leaves the
// ones opened after it unclosed. Each element is looked up by its name and dropped once.
function openElements() {
  const stack = [];
  const byName = new Map();

  return {
    open(name, value) {
      const at = byName.get(name);

      if (at === undefined) {
        byName.set(name, [stack.length]);
      } else {
        at.push(stack.length);
      }

      stack.push({ name, value });
    },

    // The element `name` ends, or null.
    close(name) {
      const k = byName.get(name)?.at(-1);

      if (k === undefined) {
        return null;
      }

      const element = stack[k];

      for (let i = stack.length - 1; i >= k; i--) {
        byName.get(stack[i].name).pop();
      }

      stack.length = k;

      return element;
    }
  };
}

// What reads as the start of a tag inside a tag's attributes.
const TAG_START_RE = /<[A-Za-z/]/u;

// The engine's own markup keeps its place: the rules that settle a wrapper read its tags, and a
// second pass over the engine's output reads the same markup as the pass that wrote it. So does a
// tag holding what reads as a tag, as an attribute left open takes in the wrapper written after
// it. A comment or a declaration stays where it is too.
function pinEngineWrappers(text, items, cx) {
  noteEngineForms(text, items, cx);

  const open = openElements();

  for (const item of items) {
    if (!item.tag) {
      continue;
    }

    const name = tagName(text, item, cx);

    if (name === null) {
      item.pinned = true;
      continue;
    }

    if (VOID_NAMES.has(name)) {
      continue;
    }

    if (!item.close) {
      item.pinned =
        cx.engineOpeners.has(text.slice(item.start, item.end)) ||
        TAG_START_RE.test(cx.rawOf(item.kind, Number(text.slice(item.id + 1, item.shut))));
      open.open(name, item.pinned);
      continue;
    }

    item.pinned = open.close(name)?.value === true;
  }
}

// The tag each inline tag pairs with, by name; a void tag, a comment and a tag left unpaired have
// none.
function pairTags(text, items, cx) {
  const open = openElements();

  for (const item of items) {
    if (!item.tag || (item.kind !== 'T' && item.kind !== 'A')) {
      continue;
    }

    const name = tagName(text, item, cx);

    if (name === null || VOID_NAMES.has(name)) {
      continue;
    }

    if (!item.close) {
      open.open(name, item);
      continue;
    }

    const element = open.close(name);

    if (element !== null) {
      item.mate = element.value;
      element.value.mate = item;
    }
  }
}

const inlineTag = (p) => p?.tag && (p.kind === 'T' || p.kind === 'A');

// A protected inline element, as one unit: `<code>⟦B0⟧</code>`, a Markdown code span `` `⟦B0⟧` ``,
// or a `<script>` body no reader sees (kind `N`). A protected block, `<pre>` among them, is none.
function findUnits(text, items, markdown) {
  const units = [];

  for (let k = 0; k < items.length; k++) {
    const item = items[k];

    if (item.tag || (item.kind !== 'B' && item.kind !== 'N')) {
      continue;
    }

    const prev = items[k - 1];
    const next = items[k + 1];

    if (
      inlineTag(prev) &&
      !prev.close &&
      prev.end === item.start &&
      inlineTag(next) &&
      next.close &&
      next.start === item.end
    ) {
      prev.unit = true;
      next.unit = true;
      item.unit = true;
      units.push(piece(prev.start, next.end, false, false, item.kind === 'N' ? 'N' : 'U'));
      continue;
    }

    if (markdown && item.kind === 'B') {
      let n = 0;

      while (text.codePointAt(item.start - n - 1) === BACKTICK) {
        n++;
      }

      if (
        n > 0 &&
        text.startsWith('`'.repeat(n), item.end) &&
        text.codePointAt(item.end + n) !== BACKTICK
      ) {
        item.unit = true;
        units.push(piece(item.start - n, item.end + n, false, false, 'U'));
      }
    }
  }

  return units;
}

// A tag without a pair, `<img>` or one left open, stays: the text does not show where its element
// ends, and there are no words in a void one to read. A run beside it reads it as an edge.
const isCandidate = (p) =>
  p.kind === 'M' || (p.tag && !p.pinned && p.mate !== null && (p.kind === 'T' || p.kind === 'A'));

// What a run of markup sees in a piece of markup that stays beside it: a stand-in's letter; a pin
// for an inline block or a protected element that is not a word; the edge for anything else.
function seen(p) {
  if (p.kind === 'U') {
    return p.standIn ? STAND_IN.codePointAt(0) : PIN;
  }

  return p.kind === 'N' || p.kind === 'I' || p.kind === 'H' ? PIN : EDGE;
}

// The visible neighbour on the left of piece `i` of `all`, or on the right of it.
function leftOf(text, all, i) {
  const at = all[i].start;

  if (i > 0 && all[i - 1].end === at) {
    return seen(all[i - 1]);
  }

  if (at === 0) {
    return EDGE;
  }

  const c = text.codePointAt(at - 1);

  return isPua(c) ? EDGE : c;
}

function rightOf(text, all, i) {
  const at = all[i].end;

  if (i + 1 < all.length && all[i + 1].start === at) {
    return seen(all[i + 1]);
  }

  if (at >= text.length) {
    return EDGE;
  }

  const c = text.codePointAt(at);

  return isPua(c) ? EDGE : c;
}

const HYPHEN = 0x2d;
const CLOSING_MARKS = new Set([...`,.;:!?${G.HELLIP})]}`].map((c) => c.codePointAt(0)));
// The quote marks the rules take the white space after.
const OPENING_QUOTES = new Set([G.LAQUO.codePointAt(0), G.BDQUO.codePointAt(0)]);

function codeAt(text, at) {
  return at >= 0 && at < text.length ? text.codePointAt(at) : -1;
}

// Whether an opening quote stands past the white space that ends at `at`. One glued to the end of a
// word is no such quote: the rules turn it into a closing one.
function opensQuoteBefore(text, at) {
  let p = at;

  while (p >= 0 && isSpace(text.codePointAt(p))) {
    p--;
  }

  return p >= 0 && OPENING_QUOTES.has(text.codePointAt(p)) && !isWordChar(codeAt(text, p - 1));
}

// Whether `c`, beside a run of markup, is a dash that stands as a sign, `beyond` the character past
// it. A hyphen that joins two words is part of a word.
function dashSign(c, beyond) {
  return (
    c === G.MDASH.codePointAt(0) ||
    c === G.NDASH.codePointAt(0) ||
    (c === HYPHEN && !isWordChar(beyond))
  );
}

// Whether pieces `i` to `j` of `all`, one run of markup in `text`, may be lifted. The run may touch
// a word on one side only, and never only white space, where a lifted tag would leave a doubled
// space behind. A closing tag in it is pressed to the last character its element holds and an
// opening one to the first, so one with white space or an edge there stays.
//
// The next pass lifts the same runs: a rule that takes away white space beside a run leaves it
// pressed to the character past that space, so a run stays where that character would keep it in
// place. It stays beside what the rules read beside a tag, too:
// - a quote mark, as the quote rules read the tags next to one, and one past the white space after
//   an opening quote, which the rules take away. A closing quote past white space is no such mark:
//   the rules may yet turn it into an opening one, before which the white space stays;
// - a dash that stands as a sign inside the element the tag opens or closes, as `<em>- слово</em>`
//   opens a line to the dash rules. A dash outside it, `<em>слово</em>—`, gets white space before it
//   from them, which the next pass would lift past;
// - for an opening tag, a mark that closes what stands before it, `<em>, что</em>`: lifted, the
//   element would move onto the word before when a rule takes away the white space before the mark.
function liftable(text, all, i, j, closes, opens) {
  const l = leftOf(text, all, i);
  const r = rightOf(text, all, j);

  if (l === PIN || r === PIN || QUOTES.has(l) || QUOTES.has(r)) {
    return false;
  }

  if (isWordChar(l) && isWordChar(r)) {
    return false;
  }

  // Every run opens or closes, so white space on both sides stops it here.
  if ((closes && isEdge(l)) || (opens && isEdge(r))) {
    return false;
  }

  if (opens && CLOSING_MARKS.has(r)) {
    return false;
  }

  if (
    (closes && dashSign(l, codeAt(text, all[i].start - 2))) ||
    (opens && dashSign(r, codeAt(text, all[j].end + 1)))
  ) {
    return false;
  }

  return !(isSpace(l) && opensQuoteBefore(text, all[i].start - 1));
}

// Whether a word stands past the quote mark at `at` of `text`, going `step` past the markup of `all`
// from piece `from` on.
function wordPastQuote(text, all, at, from, step) {
  let b = at + step;

  for (let k = from; k >= 0 && k < all.length && isCandidate(all[k]); k += step) {
    const p = all[k];

    if (step < 0 ? p.end !== b + 1 : p.start !== b) {
      break;
    }

    b = step < 0 ? p.start - 1 : p.end;
  }

  return isWordChar(codeAt(text, b));
}

const MARKER_RE = /[*_~[`]/;

// An inline element's tag, `<⟦T0⟧>` or `</⟦A1⟧>`; any other is a block's, or a protected one's.
function hasInlineTags(text) {
  return text.includes(`${OPEN}T`) || text.includes(`${OPEN}A`);
}

// Whether `text` holds anything a lift reads. A text that holds none never will: the rules add only
// the engine's own markup, which stays where it is.
export function mayLift(text, cx) {
  return hasInlineTags(text) || (cx.markdown && MARKER_RE.test(text));
}

function liftLinks(text, cx) {
  if (!cx.markdown || /[\n*_~`]/.test(text) || hasInlineTags(text)) {
    return null;
  }

  const links = [];
  findLinks(text, 0, text.length, links);
  if (links.length === 0) {
    return null;
  }

  const all = [piece(0, 0, false, false, 'M'), piece(0, 0, false, true, 'M')];
  const parts = [];
  const pos = [];
  const str = [];
  const flag = [];
  const partner = [];
  let cursor = 0;
  let length = 0;

  for (const link of links) {
    if (link.image || link.open < cursor || (cursor > 0 && link.open === cursor)) {
      return null;
    }
    const before = text.slice(cursor, link.open);
    const content = text.slice(link.open + 1, link.close);
    if (content.length === 0 || before.includes(OPEN) || content.includes(OPEN)) {
      return null;
    }

    const [open, close] = all;
    open.start = link.open;
    open.end = link.open + 1;
    close.start = link.close;
    close.end = link.end;
    if (!liftable(text, all, 0, 0, false, true) || !liftable(text, all, 1, 1, true, false)) {
      return null;
    }

    parts.push(before, content);
    length += before.length;
    pos.push(length, length + content.length);
    length += content.length;
    const index = str.length;
    str.push('[', text.slice(link.close, link.end));
    flag.push(0, CLOSER);
    partner.push(index + 1, index);
    cursor = link.end;
  }

  const tail = text.slice(cursor);
  if (tail.includes(OPEN)) {
    return null;
  }
  parts.push(tail);
  return { visible: parts.join(''), pos, toks: { str, flag, partner } };
}

// Lifts the inline markup out of `text`: `{ visible, pos, toks }`, `pos[k]` the offset in `visible`
// token `k` stood at, or null when there is nothing to lift.
export function lift(text, cx) {
  if (!mayLift(text, cx)) {
    return null;
  }

  const links = liftLinks(text, cx);
  if (links !== null) {
    return links;
  }

  const items = scanPlaceholders(text);

  if (hasInlineTags(text)) {
    pinEngineWrappers(text, items, cx);
    pairTags(text, items, cx);
  }

  const units = findUnits(text, items, cx.markdown);
  let all =
    units.length === 0
      ? items
      : mergePieces(
          items.filter((item) => !item.unit),
          units
        );

  if (cx.markdown) {
    // Both in the order they start: a marker inside a code span is the span's text.
    const marks = [];
    let u = 0;

    for (const mark of markdownMarks(text)) {
      while (u < units.length && units[u].end <= mark.start) {
        u++;
      }

      if (u === units.length || mark.start < units[u].start) {
        marks.push(mark);
      }
    }

    all = mergePieces(all, marks);
  }

  const n = all.length;

  // A protected element is a word where the text around it, past any markup, is not one. One with a
  // quote mark between it and a word stays as written: the quote rules turn a mark glued between two
  // words as an opening one, and that mark by the markup beside it.
  for (let u = 0; u < n; u++) {
    if (all[u].kind !== 'U') {
      continue;
    }

    let i = u;
    let j = u;

    while (i > 0 && isCandidate(all[i - 1]) && all[i - 1].end === all[i].start) {
      i--;
    }

    while (j + 1 < n && isCandidate(all[j + 1]) && all[j + 1].start === all[j].end) {
      j++;
    }

    const l = leftOf(text, all, i);
    const r = rightOf(text, all, j);

    all[u].standIn =
      l !== PIN &&
      r !== PIN &&
      !isWordChar(l) &&
      !isWordChar(r) &&
      !(QUOTES.has(l) && wordPastQuote(text, all, all[i].start - 1, i - 1, -1)) &&
      !(QUOTES.has(r) && wordPastQuote(text, all, all[j].end, j + 1, 1));
  }

  for (let i = 0; i < n;) {
    if (!isCandidate(all[i])) {
      i++;
      continue;
    }

    let j = i;

    while (j + 1 < n && isCandidate(all[j + 1]) && all[j + 1].start === all[j].end) {
      j++;
    }

    let closes = false;
    let opens = false;

    for (let k = i; k <= j; k++) {
      closes ||= all[k].close;
      opens ||= !all[k].close;
    }

    if (liftable(text, all, i, j, closes, opens)) {
      for (let k = i; k <= j; k++) {
        all[k].lift = true;
      }
    }

    i = j + 1;
  }

  // An element is lifted whole or stays whole: half of it left in place reads to a rule as a word
  // break inside it.
  const parts = [];
  const pos = [];
  const str = [];
  const flag = [];
  const lifted = [];
  let cursor = 0;
  let length = 0;

  for (let k = 0; k < n; k++) {
    const t = all[k];

    if (!(t.standIn || (t.lift && t.mate !== null && t.mate.lift))) {
      continue;
    }

    t.index = lifted.length;
    lifted.push(t);
    parts.push(text.slice(cursor, t.start));
    length += t.start - cursor;
    pos.push(length);
    str.push(text.slice(t.start, t.end));
    flag.push((t.close ? CLOSER : 0) | (t.standIn ? STANDS_IN : 0));
    cursor = t.end;

    if (t.standIn) {
      parts.push(STAND_IN);
      length += STAND_IN.length;
    }
  }

  if (lifted.length === 0) {
    return null;
  }

  parts.push(text.slice(cursor));

  // The token each one pairs with, itself for one that stands alone.
  const partner = lifted.map((t, k) => (t.mate === null ? k : t.mate.index));

  return { visible: parts.join(''), pos, toks: { str, flag, partner } };
}

// The marked-up text back: every token at its offset in the visible text.
export function materialize(state) {
  const { visible, pos } = state;
  const { str, flag } = state.toks;
  const parts = [];
  let cursor = 0;

  for (let k = 0; k < pos.length; k++) {
    parts.push(visible.slice(cursor, pos[k]), str[k]);
    cursor = flag[k] & STANDS_IN ? pos[k] + STAND_IN.length : pos[k];
  }

  parts.push(visible.slice(cursor));

  return parts.join('');
}

function traceProjection(state) {
  const edits = state.pos.map((start, k) => ({
    start,
    end: state.toks.flag[k] & STANDS_IN ? start + STAND_IN.length : start,
    text: state.toks.str[k],
    retain: true
  }));
  const output = materialize(state);
  return {
    text: state.visible,
    tokens: state.toks,
    edits,
    render(mapping) {
      mapping.record(state.visible, output, edits);
      return output;
    }
  };
}

function acceptTrace(ctx, state) {
  const trace = ruleTraceOf(ctx);
  if (trace !== undefined) {
    trace.accept(traceProjection(state));
  }
}

// ---------------------------------------------------------------------------------------------
// Realignment.

// How many characters from `a` in `x` and `b` in `y` are the same. Rules change text in many close
// places, so the first few are compared one by one; past them, blocks that double while they agree
// and halve where the two part.
const NEAR = 16;

function common(x, a, y, b) {
  const max = Math.min(x.length - a, y.length - b);
  const near = max < NEAR ? max : NEAR;
  let k = 0;

  while (k < near && x.codePointAt(a + k) === y.codePointAt(b + k)) {
    k++;
  }

  if (k < near || k === max) {
    return k;
  }

  let block = 32;

  while (k + block <= max && x.slice(a + k, a + k + block) === y.slice(b + k, b + k + block)) {
    k += block;
    block = block < 2048 ? block << 1 : block;
  }

  for (block >>= 1; block >= 16; block >>= 1) {
    if (k + block <= max && x.slice(a + k, a + k + block) === y.slice(b + k, b + k + block)) {
      k += block;
    }
  }

  while (k < max && x.codePointAt(a + k) === y.codePointAt(b + k)) {
    k++;
  }

  return k;
}

// How far a change of words reaches, in words on either side of the ones it touched: lifted markup
// within it leaves the change to the marked-up text, where the rule reads that markup as it always
// did.
const REACH = 2;
// How many words past a change the two texts are looked at for meeting again.
const SPAN = 8;

// Whether the word at `x` in `s` and the one at `y` in `t` are the same, a line's end matching a
// line's end.
function sameWord(s, x, se, t, y, te) {
  if (x === se || y === te) {
    return x === se && y === te;
  }

  for (let k = 0; ; k++) {
    const c = x + k < se ? s.codePointAt(x + k) : -1;
    const d = y + k < te ? t.codePointAt(y + k) : -1;
    const endS = c === -1 || isSpace(c);
    const endT = d === -1 || isSpace(d);

    if (endS || endT) {
      return endS && endT;
    }

    if (c !== d) {
      return false;
    }
  }
}

// The starts of the next few words in `s` from `from` on, the line's end `end` last.
function wordStarts(s, from, end) {
  const starts = [];
  let p = from;

  if (p > 0 && !isSpace(s.codePointAt(p - 1))) {
    while (p < end && !isSpace(s.codePointAt(p))) {
      p++;
    }
  }

  while (starts.length < SPAN && p < end) {
    while (p < end && isSpace(s.codePointAt(p))) {
      p++;
    }

    if (p < end) {
      starts.push(p);
    }

    while (p < end && !isSpace(s.codePointAt(p))) {
      p++;
    }
  }

  starts.push(end);

  return starts;
}

// Where `before` and `after` meet again past a change of words at `a` and `b`: the first word, of the
// next few, that both have next, as `[x, y]`, or null.
function resync(before, a, le, after, b, be) {
  const xs = wordStarts(before, a, le);
  const ys = wordStarts(after, b, be);

  for (let d = 0; d < xs.length + ys.length - 1; d++) {
    for (let i = Math.max(0, d - ys.length + 1); i <= d && i < xs.length; i++) {
      if (sameWord(before, xs[i], le, after, ys[d - i], be)) {
        return [xs[i], ys[d - i]];
      }
    }
  }

  return null;
}

// The span of `s` a change from `from` to `to` reaches: the word it begins inside and `words` words
// on either side, within the line `ls`..`le`. `to` is where the texts meet again, the start of a word
// the change left alone, or the line's end.
function reach(s, from, to, ls, le, words) {
  let lo = from;
  let hi = to;

  if (lo < le && !isSpace(s.codePointAt(lo))) {
    while (lo > ls && !isSpace(s.codePointAt(lo - 1))) {
      lo--;
    }
  }

  for (let n = 0; n < words; n++) {
    while (lo > ls && isSpace(s.codePointAt(lo - 1))) {
      lo--;
    }

    while (lo > ls && !isSpace(s.codePointAt(lo - 1))) {
      lo--;
    }

    while (hi < le && isSpace(s.codePointAt(hi))) {
      hi++;
    }

    while (hi < le && !isSpace(s.codePointAt(hi))) {
      hi++;
    }
  }

  return [lo, hi];
}

// The tag `<⟦X0⟧>` or `</⟦X0⟧>` at `at`, as its end, or -1.
function tagAt(s, at) {
  if (s.codePointAt(at) !== LT) {
    return -1;
  }

  const j = s.codePointAt(at + 1) === SLASH ? at + 2 : at + 1;

  if (s.codePointAt(j) !== OPEN_CODE) {
    return -1;
  }

  const shut = s.indexOf(CLOSE, j + 1);

  return shut !== -1 && s.codePointAt(shut + 1) === GT ? shut + 2 : -1;
}

// Where the tag `at` falls inside begins, or `at` itself when it falls inside none; never before
// `from`.
function tagStartBefore(s, at, from) {
  for (let p = at - 1; p >= from; p--) {
    const c = s.codePointAt(p);

    if (c === LT) {
      const next = s.codePointAt(p + 1);

      return p + 1 === at || next === OPEN_CODE || next === SLASH ? p : at;
    }

    if (
      c !== OPEN_CODE &&
      c !== SLASH &&
      !(c >= 48 && c <= 57) &&
      !((c | 32) >= 97 && (c | 32) <= 122)
    ) {
      return at;
    }
  }

  return at;
}

function lineHasToken(pos, from, to) {
  const lo = firstAtOrAfter(pos, from);

  return lo < pos.length && pos[lo] <= to;
}

// Whether the tokens from `lo` to `hi` are all stand-ins outside the stretch `from` to `to` a change
// rewrote.
function standInsBeside(pos, toks, lo, hi, from, to) {
  for (let k = firstAtOrAfter(pos, lo); k < pos.length && pos[k] <= hi; k++) {
    if (!(toks.flag[k] & STANDS_IN) || (pos[k] + STAND_IN.length > from && pos[k] < to)) {
      return false;
    }
  }

  return true;
}

// Where the tag ending at `end` in `s` begins, or -1.
function tagEndingAt(s, end) {
  if (s.codePointAt(end - 1) !== GT || s[end - 2] !== CLOSE) {
    return -1;
  }

  const at = s.lastIndexOf('<', end - 3);

  return at !== -1 && tagAt(s, at) === end ? at : -1;
}

// Where the engine's tags from `at` in `s` end, going `step` (-1 or 1).
function pastTags(s, at, step) {
  let p = at;

  for (;;) {
    const tag = step < 0 ? tagEndingAt(s, p + 1) : tagAt(s, p);

    if (tag === -1) {
      return p;
    }

    p = step < 0 ? tag - 1 : tag;
  }
}

// The character at `at` in `s` as written against a stand-in, `from` to `to` the stretch up to the
// stand-ins on either side: 0 for white space or past the stretch, 1 for a quote mark, which turns by
// the word it stands at, and the character itself for anything else.
function markAt(s, at, from, to) {
  const c = at < from || at >= to ? 32 : s.codePointAt(at);

  if (isSpace(c)) {
    return 0;
  }

  return QUOTES.has(c) ? 1 : c;
}

// Whether what is written against a stand-in up to white space, going `step` from `p` in `before`
// and `q` in `after`, past the engine's tags and within `[pf, pt)` and `[qf, qt)`, reads the same.
function sameSide(before, p, pf, pt, after, q, qf, qt, step) {
  let i = p;
  let j = q;

  for (;;) {
    i = pastTags(before, i, step);
    j = pastTags(after, j, step);

    const x = markAt(before, i, pf, pt);

    if (x !== markAt(after, j, qf, qt)) {
      return false;
    }

    if (x === 0) {
      return true;
    }

    i += step;
    j += step;
  }
}

// Whether one of the engine's tags `tags` starts in `s` from `from` to `to`.
function holdsTag(s, from, to, tags) {
  const part = s.slice(from, to);

  for (let i = part.indexOf('<'); i !== -1; i = part.indexOf('<', i + 1)) {
    const end = tagAt(s, from + i);

    if (end !== -1 && tags.has(s.slice(from + i, end))) {
      return true;
    }
  }

  return false;
}

// How many of the engine's no-break wrappers hold each stand-in of `s`, `at` the places of the tokens.
function heldIn(s, at, flag, cx) {
  const held = Array.from({ length: at.length }, () => 0);
  const stack = [];
  let keeps = 0;
  let p = s.indexOf('<');

  for (let k = 0; k < at.length; k++) {
    if (!(flag[k] & STANDS_IN)) {
      continue;
    }

    while (p !== -1 && p < at[k]) {
      const end = tagAt(s, p);

      if (end === -1) {
        p = s.indexOf('<', p + 1);
        continue;
      }

      const tag = s.slice(p, end);

      if (s.codePointAt(p + 1) === SLASH) {
        if (stack.length > 0 && cx.engineTags.has(tag)) {
          keeps -= stack.pop();
        }
      } else if (cx.engineOpeners.has(tag)) {
        const one = cx.engineOpeners.get(tag) === true ? 1 : 0;

        stack.push(one);
        keeps += one;
      }

      p = s.indexOf('<', end);
    }

    held[k] = keeps;
  }

  return held;
}

// The stand-ins a rule's output reads as more than a word, as spans of `state.visible` to put back:
// those with anything but white space and quote marks written, taken or changed against them, and
// those a no-break wrapper takes in. A code element tells the words around it that a word stands
// there, and nothing of what it holds: no mark is bound to it, and a line breaks around it as it
// would without the rules. Null where there are none, false where the rule rewrote a stand-in.
// `tagged` is whether one of the engine's tags stands where the rule changed the text: where none
// does, its wrappers hold every stand-in as before.
function touchedStandIns(state, after, out, cx, tagged) {
  const { visible: before, pos } = state;
  const { flag } = state.toks;
  const ks = [];

  for (let k = 0; k < pos.length; k++) {
    if (flag[k] & STANDS_IN) {
      if (!after.startsWith(STAND_IN, out[k])) {
        return false;
      }

      ks.push(k);
    }
  }

  if (ks.length === 0) {
    return null;
  }

  const held = tagged ? [heldIn(before, pos, flag, cx), heldIn(after, out, flag, cx)] : null;
  const len = STAND_IN.length;
  let spans = null;

  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    const p = pos[k];
    const q = out[k];
    const pf = i > 0 ? pos[ks[i - 1]] + len : 0;
    const qf = i > 0 ? out[ks[i - 1]] + len : 0;
    const pt = i + 1 < ks.length ? pos[ks[i + 1]] : before.length;
    const qt = i + 1 < ks.length ? out[ks[i + 1]] : after.length;

    if (
      (held !== null && held[1][k] > held[0][k]) ||
      !sameSide(before, p - 1, pf, p, after, q - 1, qf, q, -1) ||
      !sameSide(before, p + len, p + len, pt, after, q + len, q + len, qt, 1)
    ) {
      (spans ??= []).push(p, p);
    }
  }

  return spans;
}

// Whether `le` in `before` and `be` in `after` end the same line: both texts end there, or read
// the same a little past them.
const LOOK = 16;

function sameLineEnd(before, le, after, be) {
  if (le === before.length || be === after.length) {
    return le === before.length && be === after.length;
  }

  const k = Math.min(LOOK, before.length - le, after.length - be);

  for (let i = 0; i < k; i++) {
    if (before.codePointAt(le + i) !== after.codePointAt(be + i)) {
      return false;
    }
  }

  return true;
}

// How many lines on a change that joins or splits lines is followed.
const LINES = 3;

function lineEnd(s, at) {
  const end = s.indexOf('\n', at + 1);

  return end === -1 ? s.length : end;
}

// Where a change on a line of `before` with no token, ending at `le`, is over: `[le, be]` where the
// texts read alike past both line ends, or else the nearest two line ends past which they do, at
// most `LINES` lines on, with no token in `before` up to there. A rule that joined or split lines
// meets the other text a line end later; as many lines on in both are tried first. Null where there
// is none.
function changedLines(before, le, after, be, pos) {
  if (sameLineEnd(before, le, after, be)) {
    return [le, be];
  }

  const xs = [le];
  const ys = [be];

  for (let x = le; xs.length <= LINES && x < before.length;) {
    const end = lineEnd(before, x);

    if (lineHasToken(pos, x + 1, end)) {
      break;
    }

    xs.push(end);
    x = end;
  }

  for (let y = be; ys.length <= LINES && y < after.length;) {
    y = lineEnd(after, y);
    ys.push(y);
  }

  for (let d = 1; d < xs.length + ys.length - 1; d++) {
    // From the middle out: as many lines in both first.
    for (let s = 0; s <= d; s++) {
      const i = (d >> 1) + (s % 2 === 1 ? (s + 1) >> 1 : -(s >> 1));
      const j = d - i;

      if (i < 0 || i >= xs.length || j < 0 || j >= ys.length) {
        continue;
      }

      const tx = before.length - xs[i];
      const ty = after.length - ys[j];

      // Near the end, only tails alike to the end: any two short ones would read alike for a look.
      if ((tx === ty || (tx >= LOOK && ty >= LOOK)) && sameLineEnd(before, xs[i], after, ys[j])) {
        return [xs[i], ys[j]];
      }
    }
  }

  return null;
}

// The line of `s` that holds `at`, `[start, end]`, `end` its line break or the end of `s`: `line`
// itself where it is that line already, and refilled otherwise.
function lineOf(s, line, at) {
  if (at < line[0] || at > line[1]) {
    const end = s.indexOf('\n', at);

    line[0] = s.lastIndexOf('\n', at - 1) + 1;
    line[1] = end === -1 ? s.length : end;
  }

  return line;
}

// The tags of `found`, `[start, end, …]` in `s`, left once the tags `known` are found among them in
// order: first each as early as it can stand, then each as late. Null where `known` are not all
// there, or the two readings leave different tags.
function mintedOf(s, found, known) {
  const early = [];
  const late = [];
  let k = 0;

  for (let i = 0; i < found.length; i += 2) {
    if (k < known.length && s.slice(found[i], found[i + 1]) === known[k]) {
      k++;
    } else {
      early.push(found[i], found[i + 1]);
    }
  }

  if (k < known.length) {
    return null;
  }

  k = known.length - 1;

  for (let i = found.length - 2; i >= 0; i -= 2) {
    if (k >= 0 && s.slice(found[i], found[i + 1]) === known[k]) {
      k--;
    } else {
      late.unshift(found[i], found[i + 1]);
    }
  }

  return early.length === late.length && early.every((p, i) => p === late[i]) ? early : null;
}

// Whether a rule that wrote the tags `minted` left more of one of them in `after` than `before` had: a
// rule may ask for a wrapper only to read its shape, and moves the ones the text holds.
function mintsNew(minted, before, after) {
  for (const tag of minted) {
    if (count(after, tag) > count(before, tag)) {
      return true;
    }
  }

  return false;
}

function count(text, part) {
  let n = 0;

  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) {
    n++;
  }

  return n;
}

// Places the tokens of `state` into `after`, the rule's output on the visible text: `{ visible,
// pos, toks }`, or null when the rule changed more than white space on a line holding a token, or
// put a token's white space in a state the token's place in it cannot be read from. Where changes
// of words came too near tokens and nothing else stood in the way, `cx.near` is the spans of
// `state.visible` they reached, `[from, to, from, to, …]`, and null otherwise. A change reaches
// `words` words on either side of the ones it touched.
export function realign(state, after, cx, words = REACH) {
  cx.near = null;

  const before = state.visible;
  const { pos, toks } = state;
  const n = pos.length;
  const na = before.length;
  const nb = after.length;
  if (nb < na && (n === 0 || pos[n - 1] <= nb) && before.startsWith(after)) {
    let at = nb;
    while (at < na && isSpace(before.codePointAt(at))) {
      at++;
    }
    if (at === na) {
      return { visible: after, pos, toks };
    }
  }
  const out = Array(n).fill(0);
  const minted = cx.mints !== null && mintsNew(cx.mints, before, after) ? cx.mints : null;
  let inserted = null;
  // Wrappers minted and recorded open, whose closing tags are still to come.
  let open = 0;
  const record = (p, e) => {
    (inserted ??= []).push(p, e);
    open += after.codePointAt(p + 1) === SLASH ? -1 : 1;
  };
  let near = null;
  let a = 0;
  let b = 0;
  let t = 0;
  // Whether a tag of the engine stands in or around a stretch the rule changed so far, `af` to `at`
  // of `before` and `bf` to `bt` of `after`, where a stand-in is there to be held by it.
  const standsIn = toks.flag.some((f) => f & STANDS_IN);
  let tagged = false;
  const changed = (af, at, bf, bt) => {
    tagged ||=
      standsIn &&
      (holdsTag(before, tagStartBefore(before, af, 0), at, cx.engineTags) ||
        holdsTag(after, tagStartBefore(after, bf, 0), bt, cx.engineTags));
  };

  const shiftTo = (limit, delta) => {
    while (t < n && pos[t] < limit) {
      out[t] = pos[t] + delta;
      t++;
    }
  };

  // The wrappers minted in a stretch of `after` the rule rewrote, `from` to `to`, are settled with the
  // rest; a line with no token takes them unread, unless a wrapper opened before it closes on it.
  // Where the stretch it replaced, `was` to `end` of `before`, holds tags written like them, those
  // stand in `after` in the same order and the rest are the minted ones; false where more than one
  // reading of which are which is left, which leaves the minted ones unknown.
  const tagsIn = (s, from, to, found) => {
    for (let p = s.indexOf('<', from); p !== -1 && p < to; p = s.indexOf('<', p + 1)) {
      const end = tagAt(s, p);

      if (end !== -1 && minted.has(s.slice(p, end))) {
        found(p, end);
      }
    }
  };
  const mintsIn = (was, end, from, to) => {
    if (minted === null) {
      return true;
    }

    const known = [];
    const found = [];

    tagsIn(before, was, end, (p, e) => known.push(before.slice(p, e)));
    tagsIn(after, from, to, (p, e) => found.push(p, e));

    const fresh = known.length === 0 ? found : mintedOf(after, found, known);

    if (fresh === null) {
      return false;
    }

    for (let i = 0; i < fresh.length; i += 2) {
      record(fresh[i], fresh[i + 1]);
    }

    return true;
  };

  // The lines of the two texts last looked for: they are read forward, so a line is looked for once,
  // however many changes it holds.
  const lineA = [0, -1];
  const lineB = [0, -1];
  const afterLineEnd = (at) => lineOf(after, lineB, at)[1];

  // A line of `before` with no token, `ls` to `le`, ending where `be` ends one in `after`, takes the
  // rule's word for whatever changed on it, unless a wrapper opened before it closes on it: 1 where
  // the line is passed, 0 where it is not such a line, -1 where its wrappers are unknown.
  const passLine = (ls, le, be) => {
    const ends = lineHasToken(pos, ls, le) ? null : changedLines(before, le, after, be, pos);

    if (ends === null) {
      return 0;
    }

    if (open > 0 && !mintsIn(a, ends[0], b, ends[1])) {
      return -1;
    }

    shiftTo(ls, b - a);
    changed(a, ends[0], b, ends[1]);
    a = ends[0];
    b = ends[1];

    return 1;
  };

  for (;;) {
    const from = a;
    const k = common(before, a, after, b);

    a += k;
    b += k;

    if (a === na && b === nb) {
      shiftTo(Infinity, b - a);
      break;
    }

    if (before.codePointAt(a) !== NL && after.codePointAt(b) !== NL) {
      const [ls, le] = lineOf(before, lineA, a);
      const passed = passLine(ls, le, afterLineEnd(b));

      if (passed < 0) {
        return null;
      }

      if (passed > 0) {
        continue;
      }
    }

    // Two tags that differ past their common start differ as whole tags.
    const back = tagStartBefore(before, a, from);

    b -= a - back;
    a = back;

    let ga0 = a;

    while (ga0 > 0 && isSpace(before.codePointAt(ga0 - 1))) {
      ga0--;
    }

    const gb0 = b - (a - ga0);
    let ga1 = a;
    let gb1 = b;
    let marks = null;

    for (;;) {
      while (ga1 < na && isSpace(before.codePointAt(ga1))) {
        ga1++;
      }

      while (gb1 < nb && isSpace(after.codePointAt(gb1))) {
        gb1++;
      }

      const ea = tagAt(before, ga1);
      const eb = tagAt(after, gb1);

      if (ea !== -1 && eb !== -1 && before.slice(ga1, ea) === after.slice(gb1, eb)) {
        break;
      }

      if (eb !== -1 && minted !== null && minted.has(after.slice(gb1, eb))) {
        (marks ??= []).push(gb1, eb);
        gb1 = eb;
        continue;
      }

      if (ea !== -1 && cx.engineTags.has(before.slice(ga1, ea))) {
        ga1 = ea;
        continue;
      }

      break;
    }

    const bothEnd = ga1 === na && gb1 === nb;
    const resumes = ga1 < na && gb1 < nb && before.codePointAt(ga1) === after.codePointAt(gb1);

    if ((ga1 === a && gb1 === b) || !(bothEnd || resumes)) {
      // More than white space changed here: a line with no token takes the rule's word for it, a
      // line with tokens only where none is near the change.
      const [ls, le] = lineOf(before, lineA, a);
      const be = afterLineEnd(b);
      const passed = passLine(ls, le, be);

      if (passed < 0) {
        return null;
      }

      if (passed > 0) {
        continue;
      }

      if ((le === na) !== (be === nb)) {
        return null;
      }

      const met = resync(before, a, le, after, b, be);

      if (met === null || (met[0] === a && met[1] === b)) {
        return null;
      }

      const [lo, hi] = reach(before, a, met[0], ls, le, words);

      // The tokens near every such change are what the rule runs again with, so the rest of the
      // text is still read. A stand-in the change leaves whole is the word the rule read.
      if (lineHasToken(pos, lo, hi) && !standInsBeside(pos, toks, lo, hi, a, met[0])) {
        (near ??= []).push(lo, hi);
      }

      shiftTo(a, b - a);

      if (!mintsIn(a, met[0], b, met[1])) {
        return null;
      }

      changed(a, met[0], b, met[1]);
      a = met[0];
      b = met[1];
      continue;
    }

    shiftTo(ga0, gb0 - ga0);

    const first = t;

    while (t < n && pos[t] <= ga1) {
      t++;
    }

    if (first < t) {
      if (ga0 === ga1) {
        let k2 = first;

        while (k2 < t && toks.flag[k2] & CLOSER) {
          out[k2++] = gb0;
        }

        for (; k2 < t; k2++) {
          out[k2] = gb1;
        }
      } else {
        for (let k2 = first; k2 < t; k2++) {
          if (pos[k2] === ga0) {
            out[k2] = gb0;
          } else if (pos[k2] === ga1) {
            out[k2] = gb1;
          } else {
            return null;
          }
        }
      }
    }

    if (marks !== null) {
      for (let i = 0; i < marks.length; i += 2) {
        record(marks[i], marks[i + 1]);
      }
    }

    changed(ga0, ga1, gb0, gb1);
    a = ga1;
    b = gb1;
  }

  if (near !== null) {
    cx.near = near;
    return null;
  }

  const touched = touchedStandIns(state, after, out, cx, tagged);

  if (touched !== null) {
    cx.near = touched || null;
    return null;
  }

  if (inserted !== null) {
    return settleWrappers(after, out, toks, inserted, cx);
  }

  return { visible: after, pos: out, toks };
}

// ---------------------------------------------------------------------------------------------
// Wrappers the rule minted on the lifted text.

// Whether the opening tag `str`, `<⟦T0⟧>`, is a `<nobr>` or a `<span>` that says `nowrap`: the
// engine's no-break wrapper in any of its forms.
function keepsTogether(str, cx) {
  const shut = str.indexOf(CLOSE, 2);
  const raw = cx.rawOf(str[2], Number(str.slice(3, shut)));

  if (raw === null) {
    return false;
  }

  const name = cx.nameOf(str[2], Number(str.slice(3, shut)));

  return name === 'nobr' || (name === 'span' && raw.includes('nowrap'));
}

// A wrapper minted around lifted markup stays when the markup it holds is whole; one that would
// cross an author's tag gives way to the no-break spaces it stands for, or, minted for anything
// but keeping words together, sends the rule back to the marked-up text.
function settleWrappers(after, out, toks, inserted, cx) {
  const pairs = [];
  const stack = [];

  for (let i = 0; i < inserted.length; i += 2) {
    const at = inserted[i];
    const end = inserted[i + 1];

    if (after.codePointAt(at + 1) === SLASH) {
      const open = stack.pop();

      if (open === undefined) {
        return null;
      }

      pairs.push([open[0], open[1], at, end]);
    } else {
      stack.push([at, end]);
    }
  }

  if (stack.length > 0) {
    return null;
  }

  const { partner } = toks;
  const changes = [];
  const loose = cx.loose == null ? null : looseTags(after, cx.loose);

  for (const [o, oe, c, ce] of pairs) {
    let whole = true;
    let first = -1;
    let last = -1;

    for (let k = firstAtOrAfter(out, oe); k < out.length && out[k] <= c && whole; k++) {
      const p = partner[k];

      whole = p !== -1 && out[p] >= oe && out[p] <= c;
      first = first === -1 ? k : first;
      last = k;
    }

    // A tag put back without its mate holds its element open past the wrapper.
    if (whole && loose !== null) {
      // An odd index falls on the end of a tag that begins before the wrapper's body.
      const found = firstAtOrAfter(loose, oe);
      const i = found + (found & 1);

      whole = i >= loose.length || loose[i + 1] > c;
    }

    if (whole) {
      // An element of the author's that holds exactly these words keeps them together with
      // no-break spaces, or itself where it is a no-break wrapper, as a wrapper is never opened
      // right around or inside one.
      if (first !== last && out[first] === oe && out[last] === c && partner[first] === last) {
        changes.push([o, oe, c, ce, !keepsTogether(toks.str[first], cx)]);
      }

      continue;
    }

    if (cx.engineOpeners.get(after.slice(o, oe)) !== true) {
      return null;
    }

    changes.push([o, oe, c, ce, true]);
  }

  if (changes.length === 0) {
    return { visible: after, pos: out, toks };
  }

  changes.sort((x, y) => x[0] - y[0]);

  for (let i = 1; i < changes.length; i++) {
    if (changes[i - 1][3] > changes[i][0]) {
      return null;
    }
  }

  const parts = [];
  let cursor = 0;

  for (const [o, oe, c, ce, nbsp] of changes) {
    parts.push(
      after.slice(cursor, o),
      nbsp ? after.slice(oe, c).replaceAll(' ', G.NBSP) : after.slice(oe, c)
    );
    cursor = ce;
  }

  parts.push(after.slice(cursor));

  // A token after a wrapper taken off moves back by its two tags, one inside it by its opening tag.
  const pos = Array.from({ length: out.length });
  let shift = 0;
  let j = 0;

  for (let k = 0; k < out.length; k++) {
    while (j < changes.length && out[k] >= changes[j][3]) {
      const [o, oe, c, ce] = changes[j];

      shift += oe - o + (ce - c);
      j++;
    }

    if (j < changes.length && out[k] >= changes[j][1]) {
      pos[k] = out[k] - shift - (changes[j][1] - changes[j][0]);
    } else if (j < changes.length && out[k] > changes[j][0]) {
      return null;
    } else {
      pos[k] = out[k] - shift;
    }
  }

  return { visible: parts.join(''), pos, toks };
}

// The first index of the ascending `list` whose value is `at` or more, or its length.
function firstAtOrAfter(list, at) {
  let lo = 0;
  let hi = list.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (list[mid] < at) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}

// Where the tags of `tags` stand in `text`, as `[start, end, …]`.
function looseTags(text, tags) {
  const found = [];

  for (let p = text.indexOf('<'); p !== -1; p = text.indexOf('<', p + 1)) {
    const end = tagAt(text, p);

    if (end !== -1 && tags.has(text.slice(p, end))) {
      found.push(p, end);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------------------------
// One rule on the lifted text.

// `state` with the tokens that stand within `spans`, `[from, to, …]`, back in the visible text. A
// tag goes back without its mate, which stays lifted where the rule reads past it; `cx.loose` is
// the tags put back so, for the wrappers the rule mints around them.
function putBack(state, spans, cx) {
  const { visible, pos } = state;
  const { str, flag, partner } = state.toks;
  const n = pos.length;
  const back = Array.from({ length: n }, () => false);

  for (let k = 0, s = 0; k < n; k++) {
    while (s < spans.length && spans[s + 1] < pos[k]) {
      s += 2;
    }

    back[k] = s < spans.length && pos[k] >= spans[s];
  }

  for (let k = 0; k < n; k++) {
    if (back[k] && partner[k] !== -1 && partner[k] !== k && !back[partner[k]]) {
      (cx.loose ??= new Set()).add(str[k]);
    }
  }

  const parts = [];
  const index = Array.from({ length: n }, () => -1);
  const kept = { str: [], flag: [], partner: [] };
  const at = [];
  let cursor = 0;
  let length = 0;

  for (let k = 0; k < n; k++) {
    parts.push(visible.slice(cursor, pos[k]));
    length += pos[k] - cursor;
    cursor = pos[k];

    if (back[k]) {
      parts.push(str[k]);
      length += str[k].length;

      if (flag[k] & STANDS_IN) {
        cursor += STAND_IN.length;
      }
    } else {
      index[k] = at.length;
      at.push(length);
      kept.str.push(str[k]);
      kept.flag.push(flag[k]);
    }
  }

  parts.push(visible.slice(cursor));

  for (let k = 0; k < n; k++) {
    if (!back[k]) {
      kept.partner.push(partner[k] === -1 ? -1 : index[partner[k]]);
    }
  }

  return { visible: parts.join(''), pos: at, toks: kept };
}

// Times a rule runs again with the markup near its changes of words put back, before it runs on the
// marked-up text.
const ROUNDS = 4;

function run(state, rule, ctx, keep, cx, checkBudget) {
  const before = state.visible;

  cx.mintLog.clear();
  cx.mints = cx.mintLog;

  try {
    const projection = ruleTraceOf(ctx) === undefined ? undefined : traceProjection(state);
    return keep(before, executeRule(rule, before, ctx, checkBudget, projection), (t) =>
      executeRule(rule, t, ctx, checkBudget)
    );
  } catch (error) {
    cx.mints = null;
    throw error;
  }
}

// Runs `rule` on the lifted text and returns the next state. Where the lifted run changed words near
// lifted markup, the rule runs again with that markup back in the text, as it reads it there without
// lifting; past a few such places, on the marked-up text.
export function applyLifted(state, rule, ctx, keep, cx, checkBudget = null) {
  cx.mintLog ??= new Set();
  cx.loose = null;

  let current = state;
  let after = run(current, rule, ctx, keep, cx, checkBudget);

  if (after === current.visible || current.pos.length === 0) {
    cx.mints = null;

    const next =
      after === current.visible ? state : { visible: after, pos: state.pos, toks: state.toks };
    acceptTrace(ctx, next);
    return next;
  }

  let next = realign(current, after, cx);

  for (let round = 0; next === null && cx.near !== null && round < ROUNDS; round++) {
    current = putBack(current, cx.near, cx);
    after = run(current, rule, ctx, keep, cx, checkBudget);
    next =
      current.pos.length === 0 || after === current.visible
        ? { visible: after, pos: current.pos, toks: current.toks }
        : realign(current, after, cx);
  }

  cx.mints = null;
  cx.loose = null;

  if (next !== null) {
    acceptTrace(ctx, next);
    return current === state
      ? next
      : settle(relift(materialize(next), cx), rule, ctx, keep, cx, checkBudget);
  }

  const input = materialize(state);

  const fallback = relift(
    keep(input, executeRule(rule, input, ctx, checkBudget), (t) =>
      executeRule(rule, t, ctx, checkBudget)
    ),
    cx
  );
  acceptTrace(ctx, fallback);
  return settle(fallback, rule, ctx, keep, cx, checkBudget);
}

// Where white space and the tags of `minted` from `at` on in `s` end.
function pastSpaceAndMints(s, at, minted) {
  let p = at;

  for (;;) {
    while (p < s.length && isSpace(s.codePointAt(p))) {
      p++;
    }

    const end = tagAt(s, p);

    if (end === -1 || !minted.has(s.slice(p, end))) {
      return p;
    }

    p = end;
  }
}

// Whether two texts hold the same characters past their white space and the wrappers the rule
// minted, `minted` their tags.
function sameWords(x, y, minted) {
  let i = 0;
  let j = 0;

  for (;;) {
    i = pastSpaceAndMints(x, i, minted);
    j = pastSpaceAndMints(y, j, minted);

    if (i === x.length || j === y.length) {
      return i === x.length && j === y.length;
    }

    if (x.codePointAt(i) !== y.codePointAt(j)) {
      return false;
    }

    i++;
    j++;
  }
}

// A rule that read markup next to the words it rewrote runs once more on what it wrote, as a second
// pass over its output would, putting back the markup near its changes of words as that pass does:
// where that changes nothing but white space and its wrappers, it binds through the markup there too.
// Words it would change again take back only the markup that touches them: how far a reach of words
// goes depends on how the rules after this one split the words, and a second pass reads them split.
function settle(state, rule, ctx, keep, cx, checkBudget) {
  if (state.pos.length === 0) {
    return state;
  }

  let current = state;
  let next = null;

  for (let round = 0; round <= ROUNDS; round++) {
    const after = run(current, rule, ctx, keep, cx, checkBudget);

    cx.near = null;

    if (after === current.visible) {
      break;
    }

    const same = sameWords(current.visible, after, cx.mints);

    if (current.pos.length === 0) {
      next = same ? { visible: after, pos: current.pos, toks: current.toks } : null;
      break;
    }

    next = realign(current, after, cx, same ? REACH : 0);

    if (!same) {
      next = null;
    }

    if (next !== null || cx.near === null) {
      break;
    }

    current = putBack(current, cx.near, cx);
  }

  cx.mints = null;
  cx.loose = null;

  if (next === null) {
    ruleTraceOf(ctx)?.discard();
    return state;
  }

  acceptTrace(ctx, next);

  return current === state ? next : relift(materialize(next), cx);
}

// The state of a text that has no markup left to lift.
function bare(text) {
  return { visible: text, pos: [], toks: { str: [], flag: [], partner: [] } };
}

function relift(text, cx) {
  return lift(text, cx) ?? bare(text);
}

// ---------------------------------------------------------------------------------------------
// One builtin group.

// A group's text as the marked-up text, the lifted run, or both: `marked` is null once a rule changed
// the lifted run, `state` once a rule changed the marked-up text. Nothing is lifted before the first
// rule that reads the lifted run, and the lifting is kept from one group to the next while the text
// between them stays the same. Null when the fragment has nothing to lift: a rule only ever adds the
// engine's own markup, which stays where it is, so it never will.
export function beginGroup(text, cx, ctx) {
  if (cx.bare) {
    return null;
  }

  // A wrapper the engine writes keeps its place even where the author wrote it, as a second pass
  // over the engine's own output finds it: a word lifted out of it would be wrapped again.
  if (ctx.html && cx.mintForms !== null && hasInlineTags(text)) {
    const known = cx.engineOpeners.size;

    cx.mintForms();
    cx.mintForms = null;

    if (cx.engineOpeners.size !== known) {
      cx.cache = null;
    }
  }

  return { marked: text, state: null };
}

function liftedRun(group, cx) {
  if (group.state === null) {
    const text = group.marked;
    const { cache } = cx;
    const state = cache !== null && cache.src === text ? cache.state : lift(text, cx);

    cx.cache = { src: text, state };

    if (state === null) {
      cx.bare = !mayLift(text, cx);
      group.state = bare(text);
    } else {
      group.state = state;
    }
  }

  return group.state;
}

// A rule that only runs to write markup — `htmlOnly` — reads the marked-up text it writes into; the
// markup is lifted again for the next rule that reads the lifted run.
export function applyRule(group, rule, ctx, keep, cx, features = null, checkBudget = null) {
  if (rule.htmlOnly) {
    const input = group.marked ?? materialize(group.state);
    if (features !== null && !hasRequiredFeatures(rule, input, features)) {
      return;
    }
    const output = keep(input, executeRule(rule, input, ctx, checkBudget), (t) =>
      executeRule(rule, t, ctx, checkBudget)
    );

    group.marked = output;
    ruleTraceOf(ctx)?.accept();

    if (output !== input) {
      group.state = null;
    }

    return;
  }

  const input = group.state?.visible ?? group.marked;
  const lifted = group.state !== null;
  if (features !== null && !hasRequiredFeatures(rule, input, features, lifted)) {
    return;
  }

  const state = liftedRun(group, cx);
  if (!lifted && features !== null && !hasRequiredFeatures(rule, state.visible, features)) {
    return;
  }
  const next = applyLifted(state, rule, ctx, keep, cx, checkBudget);

  if (next !== state) {
    group.state = next;
    group.marked = null;
  }
}

export function endGroup(group, cx) {
  const { state } = group;
  const text = group.marked ?? materialize(state);

  if (state !== null) {
    cx.cache = { src: text, state: state.pos.length > 0 ? state : null };
  }

  return text;
}
