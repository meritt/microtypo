export const OPEN = '\u{E000}';
export const CLOSE = '\u{E001}';
const PARA_DELIM_OPEN = '\u{E100}';
const PARA_DELIM_CLOSE = '\u{E101}';

const RESERVED_PUA_RE = /[\u{E000}\u{E001}\u{E100}\u{E101}]/gu;

// Engine must strip on every process() entry, else crafted input forges vault/paragraph placeholders.
export function stripReservedPua(text) {
  return text.replace(RESERVED_PUA_RE, '');
}

export function placeholderRegex(prefix, flags = 'g') {
  return new RegExp(`${OPEN}${prefix}(\\d+)${CLOSE}`, flags);
}

export const PARAGRAPH_OPEN = `${PARA_DELIM_OPEN}POP${PARA_DELIM_CLOSE}`;
export const PARAGRAPH_CLOSE = `${PARA_DELIM_OPEN}PCL${PARA_DELIM_CLOSE}`;
export const BREAKLINE = `${PARA_DELIM_OPEN}BR${PARA_DELIM_CLOSE}`;

const PARAGRAPH_RESTORE_RE = new RegExp(`${PARA_DELIM_OPEN}(POP|PCL|BR)${PARA_DELIM_CLOSE}`, 'gu');
const PARAGRAPH_TO_HTML = { POP: '<p>', PCL: '</p>', BR: '<br>' };

// Unwrap a tag-placeholder-tagged paragraph marker into a real <…>/</…> so tag restore fills
// the original bytes (attributes and all), not the plain <p>/</p> a synthesized paragraph gets.
const TAG_PLACEHOLDER_RE = `${OPEN}[TA]\\d+${CLOSE}`;
const PARAGRAPH_OPEN_TAGGED_RE = new RegExp(`${PARAGRAPH_OPEN}(${TAG_PLACEHOLDER_RE})`, 'gu');
const PARAGRAPH_CLOSE_TAGGED_RE = new RegExp(`(${TAG_PLACEHOLDER_RE})${PARAGRAPH_CLOSE}`, 'gu');

export function restoreParagraphs(text) {
  return text
    .replace(PARAGRAPH_OPEN_TAGGED_RE, (_, ph) => `<${ph}>`)
    .replace(PARAGRAPH_CLOSE_TAGGED_RE, (_, ph) => `</${ph}>`)
    .replace(PARAGRAPH_RESTORE_RE, (_, kind) => PARAGRAPH_TO_HTML[kind] ?? '');
}
