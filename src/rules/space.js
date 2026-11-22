import { DOTTED_INITIALS, SURNAME } from '../lib/abbreviation-grammar.js';
import { CONTENT_START_GROUP, NOT_AFTER_LONE_QUOTE } from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { CURRENCY_PREFIX_SIGNS } from '../lib/measurement-units.js';
import { F } from '../lib/rule-features.js';
import { sessionMap } from '../lib/session-maps.js';
import { collapsesAsRepeat } from './punctmark.js';

// The zone list and URL_REGEX's scheme-less branch answer different questions and cannot share a
// definition: there a trailing slash proves the author meant a URL, so any 2-24 letter zone is
// accepted, while here nothing proves it and an unlisted zone means `simonenko.xyz` comes out
// `simonenko. xyz`. The list can never be complete — ~1500 zones exist — so what belongs in it is
// what documents actually carry, and the reserved zones of RFC 2606 are the ones documentation
// itself is required to use.
const DOMAIN_ZONES = new Set([
  'ru',
  'рф',
  'ру',
  'ком',
  'орг',
  'уа',
  'ua',
  'uk',
  'co',
  'fr',
  'com',
  'net',
  'edu',
  'gov',
  'org',
  'mil',
  'int',
  'info',
  'biz',
  'name',
  'pro',
  'io',
  'dev',
  'app',
  'me',
  'tv',
  'cc',
  'us',
  'eu',
  'de',
  'jp',
  'cn',
  'br',
  'in',
  'au',
  'ai',
  'xyz',
  // RFC 2606 reserves these for documentation and testing, so they are exactly the zones a written
  // example uses and the ones a typography engine must not break.
  'example',
  'test',
  'invalid',
  // Zones longer than four letters are ordinary, and a host is far likelier than a sentence that
  // forgot its space.
  'online',
  'store',
  'cloud',
  'email',
  'site',
  'website',
  'agency',
  'digital',
  'systems',
  'software',
  'technology',
  'network',
  'solutions',
  'studio',
  'space',
  'world',
  'group',
  'media',
  'center',
  'expert',
  'academy',
  'community',
  'moscow',
  'рус',
  'онлайн',
  'сайт',
  'москва'
]);

const TECH_SUFFIXES = new Set([
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'php',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'cs',
  'lua',
  'sh',
  'bat',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'xml',
  'svg',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'env',
  'md',
  'mdx',
  'rst',
  'txt',
  'rtf',
  'pdf',
  'doc',
  'docx',
  'odt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'tiff',
  'mp3',
  'mp4',
  'webm',
  'wav',
  'ogg',
  'flac',
  'mov',
  'avi',
  'mkv',
  'zip',
  'tar',
  'gz',
  'bz2',
  'xz',
  'rar',
  '7z',
  'exe',
  'dll',
  'so',
  'dmg',
  'app',
  'deb',
  'rpm'
]);

// A zone written Capitalized is the first word of a sentence, not a host: the list carries ordinary
// nouns — `москва`, `сайт`, `онлайн`, `store`, `media` — so `Это конец.Москва` must keep the space it
// is missing. An all-caps `REBMA.RU` is still a host, so only the Capitalized shape is out.
const SENTENCE_WORD_RE = /^\p{Lu}\p{Ll}/u;

// A port behind the zone is structure a sentence does not have, and DNS names are case-insensitive
// (RFC 4343), so `amber.Com:443` is a host however it is spelled.
function isKnownTld(afterDot, portFollows) {
  return (
    DOMAIN_ZONES.has(afterDot.toLowerCase()) && (portFollows || !SENTENCE_WORD_RE.test(afterDot))
  );
}

function isKnownExtension(afterDotLower) {
  return TECH_SUFFIXES.has(afterDotLower);
}

function isCapitalizedTechName(beforeDot, afterDot) {
  return /^[A-ZА-ЯЁ]/.test(beforeDot) && /^[a-zа-яё0-9]+$/.test(afterDot);
}

