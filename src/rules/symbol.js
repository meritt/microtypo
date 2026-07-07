import { G } from '../lib/glyphs.js';
import { OPEN } from '../protect/placeholders.js';

const GENERATED_SYMBOLS = new Set([G.COPY, G.REG, G.TRADE]);

function hasNextCopyrightToken(source, index) {
  return /^\((?:c|с)\)/iu.test(source.slice(index, index + 3));
}

function copyrightSpace(m) {
  const [match, , offset, source] = m;
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

export const symbolGroup = {
  title: 'Специальные символы',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'trademark',
      description: '(tm) → ™',
      pattern: /\(tm\)/gi,
      replacement: G.TRADE
    },
    {
      id: 'registered',
      description: '(R) → ®',
      pattern: /\(r\)/gi,
      replacement: G.REG
    },
    {
      id: 'copyright',
      description: '(c) → ©',
      pattern: [
        /\((c|с)\)\s+/giu,
        /\((c|с)\)($|\.|,|!|\?)/giu,
        /\((c|с)\)([a-zа-яёA-ZА-ЯЁ0-9])/giu
      ],
      replacement: [copyrightSpace, (m) => `${G.COPY}${m[2]}`, (m) => `${G.COPY}${m[2]}`]
    },
    {
      id: 'apostrophe',
      description: 'Правильный апостроф',
      pattern: /(\s|^|>|’)([a-zа-яё]{1,})'{1,2}([a-zа-яё]+)/giu,
      replacement: `$1$2${G.RSQUO}$3`,
      cycled: true
    },
    {
      id: 'fahrenheit',
      description: 'Градусы по Фаренгейту',
      pattern: /(?<!\d)([0-9]+)F($|\s|\.|,|;|:|\u{00A0}|\?|!)/gu,
      replacement: (m, ctx) => `${ctx.tag(`${m[1]} ${G.DEG}F`, 'span', { class: 'nowrap' })}${m[2]}`
    },
    {
      id: 'arrows',
      description: 'Преобразование -> в → и <- в ←',
      pattern: [/([^-]|^)->/g, /<-(?!-)/g],
      replacement: [`$1${G.RARR}`, G.LARR]
    }
  ]
};
