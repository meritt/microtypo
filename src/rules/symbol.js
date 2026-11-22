import { G } from '../lib/glyphs.js';
import { heldBeforeNowrapEnd, nowrap } from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import { CLOSE, OPEN, TRANSPARENT_TAG_KINDS } from '../protect/placeholders.js';

const GENERATED_SYMBOLS = new Set([G.COPY, G.REG, G.TRADE]);
const EXTENDED_ARROWS = { '<->': G.HARR, '=>': G.RIMPL, '<=>': G.HEQUIV };
const EXTENDED_ARROW_LEAD = `>\\s(${G.LAQUO}${G.BDQUO}`;
const EXTENDED_ARROW_LEAD_RE = new RegExp(`[${EXTENDED_ARROW_LEAD}]`, 'u');
const PLUS_MINUS_LEAD = `>\\s(${G.LAQUO}${G.BDQUO}:;`;
const PLUS_MINUS_LEAD_RE = new RegExp(`[${PLUS_MINUS_LEAD}]`, 'u');

// The end tag of the engine's own wrapper leads a mark only where what the wrapper holds last does:
// `и пр. b</span>=>` stays as `и пр. b=>` left it before `abbr.nowrap_because` wrapped it, and
// `н. э.</span>+/-` as `нэ.+/-` before `abbr.nowrap_era` did.
function unlessWrapperEnd(leadRe, replace) {
  return (m, ctx) => {
    const held = heldBeforeNowrapEnd(ctx, m.at(-1), m.at(-2) - 1);

    return held !== null && !leadRe.test(held) ? m[0] : replace(m);
  };
}

function hasNextCopyrightToken(source, index) {
  return /^\((?:c|с)\)/iu.test(source.slice(index, index + 3));
}

function copyrightSpace(match, offset, source) {
  const next = source[offset + match.length];

  return `${G.COPY}${
    next === OPEN ||
    next === '<' ||
    (next === '"' && /[.,;:!?…)]/u.test(source[offset + match.length + 1] ?? '')) ||
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
// The item is read through the inline markup a hanging bracket is drawn into later, `<span>(</span>б)`.
const COPYRIGHT_SCAN_RE = new RegExp(
  String.raw`(\n[ \t]*\n|<\/${OPEN}L\d+${CLOSE}>)|(\(${INLINE_MARKUP}{0,4}[abаб]\))|${COPYRIGHT_MARK}`,
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
      id: 'plus_minus_slash',
      requires: F.MATH | F.SLASH | F.DASH,
      description: 'Преобразование +/- в ±',
      pattern: new RegExp(
        `(?<=^|[${PLUS_MINUS_LEAD}])\\+\\/-(?=$|[\\s\\d).,;:!?${G.RAQUO}${G.LDQUO}]|<\\/)`,
        'gu'
      ),
      replacement: unlessWrapperEnd(PLUS_MINUS_LEAD_RE, () => G.PLUSMN)
    },
    {
      id: 'arrows_extended',
      requiresAny: F.MATH | F.DASH,
      description: 'Дополнительные стрелки: <-> → ↔, => → ⇒, <=> → ⇔',
      pattern: new RegExp(
        `(?<=^|[${EXTENDED_ARROW_LEAD}])(<=>|<->|=>)(?=$|[\\s).,;:!?${G.RAQUO}${G.LDQUO}]|<\\/)`,
        'gu'
      ),
      replacement: unlessWrapperEnd(EXTENDED_ARROW_LEAD_RE, (m) => EXTENDED_ARROWS[m[1]])
    },
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
      replacement: (m, ctx) => {
        const end = m.at(-2) + m[1].length + 1;

        return `${nowrap(ctx, `${m[1]} ${G.DEG}F`, m.at(-1), m.at(-2), end)}${m[2]}`;
      }
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
