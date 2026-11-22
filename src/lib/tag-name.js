// What may start a tag name, in one place. XML NameStartChar admits any letter plus `_` and `:`, so
// an element may be named `книга` or `σελίδα`, and a scanner recognising only `[A-Za-z]` leaves such
// a tag unprotected for the rules to typeset.
export const NAME_START = String.raw`\p{L}_:`;

// `!` and `?` are not names: they open a comment, a doctype or a processing instruction, which the
// same scanners have to span.
const NAME_START_RE = new RegExp(`[${NAME_START}!?]`, 'u');
// HTML starts a tag name with an ASCII letter only: a `<` before any other letter is the sign of
// the text, `Цена <тысячи`, and read as a tag it would take the markup behind it for its attributes.
const HTML_NAME_START_RE = /[A-Za-z!?]/;

export function isTagNameStart(codePoint, xml = false) {
  return (
    codePoint !== undefined &&
    (xml ? NAME_START_RE : HTML_NAME_START_RE).test(String.fromCodePoint(codePoint))
  );
}

// The write side of the same question, and deliberately narrower: a name a rule group hands to
// `ctx.tag` or `addSafeTag` goes into the markup as written, so it stays inside what every parser
// reads the same way. Recognising a name in someone else's document is not the same permission as
// minting one.
export const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
