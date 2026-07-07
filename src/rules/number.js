import { G } from '../lib/glyphs.js';
import { OPEN, CLOSE } from '../protect/placeholders.js';

export const numberGroup = {
  title: 'Числа, дроби, математические знаки',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'time',
      description: 'Нормализация времени: 08 : 59 → 08:59, 9:30 не трогаем',
      // Run BEFORE space.trim_before_punctuation so both sides collapse at once.
      pattern: /(?<![\d:])(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?(?![\d:])/g,
      replacement: (m) => {
        const [, h, mm, ss] = m;

        return ss != null ? `${h}:${mm}:${ss}` : `${h}:${mm}`;
      }
    },
    {
      id: 'en_range',
      description: 'Среднее тире для диапазонов чисел: 100-500 → 100–500',
      // Lookarounds exclude longer digit-dash chains (phones, ISO dates) so only a lone NNN-dash-NNN range matches.
      pattern: /(?<![\d—−-])(\d+)[—−-](\d+)(?![\d—−-])/gu,
      replacement: `$1${G.NDASH}$2`
    },
    {
      id: 'minus_range',
      description: 'Минус между диапазоном чисел',
      pattern: /(^|\s)([−-])(\d+)(\.\.\.|…)(\s)?(\+|-|−)?(\d+)/gu,
      replacement: (m) => {
        const [, p1, , p3, p4, p5 = '', p6, p7] = m;

        return `${p1}${G.MINUS}${p3}${p4}${p5}${p6 === '+' ? '+' : G.MINUS}${p7}`;
      }
    },
    {
      id: 'times',
      description: 'x на × в размерных единицах',
      cycled: true,
      pattern: /([^a-zA-Z><]|^)(×)?(?<!\d)(\d+)( *)(x|х|×)( *)(\d+)([^a-zA-Z><]|$)/gu,
      replacement: `$1$2$3${G.TIMES}$7$8`
    },
    {
      id: 'sub',
      description: 'Нижний индекс',
      // htmlOnly: under html:false the consumed _ marker would vanish and corrupt input.
      htmlOnly: true,
      pattern: /([a-zа-яё0-9])_(\d{1,3})([^@а-яёa-z0-9]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3] = m;

        return `${p1}${ctx.tag(ctx.tag(p2, 'small'), 'sub')}${p3}`;
      }
    },
    {
      id: 'sup',
      description: 'Верхний индекс',
      htmlOnly: true,
      pattern: /([a-zа-яё0-9])\^(\d{1,3})([^а-яёa-z0-9]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3] = m;

        return `${p1}${ctx.tag(ctx.tag(p2, 'small'), 'sup')}${p3}`;
      }
    },
    {
      id: 'fraction',
      description: 'Дроби 1/2, 1/4, 3/4 → символы (кроме дюймов)',
      // Trailing negative lookahead keeps longer numbers (1/24) and inch marks (3/4″) intact.
      pattern: [/(^|\D)1\/2(?![\d"″′])/g, /(^|\D)1\/4(?![\d"″′])/g, /(^|\D)3\/4(?![\d"″′])/g],
      replacement: [`$1${G.FRAC12}`, `$1${G.FRAC14}`, `$1${G.FRAC34}`]
    },
    {
      id: 'math',
      description: 'Математические знаки',
      // >= excludes PUA chars so it can't eat a tag-placeholder > (CLOSE precedes it).
      pattern: [
        /!=/g,
        /<=/g,
        new RegExp(`([^=${OPEN}${CLOSE}]|^)>=`, 'gu'),
        /~=/g,
        /(?<![-+])\+-(?![-+])/g
      ],
      replacement: [G.NE, G.LE, `$1${G.GE}`, G.CONG, G.PLUSMN]
    },
    {
      id: 'thin_space_triads',
      description: 'Триады чисел через узкий неразрывный пробел',
      // Lookarounds skip digit-space chains so phone numbers and IBANs (non-triadic groups) aren't chewed.
      pattern: /(?<!\d)(?<!\d )([0-9]{1,3}( [0-9]{3}){1,})(?!\d)(.|$)/gu,
      replacement: (m) => {
        const [m0, p1, , p4, offset, str] = m;

        if (p4 === '-') {
          return m0;
        }

        // The greedy {1,} already took every legit space-NNN triad; a digit one space further is a phone/IBAN tail, leave whole.
        if (p4 === ' ' && /\d/.test(str[offset + m0.length] ?? '')) {
          return m0;
        }

        return p1.replaceAll(' ', G.NNBSP) + p4;
      }
    },
    {
      id: 'nbsp_numero',
      description: 'Узкий неразрывный пробел между № и числом',
      pattern: /[№]\s*(\d)/gu,
      replacement: `${G.NUMERO}${G.NNBSP}$1`
    },
    {
      id: 'nbsp_section',
      description: 'Узкий неразрывный пробел между § и числом',
      pattern: /§\s*(\d+|[IVX]+|[a-zа-яё]+)/giu,
      replacement: `${G.SECT}${G.NNBSP}$1`
    }
  ]
};
