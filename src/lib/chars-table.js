import { G } from './glyphs.js';

// Space-family glyphs stay split by type; collapsing to ASCII would drop non-breaking or narrow
// intent.
//
// One character, one canonical form: every named reference is listed beside the numeric reference
// for the same code point, or the same character typesets differently depending on how the author
// spelled it. `&#133;`, `&#0133;`, `&#151;` and `&#153;` name C1 code points that carry no character;
// they fold with the cp1252 glyph an HTML parser resolves them to.
//
// A canonical form that is an ASCII stand-in (`-`, `(c)`, `...`) is re-derived by a rule, so it is
// safe only while that rule is total — and a rule that can be switched off is not. A glyph with no
// total rule behind it stays its own canonical form, and its entity spellings decode straight to it.
//
// Every glyph the engine emits also has to decode back, or it cannot read its own entity-mode output.
export const CHARS_TABLE = Object.freeze({
  '"': {
    html: ['&ldquo;', '&quot;', '&#8220;', '&#34;'],
    utf8: [0x201c]
  },
  // The utf8 list above deliberately leaves « and » out, so a raw guillemet keeps the direction its
  // author chose, and their entity spellings have to agree. `„` and `‟` join the opening guillemet
  // for the same reason: they open and nothing else, so the pair they mark is knowable without
  // guessing. `“` stays neutral because it does not say which way it points — it closes a Russian
  // `„…“` and opens an English `“…”`.
  [G.LAQUO]: {
    html: ['&laquo;', '&#171;', '&bdquo;', '&#8222;', '&#8223;'],
    utf8: [0x00ab, 0x201e, 0x201f]
  },
  // `”` joins the closing guillemet on the same reasoning: it closes and nothing else, in English as
  // in Russian.
  [G.RAQUO]: { html: ['&raquo;', '&#187;', '&rdquo;', '&#8221;'], utf8: [0x00bb, 0x201d] },
  [G.NBSP]: { html: ['&nbsp;', '&#160;'], utf8: [0x00a0] },
  // Emitted as `&#8239;` in entity mode, so it has to decode back.
  [G.NNBSP]: { html: ['&#8239;', '&#x202F;', '&#x202f;'], utf8: [0x202f] },
  [G.THINSP]: { html: ['&thinsp;', '&#8201;'], utf8: [0x2009] },
  '\u{2008}': { utf8: [0x2008] },
  // U+2010 is the hyphen itself and U+2012 only ever stands between figures, so both fold. The en
  // dash does not: only the range rules would put it back, and everywhere else the author's `–` in
  // `отец–сын` or `Корвин–Эрик` would come out a hyphen. A spaced `–` between words is still raised
  // to an em dash — that is `dash.em`'s job, and its class lists the en dash for exactly this reason.
  '-': { utf8: [0x002d, 0x2010, 0x2012] },
  [G.NDASH]: { html: ['&ndash;', '&#8211;'], utf8: [0x2013] },
  '—': { html: ['&mdash;', '&#8212;', '&#151;'], utf8: [0x2014] },
  [G.MINUS]: { html: ['&minus;', '&#8722;'], utf8: [0x2212] },
  [G.EQUIV]: { html: ['&equiv;', '&#8801;'], utf8: [0x2261] },
  // The inch mark is emitted as `&Prime;` in entity mode, so it has to decode back: a guard that
  // looks for `″` after a number would otherwise see a literal `&`.
  [G.PRIME]: { html: ['&Prime;', '&#8243;'], utf8: [0x2033] },
  // Own canonical form: `punctuation.ellipsis` is the only way back from `...` and can be switched
  // off. It also reached the earlier groups as `...`, where quote and dash list `…` in their boundary
  // classes and so could not see it. Typing `...` still yields `…`.
  [G.HELLIP]: { html: ['&hellip;', '&#8230;', '&#133;', '&#0133;'], utf8: [0x2026] },
  // Own canonical forms: `number.math` is the only way back from `!=`, `<=`, `>=`, `~=` and `+-`,
  // and can be switched off. Typing `!=` still yields `≠`; that is the rule's job, not
  // normalisation's.
  [G.NE]: { html: ['&ne;', '&#8800;'], utf8: [0x2260] },
  [G.LE]: { html: ['&le;', '&#8804;'], utf8: [0x2264] },
  [G.GE]: { html: ['&ge;', '&#8805;'], utf8: [0x2265] },
  [G.CONG]: { html: ['&cong;', '&#8773;'], utf8: [0x2245] },
  // Own canonical forms: `number.fraction` covers only these three of the many fraction glyphs and
  // can be switched off. `1/2` still becomes `½`; that is the rule's job, not normalisation's.
  [G.FRAC12]: { html: ['&frac12;', '&#189;'], utf8: [0x00bd] },
  [G.FRAC14]: { html: ['&frac14;', '&#188;'], utf8: [0x00bc] },
  [G.FRAC34]: { html: ['&frac34;', '&#190;'], utf8: [0x00be] },
  // No '&' entry: &amp;/&#38; must round-trip verbatim, else an escaped ampersand changes meaning.
  [G.PLUSMN]: { html: ['&plusmn;', '&#177;'], utf8: [0x00b1] },
  // Own canonical forms: `symbol.copyright` and its siblings are the only way back from `(tm)`, `(r)`
  // and `(c)`, and that group can be switched off. Nothing is being decided here either — unlike a
  // hyphen, © is never ambiguous.
  [G.TRADE]: { html: ['&trade;', '&#8482;', '&#153;'], utf8: [0x2122] },
  [G.REG]: { html: ['&reg;', '&#174;'], utf8: [0x00ae] },
  [G.COPY]: { html: ['&copy;', '&#169;'], utf8: [0x00a9] },
  '§': { html: ['&sect;', '&#167;'], utf8: [0x00a7] },
  '€': { html: ['&euro;', '&#8364;'], utf8: [0x20ac] },
  '₽': { html: ['&#8381;'], utf8: [0x20bd] },
  '\u{0301}': { html: ['&#769;'] }, // combining acute accent
  // Own canonical forms: `symbol.apostrophe` is the only way back from ASCII and fires only between
  // letters, so an authored `‘…’` pair would come out as two straight quotes. A typed `'` between
  // letters still becomes `’`.
  [G.LSQUO]: { html: ['&lsquo;', '&#8216;'], utf8: [0x2018] },
  [G.RSQUO]: { html: ['&rsquo;', '&#8217;'], utf8: [0x2019] },
  // Multiplication sign stays U+00D7, not folded to ASCII x.
  '×': { html: ['&times;', '&#215;'] },
  [G.DEG]: { html: ['&deg;', '&#176;'], utf8: [0x00b0] },
  [G.NUMERO]: { html: ['&#8470;'], utf8: [0x2116] },
  [G.LARR]: { html: ['&larr;', '&#8592;'], utf8: [0x2190] },
  [G.RARR]: { html: ['&rarr;', '&#8594;'], utf8: [0x2192] },
  [G.SUP2]: { html: ['&sup2;', '&#178;'], utf8: [0x00b2] },
  [G.SUP3]: { html: ['&sup3;', '&#179;'], utf8: [0x00b3] }
});
