// The scheme allowlist blocks `javascript:` and `data:`, the body excludes `"` and `'` to stop an
// href breakout, and a linear body with a 253-character domain bound keeps the match out of ReDoS.
// The top-level domain runs to 24 letters, not 4: `.online`, `.technology` and `.example` are
// ordinary zones, and a shorter cap leaves `arden.technology/t?n=100000` unprotected.
//
// A reference to a space is the space, which ends the address as the character does: the engine
// writes its own no-break spaces as references in entity mode, and its next pass reads them back.
const SPACE_REFERENCE = '(?:nbsp|thinsp|#0*(?:160|8239|8201)|#x0*(?:a0|202f|2009))';
const REFERENCE_BODY = '(?:#[0-9]+|#[xX][0-9a-f]+|[a-z][a-z0-9]*)';
const REFERENCE = `&(?!(?:${SPACE_REFERENCE});)${REFERENCE_BODY};`;
const AMP = `&(?!(?:${SPACE_REFERENCE});)(?!${REFERENCE_BODY};)`;
const BODY = `(?:${REFERENCE}|[^\\s<>"'\`&]|${AMP})`;
// Nor does it end on a reference to a typographic quote or an ellipsis, any more than on the
// character: entity mode writes the engine's own quotes as references, `&laquo;www.ru&raquo;`. A
// `&quot;` is the escaped straight quote of a query and stays the address's.
const UNENDING_REFERENCE =
  '(?:laquo|raquo|ldquo|rdquo|lsquo|rsquo|hellip|#0*(?:171|187|8216|8217|8220|8221|8230)|#x0*(?:ab|bb|2018|2019|201c|201d|2026))';
const LAST_REFERENCE = `&(?!(?:${SPACE_REFERENCE}|${UNENDING_REFERENCE});)${REFERENCE_BODY};`;
const UNENDING = '\\s`![\\]{};:\'".,<>?«»“”‘’…&';
// The characters of the name of an e-mail, before its `@`.
const EMAIL_NAME = "\\p{L}0-9!#$%&'*+/=?^_`{|}~.-";
const last = (unending) => `(?:${LAST_REFERENCE}|[^${unending}]|${AMP})`;
// An address written without a scheme does not begin inside the domain of an e-mail: `a.b@c.ru/d` is
// the e-mail and what follows it, and read as `c.ru/d` it would leave the local part to the rules. The
// look behind is as long as a domain is.
const NOT_EMAIL_DOMAIN = '(?<!@[\\p{L}0-9.-]{0,253})';
// What `mailto:` names is an e-mail, whose name may hold an apostrophe or a backtick an address ends
// on: `mailto:o'brien@mail.ru` is one address, not a `mailto:` left to the rules before an e-mail.
const MAILTO = `mailto:(?=[^\\s@]{1,254}@)[${EMAIL_NAME}]+@`;
const address = (end) =>
  `(?:${MAILTO}|(?:https?|ftps?|mailto):(?:\\/{1,3}|[a-z0-9%])|www\\d{0,3}[.])${BODY}*${end}|${NOT_EMAIL_DOMAIN}[a-z0-9.-]{1,253}[.][a-z]{2,24}\\/(?:${BODY}*${end})?`;

export const URL_REGEX = new RegExp(`\\b(${address(last(UNENDING))})`, 'giu');
// The longest start of an address that ends where an address may end and not on `)`: what is left
// once a `)` nothing opens is cut off is read again with it.
export const URL_UNBRACKETED_START_REGEX = new RegExp(address(last(`${UNENDING})`)), 'yiu');
// The longest start of an address that ends where an address may end.
export const URL_START_REGEX = new RegExp(address(last(UNENDING)), 'yiu');

// Flat local-part class and bounded lookahead avoid catastrophic backtracking.
export const EMAIL_REGEX = new RegExp(
  `(?=[^\\s@]{0,254}@)[${EMAIL_NAME}]+@[\\p{L}0-9.-]+\\.[\\p{L}0-9-]{2,}`,
  'gimu'
);

// Negative boundaries avoid matching ::before or Foo::Bar namespacing.
export const IPV6_REGEX =
  /(?<![a-zA-Z0-9])\[?(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?\]?(?::\d{1,5})?(?:\/\d{1,3})?(?![a-zA-Z0-9])/g;

export const UUID_REGEX =
  /(?<![a-zA-Z0-9])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![a-zA-Z0-9])/g;
