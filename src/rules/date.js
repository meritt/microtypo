import { G } from '../lib/glyphs.js';
import { F } from '../lib/rule-features.js';

// A date with its year mark, `12.05.20г` or `12.05.2020 г.`. Only the mark is taken, with a period
// set apart from it (`г .`), which is the mark's own: the space around it is looked at and left as
// written, so it still starts the next date.
const DATE_YEAR_RE =
  /(?<=^|\s)([0-9]{2}\.[0-9]{2}\.(?:[0-9]{2})?[0-9]{2})[ \t\u{00A0}]?г(?:[ \t\u{00A0}]*\.|(?=\s))/giu;

// `nowrap_date` wraps a date in its own turn, after the quote, dash, space and binding groups, and to
// them a `г` glued to the date is a word of its own; the next pass would read `12.05.20 г.` instead.
// The engine settles the mark before every group, past inline markup as the group's rules read.
export const YEAR_MARKS = {
  id: 'settle_year_marks',
  budgetStage: 'group:date',
  requires: F.DIGIT | F.PERIOD | F.CYRILLIC,
  apply: (text) => text.replace(DATE_YEAR_RE, `$1${G.NBSP}г.`)
};

export const dateGroup = {
  title: 'Даты и дни',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'year_range',
      requires: F.DIGIT | F.DASH | F.SPACE,
      requiresPattern: /\d{4}[-—−–]\d{4}/u,
      description: 'Тире и неразрывные пробелы в периодах дат',
      pattern:
        /(с|по|период|середины|начала|начало|конца|конец|половины|в|между|\([cс]\)|©)(\s+)(\d{4})([-—−–])(\d{4})(( |\u{00A0})?(г\.г\.|гг\.|гг|г\.|г)(?![а-яёa-z]))?/giu,
      replacement: (m) => {
        const [, p1, p2, p3, p4, p5, p6] = m;

        const range =
          Number.parseInt(p3, 10) >= Number.parseInt(p5, 10)
            ? `${p3}${p4}${p5}`
            : `${p3}${G.NDASH}${p5}`;

        return `${p1}${p2}${range}${p6 ? `${G.NBSP}гг.` : ''}`;
      }
    },
    {
      id: 'month_range',
      requires: F.DASH,
      requiresPattern: /-/u,
      description: 'Среднее тире между периодами месяцев',
      pattern:
        /(?<![а-яёa-z])((январ|феврал|сентябр|октябр|ноябр|декабр)([ьяюе]|[её]м)|(апрел|июн|июл)([ьяюе]|ем)|(март|август)([ауе]|ом)?|ма[йяюе]|маем)-((январ|феврал|сентябр|октябр|ноябр|декабр)([ьяюе]|[её]м)|(апрел|июн|июл)([ьяюе]|ем)|(март|август)([ауе]|ом)?|ма[йяюе]|маем)(?![а-яёa-z])/giu,
      replacement: `$1${G.NDASH}$8`
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
      requires: F.DIGIT | F.DASH | F.SPACE,
      description: 'Тире и неразрывные периоды дней',
      enabled: false,
      pattern:
        /([^>]|^)(\d+)([-−—–])(\d+)( |\u{00A0})(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)([^<]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, , p4, , p6, p7] = m;

        return `${p1}${ctx.tag(`${p2}${G.MDASH}${p4} ${p6}`, 'span', { class: 'nowrap' })}${p7}`;
      }
    },
    {
      id: 'nowrap_date',
      requires: F.DIGIT | F.PERIOD,
      requiresPattern: /[0-9]{2}\.[0-9]{2}\./u,
      description: 'Привязка года к дате',
      pattern: [
        DATE_YEAR_RE,
        /(\s|\u{00A0})([0-9]{2}\.[0-9]{2}\.([0-9]{2})?[0-9]{2})(\s|\u{00A0}|\.(\s|\u{00A0}|$)|$)/giu
      ],
      replacement: [
        (m, ctx) => ctx.tag(`${m[1]} г.`, 'span', { class: 'nowrap' }),
        (m, ctx) => {
          const [, p1, p2, , p4] = m;

          return `${p1}${ctx.tag(p2, 'span', { class: 'nowrap' })}${p4}`;
        }
      ]
    },
    {
      id: 'nbsp_year_suffix',
      requires: F.DIGIT | F.PERIOD,
      description: 'Пробел между годом и сокращением г.',
      pattern: /(^| |\u{00A0}|"|«)([0-9]{3,4})[ ]?(г\.)([^a-zа-яё]|$)/giu,
      replacement: `$1$2${G.NBSP}$3$4`
    }
  ]
};
