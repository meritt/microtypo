import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from '../lib/block-tags.js';
import { count } from '../lib/strings.js';
import {
  PARAGRAPH_OPEN,
  PARAGRAPH_CLOSE,
  BREAKLINE,
  OPEN,
  CLOSE
} from '../protect/placeholders.js';

function liftParagraphs(text, ctx) {
  const { tags } = ctx;

  if (!tags) {
    return text;
  }

  const ps = tags.findByTagName(/^p$/i);
  let result = text;

  for (const { prefix, id } of ps) {
    const ph = `${OPEN}${prefix}${id}${CLOSE}`;
    const re = new RegExp(`<\\/?${ph}>`, 'g');
    result = result.replace(re, (m) =>
      m.startsWith('</') ? `${ph}${PARAGRAPH_CLOSE}` : `${PARAGRAPH_OPEN}${ph}`
    );
  }

  return result;
}

function tagPlaceholders(ctx, nameOrRegex) {
  const { tags } = ctx;

  if (!tags) {
    return [];
  }

  return tags.findByTagName(nameOrRegex).map(({ prefix, id }) => `${OPEN}${prefix}${id}${CLOSE}`);
}

const isBlockTagName = (name) => {
  const lower = name.toLowerCase();

  return BLOCK_TAG_NAMES.includes(lower) || VOID_BLOCK_TAG_NAMES.includes(lower);
};
const isVoidBlockTagName = (name) => VOID_BLOCK_TAG_NAMES.includes(name.toLowerCase());

function doParagraphs(text, ctx) {
  let result = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  result = `${PARAGRAPH_OPEN}${result.trim()}${PARAGRAPH_CLOSE}`;

  result = result.replace(
    /([ \t]+)?(\n)+([ \t]*)(\n)+/g,
    (_, p1) => `${p1 ?? ''}${PARAGRAPH_CLOSE}${ctx.iblock('\n\n')}${PARAGRAPH_OPEN}`
  );
  result = result.replace(
    new RegExp(
      `${PARAGRAPH_OPEN}(?:[^${PARAGRAPH_OPEN[0]}${PARAGRAPH_CLOSE[0]}]*?)?${PARAGRAPH_CLOSE}`,
      'g'
    ),
    (m) => (/[^\s]/.test(stripPlaceholders(m)) ? m : '')
  );

  return result;
}

const VAULT_PLACEHOLDER_RE = new RegExp(`${OPEN}[A-Za-z]\\d+${CLOSE}`, 'g');

function stripPlaceholders(s) {
  return s
    .replaceAll(PARAGRAPH_OPEN, '')
    .replaceAll(PARAGRAPH_CLOSE, '')
    .replace(VAULT_PLACEHOLDER_RE, '');
}

function buildParagraphs(ctx) {
  const { text } = ctx;
  const r = text.indexOf(PARAGRAPH_OPEN);
  const p = text.lastIndexOf(PARAGRAPH_CLOSE);

  if (r !== -1 && p !== -1) {
    const beg = text.slice(0, r);
    const mid = text.slice(r + PARAGRAPH_OPEN.length, p);
    const end = text.slice(p + PARAGRAPH_CLOSE.length);

    ctx.text =
      (beg.trim() ? doParagraphs(beg, ctx) + '\n' : '') +
      PARAGRAPH_OPEN +
      mid +
      PARAGRAPH_CLOSE +
      (end.trim() ? '\n' + doParagraphs(end, ctx) : '');
  } else {
    ctx.text = doParagraphs(text, ctx);
  }
}

