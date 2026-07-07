import { G } from '../lib/glyphs.js';

const DOMAIN_ZONES = new Set([
  'ru',
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
  'ai'
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

function isKnownTld(afterDotLower) {
  return DOMAIN_ZONES.has(afterDotLower);
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

function shouldKeepGlued(beforeDot, afterDot, terminator) {
  const lower = afterDot.toLowerCase();

  return (
    isKnownTld(lower) ||
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
      // Both boundaries are lookarounds: in an acronym run the shared space would strand the middle one if consumed.
      pattern: /(?<=[a-zA-Zа-яёА-ЯЁ])( |\t)+([A-ZА-ЯЁ]{2})(?=[\s;.?!:("»“]|$)/gu,
      replacement: `${G.NBSP}$2`
    },
    {
      id: 'trim_before_punctuation',
      description: 'Удаление пробела перед знаками препинания',
      // (?<!\.\.) excludes only the ?.. / !.. suspension mark, not periods in general, so abbreviation trims still fire.
      pattern: /(?<!\.\.)(?<![ \t\u{00A0}])(( |\t|\u{00A0})+)([,:.;?!…]+)(\s+|$)/gu,
      replacement: '$3$4'
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
      pattern: [
        /( |\t|\u{00A0}|^)([a-zа-яё0-9]+)( |\t|\u{00A0})?\.([а-яёa-z]{5,})($|[^a-zа-яё])/giu,
        /( |\t|\u{00A0}|^)([a-zа-яё0-9]+)\.([а-яёa-z]{1,4})($|[^a-zа-яё])/giu
      ],
      replacement: [
        (m) => `${m[1]}${m[2]}.${m[5] === '.' ? '' : ' '}${m[4]}${m[5]}`,
        (m) => {
          const sep = shouldKeepGlued(m[2], m[3], m[4]) || m[4] === '.' ? '' : ' ';

          return `${m[1]}${m[2]}.${sep}${m[3]}${m[4]}`;
        }
      ]
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
      pattern: /(^| |\t|>)([a-zа-яё]{1,2}) ([«„])/gu,
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
      replacement: `$1…$4`
    },
    {
      id: 'trim_before_parenthetical_ellipsis',
      description: 'Удаление пробела перед многоточием в конце скобок',
      pattern: /([a-zа-яё0-9])(?: |\t|\u{00A0})+…(\))/giu,
      replacement: '$1…$2'
    },
    {
      id: 'space_after_year',
      description: 'Пробел после года',
      pattern: /(^| |\u{00A0})([0-9]{3,4})(год([ауе]|ом)?)([^a-zа-яё]|$)/giu,
      replacement: '$1$2 $3$5'
    }
  ]
};
