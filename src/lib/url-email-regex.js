// The scheme allowlist blocks `javascript:` and `data:`, the body excludes `"` and `'` to stop an
// href breakout, and a linear body with a 253-character domain bound keeps the match out of ReDoS.
// The top-level domain runs to 24 letters, not 4: `.online`, `.technology` and `.example` are
// ordinary zones, and a shorter cap leaves `arden.technology/t?n=100000` unprotected.
export const URL_REGEX =
  /\b((?:(?:https?|ftps?|mailto):(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.-]{1,253}[.][a-z]{2,24}\/)[^\s<>"'`]*[^\s`![\]{};:'".,<>?«»“”‘’])/giu;

// Flat local-part class and bounded lookahead avoid catastrophic backtracking.
export const EMAIL_REGEX =
  /(?=[^\s@]{0,254}@)[\p{L}0-9!#$%&'*+/=?^_`{|}~.-]+@[\p{L}0-9.-]+\.[\p{L}0-9-]{2,}/gimu;

// Negative boundaries avoid matching ::before or Foo::Bar namespacing.
export const IPV6_REGEX =
  /(?<![a-zA-Z0-9])\[?(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?\]?(?::\d{1,5})?(?:\/\d{1,3})?(?![a-zA-Z0-9])/g;

export const UUID_REGEX =
  /(?<![a-zA-Z0-9])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![a-zA-Z0-9])/g;
