import { G } from '../lib/glyphs.js';
import { F } from '../lib/rule-features.js';
import { CLOSE, OPEN, TRANSPARENT_TAG_KINDS } from '../protect/placeholders.js';

const GENERATED_SYMBOLS = new Set([G.COPY, G.REG, G.TRADE]);

function hasNextCopyrightToken(source, index) {
  return /^\((?:c|с)\)/iu.test(source.slice(index, index + 3));
}

function copyrightSpace(match, offset, source) {
  const next = source[offset + match.length];

  return `${G.COPY}${
    next === OPEN ||
    next === '<' ||
    GENERATED_SYMBOLS.has(next) ||
    hasNextCopyrightToken(source, offset + match.length)
      ? ' '
      : G.NBSP
  }`;
}

// A mark reads the word it belongs to through the inline tags and Markdown emphasis beside it, as the
// reader does. A run of spaces is one gap: a later rule collapses it.
const INLINE_MARKUP = String.raw`(?:<\/?${OPEN}[${TRANSPARENT_TAG_KINDS}]\d{1,9}${CLOSE}>|[*_~])`;
const MARK_GAP = String.raw`${INLINE_MARKUP}{0,4}(?:[ \t${G.NBSP}]{1,8}${INLINE_MARKUP}{0,4})?`;

// Letters are spelled in both cases rather than read under the `i` flag, which would let `\p{Lu}`
// match a lowercase letter too.
const COPYRIGHT_SHORTHAND = String.raw`\([cсCС]\)`;
const COPYRIGHT_MARK = String.raw`(?<=(?<![\p{L}\d])[Cc][Oo][Pp][Yy][Rr][Ii][Gg][Hh][Tt]${MARK_GAP})${COPYRIGHT_SHORTHAND}|(?<![\p{L}\d]${INLINE_MARKUP}{0,4})${COPYRIGHT_SHORTHAND}(?=${MARK_GAP}(?:\d{4}(?!\d)|\p{Lu}))`;

// The end of a paragraph, or an item of an enumeration in it: after `(a)` or `(b)` a `(c)` is the next
// item. A closing block tag ends a paragraph and `<br>` does not, and only a close tells them apart.
const COPYRIGHT_SCAN_RE = new RegExp(
  String.raw`(\n[ \t]*\n|<\/${OPEN}L\d+${CLOSE}>)|(\([abаб]\))|${COPYRIGHT_MARK}`,
  'gu'
);

// A word glued to a number, `0DPI` or `6Гц`, is still a word: a later rule spaces the two apart.
const REGISTERED_RE = new RegExp(
  String.raw`(?<=(?<!\p{L})(?=\p{L}{0,39}\p{Lu})\p{L}{2,40}${MARK_GAP})\([rR]\)`,
  'gu'
);

const COPYRIGHT_GAP_RE = new RegExp(`${G.COPY}[ \\t]+`, 'gu');

function copyright(ctx) {
  let enumeration = false;

  ctx.text = ctx.text
    .replace(COPYRIGHT_SCAN_RE, (match, paragraphEnd, item) => {
      if (paragraphEnd !== undefined) {
        enumeration = false;

        return match;
      }

      if (item !== undefined) {
        enumeration = true;

        return match;
      }

      return enumeration ? match : G.COPY;
    })
    .replace(COPYRIGHT_GAP_RE, copyrightSpace);
}

export const symbolGroup = {
  title: 'Специальные символы',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'trademark',
      requires: F.PAREN | F.LATIN,
      description: '(tm) → ™',
      pattern: /\(tm\)/gi,
      replacement: G.TRADE
    },
    {
      id: 'registered',
      requires: F.PAREN | F.LATIN,
      description: '(R) → ®',
      pattern: REGISTERED_RE,
      replacement: G.REG
    },
    {
      id: 'copyright',
      requiresAny: F.PAREN | F.COPYRIGHT,
      description: '(c) → ©',
      // © is its own canonical form, so an authored glyph reaches this rule as itself. Convert first,
      // space second, or the spacing decision has to be spelled once against the shorthand and once
      // against the glyph, with the two kept in agreement.
      //
      // The gap the second pattern binds is horizontal, because `\s` spans a blank line and a mark
      // ending a paragraph would swallow the break behind it.
      regexes: [COPYRIGHT_SCAN_RE, COPYRIGHT_GAP_RE],
      handler: copyright
    },
    {
      id: 'apostrophe',
      requires: F.APOSTROPHE,
      description: 'Правильный апостроф',
      pattern: /(\s|^|>|’)([a-zа-яё]{1,})'{1,2}([a-zа-яё]+)/giu,
      replacement: `$1$2${G.RSQUO}$3`,
      cycled: true
    },
    {
      id: 'fahrenheit',
      requires: F.DIGIT | F.LATIN,
      description: 'Градусы по Фаренгейту',
      pattern: /(?<!\d)([0-9]+)F($|\s|\.|,|;|:|\u{00A0}|\?|!)/gu,
      replacement: (m, ctx) => `${ctx.tag(`${m[1]} ${G.DEG}F`, 'span', { class: 'nowrap' })}${m[2]}`
    },
    {
      id: 'arrows',
      requires: F.DASH,
      description: 'Преобразование -> в → и <- в ←',
      pattern: [/([^<-]|^)->/g, /<-(?![->])/g],
      replacement: [`$1${G.RARR}`, G.LARR]
    }
  ]
};
