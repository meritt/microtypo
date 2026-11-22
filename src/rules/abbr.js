import {
  BUILDING_LABEL,
  DOCUMENT_LABEL,
  DOTTED_INITIAL_PAIR,
  followsCompleteName,
  LABEL_NUMBER_END,
  MAGNITUDE,
  ORGANIZATION,
  STREET_LABEL,
  currencyUnit,
  postscript
} from '../lib/abbreviation-grammar.js';
import {
  CONTENT_END_LOOKAHEAD,
  CONTENT_START,
  CONTENT_START_GROUP,
  WRAPPER_START_GROUP
} from '../lib/boundaries.js';
import { keptGlyphsAt } from '../lib/character-reference.js';
import { G } from '../lib/glyphs.js';
import {
  LENGTH_UNITS,
  SPEED_UNITS,
  WEIGHT_UNITS,
  VOLUME_UNITS,
  TIME_UNITS,
  DATA_UNITS,
  FREQUENCY_UNITS,
  CURRENCY_PREFIX_SIGNS,
  DECIMAL_UNIT,
  VOLT_UNIT_RE,
  unitBind
} from '../lib/measurement-units.js';
import {
  canonicalNowrapContentStart,
  heldBeforeNowrapEnd,
  insideCanonicalNowrap,
  nowrap
} from '../lib/nowrap-context.js';
import { F } from '../lib/rule-features.js';
import {
  CLOSE,
  OPEN,
  TRANSPARENT_BARE_KINDS,
  INLINE_END,
  TRANSPARENT_TAG_KINDS,
  vaultedReference
} from '../protect/placeholders.js';
import { DASH_IN_GAPS, SENTENCE_DASH, SENTENCE_DASH_TAIL } from './dash.js';
import { phoneContextAt } from './number.js';

// Inline markup and an opening bracket are transparent to the question below: neither ends a
// sentence, what stands behind them does, so putting a phrase in emphasis must not change its
// punctuation.
//
// What the protect layer sorted, read back by prefix: a vaulted region holding content is read
// through — `<code>за книгу.</code>` holds the words that finish the sentence — while the body of a
// `<script>` shows the reader nothing and what stands behind it is what decides.
const INLINE_LEAD_RE = new RegExp(
  `^(?:[ \\t${G.NBSP}(]|<\\/?${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d+${CLOSE}>|${OPEN}[${TRANSPARENT_BARE_KINDS}]\\d+${CLOSE})+`,
  'u'
);

// Nothing left, a new sentence, or the end of the text run. `<` is a boundary in its own right: what
// is left standing behind the inline lead is a block tag or markup this run never protected.
const SENTENCE_ENDS_RE = new RegExp(
  `^\\s*$|^[ \\t${G.NBSP}]*(?:[\\n<${G.LAQUO}${G.BDQUO}]|\\p{Lu})`,
  'u'
);

const endsSentence = (rest) => SENTENCE_ENDS_RE.test(rest.replace(INLINE_LEAD_RE, ''));

// `dash` runs first and cannot know the period belongs to the abbreviation, so the rule that takes
// the evidence away is the one that has to restore the conclusion — reading back the exact form
// `dash.em_after_sentence` produced, which is why that form is imported rather than respelled.

// The end tag of the engine's own wrapper starts content only where what the wrapper holds last does:
// `09.11.31 г.</span>8 м` binds no more than `г.8 м` did before the wrapper was written.
const CONTENT_START_RE = new RegExp(`[${CONTENT_START}]`, 'u');

function unboundNumber(m, ctx) {
  const held = heldBeforeNowrapEnd(ctx, m.at(-1), m.at(-2));
  return (
    (held !== null && !CONTENT_START_RE.test(held)) ||
    phoneContextAt(m.at(-1), m.at(-2) + m[1].length) === 1
  );
}

function bindUnit(m, ctx) {
  return unboundNumber(m, ctx) ? m[0] : `${m[1]}${m[2]}${G.NBSP}${m[4]}`;
}

