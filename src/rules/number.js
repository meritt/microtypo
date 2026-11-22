import { G } from '../lib/glyphs.js';
import { F } from '../lib/rule-features.js';
import { OPEN, CLOSE } from '../protect/placeholders.js';

const GAP_RE = /[ \t]+/g;

// Whether a digit stands before the run of spaces and tabs that ends at `at`, the run not empty.
function digitBeforeGap(str, at) {
  let i = at;

  while (str[i - 1] === ' ' || str[i - 1] === '\t') {
    i -= 1;
  }

  return i < at && str[i - 1] >= '0' && str[i - 1] <= '9';
}

export const numberGroup = {
  title: 'Числа, дроби, математические знаки',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'time',
      requires: F.DIGIT | F.COLON,
      description: 'Нормализация времени: 08 : 59 → 08:59, 9:30 не трогаем',
      // Runs before `space.trim_before_punctuation`, so both sides collapse at once.
      pattern: /(?<![\d:])(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?(?![\d:])/g,
      replacement: (m) => {
        const [, h, mm, ss] = m;

        return ss != null ? `${h}:${mm}:${ss}` : `${h}:${mm}`;
      }
    },
    {
      id: 'en_range',
      requires: F.DIGIT | F.DASH,
      description: 'Среднее тире для диапазонов чисел: 100-500 → 100–500',
      // The lookarounds exclude longer digit-dash chains — phones, ISO dates — so only a lone
      // `NNN-NNN` range matches.
      pattern: /(?<![\d—−-])(\d+)[—−-](\d+)(?![\d—−-])/gu,
      replacement: `$1${G.NDASH}$2`
    },
    {
      id: 'minus_range',
      requires: F.DIGIT | F.DASH,
      description: 'Минус между диапазоном чисел',
      pattern: /(^|\s)([−-])(\d+)(\.\.\.|…)(\s)?(\+|-|−)?(\d+)/gu,
      replacement: (m) => {
        const [, p1, , p3, p4, p5 = '', p6, p7] = m;
        const sign = p6 === '-' ? G.MINUS : (p6 ?? '');

        return `${p1}${G.MINUS}${p3}${p4}${p5}${sign}${p7}`;
      }
    },
    {
      id: 'times',
      requires: F.DIGIT,
      description: 'x на × в размерных единицах',
      cycled: true,
      pattern: /([^a-zA-Z><]|^)(×)?(?<!\d)(\d+)( *)(x|х|×)( *)(\d+)([^a-zA-Z><]|$)/gu,
      replacement: `$1$2$3${G.TIMES}$7$8`
    },
    {
      id: 'sub',
      requires: F.DIGIT | F.UNDERSCORE,
      description: 'Нижний индекс',
      // Under `html: false` the consumed `_` marker would vanish and corrupt the input.
      htmlOnly: true,
      pattern: /(?<![\p{L}\d_])([a-zа-яё])_(\d{1,3})([^@а-яёa-z0-9]|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3] = m;

        return `${p1}${ctx.tag(ctx.tag(p2, 'small'), 'sub')}${p3}`;
      }
    },
    {
      id: 'sup',
      requires: F.DIGIT | F.CARET,
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
      requires: F.DIGIT | F.SLASH,
      description: 'Дроби 1/2, 1/4, 3/4 → символы (кроме дюймов)',
      // Trailing negative lookahead keeps longer numbers (1/24) and inch marks (3/4″) intact.
      pattern: [/(^|\D)1\/2(?![\d"″′])/g, /(^|\D)1\/4(?![\d"″′])/g, /(^|\D)3\/4(?![\d"″′])/g],
      replacement: [`$1${G.FRAC12}`, `$1${G.FRAC14}`, `$1${G.FRAC34}`]
    },
    {
      id: 'math',
      requires: F.MATH,
      description: 'Математические знаки: !=, <=, >=, ~=, +-',
      // >= excludes PUA chars so it can't eat a tag-placeholder > (CLOSE precedes it).
      // No == → ≡: it would eat a Markdown setext underline and ==highlight== markers. ≡ needs no
      // rule anyway — it is its own canonical form in CHARS_TABLE.
      pattern: [
        /!=/g,
        /<=(?![>=])/g,
        new RegExp(`([^=${OPEN}${CLOSE}]|^)>=`, 'gu'),
        /~=/g,
        /(?<![-+])\+-(?![-+])/g
      ],
      replacement: [G.NE, G.LE, `$1${G.GE}`, G.CONG, G.PLUSMN]
    },
    {
      id: 'thin_space_triads',
      requires: F.DIGIT | F.SPACE,
      description: 'Триады чисел через узкий неразрывный пробел',
      // The lookarounds skip digit-space chains, so phone numbers and IBANs — non-triadic groups —
      // are left whole. The letter guard is the one `split_triads` already carries: digits stuck to a
      // word are part of that word, not a quantity, and without it `ab12 345678` never settles.
      //
      // A gap is a run of spaces and tabs: `space.collapse_spaces` makes it one space later, and the
      // number it leaves is the one read here. The gap in front of the match is read in the
      // replacement, once per match: a lookbehind over a run is reread from every start by a
      // backtracking engine.
      pattern: /(?<!\d)(?<!\p{L})([0-9]{1,3}([ \t]+[0-9]{3}){1,})(?!\d)(.|$|(?=\n\s*$))/gu,
      replacement: (m) => {
        const [m0, p1, , p4, offset, str] = m;

        if (p4 === '-' || digitBeforeGap(str, offset)) {
          return m0;
        }

        // The greedy `{1,}` already took every legitimate space-triad, so a digit one space further
        // is the tail of a phone number or an IBAN and stays whole.
        if (p4 === ' ' && /\d/.test(str[offset + m0.length] ?? '')) {
          return m0;
        }

        return p1.replace(GAP_RE, G.NNBSP) + p4;
      }
    },
    {
      id: 'nbsp_numero',
      requires: F.DIGIT | F.NUMERO,
      description: 'Узкий неразрывный пробел между № и числом',
      pattern: /[№]\s*(\d)/gu,
      replacement: `${G.NUMERO}${G.NNBSP}$1`
    },
    {
      id: 'nbsp_section',
      requires: F.SECTION,
      description: 'Узкий неразрывный пробел между § и числом',
      pattern: /§\s*(\d+|[IVX]+|[a-zа-яё]+)/giu,
      replacement: `${G.SECT}${G.NNBSP}$1`
    }
  ]
};
