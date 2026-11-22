import { MicroTypoConfigError } from '../errors/index.js';
import { isBackslashEscaped, skipSpaces } from '../lib/strings.js';
import { TAG_NAME_RE } from '../lib/tag-name.js';
import { CLOSE, OPEN } from './placeholders.js';
import {
  COMMENT_CLOSE,
  COMMENT_OPEN,
  DOCUMENT_READING,
  FRAGMENT_READING,
  commentCloseAt,
  insideTag,
  selfClosing,
  tagSpanReader,
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
    if (text.startsWith('<p>', end)) {
      const innerStart = end + 3;
      const innerEnd = skipSpaces(text, innerStart, next);
      if (innerEnd > innerStart && innerEnd < next) {
        spans.push([innerStart, innerEnd]);
      }
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
function tagIndex(text, rawText, caseSensitive, readComment, reading, limitAt, xmlNames) {
  const index = new Map();
  const spans = tagSpans(text, rawText, caseSensitive, readComment, reading, [], limitAt, xmlNames);

  for (const span of spans) {
    index.set(span[0], span);
  }

  return index;
}

function closingEnd(text, index, at) {
  const span = index.get(at);
  return span !== undefined && text[span[1]] === '>' ? span[1] + 1 : -1;
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

  for (let close = closeRe.exec(text); close !== null; close = closeRe.exec(text)) {
    const end = closes(close.index);
    if (end !== -1) {
      close[0] = text.slice(close.index, end);
      closeRe.lastIndex = end;
      return close;
    }
  }

  return null;
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
    if (closes(m.index) !== -1) {
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
  #labelAddresses = new Set();
  #lineBlocks = new Set();
  #lineBlockContents = new Map();
  #tableDelimiters = new Set();
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
  #caseSensitive;
  #readComments;
  #reading;
  #readLimit;
  #xmlNames;

  // `readLimit(text)` gives where the paragraph at a place ends, in a format whose tags end with
  // their paragraph: the element reader and the tag index read a tag the same way.
  constructor(
    caseSensitive = false,
    readComments = null,
    reading = DOCUMENT_READING,
    readLimit = null,
    xmlNames = false
  ) {
    this.#caseSensitive = caseSensitive;
    this.#readComments = readComments;
    this.#reading = reading;
    this.#readLimit = readLimit;
    this.#xmlNames = xmlNames;
  }

  // A body with nothing in it shows the reader nothing, whatever element holds it — the same fact
  // the hidden vault stands for, and the reason every protection path stores through here.
  #store(body, vault = this.#vault, scope) {
    return (showsNothing(body) ? this.#hiddenVault : vault).store(body, scope);
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

  // An ordinary tag owns its syntax; a closed protected element also owns its body. Searching for
  // their openers must not commit the lexical state of a candidate that loses to another owner.
  elementReader(
    text,
    checkBudget,
    syntax = true,
    mdx = null,
    readTemplates = null,
    readLimit = null
  ) {
    if (!text.includes('<')) {
      return { next: () => null };
    }

    const tags = tagSpanReader(
      text,
      this.#rawTextTags,
      this.#caseSensitive,
      this.#readComments?.(text, checkBudget),
      this.#reading,
      checkBudget,
      this.#xmlNames
    );
    const anchored = new Map();
    const matches = (re, at) => {
      let pattern = anchored.get(re);
      if (pattern === undefined) {
        pattern = new RegExp(re.source, re.flags.replace('g', 'y'));
        anchored.set(re, pattern);
      }
      pattern.lastIndex = at;
      return pattern.test(text);
    };
    const lastCloses = new Map();
    const atomEnd = readTemplates?.(text, checkBudget).header;
    const paragraphEnd = readLimit?.(text, checkBudget);
    const endings = new Map();
    const opens = (opener, span, readAtom) =>
      span !== null &&
      span[2] !== true &&
      text[span[1]] === '>' &&
      matches(opener.openRe, span[0]) &&
      (opener.slashOpens || !selfClosing(text, span[0], span[1], readAtom, checkBudget));

    return {
      next: tags.next,
      read: (at) => {
        if (!syntax && !this.#openers.some((entry) => matches(entry.openRe, at))) {
          return [at, at + 1, at + 1];
        }
        if (mdx !== null && isBackslashEscaped(text, at)) {
          // The JSX reader skips escaped openings when it searches on its own.
          return [at, at + 1, at + 1, null, false];
        }
        const jsx = mdx !== null && /[A-Za-z/]/.test(text[at + 1] ?? '') ? mdx.read(at) : null;
        const limit = paragraphEnd?.(at);
        const openingTrial =
          limit !== undefined && this.#openers.some((entry) => matches(entry.openRe, at));
        if (openingTrial) {
          tags.begin();
        }
        const first = tags.read(
          at,
          jsx === null ? undefined : jsx[1] - 1,
          atomEnd,
          openingTrial ? undefined : limit
        );
        const { context, scope, depth } = tags;
        const end = first.span === null ? at + 1 : Math.min(first.span[1] + 1, text.length);
        const ordinary = (token) => {
          const to =
            token.span === null ||
            (jsx === null && this.#reading === FRAGMENT_READING && text[token.span[1]] !== '>')
              ? at + 1
              : Math.min(token.span[1] + 1, text.length);
          const span = [at, syntax ? to : at + 1, syntax ? to : at + 1, null, jsx !== null];
          span.syntax = to > at + 1 ? token.syntax : [];
          return span;
        };
        const fallback = () => {
          if (!openingTrial) {
            return ordinary(first);
          }
          tags.finish(false);
          return ordinary(tags.read(at, undefined, atomEnd, limit));
        };
        const opener = this.#openers.find((entry) => opens(entry, first.span, atomEnd));
        if (opener === undefined) {
          return fallback();
        }
        if (!lastCloses.has(opener)) {
          opener.closeRe.lastIndex = 0;
          let last = -1;
          for (let m = opener.closeRe.exec(text); m; m = opener.closeRe.exec(text)) {
            checkBudget?.('safeBlocks.elements');
            ({ index: last } = m);
          }
          lastCloses.set(opener, last);
        }
        if (lastCloses.get(opener) < end) {
          return fallback();
        }

        let cache = endings.get(opener);
        if (cache === undefined) {
          cache = new Map();
          endings.set(opener, cache);
        }
        const known = cache.get(at);
        if (
          known?.end === -1 &&
          known.bodyStart === end &&
          known.scope === scope &&
          (known.context === context || known.stable)
        ) {
          return fallback();
        }
        const stack = [{ at, context, scope, depth, mark: 0, bodyStart: end }];
        let from = first.after;
        let through = -1;
        let readThrough;
        let independent = true;
        tags.begin();
        for (let candidate = tags.next(from); candidate !== null; candidate = tags.next(from)) {
          const token = tags.read(candidate[0]);
          const { context: inside, scope: innerScope, depth: innerDepth, mark } = tags;
          from = token.after;
          const { span } = token;
          if (span === null || text[span[1]] !== '>') {
            continue;
          }
          if (matches(opener.closeRe, span[0])) {
            const open = stack.pop();
            cache.set(open.at, { context: open.context, end: span[1] + 1 });
            if (stack.length === 0) {
              through = span[1] + 1;
              break;
            }
          } else if (span[1] >= lastCloses.get(opener)) {
            readThrough = token.mark;
            break;
          } else if (from > lastCloses.get(opener)) {
            break;
          } else if (opener.nests && opens(opener, span)) {
            const nested = cache.get(span[0]);
            if (
              nested?.end === -1 &&
              nested.bodyStart === span[1] + 1 &&
              nested.scope === innerScope &&
              (nested.context === inside || nested.stable)
            ) {
              independent = nested.stable;
              break;
            }
            stack.push({
              at: span[0],
              context: inside,
              scope: innerScope,
              depth: innerDepth,
              mark,
              bodyStart: span[1] + 1
            });
          }
        }
        const minimums = tags.finish(through !== -1, readThrough);
        for (const open of stack) {
          cache.set(open.at, {
            context: open.context,
            scope: open.scope,
            bodyStart: open.bodyStart,
            stable: independent && minimums[open.mark] >= open.depth - 1,
            end: -1
          });
        }
        if (through === -1) {
          return fallback();
        }
        if (openingTrial) {
          tags.finish(true);
        }
        const owned = [at, through, through];
        owned.syntax = first.syntax;
        return owned;
      }
    };
  }

  protectsTag(name) {
    const tag = `<${name}>`;
    for (const { openRe } of this.#openers) {
      const previous = openRe.lastIndex;
      openRe.lastIndex = 0;
      const matches = openRe.test(tag);
      openRe.lastIndex = previous;
      if (matches) {
        return true;
      }
    }
    return false;
  }

  // Keep #blocks (compiled regexes); only vault entry state resets between process() calls.
  reset() {
    this.#vault.reset();
    this.#labelAddresses.clear();
    this.#lineBlocks.clear();
    this.#lineBlockContents.clear();
    this.#tableDelimiters.clear();
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
  // `typeset` marks a raw-text element whose body a reader sees as text: what the caller hands
  // `protect` for it typesets the body before it goes into the vault.
  addTag(
    tag,
    { renders = true, nests = true, formFeed = false, slashOpens = false, typeset = false } = {}
  ) {
    if (typeof tag !== 'string' || !TAG_NAME_RE.test(tag)) {
      throw new TypeError(
        `addSafeTag: invalid tag name ${JSON.stringify(tag)} — must match ${TAG_NAME_RE.source}`
      );
    }

    // The tag name is pre-validated, so nothing here escapes it. Where the opener ends, and whether
    // it opens anything, is the tag span's answer; a pattern only finds the name. A closing tag may
    // carry white space before its `>`, which every parser reads as the close it is.
    const flags = this.#caseSensitive ? 'g' : 'gi';
    const openRe = new RegExp(`<${tag}(?=[ \\t\\n\\r\\f/>])`, flags);
    const closeRe = new RegExp(
      formFeed ? `<\\/${tag}(?=[ \\t\\r\\n\\f/>])` : `<\\/${tag}[ \\t\\r\\n]*>`,
      flags
    );

    if (!nests) {
      this.#rawTextTags.add(tag.toLowerCase());
    }

    const vault = renders ? this.#vault : this.#hiddenVault;
    const opener = { openRe, closeRe, nests, vault, slashOpens };

    this.#openers.push(opener);
    this.#blocks.push({
      id: tag,
      apply: (text, checkBudget, resolve, afterInline, typesetBody) =>
        nests
          ? this.#protectNesting(text, opener, checkBudget)
          : this.#protectRawText(text, opener, checkBudget, typeset ? typesetBody : null)
    });
  }

  // An element whose content is raw text holds no markup at all, so the first closing tag after the
  // opener ends it, found by looking for that tag and nothing else: through the generic tag parser a
  // quote in the element's own text would open an attribute running past the real closer. Only the
  // opener is filtered there, because a `<script>` inside someone else's attribute value is no tag.
  #protectRawText(text, { openRe, closeRe, vault, slashOpens }, checkBudget, typesetBody) {
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

      index ??= this.#tagIndex(text);

      const start = bodyStart(text, index, open.index, slashOpens);

      if (start === -1) {
        continue;
      }

      const close = closerFrom(text, closeRe, start, (at) => closingEnd(text, index, at));

      // An element never closed is the tail pass's, which runs once every block is out of sight.
      if (!close) {
        this.#unclosed = true;
        break;
      }

      const body = text.slice(start, close.index);
      parts.push(text.slice(cursor, start));
      parts.push(this.#store(typesetBody ? typesetBody(body) : body, vault));
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
    const index = this.#tagIndex(text);
    const kept = events.filter((ev) => {
      if (!ev.open) {
        return closingEnd(text, index, ev.index) !== -1;
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
  addScanner(id, scan, lineBlock = false) {
    this.#blocks.push({
      id,
      apply: (text, checkBudget, resolve) =>
        this.#vaultSpans(text, scan(text, checkBudget, resolve), undefined, lineBlock)
    });
  }

  addInlineScanner(id, scan) {
    this.#blocks.push({
      id,
      apply: (text, checkBudget, resolve, afterInline) => {
        const cuts = afterInline && [];
        const spans = scan(text, checkBudget, resolve, Boolean(cuts));
        const hidden = this.#vaultSpans(text, spans, undefined, false, cuts);
        return afterInline ? afterInline(hidden, cuts) : hidden;
      }
    });
  }

  // Only an address already recognised in a visible Markdown label has this lexical edge.
  labelAddressBefore(text, end) {
    if (this.#labelAddresses.size === 0) {
      return false;
    }
    const tail = text.slice(Math.max(0, end - 12), end);
    const start = tail.lastIndexOf(OPEN);
    return start !== -1 && this.#labelAddresses.has(tail.slice(start));
  }

  // A lexer-owned Markdown block can start the line after a quotation. A quoted inline
  // code span in the same position still supplies content.
  lineBlockAt(text, at, afterBreak) {
    if (afterBreak && this.#tableDelimiters.size > 0) {
      const next = text.indexOf('\n', at) + 1;
      if (next > 0 && this.#markedAt(this.#tableDelimiters, text, next)) {
        return true;
      }
    }
    return this.#markedAt(this.#lineBlocks, text, at);
  }

  #markedAt(tokens, text, at) {
    return text[at] === OPEN && tokens.size > 0 && tokens.has(this.#tokenAt(text, at));
  }

  #tokenAt(text, at) {
    let token = OPEN;
    for (let i = at + 1; i < text.length && token.length < 12; i++) {
      token += text[i];
      if (text[i] === CLOSE) {
        return token;
      }
    }
    return '';
  }

  // The payload of a Markdown hard break is protected even on a whitespace-only
  // line. Its exact spelling stays in the vault while the quotation reads its width.
  horizontalSpaceEnd(text, at) {
    const kind = text[at + 1];
    if (kind !== 'N' && kind !== 'W') {
      return at;
    }
    const token = this.#tokenAt(text, at);
    const vault = kind === 'N' ? this.#hiddenVault : this.#indentVault;
    const raw = token && vault.retrieve(Number(token.slice(2, -1)));
    return raw && /^[ \t]+$/u.test(raw) ? at + token.length : at;
  }

  #vaultSpans(text, spans, store = (body) => this.#store(body), lineBlock = false, cuts) {
    if (spans.length === 0) {
      return text;
    }

    const parts = [];
    let cursor = 0;

    let shift = 0;
    for (const [start, end, kind, fenceWidth] of spans) {
      parts.push(text.slice(cursor, start));
      const body = text.slice(start, end);
      const startsBlock = lineBlock || kind === 'line-block';
      let token;
      if (kind === 'tail') {
        token = (showsNothing(body) ? this.#hiddenTailVault : this.#tailVault).store(body);
      } else if (startsBlock) {
        // The same prefix can start one blockquote and continue the next line of that
        // blockquote. Keep its occurrence's role when the vault interns equal spellings.
        token = this.#store(body, this.#vault, this.#lineBlockContents);
        this.#lineBlocks.add(token);
      } else {
        token = store(body);
      }
      if (kind === 'table-delimiter') {
        this.#tableDelimiters.add(token);
      }
      if (kind === 'label-address') {
        this.#labelAddresses.add(token);
      }
      parts.push(token);
      if (cuts) {
        if (kind === 'inline-code') {
          cuts.push(start + shift - fenceWidth, start + shift + token.length + fenceWidth);
        }
        shift += token.length - (end - start);
      }
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

  protect(text, checkBudget, resolve, afterInline, typesetBody = null) {
    let result = text;

    this.#unclosed = false;

    for (const block of this.#blocks) {
      result = block.apply(result, checkBudget, resolve, afterInline, typesetBody);
    }

    if (this.#tail !== null) {
      result = this.#protectTail(result, checkBudget);
    }

    return this.#vaultIndents(result, checkBudget);
  }

  #vaultIndents(text, checkBudget) {
    return this.#indents === null
      ? text
      : this.#vaultSpans(text, this.#indents(text, checkBudget), (indent) =>
          this.#indentVault.store(indent)
        );
  }

  #tagIndex(text) {
    return tagIndex(
      text,
      this.#rawTextTags,
      this.#caseSensitive,
      this.#readComments?.(text),
      this.#reading,
      this.#readLimit?.(text),
      this.#xmlNames
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
    const tags = tagSpans(
      text,
      this.#rawTextTags,
      this.#caseSensitive,
      undefined,
      undefined,
      undefined,
      undefined,
      this.#xmlNames
    );
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
    const closes = (at) => (within(opaque, at) ? -1 : closingEnd(text, index, at));
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

  // These are the W-indents lift/settle expose before final trimming. A W already at the
  // fragment start remains protected, as it does at the final edge. Other vaults stay opaque.
  trimSource(text, trim, checkBudget) {
    const view = text.replace(INDENT_RE, (_, token) => `\n${this.#indentVault.restoreAll(token)}`);
    const result = trim(view);
    if (result === view) {
      return text;
    }
    return this.#vaultIndents(result, checkBudget);
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

  restore(text, mapping) {
    // Nested blocks leave nested placeholders after one pass; iterate until stable.
    let result = text;
    let prev;

    do {
      prev = result;
      result = this.#hiddenTailVault.restoreAll(
        this.#tailVault.restoreAll(result, mapping),
        mapping
      );
      result = this.#indentVault.restoreAll(
        this.#hiddenVault.restoreAll(this.#vault.restoreAll(result, mapping), mapping),
        mapping
      );
    } while (prev !== result);

    return result;
  }
}