// `долл. США` is read through Markdown emphasis on `США`, through the end of the no-break wrapper
// a rerun finds closed after `долл`, `ГОСТ 7 долл</span>. США`, and through the start of the one
// `other.strip_nbsp_in_nowrap` grows around `США` and the wrapped phrase after it, `долл. <span>США`.
// The amount and its currency are one pair across a no-break space as across a space: the space
// inside a no-break wrapper is that no-break space written plainly, and the next pass reads it so.
// A run of both is one gap too: `nobr.nbsp_after_number` collapses it to one no-break space.
const CURRENCY_GAP = `[ ${G.NBSP}]*`;
// The amount is read through the end of an inline element too: in HTML the phone wrapper is written
// before this group, `67</span>⍽р`, and `other.strip_nbsp_in_nowrap` draws the currency inside it.
const CURRENCY_AMOUNT = `(\\d(?:<\\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d{1,9}${CLOSE}>)?)`;

// `долл. США` keeps its words: the bare `долл.` reading below must not take the pair this one wrote.
const USD_TAIL = String.raw`(?:<\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\d{1,9}${CLOSE}>)?\.[ *_~]{0,4}(?:<${OPEN}[${TRANSPARENT_TAG_KINDS}]\d{1,9}${CLOSE}>)?США`;
const USD_ABBREVIATION_RE = new RegExp(
  `${CURRENCY_AMOUNT}${CURRENCY_GAP}(долл${USD_TAIL})(?![а-яёa-z])`,
  'giu'
);

const GLUED_USA_RE = /^(долл)\.(?=США)/iu;

// Six digits on their own before `г.` and a capitalised name are a postal index, and `г.` the city of
// the address it opens: `125009 г. Москва`. The next pass reads the index grouped by
// `other.split_triads`, `125 009`, and has to see the same index, in XML through the reference the
// space after `г.` is written as.
export const CITY_GAP = `(?:[ \\t${G.NBSP}]|${vaultedReference(G.NBSP)})`;
const CITY_AFTER_RE = new RegExp(`^\\.${CITY_GAP}{0,4}[А-ЯЁA-Z]`, 'u');
const CITY_AFTER_REACH = 40;
const INDEX_HALF_BEFORE_RE = new RegExp(`(?:^|[^\\p{L}\\d${G.NNBSP}])\\d{3}$`, 'u');

function isPostalIndex(start, number, offset, source) {
  if (start === G.NNBSP) {
    return (
      number.length === 3 &&
      INDEX_HALF_BEFORE_RE.test(source.slice(Math.max(0, offset - 4), offset))
    );
  }

  return number.length === 6;
}

// `т. е.` as `nowrap_ie` reads it and as it writes it back: its `т` is that abbreviation, no tonne.
const IE_TAIL_RE = new RegExp(`^\\.?[ ${G.NBSP}]?е\\.`, 'u');

// The surname a pair of dotted initials stands before: its first letter is no volt.
const INITIALS_AHEAD_RE = new RegExp(`^${DOTTED_INITIAL_PAIR}[А-ЯЁ][а-яё]`, 'u');

// A gram binds to its number, a city does not bind to the postal index set apart before it.
function bindWeight(m, ctx) {
  const [full, start, number, gap, unit, offset, source] = m;
  const end = offset + full.length;

  if (unboundNumber(m, ctx)) {
    return full;
  }
  if (
    gap !== undefined &&
    unit.toLowerCase() === 'т' &&
    IE_TAIL_RE.test(keptGlyphsAt(source, end, 4))
  ) {
    return full;
  }
  if (
    unit.toLowerCase() === 'г' &&
    CITY_AFTER_RE.test(source.slice(end, end + CITY_AFTER_REACH)) &&
    isPostalIndex(start, number, offset, source)
  ) {
    return gap === undefined ? `${start}${number} ${unit}` : full;
  }

  return `${start}${number}${G.NBSP}${unit}`;
}

