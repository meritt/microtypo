import {
  CONTENT_END_LOOKAHEAD,
  CONTENT_START_GROUP,
  WRAPPER_START_GROUP
} from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { F } from '../lib/rule-features.js';
import {
  CLOSE,
  OPEN,
  TRANSPARENT_BARE_KINDS,
  TRANSPARENT_TAG_KINDS,
  vaultedReference
} from '../protect/placeholders.js';
import { DASH_IN_GAPS, INLINE_END, SENTENCE_DASH, SENTENCE_DASH_TAIL } from './dash.js';

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

// Every measurement rule is the same sentence: a number, an optional gap, a unit, bounded on both
// sides by the shared fragments. The leading class lets a number right after a dash, a comma or an
// opening bracket still bind to its unit; the trailing one must stay a lookahead, because consuming
// it strands the next unit in a series (`2 м 40 см`).
const unitBind = (units, { number = '(\\d+)', flags = 'giu' } = {}) =>
  new RegExp(
    `${CONTENT_START_GROUP}${number}( |${G.NBSP})?(${units})${CONTENT_END_LOOKAHEAD}`,
    flags
  );

const BIND_UNIT = `$1$2${G.NBSP}$4`;

// `долл. США` is read through Markdown emphasis on `США` and through the end of the no-break wrapper
// a rerun finds closed after `долл`, `ГОСТ 7 долл</span>. США`.
const USD_ABBREVIATION_RE = new RegExp(
  String.raw`(\d) ?(долл(?:<\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\d{1,9}${CLOSE}>)?\.[ *_~]{0,4}США)(?![а-яёa-z])`,
  'giu'
);

const GLUED_USA_RE = /^(долл)\.(?=США)/iu;

// Six digits on their own before `г.` and a capitalised name are a postal index, and `г.` the city of
// the address it opens: `125009 г. Москва`. The next pass reads the index grouped by
// `other.split_triads`, `125 009`, and has to see the same index, in XML through the reference the
// space after `г.` is written as.
const CITY_GAP = `(?:[ \\t${G.NBSP}]|${vaultedReference(G.NBSP)})`;
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

// A gram binds to its number, a city does not bind to the postal index set apart before it.
function bindWeight(m) {
  const [full, start, number, gap, unit, offset, source] = m;
  const end = offset + full.length;

  if (
    gap !== undefined &&
    unit.toLowerCase() === 'г' &&
    CITY_AFTER_RE.test(source.slice(end, end + CITY_AFTER_REACH)) &&
    isPostalIndex(start, number, offset, source)
  ) {
    return full;
  }

  return `${start}${number}${G.NBSP}${unit}`;
}

// Decimal units anchor the digit-run start with a lookbehind to keep matching linear (avoids O(n^2)
// retries), and stay case-sensitive so `PX` and `ГЦ` are not units.
const DECIMAL_UNIT = { number: '(?<![\\d.,])([\\d.,]+)', flags: 'gu' };

const SUP_MAP = { 2: G.SUP2, 3: G.SUP3 };

