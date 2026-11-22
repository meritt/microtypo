// The invariant «строчная разметка прозрачна»: prose with no markup is typeset, then the same prose
// with whole words wrapped in inline elements, or in Markdown emphasis and links; with exactly the
// wrapping taken off again, the second output is the first. Under `html: true` the visible texts are
// compared, a no-break wrapper's spaces read as the no-break spaces it stands for, and the elements
// of the second output must nest.
//
// Only the words markup is transparent around are wrapped: none a rule rewrites as text reads the
// markup near — a word within reach of a rewrite, next to a quote mark, part of a date or of an
// address — and none whose element would cross one of the engine's no-break wrappers, which the
// engine then gives up for no-break spaces. What the engine rewrites is read off its output for the
// prose itself.
import { isOn } from '../../../src/core/options.js';
import { generateConfig } from './documents.mjs';
import { createGrammar } from './grammar.mjs';

export const TRANSPARENT_FORMATS = ['text', 'html', 'markdown'];

const HTML_WRAPPERS = [
  ['<em>', '</em>'],
  ['<b>', '</b>'],
  ['<i>', '</i>'],
  ['<strong>', '</strong>'],
  ['<span>', '</span>'],
  ['<a href="/x">', '</a>']
];

const MD_WRAPPERS = [
  ['*', '*'],
  ['**', '**'],
  ['_', '_'],
  ['[', '](/x)']
];

// A Markdown wrapper inside another, chosen so that no two markers run together into a third.
const MD_INNER = {
  '*': ['_', '['],
  '**': ['_', '['],
  _: ['['],
  '[': ['*', '**', '_']
};

const HTML_WRAP_RE = /<\/?(?:em|b|i|strong|span)>|<a href="\/x">|<\/a>/gu;
const MD_LINK_RE = /\[([^\]]*)\]\(\/x\)/gu;
const MD_MARK_RE = /[*_]/gu;
// Characters the Markdown wrapping takes off again, kept out of the prose it wraps.
const MD_TAKEN_RE = /[*_[\]]/gu;

// Part of a date: a month or a word for a year.
const DATE_WORD_RE =
  /^(?:январ|феврал|март|апрел|ма[йяюе]|маем|июн|июл|август|сентябр|октябр|ноябр|декабр|год|гг?$)/iu;
