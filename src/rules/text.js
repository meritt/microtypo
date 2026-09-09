import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from '../lib/block-tags.js';
import { count } from '../lib/strings.js';
import {
  PARAGRAPH_OPEN,
  PARAGRAPH_CLOSE,
  BREAKLINE,
  OPEN,
  CLOSE,
  RESERVED_PUA_CLASS,
  TAG_PLACEHOLDER_SOURCE
} from '../protect/placeholders.js';

// A vault id is minted per `process()`, so every regex built from one is built per call. Keeping the
// shapes in these two builders is what lets the handler rules below declare exactly what they run to
// the static ReDoS check: the declaration calls them with a sample placeholder rather than restating
// the patterns, so a shape cannot change in one place and stay unchecked in the other.
const blockBoundaryRes = (alternation) => [
  new RegExp(`[ \\t]*[\\r\\n][\\r\\n \\t]*(?=<\\/?(?:${alternation})>)`, 'g'),
  new RegExp(`(<\\/?(?:${alternation})>)[ \\t]*[\\r\\n][\\r\\n \\t]*`, 'g')
];

const afterAuthorBreakRe = (alternation) => new RegExp(`(?<!<(?:${alternation})>)\\n`, 'g');

const SAMPLE_PLACEHOLDER = `${OPEN}T1${CLOSE}`;

const ANY_TAG_LIFT_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'g');

const PARAGRAPH_SPLIT_RE = /([ \t]+)?(\n)+([ \t]*)(\n)+/g;

const EMPTY_PARAGRAPH_RE = new RegExp(
  `${PARAGRAPH_OPEN}(?:[^${PARAGRAPH_OPEN[0]}${PARAGRAPH_CLOSE[0]}]*?)?${PARAGRAPH_CLOSE}`,
  'g'
);

const PARAGRAPH_GAP_RE = new RegExp(
  `(${PARAGRAPH_CLOSE})([\\r\\n \\t]+)(${PARAGRAPH_OPEN})`,
  'gms'
);

// One pass over every tag placeholder, not one pass per `<p>`: a document whose paragraphs each
// carry their own attributes mints a distinct placeholder for each, and a replace per placeholder
// made the lift quadratic in their count.
function liftParagraphs(text, ctx) {
  const ps = new Set(tagPlaceholders(ctx, /^p$/i));

  if (ps.size === 0) {
    return text;
  }

  return text.replace(ANY_TAG_LIFT_RE, (m, slash, ph) => {
    if (!ps.has(ph)) {
      return m;
    }

    return slash === '/' ? `${ph}${PARAGRAPH_CLOSE}` : `${PARAGRAPH_OPEN}${ph}`;
  });
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

const unwrapParagraph = (paragraph) =>
  paragraph.replaceAll(PARAGRAPH_OPEN, '').replaceAll(PARAGRAPH_CLOSE, '');

function doParagraphs(text, ctx) {
  let result = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  result = `${PARAGRAPH_OPEN}${result.trim()}${PARAGRAPH_CLOSE}`;
  // Same content, same placeholder (the vault dedups), so this one token is all an otherwise-empty
  // paragraph may still hold. Every other placeholder stands for real content — a fenced block, a
  // template expression — and a paragraph holding one is not empty.
  const gap = ctx.iblock('\n\n');
  const isEmpty = (paragraph) => !/\S/.test(unwrapParagraph(paragraph).replaceAll(gap, ''));

  result = result.replace(
    PARAGRAPH_SPLIT_RE,
    (_, p1) => `${p1 ?? ''}${PARAGRAPH_CLOSE}${gap}${PARAGRAPH_OPEN}`
  );

  return result.replace(EMPTY_PARAGRAPH_RE, (m) => (isEmpty(m) ? '' : m));
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
    PARAGRAPH_GAP_RE,
    (_, c, ws, o) => `${c}${ctx.iblock(/[\r\n]/.test(ws) ? '\n\n' : ws)}${o}`
  );

  // Whitespace touching a block-level tag becomes a paragraph break, never a `<br>`: HTML forbids one
  // across a block boundary. All four sides, because a chunk left unwrapped — one holding only block
  // markup — brings back the inner two. The opening form covers void block tags too, which have no
  // closing placeholder of their own.
  const blockPhs = tagPlaceholders(ctx, isBlockTagName);

  if (blockPhs.length > 0) {
    const [beforeBlock, afterBlock] = blockBoundaryRes(blockPhs.join('|'));

    text = text
      .replace(beforeBlock, () => ctx.iblock('\n\n'))
      .replace(afterBlock, (_, tag) => `${tag}${ctx.iblock('\n\n')}`);
  }

  if (!text.includes(BREAKLINE)) {
    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

    // An author <br> already breaks its line, so only its adjacent newline is suppressed.
    const brPhs = tagPlaceholders(ctx, /^br\b/i);
    const re = brPhs.length > 0 ? afterAuthorBreakRe(brPhs.join('|')) : /\n/g;

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
      // The body excludes `"'<>` so a URL cannot break out of the href attribute, and the reserved
      // delimiters so it cannot swallow a placeholder. The closing boundary is a lookahead: consuming
      // it would eat the separator the next address needs as its own opening boundary.
      pattern: new RegExp(
        String.raw`(\s|^)(http|ftp|mailto|https)(:\/\/)([^\s,!<>"'${RESERVED_PUA_CLASS}]{4,})(?=\s|\.|,|!|\?|<|$)`,
        'giu'
      ),
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4Raw] = m;
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

        return `${p1}${ctx.tag(body, 'a', { href })}${tail}`;
      }
    },
    {
      id: 'email',
      description: 'Выделение эл. почты из текста',
      // Closing boundary is a lookahead for the same reason as autolink: two addresses parted by one
      // space must both match in one pass.
      pattern:
        /(\s|^|\()([a-z0-9\-_.]{2,})@([a-z0-9\-.]{2,})\.([a-z]{2,6})(?=\)|\s|\.|,|!|\?|$|<)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4] = m;
        const addr = `${p2}@${p3}.${p4}`;

        return `${p1}${ctx.tag(addr, 'a', { href: `mailto:${addr}` })}`;
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
      // `ANY_TAG_LIFT_RE` belongs to `preParse` rather than this handler, and is declared here
      // because the static ReDoS check reads rules and the pre-parse pass has nowhere else to say it.
      regexes: [PARAGRAPH_SPLIT_RE, EMPTY_PARAGRAPH_RE, ANY_TAG_LIFT_RE],
      handler: buildParagraphs
    },
    {
      id: 'breakline',
      description: 'Простановка переносов строк',
      regexes: [
        PARAGRAPH_GAP_RE,
        ...blockBoundaryRes(SAMPLE_PLACEHOLDER),
        afterAuthorBreakRe(SAMPLE_PLACEHOLDER),
        /\n/g
      ],
      handler: buildBreaklines
    }
  ],

  preParse(ctx) {
    ctx.text = liftParagraphs(ctx.text, ctx);
  }
};
