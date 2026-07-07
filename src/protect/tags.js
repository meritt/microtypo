import { OPEN, CLOSE } from './placeholders.js';
import { Vault } from './vault.js';

const DEFAULT_LAYOUT = { style: true, class: false };

// Anchor tags use a separate vault so the quote group can move quotes outside <a>.

// No bare ["'] fallback: each position matches exactly one branch, so a run of stray quotes can't
// explode into ~2^k parses (ReDoS). A '>' inside a quoted attribute stays in the tag; an
// unbalanced-quote tag fails to match and stays plain text.
export const TAG_RE = /(<\/?)(?=[A-Za-z!?\u{E000}])((?:[^<>"']|"[^"]*"|'[^']*')*)(>)/gu;
const INNER_PLACEHOLDER_RE = new RegExp(`${OPEN}([TAI])(\\d+)${CLOSE}`);
// Vaulted content never carries a leading "/", so this extracts the name for both opening and closing tags.
const TAG_NAME_RE = /^([A-Za-z][\w-]*)/;

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
  #tagVault = new Vault('T');
  #anchorVault = new Vault('A');
  #iblockVault = new Vault('I');

  reset() {
    this.#tagVault.reset();
    this.#anchorVault.reset();
    this.#iblockVault.reset();
  }

  protect(text) {
    return text.replace(TAG_RE, (m, open, content, close) => {
      // <-X> (single dash, next char not "-") is content like "a < -b", not a tag.
      if (open.length === 1 && content.charAt(0) === '-' && content.charAt(1) !== '-') {
        return m;
      }
      // Real tag content starts with a letter (or ! / ? for comments/PI); guards against "CPU > 95% RAM < 100MB".
      const first = content.codePointAt(0);
      const isLetter = (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
      const isAlreadyEncoded = first === 0xe000;

      if (!isLetter && first !== 0x21 /* ! */ && first !== 0x3f /* ? */ && !isAlreadyEncoded) {
        return m;
      }
      // Leave <p>/</p>/<br> untouched: later groups anchor on ">" as a left boundary.
      if (INNER_PLACEHOLDER_RE.test(content)) {
        return m;
      }

      // trimStart is only for anchor-name classification — the stored/vaulted content stays raw.
      const name = content.trimStart();
      const isAnchor = /^a\b/i.test(name) || name.toLowerCase().startsWith('/a');
      const vault = isAnchor ? this.#anchorVault : this.#tagVault;

      return `${open}${vault.store(content)}${close}`;
    });
  }

  restore(text) {
    return text.replace(TAG_RE, (m, open, content, close) => {
      const match = content.match(INNER_PLACEHOLDER_RE);

      if (!match) {
        return m;
      }

      const [, prefix, id] = match;
      let vault;

      if (prefix === 'T') {
        vault = this.#tagVault;
      } else if (prefix === 'A') {
        vault = this.#anchorVault;
      } else {
        vault = this.#iblockVault;
      }

      const value = vault.retrieve(Number(id));

      return value == null ? m : `${open}${value}${close}`;
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

    const isAnchor = /^a\b/i.test(head);
    const vault = isAnchor ? this.#anchorVault : this.#tagVault;
    const closeIsAnchor = /^a$/i.test(tag);
    const closeVault = closeIsAnchor ? this.#anchorVault : this.#tagVault;

    const open = vault.store(head);
    const close = closeVault.store(tag);

    // Report only the two tokens this call minted; caller-supplied content may carry unrelated placeholders that must not be credited as fresh.
    return { html: `<${open}>${content}</${close}>`, tokens: [open, close] };
  }

  iblock(content) {
    return this.#iblockVault.store(content);
  }

  restoreIblocks(text) {
    return this.#iblockVault.restoreAll(text);
  }

  // Returns only ids matched by the tag's parsed name, never the raw vault value, so a custom rule can't enumerate other tags' attributes or href.
  findByTagName(nameOrRegex) {
    const matches = toNameMatcher(nameOrRegex);
    const out = [];

    const collect = (vault, prefix) => {
      for (let id = 0; id < vault.size; id++) {
        const raw = vault.retrieve(id);
        const name = raw == null ? null : TAG_NAME_RE.exec(raw)?.[1];

        if (name != null && matches(name)) {
          out.push({ prefix, id });
        }
      }
    };

    collect(this.#tagVault, 'T');
    collect(this.#anchorVault, 'A');

    return out;
  }
}