// The abbreviation's own period doubles as the sentence period, so turning `руб.` into `₽` drops the
// only period the sentence had. It comes back exactly where the sentence ends.
function abbreviatedCurrency(symbol) {
  return (m) => {
    const [full, digit, dot, endTags, offset, source] = m;
    const head = `${digit}${G.NBSP}${symbol}`;

    // The period is gone, so the sentence never ended here: the dash belongs to the amount before it.
    if (endTags !== undefined) {
      return `${head}${endTags}${G.NBSP}${G.MDASH} `;
    }

    const rest = source.slice(offset + full.length);

    return `${head}${dot === '.' && endsSentence(rest) ? '.' : ''}`;
  };
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
        `${CONTENT_START_GROUP}(гл|стр|рис|илл?|ст|п|с)\\.( |\\t)*(\\d+)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2.${G.NBSP}$4`
    },
    {
      id: 'nbsp_reference',
      requires: F.PERIOD,
      description: 'Пробел перед сокращениями см., им.',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(см|им)\\.( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2.${G.NBSP}$4`
    },
    {
      id: 'nbsp_location',
      requiresAny: F.PERIOD | F.DASH,
      description: 'Пробелы в сокращениях г., ул., пер., д.',
      pattern: [
        // Before a postal index `г.` is the city: case-sensitive, for the capital of its name.
        new RegExp(
          `(?<=(?:^|[^\\p{L}\\d])\\d{6})${CONTENT_START_GROUP}([гГ])\\.( |\\t)*([А-ЯЁA-Z][а-яёА-ЯЁa-zA-Z0-9]*)${CONTENT_END_LOOKAHEAD}`,
          'gu'
        ),
        // `г.` after a number on its line is a year or a gram, never a city. The number stands on its
        // own, not as the digit of a unit like `м2`, and is seen through the end of an element a later
        // rule wraps it in, or the next pass reads `г.` otherwise.
        new RegExp(
          `${CONTENT_START_GROUP}((?<!(?:^|[^\\p{L}\\d])\\d+(?:<\\/${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d+${CLOSE}>)*[ \\t${G.NBSP}]*)г|ул|пер|просп|пл|бул|наб|пр|ш|туп)\\.( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
          'giu'
        ),
        new RegExp(
          `${CONTENT_START_GROUP}(б-р|пр-кт)( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
          'giu'
        ),
        new RegExp(
          `${CONTENT_START_GROUP}(д|кв|эт)\\.( |\\t)*(\\d+)${CONTENT_END_LOOKAHEAD}`,
          'giu'
        )
      ],
      replacement: [`$1$2.${G.NBSP}$4`, `$1$2.${G.NBSP}$4`, `$1$2${G.NBSP}$4`, `$1$2.${G.NBSP}$4`]
    },
    {
      id: 'nbsp_unit',
      requires: F.DIGIT,
      description: 'Привязка размерных сокращений (длина, скорость)',
      pattern: [
        unitBind('м|мм|см|дм|км|гм|km|dm|cm|mm'),
        new RegExp(
          `${CONTENT_START_GROUP}(\\d+)( |${G.NBSP})?(м|мм|см|дм|км|гм|km|dm|cm|mm)([32]|[${G.SUP2}${G.SUP3}])${CONTENT_END_LOOKAHEAD}`,
          'giu'
        ),
        unitBind('(?:мм|см|дм|км|гм|м)\\/(?:с|ч|мин|сут)')
      ],
      replacement: [
        BIND_UNIT,
        (m) => {
          const [, p1, p2, , p4, p5] = m;

          return `${p1}${p2}${G.NBSP}${p4}${SUP_MAP[p5] ?? p5}`;
        },
        BIND_UNIT
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
      pattern: unitBind('г|кг|мг|т'),
      replacement: bindWeight
    },
    {
      id: 'nbsp_volume_unit',
      requires: F.DIGIT,
      description: 'Привязка мер объёма',
      pattern: unitBind('мл|л'),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_time_unit',
      requires: F.DIGIT,
      description: 'Привязка мер времени',
      pattern: unitBind('мин|ч'),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_data_unit',
      requires: F.DIGIT,
      description: 'Неразрывный пробел перед единицами данных: 7 ГБ, 100 Мбит, 5 ТБ/с',
      // Alternation sorted longest-first so longer units win (Мбит before М).
      pattern: unitBind(
        '(?:Кбит|кбит|Мбит|мбит|Гбит|гбит|Тбит|kbit|Mbit|Gbit|Tbit|Kbps|Mbps|Gbps|kbps|mbps|gbps|KiB|MiB|GiB|TiB|кБ|КБ|МБ|Мб|ГБ|Гб|ТБ|Тб|ПБ|kB|KB|MB|GB|TB|PB|бит|Б|B)(?:\\/[сs])?',
        { flags: 'gu' }
      ),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_frequency_unit',
      requiresAny: F.DIGIT | F.PERIOD | F.COMMA,
      description: 'Неразрывный пробел перед частотами: 100 МГц, 2.4 ГГц',
      pattern: unitBind('(?:к|М|Г|Т)?Гц|(?:k|M|G|T)?Hz', DECIMAL_UNIT),
      replacement: BIND_UNIT
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
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_volt',
      requires: F.DIGIT,
      description: 'Сокращение «вольт»',
      // Lookbehind anchors the digit-run start to keep matching linear (avoids O(n^2) retries).
      pattern: new RegExp(`(?<!\\d)(\\d+)([вВ]| В)${CONTENT_END_LOOKAHEAD}`, 'gu'),
      replacement: `$1${G.NBSP}В`
    },
    {
      id: 'nbsp_magnitude',
      requires: F.DIGIT,
      description: 'Неразрывный пробел между числом и величиной: 23тыс. → 23 тыс.',
      // Closed set only; (?![а-яё]) keeps it off full words like тысяча.
      pattern: /(\d)(млрд|трлн|млн|тыс)(?![а-яё])/giu,
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nowrap_postscript',
      requires: F.PERIOD | F.LATIN,
      description: 'P.S., P.P.S.',
      pattern: /(^| |\t|>|\r|\n)(p\. ?)(p\. ?)?(s\.)([^<])/gi,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4, p5] = m;
        const inner = `${p2.trim()} ${p3 ? `${p3.trim()} ` : ''}${p4}`;

        return `${p1}${ctx.tag(inner, 'span', { class: 'nowrap' })}${p5}`;
      }
    },
    {
      id: 'nowrap_etc',
      requires: F.SPACE,
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
        (m, ctx) =>
          `${m[1]}${ctx.tag('и т. д.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag('и т. п.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag('в т. ч.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`,
        `$1${G.NBSP}`,
        `$1${SENTENCE_DASH}`
      ]
    },
    {
      id: 'nowrap_ie',
      requires: F.PERIOD,
      description: 'т. е.',
      pattern: new RegExp(`${WRAPPER_START_GROUP}([тТ])\\.?[ ]?е\\.`, 'gu'),
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. е.`, 'span', { class: 'nowrap' })}`
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
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. э.`, 'span', { class: 'nowrap' })}`
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
      description: 'Нормализация словесной валюты в символ + неразрывный пробел: 100 руб. → 100 ₽',
      // Spelled-out forms first, so `долларов` is not eaten as `долл.`; the abbreviated forms follow
      // and carry their own period. The trailing `(?![а-яёa-z])` stops a match inside a longer word —
      // `руб.` in `рубероид`.
      pattern: [
        /(\d) ?(?:рублями|рублях|рублям|рублей|рублём|рубле|рубля|рубль)(?![а-яёa-z])/giu,
        new RegExp(`(\\d) ?(?:руб|р)(\\.?)(?![а-яёa-z])(?:${SENTENCE_DASH_TAIL})?`, 'giu'),
        /(\d) ?(?:долларами|долларах|долларам|долларов|долларе|доллару|доллара|доллар)(?![а-яёa-z])/giu,
        USD_ABBREVIATION_RE,
        new RegExp(`(\\d) ?долл(\\.?)(?![а-яёa-z])(?:${SENTENCE_DASH_TAIL})?`, 'giu'),
        /(\d) ?евро(?![а-яёa-z])/giu,
        /(?<!%\d{0,3})(\d) ?([₽€$])/g
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
      pattern:
        /(\d)(( |\u{00A0})?(тыс|млн|млрд)\.?( |\u{00A0})?)?( |\u{00A0})?у\.? ?е\.?(?=\s|$)/giu,
      replacement: (m) => {
        const [, p1, , , p4] = m;
        const mid = p4 ? `${G.NBSP}${p4}${p4 === 'тыс' ? '.' : ''}` : '';

        return `${p1}${mid}${G.NBSP}у.е.`;
      }
    },
    {
      id: 'nbsp_currency_prefix',
      requires: F.DIGIT | F.MONEY,
      description: 'Привязка валюты к числу спереди: $100 → $ 100',
      // A sign behind a number belongs to it, read through the tags a wrapped number closes and
      // through the no-break space as the reference XML writes it.
      pattern: new RegExp(
        String.raw`(?<!\d(?:<\/${OPEN}[A-Za-z]\d{1,9}${CLOSE}>){0,2}(?:[ ${G.NBSP}]|${vaultedReference(G.NBSP)})?)(${G.EURO}|\$|${G.RUB})\s?(\d)`,
        'gu'
      ),
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nbsp_organization',
      requires: F.SPACE,
      description: 'Привязка форм собственности (ООО, ЗАО, …)',
      pattern: /(?<![a-zA-Zа-яёА-ЯЁ])(ООО|ЗАО|ОАО|НИИ|ПБОЮЛ) (?=[a-zA-Zа-яёА-ЯЁ"«„<])/gu,
      replacement: `$1${G.NBSP}`
    },
    {
      id: 'nowrap_gost',
      requires: F.DIGIT,
      description: 'ГОСТ + номер (case-insensitive — нормализуем регистр)',
      pattern: [
        /( |\t|\u{00A0}|^)ГОСТ( |\u{00A0})?(\d+(?:\.\d+)*)(([-−—–])(\d+))?(( |\u{00A0})([-—]))?/giu,
        /( |\t|\u{00A0}|^|>)ГОСТ( |\u{00A0})?(\d+(?:\.\d+)*)([-−—–])(\d+)/giu
      ],
      replacement: [
        (m, ctx) => {
          const [, p1, , p3, , , p6, p7] = m;
          const inner = `ГОСТ ${p3}${p6 ? G.NDASH + p6 : ''}${p7 ? ` ${G.MDASH}` : ''}`;

          return `${p1}${ctx.tag(inner, 'span', { class: 'nowrap' })}`;
        },
        (m) => `${m[1]}ГОСТ ${m[3]}${G.NDASH}${m[5]}`
      ]
    }
  ]
};
