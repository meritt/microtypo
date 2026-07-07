import { G } from '../lib/glyphs.js';

export const abbrGroup = {
  title: 'Сокращения',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_dpi',
      description: 'Пробел перед сокращениями dpi, lpi',
      pattern: /((?<!\s)\s+|^|>)(\d+)( |\t)*(dpi|lpi)([\s;.?!:(]|$)/gi,
      replacement: `$1$2${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_short_acronym',
      description: 'Пробел перед сокращениями гл., стр., рис., илл., ст., п.',
      pattern: /(\s|^|>|\()(гл|стр|рис|илл?|ст|п|с)\.( |\t)*(\d+)([\u{00A0}\s.,?!]|$)/giu,
      replacement: `$1$2.${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_reference',
      description: 'Пробел перед сокращениями см., им.',
      pattern: /(\s|^|>|\()(см|им)\.( |\t)*([а-яё0-9a-z]+)(\s|\.|,|\?|!|$)/giu,
      replacement: `$1$2.${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_location',
      description: 'Пробелы в сокращениях г., ул., пер., д.',
      pattern: [
        /(\s|^|>)(г|ул|пер|просп|пл|бул|наб|пр|ш|туп)\.( |\t)*([а-яё0-9a-z]+)(\s|\.|,|\?|!|$)/giu,
        /(\s|^|>)(б-р|пр-кт)( |\t)*([а-яё0-9a-z]+)(\s|\.|,|\?|!|$)/giu,
        /(\s|^|>)(д|кв|эт)\.( |\t)*(\d+)(\s|\.|,|\?|!|$)/giu
      ],
      replacement: [`$1$2.${G.NBSP}$4$5`, `$1$2${G.NBSP}$4$5`, `$1$2.${G.NBSP}$4$5`]
    },
    {
      id: 'nbsp_unit',
      description: 'Привязка размерных сокращений (длина, скорость)',
      // Dash-family chars belong in the leading class: a number right after a dash still binds to its unit.
      // Trailing boundary must stay a lookahead: consuming it strands the next unit in a series (2 м 40 см).
      pattern: [
        /(\s|^|>|,|[-−—–])(\d+)( |\u{00A0})?(м|мм|см|дм|км|гм|km|dm|cm|mm)(?=[\s.!?,±;<]|$)/giu,
        /(\s|^|>|,|[-−—–])(\d+)( |\u{00A0})?(м|мм|см|дм|км|гм|km|dm|cm|mm)([32]|[²³])(?=[\s.!?,±;<]|$)/giu,
        /(\s|^|>|,|[-−—–])(\d+)( |\u{00A0})?((?:мм|см|дм|км|гм|м)\/(?:с|ч|мин|сут))(?=[\s.!?,;<]|$)/giu
      ],
      replacement: [
        `$1$2${G.NBSP}$4`,
        (m) => {
          const [, p1, p2, , p4, p5] = m;
          const SUP_MAP = { 2: G.SUP2, 3: G.SUP3 };
          const sup = SUP_MAP[p5] ?? p5;

          return `${p1}${p2}${G.NBSP}${p4}${sup}`;
        },
        `$1$2${G.NBSP}$4`
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
      pattern: /(\s|^|>|\u{00A0}|,|[-−—–])(\d+)( |\u{00A0})?(г|кг|мг|т)(?=[\s.!?,;\u{00A0}]|$)/giu,
      replacement: `$1$2${G.NBSP}$4`
    },
    {
      id: 'nbsp_data_unit',
      description: 'Неразрывный пробел перед единицами данных: 7 ГБ, 100 Мбит, 5 ТБ/с',
      // Alternation sorted longest-first so longer units win (Мбит before М).
      pattern:
        /(\s|^|>|,|[-−—–])(\d+)( |\u{00A0})?((?:Кбит|кбит|Мбит|мбит|Гбит|гбит|Тбит|kbit|Mbit|Gbit|Tbit|Kbps|Mbps|Gbps|kbps|mbps|gbps|KiB|MiB|GiB|TiB|кБ|КБ|МБ|Мб|ГБ|Гб|ТБ|Тб|ПБ|kB|KB|MB|GB|TB|PB|бит|Б|B)(?:\/[сs])?)([\s.,!?;<]|$)/gu,
      replacement: `$1$2${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_frequency_unit',
      description: 'Неразрывный пробел перед частотами: 100 МГц, 2.4 ГГц',
      // Lookbehind anchors the digit-run start to keep matching linear (avoids O(n^2) retries).
      pattern:
        /(\s|^|>|,|[-−—–])(?<![\d.,])([\d.,]+)( |\u{00A0})?((?:к|М|Г|Т)?Гц|(?:k|M|G|T)?Hz)([\s.,!?;<]|$)/gu,
      replacement: `$1$2${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_css_unit',
      description: 'Неразрывный пробел перед CSS-единицами: 16 px, 1.5 em',
      // Non-letter terminator so it can't fire inside words like 15emoji.
      pattern:
        /(\s|^|>|,|[-−—–])(?<![\d.,])([\d.,]+)( |\u{00A0})?(px|pt|pc|em|rem|vh|vw|vmin|vmax|vi|vb|svh|svw|lvh|lvw|dvh|dvw|ch|ex|cap|ic|lh|rlh|fr|deg|rad|grad|turn|s|ms)([\s.,!?;<%]|$)/gu,
      replacement: `$1$2${G.NBSP}$4$5`
    },
    {
      id: 'nbsp_volt',
      description: 'Сокращение «вольт»',
      // Lookbehind anchors the digit-run start to keep matching linear (avoids O(n^2) retries).
      pattern: /(?<!\d)(\d+)([вВ]| В)([\s.,!?]|$)/gu,
      replacement: `$1${G.NBSP}В$3`
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
      pattern: [
        /(^|\s|\u{00A0})и( |\u{00A0})т\.?[ ]?д(\.|$|\s|\u{00A0})/gu,
        /(^|\s|\u{00A0})и( |\u{00A0})т\.?[ ]?п(\.|$|\s|\u{00A0})/gu,
        /(^|\s|\u{00A0})в( |\u{00A0})т\.?[ ]?ч(\.|$|\s|\u{00A0})/gu
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
      pattern: /(^|\s|\u{00A0})([тТ])\.?[ ]?е\./gu,
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. е.`, 'span', { class: 'nowrap' })}`
    },
    {
      id: 'nowrap_era',
      description: 'до н. э. / н. э.',
      pattern: /(^|\s|\u{00A0})((?:до )?н)\.?[ ]?э\./gu,
      replacement: (m, ctx) => `${m[1]}${ctx.tag(`${m[2]}. э.`, 'span', { class: 'nowrap' })}`
    },
    {
      id: 'nbsp_honorific',
      description: 'г-н, г-жа',
      pattern: /(^|\s|\u{00A0})([гГ])-(н|жа)( |\u{00A0})/gu,
      replacement: `$1$2-$3${G.NBSP}`
    },
    {
      id: 'currency',
      description: 'Нормализация словесной валюты в символ + неразрывный пробел: 100 руб. → 100 ₽',
      // Longest alternations first so долларов isn't eaten as долл.
      // Trailing (?![а-яёa-z]) stops matches inside longer words (руб. in рубероид).
      pattern: [
        /(\d) ?(?:рублями|рублях|рублям|рублей|рублём|рубле|рубля|рубль|руб\.?|р\.|р)(?![а-яёa-z])/giu,
        /(\d) ?(?:долларами|долларах|долларам|долларов|долларе|доллару|доллара|доллар|долл\.?)(?![а-яёa-z])/giu,
        /(\d) ?евро(?![а-яёa-z])/giu,
        /(\d) ?([₽€$])/g
      ],
      replacement: [`$1${G.NBSP}${G.RUB}`, `$1${G.NBSP}$`, `$1${G.NBSP}${G.EURO}`, `$1${G.NBSP}$2`]
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
