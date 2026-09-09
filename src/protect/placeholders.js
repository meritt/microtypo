export const OPEN = '\u{E000}';
export const CLOSE = '\u{E001}';
const PARA_DELIM_OPEN = '\u{E100}';
const PARA_DELIM_CLOSE = '\u{E101}';

// The four delimiters that carry placeholder structure, as a character-class fragment. A rule whose
// body is a negated class must exclude them, or a greedy match runs straight through a vaulted tag
// or a paragraph marker and carries it off — an autolink would put both inside its href.
export const RESERVED_PUA_CLASS = String.raw`\u{E000}\u{E001}\u{E100}\u{E101}`;

const RESERVED_PUA_RE = new RegExp(`[${RESERVED_PUA_CLASS}]`, 'gu');

// Stripped on every `process()` entry, or crafted input forges vault and paragraph placeholders.
export function stripReservedPua(text) {
  return text.replace(RESERVED_PUA_RE, '');
}

export function placeholderRegex(prefix, flags = 'g') {
  return new RegExp(`${OPEN}${prefix}(\\d+)${CLOSE}`, flags);
}

// Every vault placeholder has this shape: PUA delimiters wrapping a letter prefix and a decimal id.
// Spelled inline in each consumer it drifts, and one copy bounds the id where another does not.
export const PLACEHOLDER_TOKEN = `${OPEN}[A-Za-z]+\\d+${CLOSE}`;

// The same token as the tag a rule reads back out of the text, capturing the closing slash and the
// token itself. Built per consumer rather than shared: a `g` regex carries `lastIndex`.
export const TAG_PLACEHOLDER_SOURCE = `<(/?)(${PLACEHOLDER_TOKEN})>`;

// A rule reading the text around a placeholder cannot open the vault, so the prefix carries the
// whole classification and every consumer reads the same set from here rather than spelling a subset
// inline.
//
// What a search for the end of a sentence may read through. An inline tag and an anchor are markup
// and carry no words of their own; a region vaulted out of a `<script>` or a `<style>` carries words
// no reader ever sees. An inline block and an ordinary safe block are neither — the words in a
// `<code>` span go on with the sentence in front of it, so they stop the search.
export const BLOCK_KIND = 'L';
export const TRANSPARENT_TAG_KINDS = 'TA';
export const TRANSPARENT_BARE_KINDS = 'NH';

// The kinds `SafeTags` writes inside a literal `<…>` and restores from there; a safe block never is
// one, because that layer vaults a wrapper's content and leaves the wrapper itself standing.
export const TAG_VAULT_KINDS = 'TALIH';

export const PARAGRAPH_OPEN = `${PARA_DELIM_OPEN}POP${PARA_DELIM_CLOSE}`;
export const PARAGRAPH_CLOSE = `${PARA_DELIM_OPEN}PCL${PARA_DELIM_CLOSE}`;
export const BREAKLINE = `${PARA_DELIM_OPEN}BR${PARA_DELIM_CLOSE}`;

const PARAGRAPH_RESTORE_RE = new RegExp(`${PARA_DELIM_OPEN}(POP|PCL|BR)${PARA_DELIM_CLOSE}`, 'gu');
const PARAGRAPH_TO_HTML = { POP: '<p>', PCL: '</p>', BR: '<br>' };

// A paragraph marker carrying a tag placeholder is unwrapped into a real `<…>`/`</…>`, so tag
// restore fills in the original bytes, attributes and all, rather than the plain `<p>`/`</p>` a
// synthesized paragraph gets.
const TAG_PLACEHOLDER_RE = `${OPEN}[TAL]\\d+${CLOSE}`;
const PARAGRAPH_OPEN_TAGGED_RE = new RegExp(`${PARAGRAPH_OPEN}(${TAG_PLACEHOLDER_RE})`, 'gu');
const PARAGRAPH_CLOSE_TAGGED_RE = new RegExp(`(${TAG_PLACEHOLDER_RE})${PARAGRAPH_CLOSE}`, 'gu');

// A paragraph is something a document has and an attribute does not, so where the markers cannot
// become `<p>` they are taken out whole — stripping only their PUA delimiters left the `POP` and
// `PCL` behind as literal text.
export function dropParagraphs(text) {
  return text.replace(PARAGRAPH_RESTORE_RE, '');
}

export function restoreParagraphs(text) {
  return text
    .replace(PARAGRAPH_OPEN_TAGGED_RE, (_, ph) => `<${ph}>`)
    .replace(PARAGRAPH_CLOSE_TAGGED_RE, (_, ph) => `</${ph}>`)
    .replace(PARAGRAPH_RESTORE_RE, (_, kind) => PARAGRAPH_TO_HTML[kind] ?? '');
}
