import {
  CONTENT_END_LOOKAHEAD,
  CONTENT_START_GROUP,
  WRAPPER_START_GROUP
} from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import {
  CLOSE,
  OPEN,
  TRANSPARENT_BARE_KINDS,
  TRANSPARENT_TAG_KINDS
} from '../protect/placeholders.js';
import { SENTENCE_DASH } from './dash.js';

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

// Decimal units anchor the digit-run start with a lookbehind to keep matching linear (avoids O(n^2)
// retries), and stay case-sensitive so `PX` and `ГЦ` are not units.
const DECIMAL_UNIT = { number: '(?<![\\d.,])([\\d.,]+)', flags: 'gu' };

const SUP_MAP = { 2: G.SUP2, 3: G.SUP3 };

// The abbreviation's own period doubles as the sentence period, so turning `руб.` into `₽` drops the
// only period the sentence had. It comes back exactly where the sentence ends.
function abbreviatedCurrency(symbol) {
  return (m) => {
    const [full, digit, dot, tail, offset, source] = m;
    const head = `${digit}${G.NBSP}${symbol}`;

    // The period is gone, so the sentence never ended here: the dash belongs to the amount before it.
    if (tail) {
      return `${head}${G.NBSP}${G.MDASH} `;
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
      description: 'Пробел перед сокращениями dpi, lpi',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(\\d+)( |\\t)*(dpi|lpi)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2${G.NBSP}$4`
    },
    // The three rules below share the measurement rules' boundaries for the same reason: openers and
    // closers have to be there, or `(гл. 5)`, `«ул. Ардена»` and `гл. 5;` get no binding while a bare
    // `гл. 5` does. The trailing lookahead is what keeps a run — `гл. 5 гл. 7` — from consuming the
    // space the second one needs.
    {
      id: 'nbsp_short_acronym',
      description: 'Пробел перед сокращениями гл., стр., рис., илл., ст., п.',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(гл|стр|рис|илл?|ст|п|с)\\.( |\\t)*(\\d+)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2.${G.NBSP}$4`
    },
    {
      id: 'nbsp_reference',
      description: 'Пробел перед сокращениями см., им.',
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(см|им)\\.( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
        'giu'
      ),
      replacement: `$1$2.${G.NBSP}$4`
    },
    {
      id: 'nbsp_location',
      description: 'Пробелы в сокращениях г., ул., пер., д.',
      pattern: [
        new RegExp(
          `${CONTENT_START_GROUP}(г|ул|пер|просп|пл|бул|наб|пр|ш|туп)\\.( |\\t)*([а-яё0-9a-z]+)${CONTENT_END_LOOKAHEAD}`,
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
      replacement: [`$1$2.${G.NBSP}$4`, `$1$2${G.NBSP}$4`, `$1$2.${G.NBSP}$4`]
    },
    {
      id: 'nbsp_unit',
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
      description: 'Неразрывный пробел между дробью и единицей',
      pattern: new RegExp(
        `([${G.FRAC12}${G.FRAC14}${G.FRAC34}])( )(кг|мг|км|мм|см|дм|гм|г|м|т)(?![а-яё])`,
        'giu'
      ),
      replacement: `$1${G.NBSP}$3`
    },
    {
      id: 'nbsp_weight_unit',
      description: 'Привязка весовых сокращений',
      pattern: unitBind('г|кг|мг|т'),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_volume_unit',
      description: 'Привязка мер объёма',
      pattern: unitBind('мл|л'),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_time_unit',
      description: 'Привязка мер времени',
      pattern: unitBind('мин|ч'),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_data_unit',
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
      description: 'Неразрывный пробел перед частотами: 100 МГц, 2.4 ГГц',
      pattern: unitBind('(?:к|М|Г|Т)?Гц|(?:k|M|G|T)?Hz', DECIMAL_UNIT),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_css_unit',
      description: 'Неразрывный пробел перед CSS-единицами: 16 px, 1.5 em',
      pattern: unitBind(
        'px|pt|pc|em|rem|vh|vw|vmin|vmax|vi|vb|svh|svw|lvh|lvw|dvh|dvw|ch|ex|cap|ic|lh|rlh|fr|deg|rad|grad|turn|s|ms',
        DECIMAL_UNIT
      ),
      replacement: BIND_UNIT
    },
    {
      id: 'nbsp_volt',
      description: 'Сокращение «вольт»',
      // Lookbehind anchors the digit-run start to keep matching linear (avoids O(n^2) retries).
      pattern: new RegExp(`(?<!\\d)(\\d+)([вВ]| В)${CONTENT_END_LOOKAHEAD}`, 'gu'),
      replacement: `$1${G.NBSP}В`
    },
    {
      id: 'nbsp_magnitude',
      description: 'Неразрывный пробел между числом и величиной: 23тыс. → 23 тыс.',
      // Closed set only; (?![а-яё]) keeps it off full words like тысяча.
      pattern: /(\d)(млрд|трлн|млн|тыс)(?![а-яё])/giu,
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nowrap_postscript',
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
      description: 'и т. д., и т. п., в т. ч.',
      cycled: true,
      // Shared left boundary, like the measurement rules above, so `(и т. д.)` and `«и т. д.»` bind
      // as a bare `и т. д.` does.
      pattern: [
        new RegExp(`${WRAPPER_START_GROUP}и( |${G.NBSP})т\\.?[ ]?д(\\.|$|\\s)`, 'gu'),
        new RegExp(`${WRAPPER_START_GROUP}и( |${G.NBSP})т\\.?[ ]?п(\\.|$|\\s)`, 'gu'),
        new RegExp(`${WRAPPER_START_GROUP}в( |${G.NBSP})т\\.?[ ]?ч(\\.|$|\\s)`, 'gu')
      ],
      replacement: [
        (m, ctx) =>
          `${m[1]}${ctx.tag('и т. д.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag('и т. п.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag('в т. ч.', 'span', { class: 'nowrap' })}${m[3] !== '.' ? m[3] : ''}`
      ]
    },
    {
      id: 'nowrap_ie',
      description: 'т. е.',
      pattern: new RegExp(`${WRAPPER_START_GROUP}([тТ])\\.?[ ]?е\\.`, 'gu'),
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. е.`, 'span', { class: 'nowrap' })}`
    },
    {
      id: 'nowrap_era',
      description: 'до н. э. / н. э.',
      pattern: new RegExp(`${WRAPPER_START_GROUP}((?:до )?н)\\.?[ ]?э\\.`, 'gu'),
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. э.`, 'span', { class: 'nowrap' })}`
    },
    {
      id: 'nbsp_honorific',
      description: 'г-н, г-жа',
      pattern: new RegExp(`${CONTENT_START_GROUP}([гГ])-(н|жа)( |${G.NBSP})`, 'gu'),
      replacement: `$1$2-$3${G.NBSP}`
    },
    {
      id: 'currency',
      description: 'Нормализация словесной валюты в символ + неразрывный пробел: 100 руб. → 100 ₽',
      // Spelled-out forms first, so `долларов` is not eaten as `долл.`; the abbreviated forms follow
      // and carry their own period. The trailing `(?![а-яёa-z])` stops a match inside a longer word —
      // `руб.` in `рубероид`.
      pattern: [
        /(\d) ?(?:рублями|рублях|рублям|рублей|рублём|рубле|рубля|рубль)(?![а-яёa-z])/giu,
        new RegExp(`(\\d) ?(?:руб|р)(\\.?)(?![а-яёa-z])(${SENTENCE_DASH})?`, 'giu'),
        /(\d) ?(?:долларами|долларах|долларам|долларов|долларе|доллару|доллара|доллар)(?![а-яёa-z])/giu,
        new RegExp(`(\\d) ?долл(\\.?)(?![а-яёa-z])(${SENTENCE_DASH})?`, 'giu'),
        /(\d) ?евро(?![а-яёa-z])/giu,
        /(\d) ?([₽€$])/g
      ],
      replacement: [
        `$1${G.NBSP}${G.RUB}`,
        abbreviatedCurrency(G.RUB),
        `$1${G.NBSP}$`,
        abbreviatedCurrency('$'),
        `$1${G.NBSP}${G.EURO}`,
        `$1${G.NBSP}$2`
      ]
    },
    {
      id: 'nbsp_money_magnitude',
      description: 'Денежные сокращения с тыс/млн/млрд + у.е.',
      pattern:
        /(\d)(( |\u{00A0})?(тыс|млн|млрд)\.?( |\u{00A0})?)?( |\u{00A0})?(у\.? ?е\.?(\s|$))/giu,
      replacement: (m) => {
        const [, p1, , , p4, , , p7] = m;
        const mid = p4 ? `${G.NBSP}${p4}${p4 === 'тыс' ? '.' : ''}` : '';
        const isUe = /^у\.? ?е\.?/iu.test(p7);
        const tail = isUe ? 'у.е.' : p7;

        return `${p1}${mid}${G.NBSP}${tail}`;
      }
    },
    {
      id: 'nbsp_currency_prefix',
      description: 'Привязка валюты к числу спереди: $100 → $ 100',
      pattern: /(€|\$|₽)\s?(\d)/gu,
      replacement: `$1${G.NBSP}$2`
    },
    {
      id: 'nbsp_organization',
      description: 'Привязка форм собственности (ООО, ЗАО, …)',
      pattern: /([^a-zA-Zа-яёА-ЯЁ]|^)(ООО|ЗАО|ОАО|НИИ|ПБОЮЛ) ([a-zA-Zа-яёА-ЯЁ]|"|«|„|<)/gu,
      replacement: `$1$2${G.NBSP}$3`
    },
    {
      id: 'nowrap_gost',
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
