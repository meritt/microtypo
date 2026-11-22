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
  [
    F.SPACE,
    ' \t\n\r\v\f\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}'
  ],
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

export function featureMask(text, features) {
  if (text === features.text) {
    return features.mask;
  }
  if (text === features.previousText) {
    return features.previousMask;
  }

  let mask = 0;
  for (let index = 0; index < text.length; index += 1) {
    // Each surrogate has the same conservative mask as the astral code point it may form.
    // oxlint-disable-next-line unicorn/prefer-code-point
    const code = text.charCodeAt(index);
    const known = BY_CODE[code];
    mask |= known || (code >= 0x80 ? F.LATIN | F.CYRILLIC : 0);
  }

  features.previousText = features.text;
  features.previousMask = features.mask;
  features.text = text;
  features.mask = mask;
  return mask;
}

export function hasRequiredFeatures(rule, text, features) {
  const required = rule.requires ?? 0;
  const any = rule.requiresAny ?? 0;
  if (required === 0 && any === 0) {
    return true;
  }

  const mask = featureMask(text, features);
  return (mask & required) === required && (any === 0 || (mask & any) !== 0);
}
