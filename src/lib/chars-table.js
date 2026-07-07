import { G } from './glyphs.js';

// Space-family glyphs stay split by type; collapsing to ASCII would drop non-breaking/narrow intent.
export const CHARS_TABLE = Object.freeze({
  '"': {
    html: ['&laquo;', '&raquo;', '&rdquo;', '&bdquo;', '&ldquo;', '&quot;', '&#171;', '&#187;'],
    utf8: [0x201e, 0x201c, 0x201f, 0x201d]
  },
  [G.NBSP]: { html: ['&nbsp;', '&#160;'], utf8: [0x00a0] },
  [G.THINSP]: { html: ['&thinsp;'], utf8: [0x2009] },
  '\u{2008}': { utf8: [0x2008] },
  '-': {
    html: ['&ndash;', '&minus;', '&#151;', '&#8212;', '&#8211;'],
    utf8: [0x002d, 0x2010, 0x2012, 0x2013]
  },
  '—': { html: ['&mdash;'], utf8: [0x2014] },
  '==': { html: ['&equiv;'], utf8: [0x2261] },
  '...': { html: ['&hellip;', '&#0133;'], utf8: [0x2026] },
  '!=': { html: ['&ne;', '&#8800;'], utf8: [0x2260] },
  '<=': { html: ['&le;', '&#8804;'], utf8: [0x2264] },
  '>=': { html: ['&ge;', '&#8805;'], utf8: [0x2265] },
  '1/2': { html: ['&frac12;', '&#189;'], utf8: [0x00bd] },
  '1/4': { html: ['&frac14;', '&#188;'], utf8: [0x00bc] },
  '3/4': { html: ['&frac34;', '&#190;'], utf8: [0x00be] },
  '+-': { html: ['&plusmn;', '&#177;'], utf8: [0x00b1] },
  // No '&' entry: &amp;/&#38; must round-trip verbatim, else an escaped ampersand changes meaning.
  '(tm)': { html: ['&trade;', '&#153;'], utf8: [0x2122] },
  '(r)': { html: ['&reg;', '&#174;'], utf8: [0x00ae] },
  '(c)': { html: ['&copy;', '&#169;'], utf8: [0x00a9] },
  '§': { html: ['&sect;', '&#167;'], utf8: [0x00a7] },
  '€': { html: ['&euro;', '&#8364;'], utf8: [0x20ac] },
  '₽': { html: ['&#8381;'], utf8: [0x20bd] },
  '\u{0301}': { html: ['&#769;'] }, // combining acute accent
  // ‘ folds here too, else a pre-existing ‘…’ pair downgrades only its closer, emitting asymmetrically.
  "'": { html: ['&rsquo;', '’', '‘', '&lsquo;'] },
  // Multiplication sign stays U+00D7, not folded to ASCII x.
  '×': { html: ['&times;', '&#215;'] }
});
