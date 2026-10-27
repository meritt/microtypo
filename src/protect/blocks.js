import { MicroTypoConfigError } from '../errors/index.js';
import { skipSpaces } from '../lib/strings.js';
import { TAG_NAME_RE } from '../lib/tag-name.js';
import { CLOSE, OPEN } from './placeholders.js';
import {
  COMMENT_CLOSE,
  COMMENT_OPEN,
  commentCloseAt,
  insideTag,
  selfClosing,
  tagSpans
} from './tag-spans.js';
import { Vault } from './vault.js';
import { showsNothing } from './visible.js';

// Only the inner content of wrappers is vaulted; the open and close tags stay so later passes can
// anchor on them.

// The bodies of closed HTML comments; the delimiters stay in the text. A comment ends at the first
// `-->` past its opener, and once an opener has none, no later opener has one either, so the scan
// stops there instead of reading to the end once per opener.
export function scanHtmlComments(text, checkBudget) {
  const spans = [];
  let seen = 0;

  for (let at = text.indexOf(COMMENT_OPEN); at !== -1;) {
    if ((seen++ & 0x3fff) === 0) {
      checkBudget?.('html-comment');
    }

    const close = commentCloseAt(text, at);

    if (close === -1) {
      break;
    }

    // `<!-->` and `<!--->` close on their own dashes and hold nothing.
    if (close >= at + COMMENT_OPEN.length) {
      spans.push([at + COMMENT_OPEN.length, close]);
    }

    at = text.indexOf(COMMENT_OPEN, close + COMMENT_CLOSE.length);
  }

  return spans;
}

// The spaces and tabs a line opens with, when something follows them on that line: the author's
// layout — a verse indent, the nesting of HTML source — which no rule may collapse. A line of white
// space alone carries no content to indent and is left to the edge trim.
export function scanLineIndent(text, checkBudget) {
  const spans = [];
  const n = text.length;
  let seen = 0;
  // The next CR, looked for again only once a line starts past it, so no stretch is read twice.
  let cr = -1;

  for (let start = 0; start < n;) {
    if ((seen++ & 0x3fff) === 0) {
      checkBudget?.('line-indent');
    }

    const end = skipSpaces(text, start, n);
    const lf = text.indexOf('\n', end);

    if (cr < end) {
      cr = text.indexOf('\r', end);
      cr = cr === -1 ? n : cr;
    }

    const next = Math.min(lf === -1 ? n : lf, cr);

    if (end > start && next > end) {
      spans.push([start, end]);
    }

    start = next + 1;
  }

  return spans;
}

const INDENT_TOKEN = `${OPEN}W\\d+${CLOSE}`;
const INDENT_RE = new RegExp(`\\n(${INDENT_TOKEN})`, 'g');
const LIFTED_INDENT_RE = new RegExp(`\\n(${INDENT_TOKEN})\\n`, 'g');

// Whether `at` falls inside one of the ascending, non-overlapping `[start, end)` ranges.
function within(ranges, at) {
  let lo = 0;
  let hi = ranges.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (ranges[mid][1] <= at) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo < ranges.length && ranges[lo][0] <= at;
}

// The first `<!--` left open: no `-->` follows it, and it opens a comment rather than standing inside
// a tag the document closes, such as in a quoted attribute value, or inside an opaque range; -1 if
// there is none. `tags` are the document's tag spans in order.
function openCommentAt(text, tags, opaque) {
  // A comment pairs its opener with the first `-->` past it, so only an opener with no `-->` behind
  // it is left open, and every such opener comes after the last `-->`: the only openers it overlaps
  // are `<!-->` and `<!--->`, which it closes.
  const lastClose = text.lastIndexOf(COMMENT_CLOSE);
  const cursor = { i: 0 };

  for (
    let at = text.indexOf(COMMENT_OPEN, lastClose === -1 ? 0 : lastClose + COMMENT_CLOSE.length);
    at !== -1;
    at = text.indexOf(COMMENT_OPEN, at + 1)
  ) {
    if (!insideTag(text, tags, cursor, at) && !within(opaque, at)) {
      return at;
    }
  }

  return -1;
}

