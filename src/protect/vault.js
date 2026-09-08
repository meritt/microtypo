import { capacityError, MAX_ENTRIES } from '../errors/index.js';
import { OPEN, CLOSE, placeholderRegex } from './placeholders.js';

// Engine strips the reserved PUA band from input on entry, so vault placeholders cannot be forged.

export class Vault {
  #entries = [];
  #byContent = new Map();
  #prefix;
  #restoreRe;

  // Per-vault prefix keeps placeholder kinds distinguishable when they coexist in one text, so every
  // one of them has to be taken exactly once. In use: `T` tags, `A` anchors, `L` block-level tags,
  // `I` inline blocks, `B` safe blocks. Reusing one that is already taken makes two vaults answer to
  // the same placeholder, and a restore then pulls the wrong content into the document.
  constructor(prefix) {
    this.#prefix = prefix;
    this.#restoreRe = placeholderRegex(prefix);
  }

  // The same content returns the same placeholder, which rules that build a sample tag and re-scan
  // the text depend on.
  store(content) {
    const existing = this.#byContent.get(content);

    if (existing != null) {
      return `${OPEN}${this.#prefix}${existing}${CLOSE}`;
    }

    if (this.#entries.length >= MAX_ENTRIES) {
      throw capacityError(
        `Vault '${this.#prefix}' exceeded ${MAX_ENTRIES} entries — possible runaway input`,
        { vault: this.#prefix, max: MAX_ENTRIES }
      );
    }

    const id = this.#entries.length;
    this.#entries.push(content);
    this.#byContent.set(content, id);

    return `${OPEN}${this.#prefix}${id}${CLOSE}`;
  }

  retrieve(id) {
    return this.#entries[id];
  }

  // Entries are cleared so placeholder ids restart at 0 for the next `process()` call; `#prefix` and
  // `#restoreRe` are structural and stay.
  reset() {
    this.#entries = [];
    this.#byContent = new Map();
  }

  get size() {
    return this.#entries.length;
  }

  // Unknown ids are left untouched: blanking them would silently erase legitimate content.
  restoreAll(text) {
    this.#restoreRe.lastIndex = 0;
    const entries = this.#entries;

    return text.replace(this.#restoreRe, (m, id) => {
      const value = entries[Number(id)];

      return value == null ? m : value;
    });
  }
}
