import { CONTENT_END_LOOKAHEAD, CONTENT_START_GROUP } from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { CLOSE } from '../protect/placeholders.js';

// The trailing boundary is a lookahead, so there is nothing to put back on the right. The leading
// one is consumed and returned as it came: a non-breaking space in front of the head is one the dash
// rules above just wrote, and loosening it to an ordinary space unbinds the dash and destroys the
// exact form `abbr.currency` reads back.
const joinHyphen = (m) => {
  const [, p1, p2, , p4] = m;

  return `${p1}${p2}-${p4}`;
};

// A half-typed source may already carry the hyphen on either side of the gap, so each side is
// optional per form: `из за` never comes as `из- за`, and an emphatic particle carries none at all.
// `notBefore` narrows the shared trailing boundary where one form is written apart in that position.
const hyphenJoin = (head, tail, { lead = '-?', trail = '-?', notBefore = '' } = {}) =>
  new RegExp(
    `${CONTENT_START_GROUP}(${head})${lead}( |\\t|${G.NBSP})+${trail}(${tail})${notBefore}${CONTENT_END_LOOKAHEAD}`,
    'giu'
  );

// The three forms a dash arrives in. The en dash is one of them because it is its own canonical
// form: it reaches every rule below unfolded, as the author typed it.
const AUTHORED_DASH = `${G.MDASH}${G.NDASH}-`;

// Anything that ends content takes the dash: an enumerated allowlist would leave `]`, `*`, `%` and a
// vault placeholder without one. Sentence marks stay out — `em_after_sentence` spaces those the
// other way round — and so do openers and dashes, which would turn a `- - -` break or a `( - x)`
// into an em dash. `“` is not an opener here: in the Russian `„…“` pair it closes.
//
// The separator may already be a non-breaking space, since a half-typeset source glues short words
// before anyone converts its dashes. A spaced `–` between words still means an em dash; glued
// (`отец–сын`) it stays what it is.
const EM_AFTER_CONTENT_RE = new RegExp(
  `([^\\s(\\[{<.!?${G.LAQUO}${G.BDQUO}${G.HELLIP}${G.NDASH}${G.MDASH}-])( |\\t|${G.NBSP})+([${AUTHORED_DASH}])(\\s|$|<)`,
  'giu'
);

const EM_GLUED_RE = new RegExp(`(,|:|\\)|")([${AUTHORED_DASH}])(\\s|$|<)`, 'giu');

// What `em_after_sentence` leaves behind the mark it read as a sentence end. `abbr.currency` reads
// this exact form back — it removes the abbreviation period this rule mistook for that mark, so it
// has to undo the spacing too — and reads it from here, because a literal copy there would stop
// matching silently the first time this changed.
export const SENTENCE_DASH = ` ${G.MDASH}${G.NBSP}`;

// Same separator set as em, and still ahead of it, so a spaced range stays a range. The en dash is
// accepted as written, or `12 – 19` falls through to `em`, which raises the range's own dash to an em
// dash — the one glyph a range never takes. The separator is a run for the same reason `em` reads
// one: the two rules have to agree on what separates a dash from its neighbour.
const RANGE_DASH = `${G.NDASH}-`;
const DASH_GAP = `(?: |\\t|${G.NBSP})+`;
const EN_RANGE_RE = new RegExp(
  `(?<![\\d${RANGE_DASH}])(\\d+)${DASH_GAP}[${RANGE_DASH}]${DASH_GAP}(\\d+)(?![\\d${RANGE_DASH}])`,
  'gu'
);