function isPartOfMultiSegmentId(terminator) {
  return terminator === '.' || /^\d/.test(terminator);
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

// The particles `nobr.nbsp_particle` binds to the word before them, in either case.
export const PARTICLE = '[Лл][Ии]|[Бб][Ыы]|[Бб]|[Жж][Ее]|[Жж]';

// Whether closing this gap would glue two marks into a pair the punctuation group swallows. That
// group runs four groups earlier, so the pair would survive this pass and be rewritten on the next
// one, a mark short of what the author typed. It owns the table.
//
// A period attached to a word is the exception: it is that word's abbreviation period, not a
// sentence mark, and `abbr` may take it away four groups later, so this decision must not turn on a
// character that is about to disappear.
function glueingSwallowsAMark(source, at, marks) {
  const mark = source[at - 1];

  if (mark === '.' && WORD_CHAR_RE.test(source[at - 2] ?? '')) {
    return false;
  }

  return collapsesAsRepeat(mark, marks[0]);
}

const TRIM_MARKS = `,:.;?!${G.HELLIP}`;
const TRIM_BEFORE_PUNCTUATION = new RegExp(
  `(?<!\\.\\.)(?<=[^ \\t${G.NBSP}])${NOT_AFTER_LONE_QUOTE}(( |\\t|${G.NBSP})+)([${TRIM_MARKS}]+)(?=\\s|$|(?<=[${TRIM_MARKS}],))`,
  'gu'
);
const GAP_BEFORE_COMMA_WORD = /(?<![ \t\u{00A0}])[ \t\u{00A0}]+,([а-яёa-z0-9«„])/giu;
const TRIM_AT = new RegExp(TRIM_BEFORE_PUNCTUATION.source, 'uy');
const COMMA_GAP_AT = new RegExp(GAP_BEFORE_COMMA_WORD.source, 'iuy');

// A transparent tag ends immediately before this gap. Its ">" cannot combine with
// a punctuation mark. The same two patterns that write the spacing decide if it goes.
export function punctuationAfterInlineGap(text, at, active) {
  let mark = at;
  while (text[mark] === ' ' || text[mark] === '\t' || text[mark] === G.NBSP) {
    mark++;
  }
  if (mark === at || !TRIM_MARKS.includes(text[mark] ?? '\0')) {
    return at;
  }
  let source = text;
  let start = at;
  if (Array.isArray(text)) {
    // The depth walk holds code points. Only the punctuation run and its follower matter
    // past this known tag boundary, independently of the horizontal padding's width.
    let end = mark + 1;
    while (end < text.length && TRIM_MARKS.includes(text[end])) {
      end++;
    }
    source = `> ${text.slice(mark, end + 1).join('')}`;
    start = 1;
  }
  TRIM_AT.lastIndex = start;
  COMMA_GAP_AT.lastIndex = start;
  return (active('trim_before_punctuation') && TRIM_AT.test(source)) ||
    (active('space_after_comma') && COMMA_GAP_AT.test(source))
    ? mark
    : at;
}

function shouldKeepGlued(beforeDot, afterDot, terminator, portFollows) {
  const lower = afterDot.toLowerCase();

  return (
    isKnownTld(afterDot, portFollows) ||
    isKnownExtension(lower) ||
    isCapitalizedTechName(beforeDot, afterDot) ||
    isPartOfMultiSegmentId(terminator)
  );
}

const boundaryActivity = sessionMap();

export function bindBoundaryActivity(ctx, activity) {
  boundaryActivity.set(ctx, activity);
}

const WORD_MARK_RE =
  /(?<![a-zа-яё0-9])([a-zа-яё0-9]+)([ \t\u{00A0}]*)([.:),…]|[!?]+)(?=[а-яёa-z])/giu;
const AFTER_PERIOD_RE = /[а-яёa-z]+/iuy;
const PLAIN_GAP_RE = /^[ \t]*$/u;
const PUNCTUATION_START_RE = /[ \t\u{00A0}\n]/u;
const PERIOD_START_RE = /[ \t\u{00A0}]/u;
// A surname glued to its initials starts a word as well: `nobr.nowrap_initials` parts `Т.И.Дя :a`
// from them four groups later, and the next pass would space its mark then.
const SURNAME_RE = new RegExp(`^${SURNAME}$`, 'u');
const INITIALS_BEFORE_RE = new RegExp(`(?<=(?:\\s|^|[.,;:?!])${DOTTED_INITIALS})`, 'uy');
const afterGluedInitials = (text, offset, word) => {
  INITIALS_BEFORE_RE.lastIndex = offset;
  return SURNAME_RE.test(word) && INITIALS_BEFORE_RE.test(text);
};

// What one reading of a call's text wrote for each owner, so the reader that runs next on the same
// text takes its output instead of reading the text again.
const boundaryOutputs = sessionMap();

// Both readers compute the same prospective boundaries. Only the requested owner writes its
// marks, so virtual spacing never appears as another rule's output or trace.
function spaceBoundaries(ctx, owner) {
  const { text } = ctx;
  const active = boundaryActivity.get(ctx)();
  const known = boundaryOutputs.get(ctx);
  if (
    known !== undefined &&
    known.text === text &&
    known.periods === active.periods &&
    known.punctuation === active.punctuation
  ) {
    return owner === 'period' ? known.periodOutput : known.punctuationOutput;
  }
  const periodParts = [];
  const punctuationParts = [];
  const state = { previous: -1 };
  let cursor = 0;
  WORD_MARK_RE.lastIndex = 0;
  for (let m = WORD_MARK_RE.exec(text); m !== null; m = WORD_MARK_RE.exec(text)) {
    const [full] = m;
    const written = boundaryAt(text, active, m, state);
    if (written !== full) {
      const between = text.slice(cursor, m.index);
      const period = m[3] === '.';
      periodParts.push(between, period ? written : full);
      punctuationParts.push(between, period ? full : written);
      cursor = m.index + full.length;
    }
  }
  const periodOutput = cursor === 0 ? text : periodParts.join('') + text.slice(cursor);
  const punctuationOutput = cursor === 0 ? text : punctuationParts.join('') + text.slice(cursor);
  boundaryOutputs.set(ctx, {
    text,
    periods: active.periods,
    punctuation: active.punctuation,
    periodOutput,
    punctuationOutput
  });
  return owner === 'period' ? periodOutput : punctuationOutput;
}

