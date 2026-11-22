import { CONTENT_END_LOOKAHEAD, CONTENT_OPEN_BRACKETS, CONTENT_START } from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { F } from '../lib/rule-features.js';
import { CLOSE } from '../protect/placeholders.js';
import { PARTICLE } from './space.js';

// What a short word glues itself to: an optional second short word, then a word or a digit.
const SHORT_WORD_TAIL = `([a-zа-яё]{1,2}[ \\t]+)?(?!-+(?![a-zа-яё0-9-]))([a-zа-яё0-9-]{2,}|[0-9])`;

const WORD_START_RE = /[\p{L}\p{N}]/uy;
const ACRONYM_AHEAD_RE = /[A-ZА-ЯЁ]{2}(?=[\s;.?!:("»“]|$)/uy;
const SHORT_WORD_AHEAD_RE = new RegExp(`[a-zа-яё]{1,2}[ \\t]+${SHORT_WORD_TAIL}`, 'iuy');

const startsWith = (re, source, at) => {
  re.lastIndex = at;

  return re.test(source);
};

// A particle binds to the word before it, so the no-break space `nbsp_short_word` glued it to the
// next word with goes back to a space. Not one in front of a dash or an acronym, which binds them to
// the particle, and not one in front of a short word the space would leave for `nbsp_short_word` to
// glue on the next pass.
function takesGlueBack(source, at) {
  return (
    startsWith(WORD_START_RE, source, at) &&
    !startsWith(ACRONYM_AHEAD_RE, source, at) &&
    !startsWith(SHORT_WORD_AHEAD_RE, source, at)
  );
}

function wrapPhone(ctx, m) {
  const [, p1, p2, , p4, , p6, , p8, , p10, p11] = m;
  const inner = `${p2} ${p4} ${p6}-${p8}-${p10}`;

  return tagPhone(ctx, p1, inner, p11);
}

function tagPhone(ctx, left, inner, right) {
  if (left === '>' || right === '<') {
    return `${left}${inner}${right}`;
  }

  return `${left}${ctx.tag(inner, 'span', { class: 'nowrap' })}${right}`;
}

function wrapCompactPlusPhone(ctx, m) {
  const [, p1, area, lead, mid, tail, p6] = m;

  return tagPhone(ctx, p1, `+7 ${area} ${lead}-${mid}-${tail}`, p6);
}

function wrapCompactLocalPhone(ctx, m) {
  const [, p1, label, area, lead, mid, tail, p7] = m;
  const inner = `8 ${area} ${lead}-${mid}-${tail}`;

  if (p7 === '<') {
    return `${p1}${label}${inner}${p7}`;
  }

  return `${p1}${label}${ctx.tag(inner, 'span', { class: 'nowrap' })}${p7}`;
}

function ipNowrap(ctx, ip) {
  for (const part of ip.split('.')) {
    if (Number.parseInt(part, 10) > 255) {
      return ip;
    }
  }

  return ctx.tag(ip, 'span', { class: 'nowrap' });
}

function degreeUnit(unit) {
  return unit === 'С' ? 'C' : unit;
}

export const nobrGroup = {
  title: 'Неразрывные конструкции',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'nbsp_short_word',
      requires: F.SPACE,
      description: 'Привязка союзов и предлогов к следующему слову',
      // Not `CONTENT_START`: that one starts with `\s`, which matches a non-breaking space, and this
      // rule must not glue across one it already wrote. So the whitespace half stays ASCII-only and
      // the openers come from the shared bracket half, plus the two ends a protected region and a
      // tag leave in front of content. Trailing gaps stay horizontal, so the glue never crosses a
      // line break.
      //
      // Deliberately broad: any one- or two-letter word is glued, false positives accepted. Not a
      // particle `nbsp_particle` bound to the dash before it: that dash keeps its own no-break space
      // in front of the particle, and the particle took its glue to the next word back.
      pattern: new RegExp(
        `([ \\t\\n\\r]|^|[${CONTENT_OPEN_BRACKETS}]|>|${CLOSE}|${G.MDASH}${G.NBSP})([a-zа-яё]{1,2}(?<!${G.NBSP}${G.MDASH}${G.NBSP}(?:${PARTICLE}))[ \\t]+)${SHORT_WORD_TAIL}`,
        'giu'
      ),
      replacement: (m) => {
        const [, p1, p3, p4, p5] = m;

        return `${p1}${p3.trim()}${G.NBSP}${p4 ? p4.trim() + G.NBSP : ''}${p5}`;
      }
    },
    {
      id: 'nbsp_final_word',
      requires: F.SPACE | F.PERIOD,
      description: 'Привязка предлогов к предыдущему слову в конце предложения',
      pattern: /((?<![a-zа-яё0-9-])[a-zа-яё0-9-]{3,}) ([a-zа-яё]{1,2})\.( [A-ZА-ЯЁ]|$)/gu,
      replacement: `$1${G.NBSP}$2.$3`
    },
    {
      id: 'nowrap_phone',
      requires: F.DIGIT,
      requiresPattern: /[-−+]|тел/iu,
      description: 'Неразрывные номера телефонов',
      pattern: [
        /([^\d+]|^)(\+?[0-9]{1,3})( |\u{00A0}|\u{2009})([0-9]{3,4}|\([0-9]{3,4}\))( |\u{00A0}|\u{2009})([0-9]{2,3})([-−])([0-9]{2})([-−])([0-9]{2})([^\d]|$)/gu,
        /([^\d+]|^)(\+?[0-9]{1,3})( |\u{00A0}|\u{2009})([0-9]{3,4}|[0-9]{3,4})( |\u{00A0}|\u{2009})([0-9]{2,3})([-−])([0-9]{2})([-−])([0-9]{2})([^\d]|$)/gu,
        /([^\d+]|^)\+7([0-9]{3})([0-9]{3})([0-9]{2})([0-9]{2})([^\d]|$)/gu,
        /(^|[^a-zа-яё0-9+])((?:тел|телефон)\.?:?\s*)8([0-9]{3})([0-9]{3})([0-9]{2})([0-9]{2})([^\d]|$)/giu
      ],
      replacement: [
        (m, ctx) => wrapPhone(ctx, m),
        (m, ctx) => wrapPhone(ctx, m),
        (m, ctx) => wrapCompactPlusPhone(ctx, m),
        (m, ctx) => wrapCompactLocalPhone(ctx, m)
      ]
    },
    {
      id: 'nowrap_phone_alt',
      requires: F.DIGIT | F.MATH | F.PAREN,
      description: 'Доп. формат номеров телефонов',
      pattern: /([^\d]|^)\+\s?([0-9]{1})\s?\(([0-9]{3,4})\)\s?(\d{3})(\d{2})(\d{2})([^\d]|$)/gi,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4, p5, p6, p7] = m;

        return `${p1}${ctx.tag(`+${p2} ${p3} ${p4}-${p5}-${p6}`, 'span', { class: 'nowrap' })}${p7}`;
      }
    },
    {
      id: 'nowrap_ip',
      requires: F.DIGIT | F.PERIOD,
      description: 'Объединение IP-адресов',
      pattern: /(\s|\u{00A0}|^)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gu,
      replacement: (m, ctx) => `${m[1]}${ipNowrap(ctx, m[2])}`
    },
    {
      id: 'initials_dots',
      requires: F.SPACE,
      requiresPattern: /[А-ЯЁ](?![а-яёА-ЯЁ])/u,
      description: 'Простановка точек к инициалам у фамилии',
      enabled: false,
      pattern: [
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ])\.?(\s)?([А-ЯЁ])(\s)([А-ЯЁ][а-яё]+)(\s|$|\.|,|;|:|\?|!)/gu,
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ][а-яё]+)(\s)([А-ЯЁ])\.?(\s)?([А-ЯЁ])\.?(\s|$|\.|,|;|:|\?|!)/gu
      ],
      replacement: [
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]}. ${m[4]}. ${m[6]}`, 'span', { class: 'nowrap' })}${m[7]}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]} ${m[4]}. ${m[6]}.`, 'span', { class: 'nowrap' })}${m[7]}`
      ]
    },
    {
      id: 'nowrap_initials',
      requiresAny: F.SPACE | F.PERIOD,
      requiresPattern: /[А-ЯЁ](?![а-яёА-ЯЁ])/u,
      description: 'Привязка инициалов к фамилиям',
      pattern: [
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ])\.(\s)?([А-ЯЁ])\.(\s)?([А-ЯЁ][а-яё]+)(\s|$|\.|,|;|:|\?|!)/gu,
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ][а-яё]+)(\s)([А-ЯЁ])\.(\s)?([А-ЯЁ])\.(\s|$|\.|,|;|:|\?|!)/gu,
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ])(\s)?([А-ЯЁ])(\s)([А-ЯЁ][а-яё]+)(\s|$|\.|,|;|:|\?|!)/gu,
        /(\s|^|\.|,|;|:|\?|!)([А-ЯЁ][а-яё]+)(\s)([А-ЯЁ])(\s)?([А-ЯЁ])(\s|$|\.|,|;|:|\?|!)/gu
      ],
      replacement: [
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]}. ${m[4]}. ${m[6]}`, 'span', { class: 'nowrap' })}${m[7]}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]} ${m[4]}. ${m[6]}.`, 'span', { class: 'nowrap' })}${m[7]}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]}${m[3] ? ' ' : ''}${m[4]}${m[5] ? ' ' : ''}${m[6]}`, 'span', { class: 'nowrap' })}${m[7]}`,
        (m, ctx) =>
          `${m[1]}${ctx.tag(`${m[2]} ${m[4]}${m[5] ? ' ' : ''}${m[6]}`, 'span', { class: 'nowrap' })}${m[7]}`
      ]
    },
    {
      id: 'nbsp_particle',
      requires: F.SPACE,
      description: 'Неразрывный пробел перед частицей',
      // At the end of the text, before `!` and before `)` only a lowercase particle after a word
      // binds: `а - б` and `зон А и Б` end in a letter, not the particle.
      // Cycled: a particle the glue it took back leaves after a space binds too, `ли ли он`.
      cycled: true,
      pattern: [
        new RegExp(
          `(?<![ \\t])( |\\t)+(${PARTICLE})(?:(${G.NBSP})|(?=[.,:;${G.HELLIP}?\\s]))`,
          'gu'
        ),
        /(?<=\p{L})[ \t]+(ли|бы|б|же|ж)(?=!|\)|$)/gu
      ],
      replacement: [
        (m) => {
          const [match, , particle, glue, offset, source] = m;
          const after = glue === undefined ? '' : G.NBSP;

          return `${G.NBSP}${particle}${glue !== undefined && takesGlueBack(source, offset + match.length) ? ' ' : after}`;
        },
        `${G.NBSP}$1`
      ]
    },
    {
      id: 'nbsp_after_particle',
      requires: F.SPACE | F.DASH,
      requiresPattern: /-/u,
      description: 'Неразрывный пробел после усилительной частицы: Поди-кась так → Поди-кась так',
      // The leading boundary anchors the match start, so the greedy `[а-яё]+` cannot retry from every
      // offset. Both boundaries are only looked at: the word after the gap may be the next particle
      // word, `е-ка ь-ка к`, and it needs the gap as its own left boundary.
      pattern: /(?<=\s|^|>)([а-яё]+-(?:кась|тка|тко|ка|де)) (?=[а-яё])/giu,
      replacement: `$1${G.NBSP}`
    },
    {
      id: 'nbsp_namely',
      requires: F.SPACE | F.COLON,
      description: 'Неразрывный пробел в "как то"',
      pattern: /как то:/giu,
      replacement: `как${G.NBSP}то:`
    },
    {
      id: 'nbsp_celsius',
      requires: F.DIGIT | F.DEGREE,
      description: 'Привязка градусов к числу (включая ±, +, − перед числом)',
      // A temperature is a measurement like any other, so it shares the boundary sets and `(20 °C)`
      // gets the non-breaking space a bare `20 °C` does. `+` and `±` are extra here — a signed
      // reading is still a reading, and `±` opens content nowhere else — and the closer stays a
      // lookahead so a range binds both ends.
      pattern: new RegExp(
        `(^|[${CONTENT_START}+${G.PLUSMN}])(\\d+)( |${G.NBSP})?${G.DEG}(C|С|F)${CONTENT_END_LOOKAHEAD}`,
        'gu'
      ),
      replacement: (m) => `${m[1]}${m[2]}${G.NBSP}${G.DEG}${degreeUnit(m[4])}`
    },
    {
      id: 'nowrap_hyphen_short',
      requires: F.DASH,
      description: 'Пятисимвольные слова с дефисом в неразрывные блоки',
      enabled: false,
      cycled: true,
      pattern:
        /(\s|>|^)([a-zа-яё]{1}-[a-zа-яё]{4}|[a-zа-яё]{2}-[a-zа-яё]{3}|[a-zа-яё]{3}-[a-zа-яё]{2}|[a-zа-яё]{4}-[a-zа-яё]{1}|когда-то|кое-как|кой-кого|вс[её]-таки|[а-яё]+-(кась|ка|де))(\s|\.|,|!|\?|…|$)/giu,
      replacement: (m, ctx) => `${m[1]}${ctx.tag(m[2], 'span', { class: 'nowrap' })}${m[4]}`
    },
    {
      id: 'nowrap_hyphen',
      requires: F.DASH,
      description: 'Отмена переноса слова с дефисом',
      enabled: false,
      cycled: true,
      pattern: /(\u{00A0}|\s|>|^)([a-zа-яё]+)((-([a-zа-яё]+)){1,2})(\s|\.|,|!|\?|\u{00A0}|…|$)/giu,
      replacement: (m, ctx) =>
        `${m[1]}${ctx.tag(`${m[2]}${m[3]}`, 'span', { class: 'nowrap' })}${m[6]}`
    }
  ]
};
