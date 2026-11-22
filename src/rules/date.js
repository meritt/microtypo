import {
  CONTENT_END_LOOKAHEAD,
  CONTENT_START_GROUP,
  writtenContentEndLookahead
} from '../lib/boundaries.js';
import { keptReferenceTo } from '../lib/character-reference.js';
import { G } from '../lib/glyphs.js';
import { nowrap } from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import { CLOSE, OPEN, TRANSPARENT_TAG_KINDS } from '../protect/placeholders.js';

const ROMAN_CENTURIES = new Set(
  ['', 'X', 'XX', 'XXX'].flatMap((tens) =>
    ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((ones) => tens + ones)
  )
);

// A date with its year mark, `12.05.20г` or `12.05.2020 г.`. Only the mark is taken, with a period
// set apart from it (`г .`), which is the mark's own: the space around it is looked at and left as
// written, so it still starts the next date. The start of a no-break wrapper is the start of the word
// it holds first: the lifted text keeps the tag of the engine's own form, and a date behind it reads
// as it does once a word is drawn into the wrapper in front of it.
const YEAR_MARK = String.raw`[ \t${G.NBSP}]?г(?:[ \t${G.NBSP}]*\.|(?=\s))`;
const INLINE_START = `<${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d{1,9}${CLOSE}>`;
const DATE_YEAR_RE = new RegExp(
  String.raw`(?<=^|\s|${INLINE_START})([0-9]{2}\.[0-9]{2}\.(?:[0-9]{2})?[0-9]{2})${YEAR_MARK}`,
  'giu'
);

// Ends on a lookahead: the space after a date is the left boundary of the next one.
export const NUMERIC_DATE_RE =
  /(\s|\u{00A0})([0-9]{2}\.[0-9]{2}\.([0-9]{2})?[0-9]{2})(?=\s|\u{00A0}|\.(?:\s|\u{00A0}|$)|$)/giu;

// A date with its year mark is the first pattern's, wrapped there or left inside a wrapper it already
// stands in; the plain date pattern after it does not read it again, since on lifted text the
// context of a span the first pattern rewrote can no longer be told.
const UNMARKED_DATE_RE = new RegExp(`${NUMERIC_DATE_RE.source}(?!${YEAR_MARK})`, 'giu');

// The final group of a number cannot start a day range. XML can preserve either the preceding
// digit or the narrow no-break space as a numeric character reference.
const GROUPED_NUMBER_PREFIX = `(?:\\d|${keptReferenceTo(...'0123456789')})(?:${G.NNBSP}|${keptReferenceTo(G.NNBSP)})`;

// `nowrap_date` wraps a date in its own turn, after the quote, dash, space and binding groups, and to
// them a `г` glued to the date is a word of its own; the next pass would read `12.05.20 г.` instead.
// The engine settles the mark before every group, past inline markup as the group's rules read.
export const YEAR_MARKS = {
  id: 'settle_year_marks',
  budgetStage: 'group:date',
  requires: F.DIGIT | F.PERIOD | F.CYRILLIC,
  apply: (text) => text.replace(DATE_YEAR_RE, `$1${G.NBSP}г.`)
};

function wrapDate(m, ctx, body, lead = '', tail = '') {
  const start = m.at(-2) + lead.length;
  const end = m.at(-2) + m[0].length - tail.length;
  return `${lead}${nowrap(ctx, body, m.at(-1), start, end)}${tail}`;
}

function yearRangePattern(dash, gap) {
  return new RegExp(
    String.raw`((?:с|по|период|середины|начала|начало|конца|конец|половины|в|между|\([cс]\)|${G.COPY})\s+)(\d{4})(${dash})(\d{4})(?:${gap}(г\.г\.|гг\.|гг|г\.|г)(?![а-яёa-z]))?`,
    'giu'
  );
}

const YEAR_DASHES = G.MDASH + G.MINUS + G.NDASH;
const YEAR_RANGE_RE = yearRangePattern(`[-${YEAR_DASHES}]`, `[ ${G.NBSP}]?`);
// Any horizontal author space keeps the range visible. The ordinary rules still decide which
// spaces collapse and which survive, including thin space between the year and its suffix.
const SOURCE_GAP = String.raw`[\t\p{Zs}]`;
// The inline pass sees author separators before the dash rules get to collapse them.
export const SOURCE_YEAR_RANGE_RE = yearRangePattern(
  `${SOURCE_GAP}*(?:-{1,2}|[${YEAR_DASHES}])${SOURCE_GAP}*`,
  `(?<suffixGap>${SOURCE_GAP}*)`
);

