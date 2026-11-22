import { WHITESPACE } from './strings.js';

export const F = Object.freeze({
  SPACE: 1 << 0,
  DIGIT: 1 << 1,
  QUOTE: 1 << 2,
  DASH: 1 << 3,
  PERIOD: 1 << 4,
  COMMA: 1 << 5,
  COLON: 1 << 6,
  EXCLAMATION: 1 << 7,
  QUESTION: 1 << 8,
  PAREN: 1 << 9,
  APOSTROPHE: 1 << 10,
  DEGREE: 1 << 11,
  SLASH: 1 << 12,
  MATH: 1 << 13,
  CARET: 1 << 14,
  UNDERSCORE: 1 << 15,
  NUMERO: 1 << 16,
  SECTION: 1 << 17,
  ELLIPSIS: 1 << 18,
  FRACTION: 1 << 19,
  LATIN: 1 << 20,
  COPYRIGHT: 1 << 21,
  MARKUP: 1 << 22,
  BACKTICK: 1 << 23,
  PERCENT: 1 << 24,
  MONEY: 1 << 25,
  SEMICOLON: 1 << 26,
  CYRILLIC: 1 << 27,
  NEWLINE: 1 << 28,
  AT: 1 << 29,
  SOURCE: 1 << 30
});

const BY_CODE = new Uint32Array(0x10000);
const CHARACTER_SETS = [
  [F.SPACE, WHITESPACE],
  [F.DIGIT, '0123456789'],
  [F.QUOTE, '"«»„“'],
  [F.DASH, '-—–−'],
  [F.PERIOD, '.'],
  [F.COMMA, ','],
  [F.COLON, ':'],
  [F.EXCLAMATION, '!'],
  [F.QUESTION, '?'],
  [F.PAREN, '()'],
  [F.APOSTROPHE, "'"],
  [F.DEGREE, '°'],
  [F.SLASH, '/'],
  [F.MATH, '=+'],
  [F.CARET, '^'],
  [F.UNDERSCORE, '_'],
  [F.NUMERO, '№'],
  [F.SECTION, '§'],
  [F.ELLIPSIS, '…'],
  [F.FRACTION, '½¼¾'],
  [F.LATIN, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  [F.COPYRIGHT, '©'],
  [F.MARKUP, '<'],
  [F.BACKTICK, '`'],
  [F.PERCENT, '%'],
  [F.MONEY, '$€₽'],
  [F.SEMICOLON, ';'],
  [F.CYRILLIC, 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'],
  [F.NEWLINE, '\r\n'],
  [F.AT, '@'],
  [
    F.SOURCE,
    '&<>{}[]*_`.:@-\r\n\u{2010}\u{2012}\u{201C}\u{201D}\u{201E}\u{201F}\u{E000}\u{E001}\u{E100}\u{E101}'
  ]
];

for (const [feature, characters] of CHARACTER_SETS) {
  for (const character of characters) {
    BY_CODE[character.codePointAt(0)] |= feature;
  }
}
// Any other non-ASCII unit may be a letter of either script; each surrogate gets the same
// conservative mask as the astral code point it may form.
for (let code = 0x80; code < BY_CODE.length; code += 1) {
  BY_CODE[code] ||= F.LATIN | F.CYRILLIC;
}

// The scan of `text` the last two texts asked about left: `{ text, mask, at }`, its features in the
// first `at` code units. A text is read only as far as the question asked of it needs: a feature
// found stays found, so a mask that already answers the question answers it for the whole text.
function scanOf(text, features) {
  if (text === features.text) {
    return features.scan;
  }
  if (text === features.previousText) {
    return features.previousScan;
  }

  const scan = { mask: 0, at: 0 };
  features.previousText = features.text;
  features.previousScan = features.scan;
  features.text = text;
  features.scan = scan;
  return scan;
}

// Reads on until the mask holds all of `required` and some of `any` (0 for none asked), or the
// text ends.
function scanFor(text, scan, required, any) {
  let { mask, at } = scan;
  for (; at < text.length; at += 1) {
    if ((mask & required) === required && (any === 0 || (mask & any) !== 0)) {
      break;
    }
    // oxlint-disable-next-line unicorn/prefer-code-point
    mask |= BY_CODE[text.charCodeAt(at)];
  }
  scan.mask = mask;
  scan.at = at;
  return mask;
}

export function featureMask(text, features) {
  return scanFor(text, scanOf(text, features), -1, 0);
}

export function holdsAnyFeature(text, features, any) {
  return (scanFor(text, scanOf(text, features), 0, any) & any) !== 0;
}

export function hasRequiredFeatures(rule, text, features, lexical = true) {
  const required = rule.requires ?? 0;
  const any = rule.requiresAny ?? 0;
  if (required !== 0 || any !== 0) {
    const mask = scanFor(text, scanOf(text, features), required, any);
    if ((mask & required) !== required || (any !== 0 && (mask & any) === 0)) {
      return false;
    }
  }

  return !lexical || (rule.requiresPattern?.test(text) ?? true);
}