// What an address names follows an abbreviation: `г. Москва`, `ул. Ленина`.
const ABBREVIATION_RE = /^\p{Ll}{1,5}\.$/u;
const WORD_RE = /\p{L}+/gu;
const SPACE_RE = /\s/u;
const AFTER_OK = /[\s,;:!?]/u;
// A quote mark is read open or closed by what stands next to it, and a rule that rewrites quotes
// reads markup there as it always did.
const QUOTE_RE = /["'«»„“”‚‘’‹›]/u;

export function unwrap(format, text) {
  if (format === 'markdown') {
    return text.replaceAll(MD_LINK_RE, '$1').replaceAll(MD_MARK_RE, '');
  }

  return text.replaceAll(HTML_WRAP_RE, '');
}

// The ranges of `text` a guarded piece covers: no word inside one is wrapped.
function guardedRanges(text, protect) {
  const ranges = [];

  for (const { text: piece } of protect) {
    if (piece === '') {
      continue;
    }

    for (let at = text.indexOf(piece); at !== -1; at = text.indexOf(piece, at + 1)) {
      ranges.push([at, at + piece.length]);
    }
  }

  return ranges;
}

// What the engine did to `prose` in `out`, its output: `marks` holds 1 for each character of the
// prose it rewrote as text, and `wrapper` the no-break wrapper of the output each one ended up in,
// numbered from 0, or -1. The two are read past their white space and their tags, and where they
// part, the characters dropped or replaced are marked, and for characters added, the two they came
// between. Where the two do not meet again, everything from there on is marked.
const WINDOW = 4;
const LOOKAHEAD = 24;

export function readOutput(prose, out) {
  const p = [];
  const at = [];
  const q = [];
  const qw = [];

  for (let i = 0; i < prose.length; i++) {
    if (!SPACE_RE.test(prose[i])) {
      p.push(prose[i]);
      at.push(i);
    }
  }

  walkOutput(out, (text, id) => {
    for (const c of text) {
      for (let u = 0; u < c.length; u++) {
        if (!SPACE_RE.test(c)) {
          q.push(c[u]);
          qw.push(id);
        }
      }
    }
  });

  const marks = new Uint8Array(prose.length);
  const wrapper = new Int32Array(prose.length).fill(-1);
  const mark = (k) => {
    if (k >= 0 && k < at.length) {
      marks[at[k]] = 1;
    }
  };
  const agree = (x, y) => {
    for (let w = 0; w < WINDOW; w++) {
      if (x + w >= p.length || y + w >= q.length) {
        return x + w >= p.length && y + w >= q.length;
      }

      if (p[x + w] !== q[y + w]) {
        return false;
      }
    }

    return true;
  };

  let i = 0;
  let j = 0;

  while (i < p.length || j < q.length) {
    if (i < p.length && j < q.length && p[i] === q[j]) {
      wrapper[at[i]] = qw[j];
      i += 1;
      j += 1;
      continue;
    }

    let met = false;

    for (let span = 1; span <= LOOKAHEAD && !met; span++) {
      for (let di = 0; di <= span && !met; di++) {
        const dj = span - di;

        if (agree(i + di, j + dj)) {
          for (let k = i; k < i + di; k++) {
            mark(k);
          }

          if (dj > 0) {
            mark(i - 1);
            mark(i);
          }

          i += di;
          j += dj;
          met = true;
        }
      }
    }

    if (!met) {
      for (let k = i - 1; k < p.length; k++) {
        mark(k);
      }

      break;
    }
  }

  return { marks, wrapper };
}

// Whether wrapping `prose` from `start` to `end` leaves each no-break wrapper of `wrapper` whole and
// apart from the element: the element inside the wrapper or around it, never across its edge and
// never holding exactly its words. Where an element and a wrapper would cross, the engine keeps the
// words together with no-break spaces, and a rule after it reads those otherwise than the wrapper.
function fitsWrappers(prose, wrapper, start, end) {
  const inside = new Set();
  let outside = false;

  for (let k = start; k < end; k++) {
    if (!SPACE_RE.test(prose[k])) {
      if (wrapper[k] === -1) {
        outside = true;
      } else {
        inside.add(wrapper[k]);
      }
    }
  }

  for (const id of inside) {
    const first = wrapper.indexOf(id);
    const last = wrapper.lastIndexOf(id);
    const holds = first >= start && last < end;

    if (!holds && (outside || inside.size > 1)) {
      return false;
    }

    if (holds && !outside && inside.size === 1) {
      return false;
    }
  }

  return true;
}

const tokenStart = (text, k) => {
  let s = k;

  while (s > 0 && !SPACE_RE.test(text[s - 1])) {
    s -= 1;
  }

  return s;
};

const spaceBefore = (text, k) => {
  let s = k;

  while (s > 0 && SPACE_RE.test(text[s - 1])) {
    s -= 1;
  }

  return s;
};

const spaceAfter = (text, k) => {
  let e = k;

  while (e < text.length && SPACE_RE.test(text[e])) {
    e += 1;
  }

  return e;
};

const tokenEnd = (text, k) => {
  let e = k;

  while (e < text.length && !SPACE_RE.test(text[e])) {
    e += 1;
  }

  return e;
};

// How many runs of non-space characters away from a word a rewrite of the engine's keeps the word
// unwrapped: as many as the engine reads the markup around a change of words as it always did.
const REACH = 2;

// Whole words: letters only, set off by white space in front and white space or a mark that ends a
// clause behind — never a quote mark, a dot, a bracket, a digit or a hyphen. Not part of a date or an
// address, not next to a quote mark, and not within `REACH` of a place where the engine rewrote the
// text: a rule that rewrites words reads the markup around them as it always did.
function candidates(text, protect, marks) {
  const guarded = guardedRanges(text, protect);
  const words = [];

  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index;
    const end = start + m[0].length;

    if (
      (start > 0 && !SPACE_RE.test(text[start - 1])) ||
      (end < text.length && !AFTER_OK.test(text[end])) ||
      DATE_WORD_RE.test(m[0]) ||
      guarded.some(([from, to]) => start < to && end > from)
    ) {
      continue;
    }

    const gap = spaceBefore(text, start);
    const next = spaceAfter(text, tokenEnd(text, end));
    let lo = start;
    let hi = tokenEnd(text, end);

    for (let n = 0; n < REACH; n++) {
      lo = tokenStart(text, spaceBefore(text, lo));
      hi = tokenEnd(text, spaceAfter(text, hi));
    }

    if (
      ABBREVIATION_RE.test(text.slice(tokenStart(text, gap), gap)) ||
      QUOTE_RE.test(text[gap - 1] ?? '') ||
      QUOTE_RE.test(text[next] ?? '') ||
      marks.subarray(lo, hi).includes(1)
    ) {
      continue;
    }

    words.push({ start, end });
  }

  return words;
}

