import { MicroTypoConfigError } from '../errors/index.js';
import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from '../lib/block-tags.js';
import { NAME_START, TAG_NAME_RE, isTagNameStart } from '../lib/tag-name.js';
import { OPEN, CLOSE, TAG_VAULT_KINDS } from './placeholders.js';
import {
  DOCUMENT_READING,
  FRAGMENT_READING,
  selfClosing,
  tagEnd,
  tagEndsFrom
} from './tag-spans.js';
import { Vault } from './vault.js';
import { showsNothing } from './visible.js';

const DEFAULT_LAYOUT = { style: true, class: false };

// Attribute values are escaped, but the element and attribute names go into the tag as written, so a
// rule group passing `span onload=…` as the name would write markup nobody escaped.
export function assertTagName(kind, name) {
  if (typeof name !== 'string' || !TAG_NAME_RE.test(name)) {
    throw new MicroTypoConfigError(
      `ctx.tag: invalid ${kind} name ${JSON.stringify(name)} — must match ${TAG_NAME_RE.source}`,
      { details: { kind, name: String(name) } }
    );
  }
}

// Anchor tags use a separate vault so the quote group can move quotes outside <a>.

const INNER_PLACEHOLDER_RE = new RegExp(`${OPEN}([${TAG_VAULT_KINDS}])(\\d+)${CLOSE}`);
const VAULTED_TAG_RE = new RegExp(`<(\\/?)${OPEN}([${TAG_VAULT_KINDS}])(\\d+)${CLOSE}>`, 'g');
const PLACEHOLDER_START = 0xe000;

// A rule that has to know where one block ends and the next begins cannot read the vault, so the
// distinction this layer already makes goes into the placeholder's prefix — the same reason anchors
// carry one of their own. `abbr.currency` is the reader: a period in front of `</p>` ends its
// sentence whatever stands after it, while an `<em>` around the words that follow does not.
const BLOCK_BOUNDARY_NAMES = new Set([...BLOCK_TAG_NAMES, ...VOID_BLOCK_TAG_NAMES, 'p', 'br']);
// Vaulted content never carries a leading `/`, so this reads the name of an opening and a closing
// tag alike.
const LEADING_NAME_RE = new RegExp(String.raw`^([${NAME_START}][\p{L}\p{N}._:-]*)`, 'u');
// The vaults `findByTagName` reads, in the order it reports them.
const NAMED_KINDS = ['T', 'A', 'L'];