// Read in place: the gaps of the shared pair may run on.
const INITIALS_BEFORE_GOST = new RegExp(`(?<=${CONTENT_START_GROUP}${DOTTED_INITIAL_PAIR})`, 'uy');

function isSurnameGost(m) {
  const at = m.at(-2) + m[1].length;
  const source = m.at(-1);
  INITIALS_BEFORE_GOST.lastIndex = at;
  return source.slice(at, at + 4) === 'Гост' && INITIALS_BEFORE_GOST.test(source);
}

const GOST_NUMBER = `\\d+(?:\\.\\d+|${G.NNBSP}\\d{3})*`;

const SUP_MAP = { 2: G.SUP2, 3: G.SUP3 };

// The abbreviation's own period doubles as the sentence period, so turning `руб.` into `₽` drops the
// only period the sentence had. It comes back exactly where the sentence ends.
function abbreviatedCurrency(symbol) {
  return (m) => {
    const [full, digit, dot, endTags, dash, offset, source] = m;
    const head = `${digit}${G.NBSP}${symbol}`;

    // The period is gone, so the sentence never ended here: the dash belongs to the amount before it.
    if (endTags !== undefined) {
      return `${head}${endTags}${G.NBSP}${dash} `;
    }

    const rest = source.slice(offset + full.length);

    return `${head}${dot === '.' && endsSentence(rest) ? '.' : ''}`;
  };
}

// An initial is a capital on its own: the one closing `ЖМ.` or the year mark of `2001Г.` or of a period
// `1951-2032 Г.` is not, and the wrapper or the `гг.` a later rule writes there would tell the next
// pass so. It is read through the end of the wrapper `nobr.nowrap_initials` closes behind it, or behind
// its letter before the period: `Ж</span>. Г.М`.
const INITIAL_BEFORE_LABEL = new RegExp(
  `(?<![\\p{L}\\d])(?<!\\d{4}[-${G.MDASH}${G.MINUS}${G.NDASH}]\\d{4}[ ${G.NBSP}]?)[А-ЯЁ](?:<\\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d{1,9}${CLOSE}>){0,2}\\.(?:<\\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d{1,9}${CLOSE}>){0,2}(?:[ \t${G.NBSP}]|${vaultedReference(G.NBSP)})?$`,
  'u'
);

// Inside a canonical no-break wrapper the gap is already unbreakable: `nobr.nowrap_initials` writes
// `Г. Р.` with a plain space after this rule bound it, and the next pass would bind it again.
function keepsGap(ctx, source, label, value, at, end) {
  const from = Math.max(0, at - 64);
  const previous = /^[А-ЯЁ]$/u.test(label) && INITIAL_BEFORE_LABEL.exec(source.slice(from, at));
  if (previous) {
    // A surname to the right completes this pair. A surname already claimed by two initials to
    // the left ends the name before this pair, leaving the location free to bind its own value.
    if (
      !/^[ДГШ]$/u.test(label) ||
      /^[А-ЯЁ][а-яё]+$/u.test(value) ||
      !followsCompleteName(ctx, source, from + previous.index)
    ) {
      return true;
    }
  } else if (source[at - 1] === '.') {
    return true;
  }
  return insideCanonicalNowrap(ctx, source, at, end);
}

function bindAbbreviation(m, ctx) {
  const [full, lead, label, , value, offset, source] = m;
  return keepsGap(ctx, source, label, value, offset + lead.length, offset + full.length)
    ? full
    : `${lead}${label}.${G.NBSP}${value}`;
}

// The same for a label whose left boundary and word are only looked at.
function bindLabel(m, ctx) {
  const [full, label, , value, offset, source] = m;
  return keepsGap(ctx, source, label, value, offset, offset + full.length + value.length)
    ? full
    : `${label}.${G.NBSP}`;
}

