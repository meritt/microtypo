import { G } from '../lib/glyphs.js';
import { count } from '../lib/strings.js';
import { OPEN, CLOSE } from '../protect/placeholders.js';
import { processQuotes } from './quote-state.js';

const ANCHOR_OPEN_RE_STR = `<${OPEN}A\\d+${CLOSE}>`;
const ANCHOR_CLOSE_RE_STR = `<\\/${OPEN}A\\d+${CLOSE}>`;

const QUOTES_OUTSIDE_A_RE = new RegExp(
  `(${ANCHOR_OPEN_RE_STR})"([\\s\\S]+?)"(${ANCHOR_CLOSE_RE_STR})`,
  'g'
);

const FIRS_OPEN = G.LAQUO;
const FIRS_CLOSE = G.RAQUO;
const WORD_END_RE = new RegExp(`[a-zа-яё0-9${G.HELLIP}]$`, 'iu');

function repeatChar(s, char) {
  return char.repeat(count(s, '"'));
}

function closesBeforeParen(p1, next, offset, source) {
  return next.startsWith('(') && /^\s$/u.test(p1) && WORD_END_RE.test(source.slice(0, offset));
}

function applyInnerQuotes(ctx) {
  const settings = ctx.group?.settings ?? {};
  ctx.text = processQuotes(ctx.text, {
    allowNested: settings.allowNested !== false,
    convertInches: settings.convertInches !== false,
    checkBudget: ctx.checkBudget
  });
}

export const quoteGroup = {
  title: 'Кавычки',
  rules: [
    {
      id: 'around_link',
      description: 'Кавычки вынесены за тег <a>',
      pattern: QUOTES_OUTSIDE_A_RE,
      replacement: '"$1$2$3"'
    },
    {
      id: 'open',
      description: 'Открывающая кавычка',
      pattern: [
        /(^|\(|\s|>|-|[«—–])((?:"|\\")+)(\S+?)/giu,
        /(^|\(|\s|[«—–])("|\\")(\s)(\S+)/giu,
        /(,)((?:"|\\")+)([а-яёa-z0-9])/giu
      ],
      replacement: [
        (m) => {
          const [, p1, p2, p4, offset, source] = m;

          if (closesBeforeParen(p1, p4, offset, source)) {
            return m[0];
          }

          return `${p1}${repeatChar(p2, FIRS_OPEN)}${p4}`;
        },
        (m) => {
          if (closesBeforeParen(m[1], m[4], m[5], m[6])) {
            return m[0];
          }

          return `${m[1]}${FIRS_OPEN}${m[4]}`;
        },
        (m) => `${m[1]}${repeatChar(m[2], FIRS_OPEN)}${m[3]}`
      ]
    },
    {
      id: 'open_cyrillic',
      description: 'Приклеенная кавычка у кириллицы → « с пробелом',
      pattern: /([a-zа-яё0-9])"([а-яё])/giu,
      replacement: `$1 ${FIRS_OPEN}$2`
    },
    {
      id: 'close',
      description: 'Закрывающая кавычка',
      pattern: [
        // Only defuse \" as a path close when a backslash-ASCII run precedes, so ordinary \"escaped\" prose is untouched.
        /(?<=\\[\w:]*)\\"(?=$|\s|[.,;:!?)]|<)/u,
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)((?:"|\\")+)(?![a-zа-яё0-9«])/giu,
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)((?:"|\\"|«)+)(<[^>]+>)(\.|…|;|:|\?|!|,|\)|<\/|$| )/giu,
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)(\s+)((?:"|\\")+)(\s+)(\.|…|;|:|\?|!|,|\)|\(|<\/|$| )/giu,
        />«\.($|\s|<)/gu,
        />«,($|\s|<|\S)/gu,
        />«:($|\s|<|\S)/gu,
        />«;($|\s|<|\S)/gu,
        />«\)($|\s|<|\S)/gu,
        /((?:"|\\")+)$/giu,
        /(\S)((?:"|\\")+)(\.|…|;|:|\?|!|,|\s|\)|<\/|<|$)/giu
      ],
      replacement: [
        () => `\\${FIRS_CLOSE}`,
        (m) => {
          const [, p1, p2] = m;

          return `${p1}${repeatChar(p2, FIRS_CLOSE)}`;
        },
        (m) => {
          const [, p1, p2, p4, p5] = m;
          const dq = count(p2, '"');
          const lq = count(p2, '«');

          return `${p1}${FIRS_CLOSE.repeat(dq + lq)}${p4}${p5}`;
        },
        (m) => {
          const [, p1, p2, p3, p5, p6] = m;
          const dq = count(p3, '"');
          const lq = count(p3, '«');

          return `${p1}${p2}${FIRS_CLOSE.repeat(dq + lq)}${p5}${p6}`;
        },
        `>${FIRS_CLOSE}.$1`,
        `>${FIRS_CLOSE},$1`,
        `>${FIRS_CLOSE}:$1`,
        `>${FIRS_CLOSE};$1`,
        `>${FIRS_CLOSE})$1`,
        (m) => FIRS_CLOSE.repeat(count(m[1], '"')),
        (m) => {
          const [, p1, p2, p4] = m;

          return `${p1}${FIRS_CLOSE.repeat(count(p2, '"'))}${p4}`;
        }
      ]
    },
    {
      id: 'fix_orphan_open',
      description: 'Открывающая «, приклеенная к концу слова перед пробелом/концом → закрывающая »',
      pattern: /([a-zа-яё0-9])«(?=\s|$)/giu,
      replacement: `$1${FIRS_CLOSE}`
    },
    {
      id: 'nested',
      description: 'Внутренние кавычки-лапки и дюймы',
      handler: applyInnerQuotes
    }
  ]
};
