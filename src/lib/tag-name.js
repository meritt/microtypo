// What may start a tag name, in one place. XML NameStartChar admits any letter plus `_` and `:`, so
// an element may be named `книга` or `σελίδα`, and a scanner recognising only `[A-Za-z]` leaves such
// a tag unprotected for the rules to typeset.
export const NAME_START = String.raw`\p{L}_:`;

// `!` and `?` are not names: they open a comment, a doctype or a processing instruction, which the
// same scanners have to span.
const NAME_START_RE = new RegExp(`[${NAME_START}!?]`, 'u');

export function isTagNameStart(codePoint) {
  return codePoint !== undefined && NAME_START_RE.test(String.fromCodePoint(codePoint));
}

export function startsTagName(text) {
  return isTagNameStart(text.codePointAt(0));
}

// The write side of the same question, and deliberately narrower: a name a rule group hands to
// `ctx.tag` or `addSafeTag` goes into the markup as written, so it stays inside what every parser
// reads the same way. Recognising a name in someone else's document is not the same permission as
// minting one.
export const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