function buildBreaklines(ctx) {
  let { text } = ctx;

  text = text.replace(
    new RegExp(`(${PARAGRAPH_CLOSE})([\\r\\n \\t]+)(${PARAGRAPH_OPEN})`, 'gms'),
    (_, c, ws, o) => `${c}${ctx.iblock(/[\r\n]/.test(ws) ? '\n\n' : ws)}${o}`
  );

  // Whitespace touching a block-level tag becomes a paragraph break, never <br>: HTML5 forbids <br> across a block boundary.
  const blockPhs = tagPlaceholders(ctx, isBlockTagName);

  if (blockPhs.length > 0) {
    const blockAlt = blockPhs.join('|');

    text = text
      .replace(
        new RegExp(`[ \\t]*[\\r\\n][\\r\\n \\t]*(<(?:${blockAlt})>)`, 'g'),
        (_, tag) => `${ctx.iblock('\n\n')}${tag}`
      )
      .replace(
        new RegExp(`(<\\/(?:${blockAlt})>)[ \\t]*[\\r\\n][\\r\\n \\t]*`, 'g'),
        (_, tag) => `${tag}${ctx.iblock('\n\n')}`
      );
  }

  // Void block tags (<hr>) have no closing placeholder, so the trailing-whitespace gap needs its own pass.
  const voidPhs = tagPlaceholders(ctx, isVoidBlockTagName);

  if (voidPhs.length > 0) {
    const voidAlt = voidPhs.join('|');

    text = text.replace(
      new RegExp(`(<(?:${voidAlt})>)[ \\t]*[\\r\\n][\\r\\n \\t]*`, 'g'),
      (_, tag) => `${tag}${ctx.iblock('\n\n')}`
    );
  }

  if (!text.includes(BREAKLINE)) {
    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

    // An author <br> already breaks its line, so only its adjacent newline is suppressed.
    const brPhs = tagPlaceholders(ctx, /^br\b/i);
    const re = brPhs.length > 0 ? new RegExp(`(?<!<(?:${brPhs.join('|')})>)\\n`, 'g') : /\n/g;

    text = text.replace(re, `${BREAKLINE}\n`);
  }

  ctx.text = text;
}

export const textGroup = {
  title: 'Текст и абзацы',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'autolink',
      description: 'Выделение ссылок из текста',
      // Body excludes "'<> so a URL can't break out of the href attribute.
      pattern: /(\s|^)(http|ftp|mailto|https)(:\/\/)([^\s,!<>"']{4,})(\s|\.|,|!|\?|<|$)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4Raw, p5] = m;
        let body = p4Raw;
        let tail = '';
        while (
          body.length > 4 &&
          (body.endsWith('.') || (body.endsWith(')') && count(body, '(') < count(body, ')')))
        ) {
          tail = body.slice(-1) + tail;
          body = body.slice(0, -1);
        }
        const href = `${p2}${p3}${body}`;

        return `${p1}${ctx.tag(body, 'a', { href })}${tail}${p5}`;
      }
    },
    {
      id: 'email',
      description: 'Выделение эл. почты из текста',
      pattern:
        /(\s|^|\()([a-z0-9\-_.]{2,})@([a-z0-9\-.]{2,})\.([a-z]{2,6})(\)|\s|\.|,|!|\?|$|<)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4, p5] = m;
        const addr = `${p2}@${p3}.${p4}`;

        return `${p1}${ctx.tag(addr, 'a', { href: `mailto:${addr}` })}${p5}`;
      }
    },
    {
      id: 'deduplicate_words',
      description: 'Удаление повторяющихся слов',
      enabled: false,
      pattern: [
        /([а-яё]{3,})( |\t|\u{00A0})\1/giu,
        /(\s|\u{00A0}|^|\.|!|\?)(([А-ЯЁ])([а-яё]{2,}))( |\t|\u{00A0})(([а-яё])\4)/gu
      ],
      replacement: [
        '$1',
        (m) => {
          const [, p1, p2, , p3, , , p7] = m;

          return p7 === p3.toLowerCase() ? `${p1}${p2}` : `${p1}${p2}${m[5]}${m[6]}`;
        }
      ]
    },
    {
      id: 'paragraphs',
      description: 'Простановка параграфов',
      handler: buildParagraphs
    },
    {
      id: 'breakline',
      description: 'Простановка переносов строк',
      handler: buildBreaklines
    }
  ],

  preParse(ctx) {
    ctx.text = liftParagraphs(ctx.text, ctx);
  }
};