// Where each tag starts in `text`, as `tagSpans` reads it, mapped to its span.
function tagIndex(text, rawText) {
  const index = new Map();

  for (const span of tagSpans(text, rawText)) {
    index.set(span[0], span);
  }

  return index;
}

// Where the body of the element a name match at `at` opens begins, behind the `>` of the tag there,
// or -1: no tag starts there, the text never ends it, or it opens nothing — a start tag closing
// itself in SVG or MathML, or one ending in `/>` where the slash is not ignored.
function bodyStart(text, index, at, slashOpens) {
  const span = index.get(at);

  if (span === undefined || span[2] === true || text[span[1]] !== '>') {
    return -1;
  }

  return !slashOpens && selfClosing(text, at, span[1]) ? -1 : span[1] + 1;
}

// The first closer at or past `from` that is a tag where it stands. In HTML that is the first one of
// its name, which the tag scan stops at too; inside SVG or MathML, where the element is no raw text, a
// name written in an attribute value closes nothing.
function closerFrom(text, closeRe, from, closes) {
  closeRe.lastIndex = from;

  let close = closeRe.exec(text);

  while (close !== null && !closes(close.index)) {
    close = closeRe.exec(text);
  }

  return close;
}

// The outermost opener of one protected element that the document never closes, as `{ index, end }`,
// or null. The blocks have vaulted every closed body, but a pair's own tags stay in the text, so the
// pairing is read again here the way the block read it: a raw-text element ends at its first closer,
// one that nests at the closer that empties its stack. `opens(at)` is where the body of an element
// opening at `at` begins, or -1; `closes(at)` whether a tag starts there.
function unclosedOpener(text, { openRe, closeRe, nests }, opens, closes, checkBudget) {
  openRe.lastIndex = 0;

  if (!nests) {
    for (let m = openRe.exec(text); m; m = openRe.exec(text)) {
      const body = opens(m.index);

      if (body !== -1) {
        const close = closerFrom(text, closeRe, body, closes);

        if (!close) {
          return { index: m.index, end: body };
        }

        openRe.lastIndex = closeRe.lastIndex;
      }
    }

    return null;
  }

  const events = [];

  for (let m = openRe.exec(text); m; m = openRe.exec(text)) {
    const body = opens(m.index);

    if (body !== -1) {
      events.push({ index: m.index, end: body, open: true });
    }
  }

  if (events.length === 0) {
    return null;
  }

  closeRe.lastIndex = 0;

  for (let m = closeRe.exec(text); m; m = closeRe.exec(text)) {
    if (closes(m.index)) {
      events.push({ index: m.index, open: false });
    }
  }

  events.sort((a, b) => a.index - b.index);

  const stack = [];
  let seen = 0;

  for (const ev of events) {
    if ((seen++ & 0x3fff) === 0) {
      checkBudget?.('safeBlocks.tail');
    }

    if (ev.open) {
      stack.push(ev);
    } else {
      stack.pop();
    }
  }

  return stack[0] ?? null;
}

// Rewrite every capturing form — bare '(' and the named '(?<name>' — to '(?:' so a caller's regex
// can't add groups that shift the skeleton's positional ones; '(' inside [...] is literal, so class
// membership is tracked. '(?<=' and '(?<!' are lookbehind, not groups, and stay.
const NAMED_GROUP_OPEN_RE = /^\(\?<[^=!]/;

function toNonCapturing(pattern) {
  let out = '';
  let escaped = false;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === '\\') {
      out += ch;
      escaped = true;
    } else if (ch === '[' && !inClass) {
      inClass = true;
      out += ch;
    } else if (ch === ']' && inClass) {
      inClass = false;
      out += ch;
    } else if (ch === '(' && !inClass && NAMED_GROUP_OPEN_RE.test(pattern.slice(i, i + 4))) {
      const nameEnd = pattern.indexOf('>', i + 3);

      if (nameEnd === -1) {
        throw new MicroTypoConfigError('safe block: unterminated named capture group', {
          details: { pattern }
        });
      }

      out += '(?:';
      i = nameEnd;
    } else if (ch === '(' && !inClass && pattern[i + 1] !== '?') {
      out += '(?:';
    } else {
      out += ch;
    }
  }

  return out;
}