// Runs of candidate words with nothing but white space between them on one line: a wrapper spans
// words of one run.
const BETWEEN_RE = /^[^\S\n]+$/u;
const RUN_RE = /^\p{L}+(?:[^\S\n]+\p{L}+)*$/u;

function runsOf(text, words) {
  const runs = [];

  for (const w of words) {
    const last = runs.at(-1);
    const prev = last?.at(-1);

    if (prev !== undefined && BETWEEN_RE.test(text.slice(prev.end, w.start))) {
      last.push(w);
    } else {
      runs.push([w]);
    }
  }

  return runs;
}

// `fits(from, to)` tells whether an element may hold the words from `from` to `to`.
function wrapWords(d, text, words, markdown, fits) {
  const { chance, int, pick, weighted } = d;
  const inserts = [];
  const wrappers = markdown ? MD_WRAPPERS : HTML_WRAPPERS;

  for (const run of runsOf(text, words)) {
    for (let i = 0; i < run.length;) {
      if (!chance(0.35)) {
        i += 1;
        continue;
      }

      const length = Math.min(
        run.length - i,
        weighted([
          [6, 1],
          [3, 2],
          [1, 3]
        ])
      );
      const span = run.slice(i, i + length);
      const outer = pick(wrappers);
      const first = span[0];
      const last = span.at(-1);

      // Inserted in pairs, outer before inner at one offset, so the text builds back nested.
      if (fits(first.start, last.end)) {
        inserts.push([first.start, 0, outer[0]], [last.end, 3, outer[1]]);
      }

      if (chance(0.3)) {
        const word = span[int(0, span.length - 1)];
        const options = markdown
          ? MD_WRAPPERS.filter(([open]) => MD_INNER[outer[0]].includes(open))
          : HTML_WRAPPERS.filter(([open]) => open !== outer[0]);
        const inner = pick(options);

        if (fits(word.start, word.end)) {
          inserts.push([word.start, 1, inner[0]], [word.end, 2, inner[1]]);
        }
      }

      i += length;
    }
  }

  inserts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  let out = '';
  let cursor = 0;

  for (const [at, , mark] of inserts) {
    out += text.slice(cursor, at) + mark;
    cursor = at;
  }

  return out + text.slice(cursor);
}

const MD_TOKEN_RE = /\*\*|\*|_|\[|\]\(\/x\)/gu;
const HTML_NAME_RE = /^<\/?(\w+)/u;

// What the engine does to `prose` with `config`: `marks`, the characters it rewrote, and
// `fits(from, to)`, whether an element may hold the words from `from` to `to`; or null. A no-break
// wrapper is the engine's last word only once `other.strip_nbsp_in_nowrap` widened it over the words
// bound to its edges, and an element crossing the wrapper as first minted gets no-break spaces in its
// place, which a rule after it reads otherwise: an element fits both.
const WIDENS = 'other.strip_nbsp_in_nowrap';

