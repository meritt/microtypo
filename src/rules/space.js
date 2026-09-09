import { CONTENT_START_GROUP } from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
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

function shouldKeepGlued(beforeDot, afterDot, terminator, portFollows) {
  const lower = afterDot.toLowerCase();

  return (
    isKnownTld(afterDot, portFollows) ||
    isKnownExtension(lower) ||
    isCapitalizedTechName(beforeDot, afterDot) ||
    isPartOfMultiSegmentId(terminator)
  );
}

export const spaceGroup = {
  title: 'Расстановка и удаление пробелов',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_two_letter',
      description: 'Неразрывный пробел перед 2-символьной аббревиатурой',
      // Both boundaries are lookarounds: consumed, the shared space of an acronym run would strand
      // the middle one.
      pattern: /(?<=[a-zA-Zа-яёА-ЯЁ])( |\t)+([A-ZА-ЯЁ]{2})(?=[\s;.?!:("»“]|$)/gu,
      replacement: `${G.NBSP}$2`
    },
    {
      id: 'trim_before_punctuation',
      description: 'Удаление пробела перед знаками препинания',
      // `(?<!\.\.)` excludes only the `?..` and `!..` suspension marks and not periods in general, so
      // abbreviation trims still fire.
      // Neither boundary is consumed: taking the character before the gap would stop two adjacent
      // runs from both matching in one pass, and taking the whitespace after the marks would swallow
      // the leading whitespace of the next candidate — either way two runs on one line settle a pass
      // apart. What may not be glued is decided by `glueingSwallowsAMark` from the text itself.
      pattern: /(?<!\.\.)(?<=[^ \t\u{00A0}])(( |\t|\u{00A0})+)([,:.;?!…]+)(?=\s|$)/gu,
      replacement: (m) => (glueingSwallowsAMark(m.at(-1), m.at(-2), m[3]) ? m[0] : m[3])
    },
    {
      id: 'space_after_comma',
      description: 'Пробел после запятой',
      pattern: [/( |\t|\u{00A0}),([а-яёa-z0-9])/giu, /([^0-9]),([а-яёa-z0-9«„])/giu],
      replacement: [', $2', '$1, $2']
    },
    {
      id: 'space_after_punctuation',
      description: 'Пробел после знаков пунктуации, кроме точки',
      pattern:
        /( |\t|\u{00A0}|^|\n)([a-zа-яё0-9]+)( |\t|\u{00A0})?(:|\)|,|…|(?:!|\?)+)([а-яёa-z])/giu,
      replacement: '$1$2$4 $5'
    },
    {
      id: 'space_after_period',
      description: 'Пробел после точки',
      // Both branches ask the same question, so they hand it to one callback: the gap the long
      // branch tolerates is non-capturing, which puts the host, the zone and the follower in the
      // same three slots.
      pattern: [
        /( |\t|\u{00A0}|^)([a-zа-яё0-9]+)(?: |\t|\u{00A0})?\.([а-яёa-z]{5,})($|[^a-zа-яё])/giu,
        /( |\t|\u{00A0}|^)([a-zа-яё0-9]+)\.([а-яёa-z]{1,4})($|[^a-zа-яё])/giu
      ],
      replacement: (m) => {
        const [full, lead, host, zone, next, offset, source] = m;
        // `next` is the one character the pattern consumed after the zone; a port needs the digit
        // behind it too, which only the source can answer.
        const portFollows = next === ':' && /^\d/.test(source.slice(offset + full.length));
        const sep = shouldKeepGlued(host, zone, next, portFollows) ? '' : ' ';

        return `${lead}${host}.${sep}${zone}${next}`;
      }
    },
    {
      id: 'space_after_ellipsis',
      description: 'Пробел после троеточий с восклицанием/вопросом',
      pattern: /([?!]\.\.)([а-яёa-z])/giu,
      replacement: '$1 $2'
    },
    {
      id: 'collapse_spaces',
      description: 'Удаление лишних пробельных символов и табуляций',
      pattern: /( |\t)+/g,
      replacement: ' '
    },
    {
      id: 'strip_quote_padding',
      description: 'Удаление пробелов сразу после открывающей и перед закрывающей кавычкой',
      pattern: [/([«„])( |\t|\u{00A0})+/gu, /( |\t|\u{00A0})+([»“])/gu],
      replacement: ['$1', '$2']
    },
    {
      id: 'trim_before_percent',
      description: 'Удаление пробела перед %',
      // Intentional: strict typesetting wants 5 %, but modern Russian web practice glues 5%.
      pattern: /(?<!\d)(\d+)([\t ]+)%/g,
      replacement: '$1%'
    },
    {
      id: 'nbsp_before_quote',
      description: 'Неразрывный пробел перед открывающей кавычкой',
      // The shared left boundary carries brackets and a newline, so `(в «Амбере»)` and a short word
      // opening a second line lose the same breakable space a bare one does.
      pattern: new RegExp(`${CONTENT_START_GROUP}([a-zа-яё]{1,2}) ([${G.LAQUO}${G.BDQUO}])`, 'gu'),
      replacement: `$1$2${G.NBSP}$3`
    },
    {
      id: 'nbsp_before_month',
      description: 'Неразрывный пробел в датах перед месяцем',
      pattern:
        /(\d)(\s)+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)([^<]|$)/giu,
      replacement: `$1${G.NBSP}$3$4`
    },
    {
      id: 'trim_line_end',
      description: 'Удаление пробелов в конце текста',
      pattern: / +$/g,
      replacement: ''
    },
    {
      id: 'no_space_after_opening_ellipsis',
      description: 'Отсутствие пробела после … после открывающей кавычки',
      pattern: /([«„(])( |\u{00A0})?…( |\u{00A0})?([a-zа-яё])/giu,
      replacement: `$1${G.HELLIP}$4`
    },
    {
      id: 'trim_before_parenthetical_ellipsis',
      description: 'Удаление пробела перед многоточием в конце скобок',
      pattern: /([a-zа-яё0-9])(?: |\t|\u{00A0})+…(\))/giu,
      replacement: `$1${G.HELLIP}$2`
    },
    {
      id: 'space_after_year',
      description: 'Пробел после года',
      pattern: /(^| |\u{00A0})([0-9]{3,4})(год([ауе]|ом)?)([^a-zа-яё]|$)/giu,
      replacement: '$1$2 $3$5'
    }
  ]
};