export class SafeBlocks {
  #vault = new Vault('B');
  // What `<script>` and `<style>` hold is never shown to a reader, and a rule asking whether the
  // sentence in front of one has ended has to tell that from the words inside a `<code>` span. It
  // cannot open the vault, so the distinction goes into the prefix, the way every other one does.
  #hiddenVault = new Vault('N');
  // A line's indent shows nothing either, but it is the one body the rules have to see moved and
  // put back, and a block whose opener ends in a line break leaves its own body where an indent
  // would stand, so where a placeholder came from is its prefix, not its place.
  #indentVault = new Vault('W');
  // The region protected to the end of the document, kept apart for the rules that lay out
  // paragraphs and lines, which close in front of it and put nothing inside or behind it.
  #tailVault = new Vault('E');
  #hiddenTailVault = new Vault('F');
  #blocks = [];
  // The elements this instance protects as raw text, which is also the set the tag scanner must not
  // read markup inside. Derived from `nests` rather than declared twice: the option that routes a
  // tag to #protectRawText is the same fact.
  #rawTextTags = new Set();
  // Every protected element's opener, for the tail pass to find one never closed.
  #openers = [];
  // Whether an element or comment left open runs to the end of the document, set by the caller that
  // knows the document is read as HTML.
  #tail = null;
  // Whether a block of this `protect()` call left an opener without its closer: when none did, the
  // tail pass has nothing to pair again.
  #unclosed = false;
  #indents = null;

  // A body with nothing in it shows the reader nothing, whatever element holds it — the same fact
  // the hidden vault stands for, and the reason every protection path stores through here.
  #store(body, vault = this.#vault) {
    return (showsNothing(body) ? this.#hiddenVault : vault).store(body);
  }