function readCase(prose, config, plain) {
  const out = plain(config, prose);

  if (out === null) {
    return null;
  }

  const { marks, wrapper } = readOutput(prose, out);
  let first = null;

  if (wrapper.some((id) => id !== -1)) {
    const { [WIDENS]: _widens, ...rules } = config.rules ?? {};
    const narrow = plain({ ...config, rules: { ...rules, [WIDENS]: false } }, prose);

    if (narrow === null) {
      return null;
    }

    first = readOutput(prose, narrow).wrapper;
  }

  return {
    marks,
    fits: (from, to) =>
      fitsWrappers(prose, wrapper, from, to) &&
      (first === null || fitsWrappers(prose, first, from, to))
  };
}

// The prose a case wraps, or null when its wrapping is not whole candidate words in properly nested
// wrappers — as shrinking a case may leave it. `plain(config, text)` is the output with `config`
// and no character references, or null.
export function proseOf(kase, plain) {
  const markdown = kase.format === 'markdown';
  const stack = [];
  const spans = [];
  let prose = '';
  let cursor = 0;

  for (const m of kase.text.matchAll(markdown ? MD_TOKEN_RE : HTML_WRAP_RE)) {
    const mark = m[0];
    let name = mark;
    let closing;

    prose += kase.text.slice(cursor, m.index);
    cursor = m.index + mark.length;

    if (!markdown) {
      name = HTML_NAME_RE.exec(mark)[1];
      closing = mark.startsWith('</');
    } else if (mark === '[' || mark === '](/x)') {
      name = '[';
      closing = mark !== '[';
    } else {
      closing = stack.at(-1)?.name === mark;
    }

    if (!closing) {
      stack.push({ name, at: prose.length });
      continue;
    }

    const top = stack.pop();

    if (top?.name !== name) {
      return null;
    }

    spans.push([top.at, prose.length]);
  }

  prose += kase.text.slice(cursor);

  if (stack.length > 0 || prose.includes('<')) {
    return null;
  }

  if (spans.length === 0) {
    return prose;
  }

  const read = readCase(prose, kase.config, plain);

  if (read === null) {
    return null;
  }

  const starts = new Map(candidates(prose, kase.protect, read.marks).map((w) => [w.start, w.end]));

  for (const [from, to] of spans) {
    if (!RUN_RE.test(prose.slice(from, to)) || !read.fits(from, to)) {
      return null;
    }

    for (const w of prose.slice(from, to).matchAll(WORD_RE)) {
      if (starts.get(from + w.index) !== from + w.index + w[0].length) {
        return null;
      }
    }
  }

  return prose;
}

// `generate(format)` is a case: the wrapped prose as `text`. `plain(config, text)` is the output
// with `config` and no character references, or null.
export function createTransparent(lexicon, d, plain) {
  const { int } = d;
  const g = createGrammar(lexicon, d);

  return function generate(format) {
    const config = generateConfig(d, format);
    const markdown = format === 'markdown';
    const ctx = g.context({
      comments: false,
      eol: '\n',
      lines: !markdown
    });
    const paragraphs = [];

    for (let n = int(1, 3); n > 0; n--) {
      paragraphs.push(g.finish(ctx, g.paragraph(ctx)));
    }

    let prose = paragraphs.join('\n\n');

    // A `<` of the prose's own would read the inserted markup after it as part of a tag.
    prose = (
      markdown ? prose.replaceAll(MD_TAKEN_RE, '') : prose.replaceAll(HTML_WRAP_RE, '')
    ).replaceAll('<', '');

    const read = readCase(prose, config, plain);
    const text =
      read === null
        ? prose
        : wrapWords(d, prose, candidates(prose, ctx.protect, read.marks), markdown, read.fits);

    return { format, config, text, protect: ctx.protect, transparent: true };
  };
}

// The engine's no-break wrapper in each of its forms: a style, a class, both, or `<nobr>`.
const isNowrap = (tag) => tag === '<nobr>' || (tag.startsWith('<span ') && tag.includes('nowrap'));
const TAG_RE = /<\/?[A-Za-z][^>]*>/gu;
const VOID = new Set(['br', 'img', 'hr', 'wbr', 'input', 'meta', 'link']);

const REFERENCE_RE = /&nbsp;|&#(\d+);|&#[xX]([0-9A-Fa-f]+);/gu;