export const dashGroup = {
  title: 'Дефисы и тире',
  rules: [
    {
      id: 'em_double_hyphen',
      description: 'Двойной дефис → тире (как в markdown/AsciiDoc)',
      // The closing boundary is a lookahead: consuming the space would eat the one the next `--`
      // needs as its own opening boundary, so `-- -- --` would convert every other one.
      //
      // The end of a protected region opens content as a space does — that is what stands in front
      // of `--` behind a Markdown blockquote or list marker.
      pattern: new RegExp(`(\\s|^|${CLOSE})--(?=\\s)`, 'gu'),
      replacement: `$1${G.MDASH}`
    },
    {
      id: 'en_range',
      description: 'Диапазон чисел с пробелами вокруг дефиса: «12 - 19» → «12–19»',
      // Runs before em, so `dash.em` cannot take `12 - 19` for a text em dash.
      pattern: EN_RANGE_RE,
      replacement: `$1${G.NDASH}$2`
    },
    {
      id: 'em',
      description: 'Тире после слов, кавычек, скобочек, пунктуации',
      pattern: [EM_AFTER_CONTENT_RE, EM_GLUED_RE],
      replacement: [`$1${G.NBSP}${G.MDASH}$4`, `$1${G.NBSP}${G.MDASH}$3`]
    },
    {
      id: 'em_line_start',
      description: 'Тире после переноса строки',
      pattern: new RegExp(`(\\n|\\r|^|>|${CLOSE})[${AUTHORED_DASH}](\\t| )`, 'gu'),
      replacement: `$1${G.MDASH}${G.NBSP}`
    },
    {
      id: 'em_after_sentence',
      description: 'Тире после знаков восклицания, троеточия и прочее',
      // The separators are runs, and both are discarded: requiring exactly one would make the binding
      // wait for `space.collapse_spaces`, four groups later, so the same document came out two ways.
      //
      // A dash that ends the text has no next clause to open, so it binds backwards instead — the
      // form `em` gives every other dangling dash.
      pattern: [
        new RegExp(
          `([.!?${G.HELLIP}])(?: |\\t|${G.NBSP})+[${AUTHORED_DASH}](?: |\\t|${G.NBSP})+`,
          'gu'
        ),
        new RegExp(`([.!?${G.HELLIP}])(?: |\\t|${G.NBSP})+[${AUTHORED_DASH}]$`, 'gu')
      ],
      replacement: [`$1${SENTENCE_DASH}`, `$1${G.NBSP}${G.MDASH}`]
    },
    // The four hyphen-joining rules take the shared left boundary, so `(кто то)`, `«всё таки»` and
    // `[из за]` lose the same space a bare `кто то` does.
    {
      id: 'compound_preposition',
      description: 'Дефис между из-за, из-под',
      pattern: hyphenJoin('из', 'за|под', { lead: '' }),
      replacement: joinHyphen
    },
    {
      id: 'indefinite_pronoun',
      description: 'Дефисы в обезличенных местоимениях',
      // The shared trailing set carries a colon, and claiming it would take `как то:` — the
      // enumeration idiom written apart, which `nobr.nbsp_namely` owns and which `dash`, two groups
      // earlier, would reach first. Declining the colon is how the form reaches its own rule.
      pattern: hyphenJoin(
        'кто|кем|когда|зачем|почему|как|что|чем|где|чего|кого',
        'то|либо|нибудь',
        {
          notBefore: '(?!:)'
        }
      ),
      replacement: joinHyphen
    },
    {
      id: 'hyphenated_particle',
      description: 'Кое-как, кой-кого, всё-таки',
      pattern: [
        hyphenJoin(
          'кое',
          'как|что|кто|кого|кому|чей|чья|чьё|чьи|где|куда|откуда|когда|какой|какая|какое|какие|каких|каким'
        ),
        hyphenJoin('кой', 'кого'),
        hyphenJoin('вс[её]', 'таки')
      ],
      replacement: joinHyphen
    },
    {
      id: 'emphatic_particle',
      description: 'Дефис с усилительными частицами ка, кась, тка, тко, де',
      pattern: hyphenJoin('[а-яё]+', 'кась|тка|тко|ка|де', { lead: '', trail: '' }),
      replacement: joinHyphen
    }
  ]
};