  // unsafeRegex treats open/close as raw regex source — a ReDoS footgun.
  add({ id, open, close, unsafeRegex = false }) {
    if (!open || !close) {
      throw new MicroTypoConfigError(`safe block '${id}': open/close must be non-empty`, {
        details: { id }
      });
    }

    const o = unsafeRegex ? toNonCapturing(open) : RegExp.escape(open);
    const c = unsafeRegex ? toNonCapturing(close) : RegExp.escape(close);
    let re;

    // `unsafeRegex` hands the caller's own source to the engine, and `toNonCapturing` reads that
    // source without parsing it — a truncated `(?<` slips past its four-character test and reaches
    // here verbatim. Config errors leave through the typed hierarchy, not as a bare SyntaxError from
    // a constructor the caller never called.
    try {
      re = new RegExp(`(${o})([\\s\\S]*?)(${c})`, 'g');
    } catch (error) {
      throw new MicroTypoConfigError(`safe block '${id}': invalid delimiter pattern`, {
        details: { id, open, close },
        cause: error
      });
    }

    this.#blocks.push({
      id,
      apply: (text, _checkBudget) => {
        re.lastIndex = 0;

        return text.replace(re, (_, open2, inner, close2) => {
          return `${open2}${this.#store(inner)}${close2}`;
        });
      }
    });
  }

  // The protected elements the document closes, for a reader that has to know what an element owns
  // before the blocks run: `next(from)` gives the first one opening at or past `from` as
  // `[start, end, end]`, through its closer. Raw text ends at its first closer, a nesting element at
  // the closer that matches it. Both are read where the document's tags are, as the blocks read
  // them: a name written in an attribute value opens and closes nothing, and neither does a start
  // tag closing itself in SVG or MathML.
  elementReader(text, checkBudget) {
    if (!text.includes('<')) {
      return () => null;
    }

    const elements = [];
    let seen = 0;
    const tick = () => {
      if ((seen++ & 0x3fff) === 0) {
        checkBudget?.('safeBlocks.elements');
      }
    };
    let index;

    for (const { openRe, closeRe, nests, slashOpens } of this.#openers) {
      const closers = [];

      closeRe.lastIndex = 0;

      for (let m = closeRe.exec(text); m; m = closeRe.exec(text)) {
        tick();
        index ??= tagIndex(text, this.#rawTextTags);

        if (index.has(m.index)) {
          closers.push([m.index, closeRe.lastIndex]);
        }
      }

      if (closers.length === 0) {
        continue;
      }

      const stack = [];
      let c = 0;

      openRe.lastIndex = 0;

      for (let m = openRe.exec(text); m; m = openRe.exec(text)) {
        tick();

        if (bodyStart(text, index, m.index, slashOpens) === -1) {
          continue;
        }

        // A raw-text body ends at the first closer behind its opener; a nesting one at the closer
        // that empties the openers stacked since.
        for (; c < closers.length && closers[c][0] < m.index; c += 1) {
          if (nests && stack.length > 0) {
            elements.push([stack.pop(), closers[c][1]]);
          }
        }

        if (nests) {
          stack.push(m.index);
        } else if (c < closers.length) {
          elements.push([m.index, closers[c][1]]);
        }
      }

      for (; c < closers.length && stack.length > 0; c += 1) {
        elements.push([stack.pop(), closers[c][1]]);
      }
    }

    elements.sort((a, b) => a[0] - b[0]);

    let i = 0;

    return (from) => {
      while (i < elements.length && elements[i][0] < from) {
        i += 1;
      }

      return i === elements.length ? null : [elements[i][0], elements[i][1], elements[i][1]];
    };
  }

  // Keep #blocks (compiled regexes); only vault entry state resets between process() calls.
  reset() {
    this.#vault.reset();
    this.#hiddenVault.reset();
    this.#indentVault.reset();
    this.#tailVault.reset();
    this.#hiddenTailVault.reset();
  }

  // `nests`, `formFeed` and `slashOpens` are facts about the markup language and the element, and
  // the caller is what knows them: raw text is an HTML parsing mode, only HTML lets a closing tag
  // carry a form feed before its `>`, and only an HTML element ignores a `/` ending its start tag,
  // so `<script/>` opens a script there. Everywhere else — XML, or a tag the caller registered,
  // which may be foreign like `svg` — a tag ending in `/>` is an empty element that opens nothing.
  // Which built-in tag inside `<svg>` or `<math>` is still an HTML element is `tagSpans`' answer.
  addTag(tag, { renders = true, nests = true, formFeed = false, slashOpens = false } = {}) {
    if (typeof tag !== 'string' || !TAG_NAME_RE.test(tag)) {
      throw new TypeError(
        `addSafeTag: invalid tag name ${JSON.stringify(tag)} — must match ${TAG_NAME_RE.source}`
      );
    }

    // The tag name is pre-validated, so nothing here escapes it. Where the opener ends, and whether
    // it opens anything, is the tag span's answer; a pattern only finds the name. A closing tag may
    // carry white space before its `>`, which every parser reads as the close it is.
    const openRe = new RegExp(`<${tag}(?=[ \\t\\n\\r\\f/>])`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}[ \\t\\r\\n${formFeed ? '\\f' : ''}]*>`, 'gi');

    if (!nests) {
      this.#rawTextTags.add(tag.toLowerCase());
    }

    const vault = renders ? this.#vault : this.#hiddenVault;
    const opener = { openRe, closeRe, nests, vault, slashOpens };

    this.#openers.push(opener);
    this.#blocks.push({
      id: tag,
      apply: (text, checkBudget) =>
        nests
          ? this.#protectNesting(text, opener, checkBudget)
          : this.#protectRawText(text, opener, checkBudget)
    });
  }

  // An element whose content is raw text holds no markup at all, so the first closing tag after the
  // opener ends it, found by looking for that tag and nothing else: through the generic tag parser a
  // quote in the element's own text would open an attribute running past the real closer. Only the
  // opener is filtered there, because a `<script>` inside someone else's attribute value is no tag.
  #protectRawText(text, { openRe, closeRe, vault, slashOpens }, checkBudget) {
    if (!text.includes('<')) {
      return text;
    }

    openRe.lastIndex = 0;

    const parts = [];
    // Built on the first opener, not before it: a document whose markup holds no `<script>` at all
    // paid a full scan of itself per registered raw tag to learn that.
    let index;
    let cursor = 0;
    let seen = 0;
    let open;

    while ((open = openRe.exec(text))) {
      if ((seen++ & 0x3fff) === 0) {
        checkBudget?.('safeBlocks.tag');
      }

      index ??= tagIndex(text, this.#rawTextTags);

      const start = bodyStart(text, index, open.index, slashOpens);

      if (start === -1) {
        continue;
      }

      const close = closerFrom(text, closeRe, start, (at) => index.has(at));

      // An element never closed is the tail pass's, which runs once every block is out of sight.
      if (!close) {
        this.#unclosed = true;
        break;
      }

      parts.push(text.slice(cursor, start));
      parts.push(this.#store(text.slice(start, close.index), vault));
      parts.push(close[0]);
      cursor = closeRe.lastIndex;
      openRe.lastIndex = cursor;
    }

    return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
  }

  // Same-name tags nest, so a stack walk over one linear scan vaults only the outermost span and
  // never backtracks.
  #protectNesting(text, { openRe, closeRe, vault, slashOpens }, checkBudget) {
    // One scan per registered tag adds up on a document typeset value by value, and a fragment with
    // no '<' can hold none of them.
    if (!text.includes('<')) {
      return text;
    }

    openRe.lastIndex = 0;
    closeRe.lastIndex = 0;

    const events = [];
    let m;

    while ((m = openRe.exec(text))) {
      events.push({ index: m.index, open: true });
    }

    while ((m = closeRe.exec(text))) {
      events.push({ index: m.index, open: false });
    }

    if (events.length === 0) {
      return text;
    }

    // Only delimiters that begin a real tag span are kept, so a `</code>` inside a quoted attribute
    // is not read as markup.
    const index = tagIndex(text, this.#rawTextTags);
    const kept = events.filter((ev) => {
      if (!ev.open) {
        return index.has(ev.index);
      }

      ev.end = bodyStart(text, index, ev.index, slashOpens);

      return ev.end !== -1;
    });

    if (kept.length === 0) {
      return text;
    }

    kept.sort((a, b) => a.index - b.index);

    const spans = [];
    const stack = [];
    let seen = 0;

    for (const ev of kept) {
      if ((seen++ & 0x3fff) === 0) {
        checkBudget?.('safeBlocks.tag');
      }

      if (ev.open) {
        stack.push(ev);
      } else if (stack.length > 0) {
        const start = stack.pop();

        if (stack.length === 0) {
          spans.push([start, ev]);
        }
      }
    }

    if (stack.length > 0) {
      this.#unclosed = true;
    }

    if (spans.length === 0) {
      return text;
    }

    const parts = [];
    let cursor = 0;

    for (const [open, close] of spans) {
      parts.push(text.slice(cursor, open.end));
      parts.push(this.#store(text.slice(open.end, close.index), vault));
      cursor = close.index;
    }

    parts.push(text.slice(cursor));

    return parts.join('');
  }

  // scan(text) returns non-overlapping, ascending [start, end) spans; each is vaulted whole.
  // `resolve` gives a scanner the source bytes behind a placeholder an earlier layer left in the
  // text. A scanner that only recognises shapes never needs it; one that has to decide whether two
  // stretches of the document are the same content does — two spellings of one address are two
  // placeholders, and comparing those compares ids rather than what the author wrote.
  addScanner(id, scan) {
    this.#blocks.push({
      id,
      apply: (text, checkBudget, resolve) =>
        this.#vaultSpans(text, scan(text, checkBudget, resolve))
    });
  }

  #vaultSpans(text, spans, store = (body) => this.#store(body)) {
    if (spans.length === 0) {
      return text;
    }

    const parts = [];
    let cursor = 0;

    for (const [start, end] of spans) {
      parts.push(text.slice(cursor, start));
      parts.push(store(text.slice(start, end)));
      cursor = end;
    }

    parts.push(text.slice(cursor));

    return parts.join('');
  }

  // `opaque` matches what a later layer takes whole, such as `<notg>`, so an opener inside it opens
  // nothing here either.
  setTail({ opaque }) {
    this.#tail = { opaque };
  }

  // Line indents are vaulted after every block, a tag registered later and the tail included: a
  // closer written `</tag\n  >` has to stay one for each of them, and an indent inside a protected
  // region is that region's already.
  setIndents(scan) {
    this.#indents = scan;
  }

  protect(text, checkBudget, resolve) {
    let result = text;

    this.#unclosed = false;

    for (const block of this.#blocks) {
      result = block.apply(result, checkBudget, resolve);
    }

    if (this.#tail !== null) {
      result = this.#protectTail(result, checkBudget);
    }

    return this.#indents === null
      ? result
      : this.#vaultSpans(result, this.#indents(result, checkBudget), (indent) =>
          this.#indentVault.store(indent)
        );
  }

  // A browser reads an element or comment never closed as running to the end of the document, and a
  // tag the document never ends as swallowing the rest. Taken after every block, so an opener inside
  // a closed comment, a template expression or another protected span is already out of sight, and
  // only one that is markup here counts. The opener of an element or comment stays in the text in
  // front of what runs on from it; a tag never ended goes whole.
  #protectTail(text, checkBudget) {
    if (!text.includes('<')) {
      return text;
    }

    // A comment pairs with the first `-->` past it, so one is left open only if the last `<!--` has
    // no `-->` behind it.
    const lastComment = text.lastIndexOf(COMMENT_OPEN);
    const openComment = lastComment !== -1 && commentCloseAt(text, lastComment) === -1;
    const tags = tagSpans(text, this.#rawTextTags);
    // The scan stops at a tag the text never ends, which its span runs to the end of.
    const last = tags.at(-1);
    const unended = last !== undefined && last[1] === text.length ? last[0] : -1;

    if (!this.#unclosed && !openComment && unended === -1) {
      return text;
    }

    const index = new Map(tags.map((span) => [span[0], span]));
    const opaque = Array.from(text.matchAll(this.#tail.opaque), (m) => [
      m.index,
      m.index + m[0].length
    ]);
    const closes = (at) => index.has(at) && !within(opaque, at);
    let first = unended !== -1 && !within(opaque, unended) ? unended : -1;
    let firstEnd = first;
    let vault = this.#hiddenVault;
    const comment = openCommentAt(text, tags, opaque);

    // A comment with no `>` behind it is also the tag the scan stopped at, and stays a comment.
    if (comment !== -1 && (first === -1 || comment <= first)) {
      first = comment;
      firstEnd = comment + COMMENT_OPEN.length;
      vault = this.#vault;
    }

    for (const opener of this.#openers) {
      const opens = (at) =>
        within(opaque, at) ? -1 : bodyStart(text, index, at, opener.slashOpens);
      const open = unclosedOpener(text, opener, opens, closes, checkBudget);

      if (open !== null && (first === -1 || open.index < first)) {
        first = open.index;
        firstEnd = open.end;
        ({ vault } = opener);
      }
    }

    if (first === -1) {
      return text;
    }

    const rest = text.slice(firstEnd);
    const hidden = vault === this.#hiddenVault || showsNothing(rest);

    return text.slice(0, firstEnd) + (hidden ? this.#hiddenTailVault : this.#tailVault).store(rest);
  }

  // A rule reads the start of a line as `^`, a line break or white space, never as a placeholder, so
  // while the rules run each vaulted indent waits on a line of its own and its content opens a line
  // as it would unindented.
  liftIndents(text) {
    return text.replace(INDENT_RE, '\n$1\n');
  }

  // Back in front of its content as the white space it is, for the rules that lay out lines and
  // paragraphs. One whose line break a rule took stays a placeholder, restored in place.
  settleIndents(text) {
    return text.replace(LIFTED_INDENT_RE, (_, token) => `\n${this.#indentVault.restoreAll(token)}`);
  }

  restore(text) {
    // Nested blocks leave nested placeholders after one pass; iterate until stable.
    let result = text;
    let prev;

    do {
      prev = result;
      result = this.#hiddenTailVault.restoreAll(this.#tailVault.restoreAll(result));
      result = this.#indentVault.restoreAll(
        this.#hiddenVault.restoreAll(this.#vault.restoreAll(result))
      );
    } while (prev !== result);

    return result;
  }
}