const decoded = (text) =>
  text.replaceAll(REFERENCE_RE, (whole, decimal, hex) => {
    if (decimal === undefined && hex === undefined) {
      return '\u{A0}';
    }

    return String.fromCodePoint(
      decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10)
    );
  });

// What a reader sees of an HTML output: a no-break wrapper's spaces as no-break spaces, no tags,
// spaces written as character references as the characters.
export function seen(html) {
  let out = '';

  walkOutput(html, (text, id) => {
    out += id === -1 ? text : text.replaceAll(' ', '\u{A0}');
  });

  return out;
}

// Calls `visit(text, id)` for each run of the text of an output between its tags, character
// references decoded, `id` being the outermost no-break wrapper around it, numbered from 0, or -1.
function walkOutput(html, visit) {
  const stack = [];
  let depth = 0;
  let wrappers = 0;
  let cursor = 0;

  const flush = (to) => {
    if (to > cursor) {
      visit(decoded(html.slice(cursor, to)), depth > 0 ? wrappers - 1 : -1);
    }
  };

  for (const m of html.matchAll(TAG_RE)) {
    flush(m.index);
    cursor = m.index + m[0].length;

    const name = /^<\/?([A-Za-z][\w-]*)/u.exec(m[0])[1].toLowerCase();

    if (VOID.has(name) || m[0].endsWith('/>')) {
      continue;
    }

    if (m[0].startsWith('</')) {
      if (stack.pop() === true) {
        depth -= 1;
      }
    } else {
      const nowrap = isNowrap(m[0]);

      stack.push(nowrap);

      if (nowrap) {
        wrappers += depth === 0 ? 1 : 0;
        depth += 1;
      }
    }
  }

  flush(html.length);
}

// The first pair of elements that cross in an HTML output, or null.
function crossing(html) {
  const stack = [];

  for (const m of html.matchAll(TAG_RE)) {
    const name = /^<\/?([A-Za-z][\w-]*)/u.exec(m[0])[1].toLowerCase();

    if (VOID.has(name) || m[0].endsWith('/>')) {
      continue;
    }

    if (!m[0].startsWith('</')) {
      stack.push(name);
      continue;
    }

    const top = stack.pop();

    if (top !== name) {
      return `</${name}> закрывает <${top ?? '—'}>`;
    }
  }

  return null;
}

const shortly = (s) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

// The first place two strings part, with a little of each.
function parting(a, b) {
  let p = 0;

  while (p < a.length && a[p] === b[p]) {
    p += 1;
  }

  const from = Math.max(0, p - 12);

  return `${JSON.stringify(shortly(a.slice(from, p + 24)))} ≠ ${JSON.stringify(shortly(b.slice(from, p + 24)))}`;
}

// The violation of `kase`, a case `createTransparent` built, or null. `run(text)` typesets with the
// case's configuration and throws what the engine throws; `plain` is as for `proseOf`.
export function checkTransparent(kase, run, plain, classes) {
  const html = isOn(kase.config.html);
  const prose = proseOf(kase, plain);
  let bare;
  let wrapped;

  if (prose === null) {
    return null;
  }

  try {
    bare = run(prose);
    wrapped = run(kase.text);
  } catch {
    return null;
  }

  const crossed = html ? crossing(wrapped) : null;

  if (crossed !== null) {
    return {
      invariant: 'transparent',
      key: 'nesting',
      fingerprint: `вложенность ${classes(crossed)}`,
      detail: `элементы пересекаются: ${crossed}`,
      out: wrapped,
      again: bare
    };
  }

  // Under `html: true` every tag goes, the engine's and the wrapping alike.
  const a = html ? unwrap(kase.format, seen(bare)) : bare;
  const b = html ? unwrap(kase.format, seen(wrapped)) : unwrap(kase.format, wrapped);

  if (a === b) {
    return null;
  }

  return {
    invariant: 'transparent',
    key: 'text',
    fingerprint: `текст ${classes(parting(a, b))}`,
    detail: `без разметки и со снятой разметкой: ${parting(a, b)}`,
    out: b,
    again: a
  };
}