// What a match of WORD_MARK_RE writes, `${word}${mark}${separator}`, or the match itself where it
// stays; `state.previous` is where the last boundary written so far ends.
function boundaryAt(text, active, m, state) {
  const [full, word, gap, mark] = m;
  const offset = m.index;
  const period = mark === '.';
  if (!(period ? active.periods : active.punctuation)) {
    return full;
  }
  const boundary = period ? PERIOD_START_RE : PUNCTUATION_START_RE;
  if (
    offset !== 0 &&
    offset !== state.previous &&
    !boundary.test(text[offset - 1]) &&
    !afterGluedInitials(text, offset, word)
  ) {
    return full;
  }
  if (gap !== G.NBSP && !PLAIN_GAP_RE.test(gap)) {
    return full;
  }
  const afterMark = offset + full.length;
  let separator = ' ';
  if (period) {
    AFTER_PERIOD_RE.lastIndex = afterMark;
    const [zone] = AFTER_PERIOD_RE.exec(text);
    if (zone.length < 5 && gap !== '') {
      return full;
    }
    const next = text[afterMark + zone.length] ?? '';
    const port = next === ':' && /[0-9]/u.test(text[afterMark + zone.length + 1] ?? '');
    separator = shouldKeepGlued(word, zone, next, port) ? '' : ' ';
  }
  if (separator !== '') {
    state.previous = afterMark;
  }
  return `${word}${mark}${separator}`;
}

