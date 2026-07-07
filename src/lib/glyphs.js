export const G = Object.freeze({
  NBSP: '\u{00A0}', // non-breaking space
  NNBSP: '\u{202F}', // narrow non-breaking space
  THINSP: '\u{2009}', // thin space

  LAQUO: '«',
  RAQUO: '»',
  BDQUO: '„',
  LDQUO: '“',
  RSQUO: '’',
  PRIME: '″',

  MDASH: '—',
  NDASH: '–',
  MINUS: '−',

  HELLIP: '…',

  COPY: '©',
  REG: '®',
  TRADE: '™',
  SECT: '§',
  EURO: '€',
  RUB: '₽',
  DEG: '°',
  TIMES: '×',
  PLUSMN: '±',
  NUMERO: '№',

  NE: '≠',
  LE: '≤',
  GE: '≥',
  CONG: '≅',

  LARR: '←',
  RARR: '→',

  SUP2: '²',
  SUP3: '³',

  FRAC12: '½',
  FRAC14: '¼',
  FRAC34: '¾',

  COMBINING_ACUTE: '\u{0301}' // combining acute accent
});

// Only produced glyphs convert; input-only chars (e.g. raw quote) are excluded.
export const GLYPH_TO_ENTITY = Object.freeze({
  [G.NBSP]: '&nbsp;',
  [G.NNBSP]: '&#8239;',
  [G.THINSP]: '&thinsp;',
  [G.LAQUO]: '&laquo;',
  [G.RAQUO]: '&raquo;',
  [G.BDQUO]: '&bdquo;',
  [G.LDQUO]: '&ldquo;',
  [G.RSQUO]: '&rsquo;',
  [G.PRIME]: '&Prime;',
  [G.MDASH]: '&mdash;',
  [G.NDASH]: '&ndash;',
  [G.MINUS]: '&minus;',
  [G.HELLIP]: '&hellip;',
  [G.COPY]: '&copy;',
  [G.REG]: '&reg;',
  [G.TRADE]: '&trade;',
  [G.SECT]: '&sect;',
  [G.EURO]: '&euro;',
  [G.RUB]: '&#8381;',
  [G.DEG]: '&deg;',
  [G.TIMES]: '&times;',
  [G.PLUSMN]: '&plusmn;',
  [G.NUMERO]: '&#8470;',
  [G.NE]: '&ne;',
  [G.LE]: '&le;',
  [G.GE]: '&ge;',
  [G.CONG]: '&cong;',
  [G.LARR]: '&larr;',
  [G.RARR]: '&rarr;',
  [G.SUP2]: '&sup2;',
  [G.SUP3]: '&sup3;',
  [G.FRAC12]: '&frac12;',
  [G.FRAC14]: '&frac14;',
  [G.FRAC34]: '&frac34;',
  [G.COMBINING_ACUTE]: '&#769;'
});

const GLYPH_RE = new RegExp(`[${Object.keys(GLYPH_TO_ENTITY).join('')}]`, 'gu');

export function unicodeToEntities(text) {
  return text.replace(GLYPH_RE, (g) => GLYPH_TO_ENTITY[g] ?? g);
}

// XML 1.0 predefines only amp/lt/gt/quot/apos; named entities need numeric refs to stay well-formed.
const GLYPH_TO_NUMERIC = Object.freeze(
  Object.fromEntries(Object.keys(GLYPH_TO_ENTITY).map((g) => [g, `&#${g.codePointAt(0)};`]))
);

export function unicodeToXmlEntities(text) {
  return text.replace(GLYPH_RE, (g) => GLYPH_TO_NUMERIC[g] ?? g);
}
