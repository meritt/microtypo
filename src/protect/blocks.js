import { MicroTypoConfigError } from '../errors/index.js';
import { tagSpans } from './tag-spans.js';
import { Vault } from './vault.js';

// Vault only the inner content of wrappers; open/close tags stay so later passes can anchor on them.

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;

// No bare ["'] fallback: every position matches exactly one branch, so the pattern stays linear.
export const ATTR_ALT_SOURCE = String.raw`(?:[^<>"']|"[^"]*"|'[^']*')`;

// Rewrite each bare '(' to '(?:' so a caller's regex can't add capturing groups that shift the
// skeleton's positional groups; '(' inside [...] is literal, so class membership is tracked.
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
  #blocks = [];

  // unsafeRegex treats open/close as raw regex source — a ReDoS footgun.
  add({ id, open, close, unsafeRegex = false }) {
    if (!open || !close) {
      throw new MicroTypoConfigError(`safe block '${id}': open/close must be non-empty`, {
        details: { id }
      });
    }

    const o = unsafeRegex ? toNonCapturing(open) : RegExp.escape(open);
    const c = unsafeRegex ? toNonCapturing(close) : RegExp.escape(close);
    const re = new RegExp(`(${o})([\\s\\S]*?)(${c})`, 'g');

    this.#blocks.push({
      id,
      apply: (text, _checkBudget) => {
        re.lastIndex = 0;

        return text.replace(re, (_, open2, inner, close2) => {
          return `${open2}${this.#vault.store(inner)}${close2}`;
        });
      }
    });
  }

  // Keep #blocks (compiled regexes); only vault entry state resets between process() calls.
  reset() {
    this.#vault.reset();
  }

  addTag(tag) {
    if (typeof tag !== 'string' || !TAG_NAME_RE.test(tag)) {
      throw new TypeError(
        `addSafeTag: invalid tag name ${JSON.stringify(tag)} — must match /^[a-zA-Z][a-zA-Z0-9-]*$/`
      );
    }

    // Tag name pre-validated, so no escaping; attribute alternation lets a quoted value hold a literal '>'.
    const openRe = new RegExp(`<${tag}(?:\\s(?:${ATTR_ALT_SOURCE})*)?>`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}>`, 'gi');

    this.#blocks.push({
      id: tag,
      apply: (text, checkBudget) => this.#protectTag(text, openRe, closeRe, checkBudget)
    });
  }

  // Same-name tags nest; a stack walk over one linear scan vaults only the outermost span, avoiding quadratic backtracking.
  #protectTag(text, openRe, closeRe, checkBudget) {
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

    // Keep only delimiters that begin a real tag span, so a `</code>` inside a quoted attribute isn't treated as markup.
    const starts = new Set(tagSpans(text).map((s) => s[0]));
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
      parts.push(text.slice(cursor, open.index));
      parts.push(open.text);
      parts.push(this.#vault.store(text.slice(open.end, close.index)));
      parts.push(close.text);
      cursor = close.end;
    }

    parts.push(text.slice(cursor));

    return parts.join('');
  }

  // scan(text) returns non-overlapping, ascending [start, end) spans; each is vaulted whole.
  addScanner(id, scan) {
    this.#blocks.push({
      id,
      apply: (text, checkBudget) => {
        const spans = scan(text, checkBudget);

        if (spans.length === 0) {
          return text;
        }

        const parts = [];
        let cursor = 0;

        for (const [start, end] of spans) {
          parts.push(text.slice(cursor, start));
          parts.push(this.#vault.store(text.slice(start, end)));
          cursor = end;
        }

        parts.push(text.slice(cursor));

        return parts.join('');
      }
    });
  }

  protect(text, checkBudget) {
    let result = text;

    for (const block of this.#blocks) {
      result = block.apply(result, checkBudget);
    }

    return result;
  }

  restore(text) {
    // Nested blocks leave nested placeholders after one pass; iterate until stable.
    let result = text;
    let prev;

    do {
      prev = result;
      result = this.#vault.restoreAll(result);
    } while (prev !== result);

    return result;
  }
}