export const spaceGroup = {
  title: 'Расстановка и удаление пробелов',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_two_letter',
      requires: F.SPACE,
      description: 'Неразрывный пробел перед 2-символьной аббревиатурой',
      // Both boundaries are lookarounds: consumed, the shared space of an acronym run would strand
      // the middle one.
      pattern: /(?<=[a-zA-Zа-яёА-ЯЁ])( |\t)+([A-ZА-ЯЁ]{2})(?=[\s;.?!:("»“]|$)/gu,
      replacement: `${G.NBSP}$2`
    },
    {
      id: 'trim_before_punctuation',
      requires: F.SPACE,
      requiresAny:
        F.COMMA | F.COLON | F.PERIOD | F.SEMICOLON | F.QUESTION | F.EXCLAMATION | F.ELLIPSIS,
      description: 'Удаление пробела перед знаками препинания',
      // `(?<!\.\.)` excludes only the `?..` and `!..` suspension marks and not periods in general, so
      // abbreviation trims still fire.
      // Neither boundary is consumed: taking the character before the gap would stop two adjacent
      // runs from both matching in one pass, and taking the whitespace after the marks would swallow
      // the leading whitespace of the next candidate — either way two runs on one line settle a pass
      // apart. What may not be glued is decided by `glueingSwallowsAMark` from the text itself.
      // Marks that end in a comma after another mark end the punctuation even glued to the next word,
      // `а …,и`: `space_after_comma` parts them later in this group. A lone comma may be a decimal one.
      pattern: TRIM_BEFORE_PUNCTUATION,
      replacement: (m) => (glueingSwallowsAMark(m.at(-1), m.at(-2), m[3]) ? m[0] : m[3])
    },
    {
      id: 'space_after_comma',
      requires: F.COMMA,
      description: 'Пробел после запятой',
      // A gap is matched from its first character only: tried from every one, a long gap with no
      // comma behind it is reread to its end each time.
      pattern: [GAP_BEFORE_COMMA_WORD, /([^0-9]),([а-яёa-z0-9«„])/giu],
      replacement: [', $1', '$1, $2']
    },
    {
      id: 'space_after_punctuation',
      requiresAny: F.COLON | F.PAREN | F.COMMA | F.ELLIPSIS | F.EXCLAMATION | F.QUESTION,
      // A mark other than a period glued to the letter after it, which this rule writes a space before.
      requiresPattern: /[:),…!?][а-яёa-z]/iu,
      description: 'Пробел после знаков пунктуации, кроме точки',
      regexes: [WORD_MARK_RE],
      handler: (ctx) => {
        ctx.text = spaceBoundaries(ctx, 'punctuation');
      }
    },
    {
      id: 'space_after_period',
      requires: F.PERIOD,
      requiresPattern: /\.[а-яёa-z]/iu,
      description: 'Пробел после точки',
      regexes: [WORD_MARK_RE, AFTER_PERIOD_RE],
      handler: (ctx) => {
        ctx.text = spaceBoundaries(ctx, 'period');
      }
    },
    {
      id: 'space_after_ellipsis',
      requires: F.PERIOD,
      requiresAny: F.QUESTION | F.EXCLAMATION,
      description: 'Пробел после троеточий с восклицанием/вопросом',
      pattern: /([?!]\.\.)([а-яёa-z])/giu,
      replacement: '$1 $2'
    },
    {
      id: 'collapse_spaces',
      projectSpacedYears: 'gaps',
      requires: F.SPACE,
      description: 'Удаление лишних пробельных символов и табуляций',
      pattern: /( |\t)+/g,
      replacement: ' '
    },
    {
      id: 'strip_quote_padding',
      requires: F.SPACE | F.QUOTE,
      description: 'Удаление пробелов сразу после открывающей и перед закрывающей кавычкой',
      // The gap before a closing quote is matched from its first character only, as in
      // `space_after_comma`.
      pattern: [
        /([«„])( |\t|\u{00A0})+/gu,
        new RegExp(
          `(?<![ \\t${G.NBSP}])${NOT_AFTER_LONE_QUOTE}( |\\t|${G.NBSP})+([${G.RAQUO}${G.LDQUO}])`,
          'gu'
        )
      ],
      replacement: ['$1', '$2']
    },
    {
      id: 'trim_before_percent',
      requires: F.DIGIT | F.PERCENT,
      description: 'Удаление пробела перед %',
      // Intentional: strict typesetting wants 5 %, but modern Russian web practice glues 5%.
      pattern: /(?<!\d)(\d+)([\t ]+)%/g,
      replacement: '$1%'
    },
    {
      id: 'nbsp_before_quote',
      requires: F.SPACE | F.QUOTE,
      description: 'Неразрывный пробел перед открывающей кавычкой',
      // The shared left boundary carries brackets and a newline, so `(в «Амбере»)` and a short word
      // opening a second line lose the same breakable space a bare one does. The quote is only looked
      // at: it is the left boundary of the short word inside it, `«а „б „в`. A particle after a space
      // is no short word: `nobr.nbsp_particle` binds it to the word before and takes this space back.
      // Nor is a unit bound to its number, `5 м «`: the units rules glue it later, and only then.
      pattern: new RegExp(
        `${CONTENT_START_GROUP}(?<!\\d${G.NBSP})([a-zа-яё]{1,2})(?<![ \\t${G.NBSP}](?:${PARTICLE})) (?=[${G.LAQUO}${G.BDQUO}])`,
        'gu'
      ),
      replacement: `$1$2${G.NBSP}`
    },
    {
      id: 'nbsp_before_month',
      requires: F.DIGIT | F.SPACE,
      description: 'Неразрывный пробел в датах перед месяцем',
      pattern:
        /(\d)(\s)+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)([^<]|$)/giu,
      replacement: `$1${G.NBSP}$3$4`
    },
    {
      id: 'trim_line_end',
      requires: F.SPACE,
      description: 'Удаление пробелов в конце текста',
      pattern: /(?<! ) +$/g,
      replacement: ''
    },
    {
      id: 'no_space_after_opening_ellipsis',
      requires: F.ELLIPSIS,
      description: 'Отсутствие пробела после … после открывающей кавычки',
      pattern: /([«„(])( |\u{00A0})?…( |\u{00A0})?([a-zа-яё])/giu,
      replacement: `$1${G.HELLIP}$4`
    },
    {
      id: 'trim_before_parenthetical_ellipsis',
      requires: F.ELLIPSIS | F.PAREN,
      description: 'Удаление пробела перед многоточием в конце скобок',
      pattern: /([a-zа-яё0-9])(?: |\t|\u{00A0})+…(\))/giu,
      replacement: `$1${G.HELLIP}$2`
    },
    {
      id: 'space_after_year',
      requires: F.DIGIT,
      requiresPattern: /\dгод/iu,
      description: 'Пробел после года',
      // A lookahead: the space after the word is the left boundary of the next year. The period of an
      // abbreviation glued to the year is one too: `abbr.nbsp_location` binds `пр.917год` with a space.
      pattern: new RegExp(
        `(^|[ \\t${G.NBSP}${CURRENCY_PREFIX_SIGNS}]|(?<=\\p{L})\\.)([0-9]{3,4})(год([ауе]|ом)?)(?=[^a-zа-яё]|$)`,
        'giu'
      ),
      replacement: '$1$2 $3'
    }
  ]
};
