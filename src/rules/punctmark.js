import { G } from '../lib/glyphs.js';

const BRACKET_SPACE_RE = /[ \t\u{00A0}]/u;
const WORD_RE = /[a-zа-яё0-9]/iu;
const REFERENCE_TAIL_RE = /&[0-9A-Za-z#]+$/;
// Longest HTML5 named reference (CounterClockwiseContourIntegral) plus its '&' and ';'.
const REFERENCE_MAX = 32;

// Which second mark each first mark swallows, taken from the rules below: `collapse_doubled` reads
// `.`/`!` before `.`/`!`/`?` and `?` before `?`, `mark_ellipsis` reads `?`/`!` before `…`, and
// `collapse_repeated` reads a comma or a semicolon before itself. One table, because a group later
// has to ask the same question before it glues two marks together — this group runs fourth and would
// not see the pair, so it would survive to the next pass and come back a mark short.
const SWALLOWED_AFTER = new Map([
  ['.', '.!?'],
  ['!', `.!?${G.HELLIP}`],
  ['?', `?${G.HELLIP}`],
  [',', ','],
  [';', ';']
]);

export function collapsesAsRepeat(first, second) {
  return second !== undefined && (SWALLOWED_AFTER.get(first) ?? '').includes(second);
}

// The ';' closing a character reference is markup, not the stray punctuation this rule strips:
// cutting it turns &amp; into a bare &amp, which the entities layer promises never to emit.
function endsCharacterReference(text, semicolonAt) {
  return REFERENCE_TAIL_RE.test(text.slice(Math.max(0, semicolonAt - REFERENCE_MAX), semicolonAt));
}

function trimBracketPunct(text) {
  let close = text.indexOf(')');

  if (close === -1) {
    return text;
  }

  const cuts = [];

  while (close !== -1) {
    let markAt = close - 1;

    while (markAt >= 0 && BRACKET_SPACE_RE.test(text[markAt])) {
      markAt--;
    }

    const mark = text[markAt];

    if (mark === ',' || (mark === ';' && !endsCharacterReference(text, markAt))) {
      const wordAt = markAt - 1;

      if (wordAt >= 0 && WORD_RE.test(text[wordAt])) {
        cuts.push([markAt, close]);
      }
    } else if (mark === ':') {
      let wordAt = markAt - 1;

      while (wordAt >= 0 && BRACKET_SPACE_RE.test(text[wordAt])) {
        wordAt--;
      }

      if (wordAt >= 0 && WORD_RE.test(text[wordAt]) && hasLeadingEllipsis(text, wordAt)) {
        cuts.push([wordAt + 1, close]);
      }
    }

    close = text.indexOf(')', close + 1);
  }

  if (cuts.length === 0) {
    return text;
  }

  const parts = [];
  let start = 0;

  for (const [from, to] of cuts) {
    parts.push(text.slice(start, from));
    start = to;
  }

  parts.push(text.slice(start));

  return parts.join('');
}

function hasLeadingEllipsis(text, from) {
  const limit = Math.max(0, from - 160);
  let open = from;

  while (open >= limit && text[open] !== '(' && text[open] !== ')') {
    open--;
  }

  if (text[open] !== '(') {
    return false;
  }

  open++;

  while (open < text.length && BRACKET_SPACE_RE.test(text[open])) {
    open++;
  }

  return text[open] === G.HELLIP;
}

export const punctmarkGroup = {
  title: 'Пунктуация и знаки препинания',
  rules: [
    {
      id: 'comma_before_conjunction',
      description: 'Расстановка запятых перед а, но',
      enabled: false,
      pattern: /([a-zа-яё])(\s|\u{00A0})(но|а)(\s|\u{00A0})/gu,
      replacement: '$1,$2$3$4'
    },
    {
      id: 'repeat_limit',
      description: 'Повтор !/?: допустимы только 1 или 3 (!!→!, !!!→!!!, !!!!→!!!)',
      // Backref \1+ matches same-char runs only, so mixed ?! survives intact.
      pattern: /([!?])\1+/g,
      replacement: (m) => (m[0].length >= 3 ? m[1].repeat(3) : m[1])
    },
    {
      id: 'collapse_repeated',
      description: 'Лишние запятые, двоеточия, точки с запятой',
      // :: is intentionally kept (IPv6, ::before, std::vector); only 3+ colons collapse.
      cycled: true,
      pattern: [/(,){2,}/g, /(:){3,}/g, /(;){2,}/g, /((,|:);){2,}/g, /,\s+,/g],
      replacement: ['$1', '$1', '$1', '$1', ',']
    },
    {
      id: 'ellipsis',
      description: 'Три и более точек → многоточие',
      pattern: /\.{3,}/g,
      replacement: G.HELLIP
    },
    {
      id: 'mark_ellipsis',
      description: 'Многоточие после ? или ! теряет точку: ?… → ?..',
      pattern: new RegExp(`([?!])${G.HELLIP}`, 'gu'),
      replacement: '$1..'
    },
    {
      id: 'swap_exclamation_question',
      description: 'Перестановка !? → ?!',
      pattern: /([a-zа-яё0-9])(?: |\t|\u{00A0})?!\?(\s|$|<)/giu,
      replacement: '$1?!$2'
    },
    {
      id: 'drop_terminal_garbage',
      description: 'Удаление мусорных хвостов пунктуации после терминального знака',
      pattern: [/([!?])[,;]+[!?]+/g, new RegExp(`\\.${G.RAQUO}\\.`, 'g')],
      replacement: ['$1', `${G.RAQUO}.`]
    },
    {
      id: 'collapse_doubled',
      description: 'Сдвоенные знаки препинания → одиночные',
      // The pairs these three and `mark_ellipsis` rewrite are also asked about from outside, through
      // `collapsesAsRepeat` above: a group that runs later must not glue a pair together that this
      // one would have taken apart, because by then the repeat survives a pass.
      //
      // All three take the same shape: a letter or digit before, a sentence boundary after. The
      // boundary is what keeps `1..10`, `../pattern.txt` and a `1a2b3c4..5d6e7f8` revision range
      // whole, and it carries the closers too, since a doubled period ends a sentence just as often
      // inside `(…)` or `«…»`. The leading class keeps `Что?..` intact — `mark_ellipsis` produces
      // that form one rule earlier — and carries white space, because
      // `space.trim_before_punctuation` glues the gap of `Корвин ..` two groups later.
      pattern: [
        new RegExp(`([a-zа-яё0-9]|\\s|^)\\.\\.(\\s|$|<|[),\\]}${G.RAQUO}${G.LDQUO}])`, 'giu'),
        /([a-zа-яё0-9])(!|\.)(!|\.|\?)(\s|$|<)/giu,
        /([a-zа-яё0-9])(\?)(\?)(\s|$|<)/giu
      ],
      replacement: ['$1.$2', '$1$2$4', '$1$2$4']
    },
    {
      id: 'trim_bracket_terminal_punct',
      description: 'Удаление случайной пунктуации перед закрывающей скобкой',
      regexes: [BRACKET_SPACE_RE, WORD_RE, REFERENCE_TAIL_RE],
      handler: (ctx) => trimBracketPunct(ctx.text)
    },
    {
      id: 'bracket_spaces',
      description: 'Лишние пробелы внутри скобок',
      pattern: [/(?<![:;=])(\()( |\t)+/g, /(?<![ \t])( |\t)+(\))/g],
      replacement: ['$1', '$2']
    },
    {
      id: 'space_before_bracket',
      description: 'Пробел перед открывающей скобочкой',
      pattern: /([a-zа-яё])(\()/giu,
      replacement: '$1 $2'
    },
    {
      id: 'period_at_end',
      description: 'Точка в конце текста, если её там нет',
      enabled: false,
      pattern: /([a-zа-яё0-9])( |\t|\u{00A0})*$/giu,
      replacement: '$1.'
    }
  ]
};