export const dateGroup = {
  title: 'Даты и дни',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_century',
      requires: F.SPACE,
      requiresAny: F.DIGIT | F.LATIN,
      description: 'Привязка римского или арабского номера века к обозначению',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}([1-9]\\d?|[IVX]{1,8})[ \\t${G.NBSP}]+(век(?:а|е|у|ом)?|в\\.)${CONTENT_END_LOOKAHEAD}`,
        'gu'
      ),
      replacement: (m) =>
        ROMAN_CENTURIES.has(m[2]) || Number(m[2]) > 0 ? `${m[1]}${m[2]}${G.NBSP}${m[3]}` : m[0]
    },
    {
      id: 'year_range',
      requires: F.DIGIT | F.DASH | F.SPACE,
      requiresPattern: /\d{4}[-—−–]\d{4}/u,
      description: 'Тире и неразрывные пробелы в периодах дат',
      pattern: YEAR_RANGE_RE,
      projectEdits: true,
      replacement: ([, lead, first, dash, last, suffix]) => {
        const separator = first < last ? G.NDASH : dash;
        return `${lead}${first}${separator}${last}${suffix ? `${G.NBSP}гг.` : ''}`;
      }
    },
    {
      id: 'month_range',
      requires: F.DASH,
      requiresPattern: /-/u,
      description: 'Среднее тире между периодами месяцев',
      // The second month is a lookahead: in a chain it is the first month of the next range.
      pattern:
        /(?<![а-яёa-z])((январ|феврал|сентябр|октябр|ноябр|декабр)([ьяюе]|[её]м)|(апрел|июн|июл)([ьяюе]|ем)|(март|август)([ауе]|ом)?|ма[йяюе]|маем)-(?=((январ|феврал|сентябр|октябр|ноябр|декабр)([ьяюе]|[её]м)|(апрел|июн|июл)([ьяюе]|ем)|(март|август)([ауе]|ом)?|ма[йяюе]|маем)(?![а-яёa-z]))/giu,
      replacement: `$1${G.NDASH}`
    },
    {
      id: 'day_month_range',
      requires: F.DIGIT | F.DASH | F.SPACE,
      requiresPattern: /-/u,
      description: 'Среднее тире между полными датами «число месяц»',
      pattern:
        /(\d{1,2}\s(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))-(\d{1,2}\s(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/giu,
      replacement: `$1${G.NDASH}$2`
    },
    {
      id: 'nowrap_day_range',
      requires: F.DIGIT | F.CYRILLIC,
      description: 'Тире и неразрывные периоды дней',
      enabled: false,
      pattern: new RegExp(
        `(^|[^\\d])(?<!${GROUPED_NUMBER_PREFIX})(\\d+)(?:[-${G.MINUS}${G.MDASH}${G.NDASH}]|${keptReferenceTo('-', G.MINUS, G.MDASH, G.NDASH)})(\\d+)(?: |${G.NBSP}|${keptReferenceTo(G.NBSP)})(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)${writtenContentEndLookahead(keptReferenceTo)}`,
        'giu'
      ),
      replacement: (m, ctx) => {
        const [, lead, first, last, month] = m;

        return wrapDate(m, ctx, `${first}${G.MDASH}${last} ${month}`, lead);
      }
    },
    {
      id: 'nowrap_date',
      requires: F.DIGIT | F.PERIOD,
      requiresPattern: /[0-9]{2}\.[0-9]{2}\./u,
      description: 'Привязка года к дате',
      pattern: [DATE_YEAR_RE, UNMARKED_DATE_RE],
      replacement: [
        (m, ctx) => wrapDate(m, ctx, `${m[1]} г.`),
        (m, ctx) => {
          const [, p1, p2] = m;

          return wrapDate(m, ctx, p2, p1);
        }
      ]
    },
    {
      id: 'nbsp_year_suffix',
      requires: F.DIGIT | F.PERIOD,
      description: 'Пробел между годом и сокращением г.',
      // A lookahead: the space after `г.` is the left boundary of the next year.
      pattern: /(^| |\u{00A0}|"|«)([0-9]{3,4})[ ]?(г\.)(?=[^a-zа-яё]|$)/giu,
      replacement: `$1$2${G.NBSP}$3`
    }
  ]
};