function escapeAttr(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toNameMatcher(nameOrRegex) {
  if (typeof nameOrRegex === 'function') {
    return nameOrRegex;
  }

  if (typeof nameOrRegex === 'string') {
    return (name) => name.toLowerCase() === nameOrRegex.toLowerCase();
  }

  return (name) => nameOrRegex.test(name);
}

export class SafeTags {
  // `DOCUMENT_READING` for an HTML document, `FRAGMENT_READING` for anything else; `tagEnd` says what
  // the two change.
  #reading;
  #tagVault = new Vault('T');
  #anchorVault = new Vault('A');
  #blockVault = new Vault('L');
  #iblockVault = new Vault('I');
  // The same distinction `SafeBlocks` keeps between a body that shows the reader something and one
  // that shows nothing: `<notg></notg>` arrives here rather than there, and an ordinary inline-block
  // prefix would stop a search for the end of a sentence that has no words to find.
  #hiddenIblockVault = new Vault('H');

  // Keyed by the prefix `TAG_VAULT_KINDS` enumerates, so a kind added there and not here restores as
  // nothing rather than as another kind's entry, and no reset can be forgotten one vault at a time.
  #vaults = new Map([
    ['T', this.#tagVault],
    ['A', this.#anchorVault],
    ['L', this.#blockVault],
    ['I', this.#iblockVault],
    ['H', this.#hiddenIblockVault]
  ]);

  #heads = new Map(NAMED_KINDS.map((prefix) => [prefix, []]));

  constructor({ document = true } = {}) {
    this.#reading = document ? DOCUMENT_READING : FRAGMENT_READING;
  }

  reset() {
    for (const vault of this.#vaults.values()) {
      vault.reset();
    }

    for (const heads of this.#heads.values()) {
      heads.length = 0;
    }
  }

  // The one place a tag name becomes a placeholder kind: `protect` reads a name out of the document
  // and `makeTag` mints one, and a block boundary must not depend on which of them wrote it.
  #vaultFor(content) {
    const name = LEADING_NAME_RE.exec(content)?.[1]?.toLowerCase();

    if (name === 'a') {
      return this.#anchorVault;
    }

    return name !== undefined && BLOCK_BOUNDARY_NAMES.has(name) ? this.#blockVault : this.#tagVault;
  }

  // Every tag is vaulted between its brackets, its bounds read as `tagEnd` reads them. A tag starts
  // a name, or `!`/`?` for a comment or a declaration, or a placeholder an earlier layer left for a
  // name, which keeps `CPU > 95% RAM < 100MB` out. A tag the text never ends is left as text, and the
  // next `<` may still start one: only an HTML document runs to its end inside it, and its tail pass
  // has taken the rest before this layer.
  protect(text) {
    const parts = [];
    let cursor = 0;
    let ends = null;

    for (let lt = text.indexOf('<'); lt !== -1; lt = text.indexOf('<', lt + 1)) {
      const at = text[lt + 1] === '/' ? lt + 2 : lt + 1;
      const first = text.codePointAt(at);

      if (!isTagNameStart(first) && first !== PLACEHOLDER_START) {
        continue;
      }

      const gt = ends === null ? tagEnd(text, at, this.#reading) : ends[at];

      if (gt < 0) {
        if (gt === -1) {
          ends ??= tagEndsFrom(text, at + 1, this.#reading);
        }

        continue;
      }

      const content = text.slice(at, gt);

      // A tag already vaulted stays as it is.
      if (!INNER_PLACEHOLDER_RE.test(content)) {
        parts.push(text.slice(cursor, at), this.#vaultFor(content).store(content));
        cursor = gt;
      }

      lt = gt;
    }

    if (parts.length === 0) {
      return text;
    }

    parts.push(text.slice(cursor));

    return parts.join('');
  }

  restore(text) {
    return text.replace(VAULTED_TAG_RE, (m, slash, prefix, id) => {
      const value = this.#vaults.get(prefix)?.retrieve(Number(id));

      return value == null ? m : `<${slash}${value}>`;
    });
  }

  makeTag({ content, tag = 'span', attributes = {}, layout = DEFAULT_LAYOUT }) {
    const attrs = { ...attributes };
    let className = '';

    if (layout.style) {
      if (attrs.__style) {
        if (attrs.style) {
          let st = attrs.style.trim();

          if (!st.endsWith(';')) {
            st += ';';
          }

          attrs.style = st + attrs.__style;
        } else {
          attrs.style = attrs.__style;
        }
      }
    }

    delete attrs.__style;
    let head = tag;

    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') {
        className = String(v);
        continue;
      }

      head += ` ${k}="${escapeAttr(v)}"`;
    }

    if (layout.class && className) {
      head += ` class="${escapeAttr(className)}"`;
    }

    const open = this.#vaultFor(head).store(head);
    const close = this.#vaultFor(tag).store(tag);

    // Only the two tokens this call minted are reported: caller-supplied content may carry unrelated
    // placeholders that must not be credited as fresh.
    return { html: `<${open}>${content}</${close}>`, tokens: [open, close] };
  }

  iblock(content) {
    return (showsNothing(content) ? this.#hiddenIblockVault : this.#iblockVault).store(content);
  }

  // An inline block may hold another one — a rule group that boxes the whole text wraps whatever the
  // `<notg>` layer already vaulted — so one pass uncovers the outer token and stops on the inner,
  // leaving the engine's own placeholder in the output in place of the author's words.
  restoreIblocks(text) {
    let result = text;
    let previous;

    do {
      previous = result;
      result = this.#hiddenIblockVault.restoreAll(this.#iblockVault.restoreAll(result));
    } while (previous !== result);

    return result;
  }

  // Only ids matched by the tag's parsed name, never the raw vault value, so a custom rule cannot
  // enumerate other tags' attributes or hrefs. Past the name a predicate learns one bit: whether the
  // tag carries the self-closing flag, which empties an `<svg/>` and leaves a `<span/>` open.
  findByTagName(nameOrRegex) {
    const matches = toNameMatcher(nameOrRegex);
    const out = [];

    for (const prefix of NAMED_KINDS) {
      const heads = this.#headsOf(prefix);

      for (let id = 0; id < heads.length; id++) {
        const head = heads[id];

        if (head !== null && matches(head.name, head.selfClosing)) {
          out.push({ prefix, id });
        }
      }
    }

    return out;
  }

  // A vault only grows within a `process()`, so each entry's head is parsed once however many rules
  // ask.
  #headsOf(prefix) {
    const vault = this.#vaults.get(prefix);
    const heads = this.#heads.get(prefix);

    for (let id = heads.length; id < vault.size; id++) {
      const raw = vault.retrieve(id);
      const name = LEADING_NAME_RE.exec(raw)?.[1];

      heads.push(
        name === undefined
          ? null
          : { name, selfClosing: raw.endsWith('/') && selfClosing(`<${raw}>`, 0, raw.length + 1) }
      );
    }

    return heads;
  }
}
