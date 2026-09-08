import { MicroTypoConfigError } from '../errors/index.js';
import { TAG_NAME_RE } from '../lib/tag-name.js';
import { tagSpans } from './tag-spans.js';
import { Vault } from './vault.js';
import { showsNothing } from './visible.js';

// Only the inner content of wrappers is vaulted; the open and close tags stay so later passes can
// anchor on them.

// No bare ["'] fallback: every position matches exactly one branch, so the pattern stays linear.
export const ATTR_ALT_SOURCE = String.raw`(?:[^<>"']|"[^"]*"|'[^']*')`;

// Rewrite every capturing form — bare '(' and the named '(?<name>' — to '(?:' so a caller's regex
// can't add groups that shift the skeleton's positional ones; '(' inside [...] is literal, so class
// membership is tracked. '(?<=' and '(?<!' are lookbehind, not groups, and stay.
const NAMED_GROUP_OPEN_RE = /^\(\?<[^=!]/;

function tagStarts(text, rawText) {
  const starts = new Set();

  for (const span of tagSpans(text, rawText)) {
    starts.add(span[0]);
  }

  return starts;
}

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
  #blocks = [];
  // The elements this instance protects as raw text, which is also the set the tag scanner must not
  // read markup inside. Derived from `nests` rather than declared twice: the option that routes a
  // tag to #protectRawText is the same fact.
  #rawTextTags = new Set();

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

  // Keep #blocks (compiled regexes); only vault entry state resets between process() calls.
  reset() {
    this.#vault.reset();
    this.#hiddenVault.reset();
  }

  // `nests` and `formFeed` are both facts about the markup language, and the caller is what knows
  // which one this document is: raw text is an HTML parsing mode, and only HTML lets a closing tag
  // carry a form feed before its `>`.
  addTag(tag, { renders = true, nests = true, formFeed = false } = {}) {
    if (typeof tag !== 'string' || !TAG_NAME_RE.test(tag)) {
      throw new TypeError(
        `addSafeTag: invalid tag name ${JSON.stringify(tag)} — must match ${TAG_NAME_RE.source}`
      );
    }

    // The tag name is pre-validated, so nothing here escapes it, and the attribute alternation lets a
    // quoted value hold a literal `>`. A closing tag may carry white space before its `>`, which
    // every parser reads as the close it is.
    const openRe = new RegExp(`<${tag}(?:\\s(?:${ATTR_ALT_SOURCE})*)?>`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}[ \\t\\r\\n${formFeed ? '\\f' : ''}]*>`, 'gi');

    if (!nests) {
      this.#rawTextTags.add(tag.toLowerCase());
    }

    this.#blocks.push({
      id: tag,
      apply: (text, checkBudget) => {
        const vault = renders ? this.#vault : this.#hiddenVault;

        return nests
          ? this.#protectNesting(text, openRe, closeRe, checkBudget, vault)
          : this.#protectRawText(text, openRe, closeRe, checkBudget, vault);
      }
    });
  }

  // An element whose content is raw text holds no markup at all, so the first closing tag after the
  // opener ends it, found by looking for that tag and nothing else: through the generic tag parser a
  // quote in the element's own text would open an attribute running past the real closer. Only the
  // opener is filtered there, because a `<script>` inside someone else's attribute value is no tag.
  #protectRawText(text, openRe, closeRe, checkBudget, vault) {
    if (!text.includes('<')) {
      return text;
    }

    openRe.lastIndex = 0;

    const parts = [];
    // Built on the first opener, not before it: a document whose markup holds no `<script>` at all
    // paid a full scan of itself per registered raw tag to learn that.
    let starts;
    let cursor = 0;
    let seen = 0;
    let open;

    while ((open = openRe.exec(text))) {
      if ((seen++ & 0x3fff) === 0) {
        checkBudget?.('safeBlocks.tag');
      }

      starts ??= tagStarts(text, this.#rawTextTags);

      if (!starts.has(open.index)) {
        continue;
      }

      closeRe.lastIndex = openRe.lastIndex;

      const close = closeRe.exec(text);

      if (!close) {
        break;
      }

      const body = text.slice(openRe.lastIndex, close.index);

      parts.push(text.slice(cursor, openRe.lastIndex));
      parts.push(this.#store(body, vault));
      parts.push(close[0]);
      cursor = closeRe.lastIndex;
      openRe.lastIndex = cursor;
    }

    return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
  }

  // Same-name tags nest, so a stack walk over one linear scan vaults only the outermost span and
  // never backtracks.
  #protectNesting(text, openRe, closeRe, checkBudget, vault) {
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
      events.push({ index: m.index, end: openRe.lastIndex, open: true, text: m[0] });
    }

    while ((m = closeRe.exec(text))) {
      events.push({ index: m.index, end: closeRe.lastIndex, open: false, text: m[0] });
    }

    if (events.length === 0) {
      return text;
    }

    // Only delimiters that begin a real tag span are kept, so a `</code>` inside a quoted attribute
    // is not read as markup.
    const starts = tagStarts(text, this.#rawTextTags);
    const kept = events.filter((ev) => starts.has(ev.index));

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

    if (spans.length === 0) {
      return text;
    }

    const parts = [];
    let cursor = 0;

    for (const [open, close] of spans) {
      const body = text.slice(open.end, close.index);

      parts.push(text.slice(cursor, open.index));
      parts.push(open.text);
      parts.push(this.#store(body, vault));
      parts.push(close.text);
      cursor = close.end;
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
      apply: (text, checkBudget, resolve) => {
        const spans = scan(text, checkBudget, resolve);

        if (spans.length === 0) {
          return text;
        }

        const parts = [];
        let cursor = 0;

        for (const [start, end] of spans) {
          const body = text.slice(start, end);

          parts.push(text.slice(cursor, start));
          parts.push(this.#store(body));
          cursor = end;
        }

        parts.push(text.slice(cursor));

        return parts.join('');
      }
    });
  }

  protect(text, checkBudget, resolve) {
    let result = text;

    for (const block of this.#blocks) {
      result = block.apply(result, checkBudget, resolve);
    }

    return result;
  }

  restore(text) {
    // Nested blocks leave nested placeholders after one pass; iterate until stable.
    let result = text;
    let prev;

    do {
      prev = result;
      result = this.#hiddenVault.restoreAll(this.#vault.restoreAll(result));
    } while (prev !== result);

    return result;
  }
}