const ORGANIZATION_NUMBER_RE = /\+?\d/uy;

function bindOrganization(m, ctx) {
  const [full, label, offset, source] = m;
  const at = offset + full.length;
  if (ctx.html && source[at] === '<') {
    const body = canonicalNowrapContentStart(ctx, source, at);
    if (body !== -1) {
      ORGANIZATION_NUMBER_RE.lastIndex = body;
      if (ORGANIZATION_NUMBER_RE.test(source)) {
        return full;
      }
    }
  }
  return `${label}${G.NBSP}`;
}

function wrapPhrase(m, ctx, body) {
  const [full, lead, , end, offset, source] = m;
  const content = nowrap(ctx, body, source, offset + lead.length, offset + full.length);

  return `${lead}${content}${end !== '.' ? end : ''}`;
}

function wrapAbbreviation(m, ctx, tail) {
  const [full, lead, head, offset, source] = m;

  return `${lead}${nowrap(ctx, `${head}. ${tail}`, source, offset + lead.length, offset + full.length)}`;
}

export const abbrGroup = {
  title: 'Сокращения',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_dpi',
      requires: F.DIGIT | F.LATIN,
      description: 'Пробел перед сокращениями dpi, lpi',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(\\d+)( |\\t)*(dpi|lpi)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2${G.NBSP}$4`
    },
    // A glued abbreviation must release the number before the unit rules read it: `п.3 т`.
    {
      id: 'nbsp_short_acronym',
      requires: F.DIGIT | F.PERIOD,
      description: 'Пробел перед сокращениями гл., стр., рис., илл., ст., п.',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(${DOCUMENT_LABEL})\\.( |\\t)*(\\d+)${LABEL_NUMBER_END}`,
        'giu'
      ),
      replacement: bindAbbreviation
    },
    {
      id: 'nbsp_reference',
      requires: F.PERIOD,
      description: 'Пробел перед сокращениями см., им.',
      // `см` after a number is the unit, read as `г.` is read below: the number stands on its own,
      // not as the digit of `м2`, and is seen through the end of an element a later rule wraps it in.
      // The labels glued behind one at a left boundary, `им.им.о`, are bound with it: each period is
      // the left boundary of the next label, which the next pass would find once this one parts them.
      // The left boundary and the word are only looked at: the word may be the next label, `им. им. о`.
      pattern: new RegExp(
        `(?<=^|[${CONTENT_START}])((?<!(?:^|[^\\p{L}\\d])\\d+(?:${INLINE_END})*[ \\t${G.NBSP}]?)см|им)\\.((?:(?:см|им)\\.)*)( |\\t)*(?=[а-яё0-9a-z]+${CONTENT_END_LOOKAHEAD})`,
        'giu'
      ),
      replacement: ([, label, run]) => `${label}.${G.NBSP}${run.replaceAll('.', `.${G.NBSP}`)}`
    },
    {
      id: 'nbsp_location',
      requiresAny: F.PERIOD | F.DASH,
      requiresPattern: /(?:г|ул|пер|просп|пл|бул|наб|пр|ш|туп|д|кв|эт)\.|б-р|пр-кт/iu,
      description: 'Пробелы в сокращениях г., ул., пер., д.',
      pattern: [
        // Before a postal index `г.` is the city: case-sensitive, for the capital of its name. The gap
        // after the index may be a run, as a later rule binding the index leaves it one space.
        new RegExp(
          `(?<=(?:^|[^\\p{L}\\d])\\d{6}[ \\t${G.NBSP}]*)${CONTENT_START_GROUP}([гГ])\\.( |\\t)*([А-ЯЁA-Z][а-яёА-ЯЁa-zA-Z0-9]*)${CONTENT_END_LOOKAHEAD}`,
          'gu'
        ),
        // `г.` after a number on its line is a year or a gram, never a city. The number stands on its
        // own, not as the digit of a unit like `м2`, and is seen through the end of an element a later
        // rule wraps it in, or the next pass reads `г.` otherwise. The left boundary and the word are
        // only looked at: an initial `Г.` keeps its gap, and the word it leaves may be the next label,
        // `Р. Г. ул. Мира`, which a wrapper written around the initials later sets apart.
        new RegExp(
          `(?<=^|[.${CONTENT_START}])((?<!(?:^|[^\\p{L}\\d])\\d+(?:${INLINE_END})*[ \\t${G.NBSP}]*)г|${STREET_LABEL})\\.( |\\t)*(?=([а-яё0-9a-z]+)${LABEL_NUMBER_END})`,
          'giu'
        ),
        new RegExp(
          `${CONTENT_START_GROUP}(б-р|пр-кт)( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
          'giu'
        ),
        new RegExp(
          `(^|[.${CONTENT_START}])(${BUILDING_LABEL})\\.( |\\t)*(\\d+)${LABEL_NUMBER_END}`,
          'giu'
        )
      ],
      replacement: [bindAbbreviation, bindLabel, `$1$2${G.NBSP}$4`, bindAbbreviation]
    },
    {
      id: 'nbsp_currency_prefix',
      requires: F.DIGIT | F.MONEY,
      description: 'Привязка валюты к числу спереди: $100 → $ 100',
      // A sign behind its own number binds to the next one too, so a sum stays on one line:
      // `3 ₽ 20 коп.`.
      pattern: new RegExp(String.raw`([${CURRENCY_PREFIX_SIGNS}])\s?(\d)`, 'gu'),
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nbsp_unit',
      requires: F.DIGIT,
      description: 'Привязка размерных сокращений (длина, скорость)',
      pattern: [
        unitBind(LENGTH_UNITS),
        new RegExp(
          `${CONTENT_START_GROUP}(\\d+)( |${G.NBSP})?(${LENGTH_UNITS})([32]|[${G.SUP2}${G.SUP3}])${CONTENT_END_LOOKAHEAD}`,
          'giu'
        ),
        unitBind(SPEED_UNITS)
      ],
      replacement: [
        bindUnit,
        (m, ctx) => {
          const [, p1, p2, , p4, p5] = m;
          if (unboundNumber(m, ctx)) {
            return m[0];
          }
          return `${p1}${p2}${G.NBSP}${p4}${SUP_MAP[p5] ?? p5}`;
        },
        bindUnit
      ]
    },
    {
      id: 'nbsp_fraction_unit',
      requires: F.FRACTION | F.SPACE,
      description: 'Неразрывный пробел между дробью и единицей',
      pattern: new RegExp(
        `([${G.FRAC12}${G.FRAC14}${G.FRAC34}])( )(кг|мг|км|мм|см|дм|гм|г|м|т)(?![а-яё])`,
        'giu'
      ),
      replacement: `$1${G.NBSP}$3`
    },
    {
      id: 'nbsp_weight_unit',
      requires: F.DIGIT,
      description: 'Привязка весовых сокращений',
      pattern: unitBind(WEIGHT_UNITS),
      replacement: bindWeight
    },
    {
      id: 'nbsp_volume_unit',
      requires: F.DIGIT,
      description: 'Привязка мер объёма',
      pattern: unitBind(VOLUME_UNITS),
      replacement: bindUnit
    },
    {
      id: 'nbsp_time_unit',
      requires: F.DIGIT,
      description: 'Привязка мер времени',
      pattern: unitBind(TIME_UNITS),
      replacement: bindUnit
    },
    {
      id: 'nbsp_data_unit',
      requires: F.DIGIT,
      description: 'Неразрывный пробел перед единицами данных: 7 ГБ, 100 Мбит, 5 ТБ/с',
      // Alternation sorted longest-first so longer units win (Мбит before М).
      pattern: unitBind(DATA_UNITS, { flags: 'gu' }),
      replacement: bindUnit
    },
    {
      id: 'nbsp_frequency_unit',
      requiresAny: F.DIGIT | F.PERIOD | F.COMMA,
      requiresPattern: /гц|hz/iu,
      description: 'Неразрывный пробел перед частотами: 100 МГц, 2.4 ГГц',
      pattern: unitBind(FREQUENCY_UNITS, DECIMAL_UNIT),
      replacement: bindUnit
    },
    {
      id: 'nbsp_css_unit',
      requires: F.LATIN,
      requiresAny: F.DIGIT | F.PERIOD | F.COMMA,
      description: 'Неразрывный пробел перед CSS-единицами: 16 px, 1.5 em',
      pattern: unitBind(
        'px|pt|pc|em|rem|vh|vw|vmin|vmax|vi|vb|svh|svw|lvh|lvw|dvh|dvw|ch|ex|cap|ic|lh|rlh|fr|deg|rad|grad|turn|s|ms',
        DECIMAL_UNIT
      ),
      replacement: bindUnit
    },
    {
      id: 'nbsp_volt',
      requires: F.DIGIT,
      description: 'Сокращение «вольт»',
      // Lookbehind anchors the digit-run start to keep matching linear (avoids O(n^2) retries).
      pattern: VOLT_UNIT_RE,
      replacement: (m) => {
        const [full, number, , offset, source] = m;
        const letter = offset + full.length - 1;

        return phoneContextAt(source, offset) === 1 ||
          INITIALS_AHEAD_RE.test(keptGlyphsAt(source, letter, 64))
          ? full
          : `${number}${G.NBSP}В`;
      }
    },
    {
      id: 'nbsp_magnitude',
      requires: F.DIGIT,
      description: 'Неразрывный пробел между числом и величиной: 23тыс. → 23 тыс.',
      // Closed set only; (?![а-яё]) keeps it off full words like тысяча.
      pattern: new RegExp(`(\\d)(${MAGNITUDE})(?![а-яё])`, 'giu'),
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nowrap_postscript',
      requires: F.PERIOD | F.LATIN,
      description: 'P.S., P.P.S.',
      // A no-break space before it is a gap too: `nobr.nbsp_particle` hands it back as a space.
      pattern: new RegExp(`(^|[ \\t${G.NBSP}>\\r\\n])${postscript(' ?')}([^<])`, 'gu'),
      replacement: (m, ctx) => {
        const [full, p1, p2, p3, p4, p5] = m;
        const inner = `${p2.trim()} ${p3 ? `${p3.trim()} ` : ''}${p4}`;
        const start = m.at(-2) + p1.length;
        const end = m.at(-2) + full.length - p5.length;

        return `${p1}${nowrap(ctx, inner, m.at(-1), start, end)}${p5}`;
      }
    },
    {
      id: 'nowrap_etc',
      requires: F.SPACE,
      requiresPattern: /[ив][ \u{00A0}]т/u,
      description: 'и т. д., и т. п., в т. ч.',
      cycled: true,
      // Shared left boundary, like the measurement rules above, so `(и т. д.)` and `«и т. д.»` bind
      // as a bare `и т. д.` does.
      pattern: [
        new RegExp(`${WRAPPER_START_GROUP}и( |${G.NBSP})т\\.?[ ]?д(\\.|$|\\s)`, 'gu'),
        new RegExp(`${WRAPPER_START_GROUP}и( |${G.NBSP})т\\.?[ ]?п(\\.|$|\\s)`, 'gu'),
        new RegExp(`${WRAPPER_START_GROUP}в( |${G.NBSP})т\\.?[ ]?ч(\\.|$|\\s)`, 'gu'),
        // The phrase ends in a period, and `dash.em_after_sentence` reads a dash after it, through
        // the end of the wrapper too. Written as text, with no wrapper to close it, it also ends in
        // the `д.` `nbsp_location` and the `п.` `nbsp_short_acronym` bind a number to. They all run
        // before this rule, so the number binds and the dash takes the sentence form here, as after
        // a phrase typed out in full.
        new RegExp(`(и${G.NBSP}т\\.${G.NBSP}[дп]\\.)[ \\t]*(?=\\d+${CONTENT_END_LOOKAHEAD})`, 'gu'),
        new RegExp(
          `((?:и[ ${G.NBSP}]т\\.[ ${G.NBSP}][дп]|в[ ${G.NBSP}]т\\.[ ${G.NBSP}]ч)\\.(?:${INLINE_END})*)${DASH_IN_GAPS}`,
          'gu'
        )
      ],
      replacement: [
        (m, ctx) => wrapPhrase(m, ctx, 'и т. д.'),
        (m, ctx) => wrapPhrase(m, ctx, 'и т. п.'),
        (m, ctx) => wrapPhrase(m, ctx, 'в т. ч.'),
        `$1${G.NBSP}`,
        `$1${SENTENCE_DASH}`
      ]
    },
    {
      id: 'nowrap_ie',
      requires: F.PERIOD,
      description: 'т. е.',
      pattern: new RegExp(`${WRAPPER_START_GROUP}([тТ])\\.?[ ]?е\\.`, 'gu'),
      replacement: (m, ctx) => wrapAbbreviation(m, ctx, 'е.')
    },
    {
      id: 'nowrap_era',
      requires: F.PERIOD,
      description: 'до н. э. / н. э.',
      // `н. э.` behind a `до ` the rule left alone is that phrase's end, already in the wrapper the
      // whole phrase stands in.
      pattern: new RegExp(
        `${WRAPPER_START_GROUP}(?<!(?:^|[^\\p{L}])до )((?:до )?н)\\.?[ ]?э\\.`,
        'gu'
      ),
      replacement: (m, ctx) => wrapAbbreviation(m, ctx, 'э.')
    },
    {
      id: 'nbsp_honorific',
      requires: F.DASH | F.SPACE,
      description: 'г-н, г-жа',
      pattern: new RegExp(`${CONTENT_START_GROUP}([гГ])-(н|жа)( |${G.NBSP})`, 'gu'),
      replacement: `$1$2-$3${G.NBSP}`
    },
    {
      id: 'currency',
      requires: F.DIGIT,
      requiresPattern: new RegExp(`${CURRENCY_AMOUNT}${CURRENCY_GAP}[рде${G.RUB}${G.EURO}$]`, 'iu'),
      description: 'Нормализация словесной валюты в символ + неразрывный пробел: 100 руб. → 100 ₽',
      // Spelled-out forms first, so `долларов` is not eaten as `долл.`; the abbreviated forms follow
      // and carry their own period. The trailing `(?![а-яёa-z])` stops a match inside a longer word —
      // `руб.` in `рубероид`.
      pattern: [
        new RegExp(
          `${CURRENCY_AMOUNT}${CURRENCY_GAP}(?:рублями|рублях|рублям|рублей|рублём|рубле|рубля|рубль)(?![а-яёa-z])`,
          'giu'
        ),
        new RegExp(
          `${CURRENCY_AMOUNT}${CURRENCY_GAP}(?:руб|р)(\\.?)(?![а-яёa-z])(?:${SENTENCE_DASH_TAIL})?`,
          'giu'
        ),
        new RegExp(
          `${CURRENCY_AMOUNT}${CURRENCY_GAP}(?:долларами|долларах|долларам|долларов|долларе|доллару|доллара|доллар)(?![а-яёa-z])`,
          'giu'
        ),
        USD_ABBREVIATION_RE,
        new RegExp(
          `${CURRENCY_AMOUNT}${CURRENCY_GAP}долл(?!${USD_TAIL}(?![а-яёa-z]))(\\.?)(?![а-яёa-z])(?:${SENTENCE_DASH_TAIL})?`,
          'giu'
        ),
        new RegExp(`${CURRENCY_AMOUNT}${CURRENCY_GAP}евро(?![а-яёa-z])`, 'giu'),
        new RegExp(`(?<!%\\d{0,3})${CURRENCY_AMOUNT}${CURRENCY_GAP}([${G.RUB}${G.EURO}$])`, 'g')
      ],
      replacement: [
        `$1${G.NBSP}${G.RUB}`,
        abbreviatedCurrency(G.RUB),
        `$1${G.NBSP}$`,
        // `space.space_after_period` parts `долл.США` behind a space, and the no-break space written
        // here is one it reads on the next pass, so the parting is done here once.
        (m) => `${m[1]}${G.NBSP}${m[2].replace(GLUED_USA_RE, '$1. ')}`,
        abbreviatedCurrency('$'),
        `$1${G.NBSP}${G.EURO}`,
        `$1${G.NBSP}$2`
      ]
    },
    {
      id: 'nbsp_money_magnitude',
      requires: F.DIGIT,
      description: 'Денежные сокращения с тыс/млн/млрд + у.е.',
      pattern: new RegExp(
        `(\\d)(( |${G.NBSP})?(тыс|млн|млрд)\\.?( |${G.NBSP})?)?( |${G.NBSP})?${currencyUnit(' ?')}\\.?(?=\\s|[!?]|$)`,
        'giu'
      ),
      replacement: (m) => {
        const [, p1, , , p4] = m;
        const mid = p4 ? `${G.NBSP}${p4}${p4 === 'тыс' ? '.' : ''}` : '';

        return `${p1}${mid}${G.NBSP}у.е.`;
      }
    },
    {
      id: 'nbsp_organization',
      requires: F.SPACE,
      description: 'Привязка форм собственности (ООО, ЗАО, …)',
      pattern: new RegExp(
        `(?<![a-zA-Zа-яёА-ЯЁ])(${ORGANIZATION}) (?=[a-zA-Zа-яёА-ЯЁ"${G.LAQUO}${G.BDQUO}<])`,
        'gu'
      ),
      replacement: bindOrganization
    },
    {
      id: 'nowrap_gost',
      requires: F.DIGIT,
      requiresPattern: /гост/iu,
      description: 'ГОСТ + номер (case-insensitive — нормализуем регистр)',
      pattern: [
        // Not the hyphen that opens `-->`: `symbol.arrows` leaves that one, and turns the `->` taking
        // the hyphen would leave into an arrow on the next pass.
        new RegExp(
          `(\\s|^)ГОСТ( |${G.NBSP})?(${GOST_NUMBER})(([-${G.MINUS}${G.MDASH}${G.NDASH}])(\\d+))?(( |${G.NBSP})(-(?!->)|${G.MDASH}))?`,
          'giu'
        ),
        new RegExp(
          `(\\s|^|>)ГОСТ( |${G.NBSP})?(${GOST_NUMBER})([-${G.MINUS}${G.MDASH}${G.NDASH}])(\\d+)`,
          'giu'
        )
      ],
      replacement: [
        (m, ctx) => {
          const [, p1, , p3, , , p6, p7] = m;
          if (isSurnameGost(m)) {
            return m[0];
          }
          const inner = `ГОСТ ${p3}${p6 ? G.NDASH + p6 : ''}${p7 ? ` ${G.MDASH}` : ''}`;
          const start = m.at(-2) + p1.length;

          return `${p1}${nowrap(ctx, inner, m.at(-1), start, m.at(-2) + m[0].length)}`;
        },
        (m, ctx) => {
          if (isSurnameGost(m)) {
            return m[0];
          }
          const inner = `ГОСТ ${m[3]}${G.NDASH}${m[5]}`;
          const start = m.at(-2) + m[1].length;

          return `${m[1]}${ctx.html ? inner : nowrap(ctx, inner, m.at(-1), start, m.at(-2) + m[0].length)}`;
        }
      ]
    }
  ]
};
