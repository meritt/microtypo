import { G } from '../lib/glyphs.js';

function makeHyphenJoiner() {
  return (m) => {
    const [, p1, p2, , p4, p5] = m;
    const left = p1 === G.NBSP ? ' ' : p1;
    const right = p5 === G.NBSP ? ' ' : p5;

    return `${left}${p2}-${p4}${right}`;
  };
}

export const dashGroup = {
  title: 'Дефисы и тире',
  rules: [
    {
      id: 'em_double_hyphen',
      description: 'Двойной дефис → тире (как в markdown/AsciiDoc)',
      pattern: /(\s|^)--(\s)/g,
      replacement: `$1${G.MDASH}$2`
    },
    {
      id: 'en_range',
      description: 'Диапазон чисел с пробелами вокруг дефиса: «12 - 19» → «12–19»',
      // Runs before em so dash.em doesn't grab 12 - 19 as a text em-dash.
      pattern: /(?<![\d-])(\d+) - (\d+)(?![\d-])/g,
      replacement: `$1${G.NDASH}$2`
    },
    {
      id: 'em',
      description: 'Тире после слов, кавычек, скобочек, пунктуации',
      pattern: [
        /((?<![a-zа-яё0-9])[a-zа-яё0-9]+|,|:|\)|[»“]|"|>)( |\t)([—-])(\s|$|<)/giu,
        /(,|:|\)|")([—-])(\s|$|<)/giu
      ],
      replacement: [`$1\u{00A0}${G.MDASH}$4`, `$1\u{00A0}${G.MDASH}$3`]
    },
    {
      id: 'em_line_start',
      description: 'Тире после переноса строки',
      pattern: /(\n|\r|^|>)([-—])(\t| )/g,
      replacement: `$1${G.MDASH}\u{00A0}`
    },
    {
      id: 'em_after_sentence',
      description: 'Тире после знаков восклицания, троеточия и прочее',
      pattern: /(\.|!|\?|…)( |\t|\u{00A0})([-—])( |\t|\u{00A0})/gu,
      replacement: `$1 ${G.MDASH}\u{00A0}`
    },
    {
      id: 'compound_preposition',
      description: 'Дефис между из-за, из-под',
      pattern: /(\s|\u{00A0}|>|^)(из)( |\t|\u{00A0})-?(за|под)([.,!?:;]|\s|\u{00A0})/giu,
      replacement: makeHyphenJoiner()
    },
    {
      id: 'indefinite_pronoun',
      description: 'Дефисы в обезличенных местоимениях',
      cycled: true,
      pattern:
        /(\s|^|>)(кто|кем|когда|зачем|почему|как|что|чем|где|чего|кого)-?( |\t|\u{00A0})-?(то|либо|нибудь)([.,!?;]|\s|$)/giu,
      replacement: makeHyphenJoiner()
    },
    {
      id: 'hyphenated_particle',
      description: 'Кое-как, кой-кого, всё-таки',
      cycled: true,
      pattern: [
        /(\s|^|\u{00A0}|>)(кое)-?( |\t|\u{00A0})-?(как|что|кто|кого|кому|чей|чья|чьё|чьи|где|куда|откуда|когда|какой|какая|какое|какие|каких|каким)([.,!?;]|\s|\u{00A0}|$)/giu,
        /(\s|^|\u{00A0}|>)(кой)-?( |\t|\u{00A0})-?(кого)([.,!?;]|\s|\u{00A0}|$)/giu,
        /(\s|^|\u{00A0}|>)(вс[её])-?( |\t|\u{00A0})-?(таки)([.,!?;]|\s|\u{00A0}|$)/giu
      ],
      replacement: makeHyphenJoiner()
    },
    {
      id: 'emphatic_particle',
      description: 'Дефис с усилительными частицами ка, кась, тка, тко, де',
      cycled: true,
      pattern:
        /(\s|^|\u{00A0}|>)([а-яё]+)( |\t|\u{00A0})(кась|тка|тко|ка|де)([.,!?;]|\s|\u{00A0}|$)/giu,
      replacement: makeHyphenJoiner()
    }
  ]
};
