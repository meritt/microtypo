import {
  CENTURY_MARKER,
  CENTURY_RANGE,
  followsCompleteName,
  hasDottedLocationAfter,
  startsWithCompactName
} from '../lib/abbreviation-grammar.js';
import { CONTENT_START_GROUP } from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { inlineTextEnd, inlineTextStart } from '../lib/inline-boundaries.js';
import {
  NOWRAP_TAG_RE as ANY_TAG_RE,
  nowrap,
  nowrapContexts,
  spanTokenSet
} from '../lib/nowrap-context.js';
import { ruleBudgetOf } from '../lib/rule-budget.js';
import { F } from '../lib/rule-features.js';
import { sessionMap } from '../lib/session-maps.js';
import { cycle } from '../lib/strings.js';
import {
  CLOSE,
  INLINE_END,
  OPEN,
  TRANSPARENT_TAG_KINDS,
  tagTokens,
  vaultedReference
} from '../protect/placeholders.js';
// Keyed on the full sample, placeholder id and all: a stripped key would reuse a stale regex from
// another `process()` call.
import { LINE_GAP } from './dash.js';
import { phoneContextAt, joinedNumericToken } from './number.js';

const compileCache = new Map();
const COMPILE_CACHE_CAP = 8;

export function compileCacheSize() {
  return compileCache.size;
}

// The wrapper markup is minted per `process()`, so these cannot be module constants. Keeping the
// shapes in one function is what lets the rules below declare exactly what they run to the static
// ReDoS check: the declaration calls this with a sample pair instead of restating the patterns.
function nobrPatterns(open, close) {
  const oRe = RegExp.escape(open);
  const cRe = RegExp.escape(close);

  return {
    open,
    close,
    // A whole word joins the wrapper, never the letter tail of a token: `67673R`, `0^3m` and `а»й`
    // split there hand the next pass a number, a power or a quote standing before a tag.
    m1: new RegExp(
      `${CONTENT_START_GROUP}(?<![\\p{L}\\d][-\u2010\u2011])([a-zа-яё]+)${G.NBSP}(${oRe})`,
      'giu'
    ),
    // A closing tag inserted in a hyphenated word splits its visible halves. At a closing quote
    // inside a token it also changes the quote's left neighbour on the next pass.
    m2: new RegExp(
      `(${cRe})${G.NBSP}([a-zа-яё]+)(?![-\u2010\u2011${G.RAQUO}${G.LDQUO}][\\p{L}\\d])($|[^a-zа-яё])`,
      'giu'
    ),
    inner: new RegExp(`${oRe}.*?${cRe}`, 'giu'),
    marker: new RegExp(`${oRe}|${cRe}`, 'gu')
  };
}

function compileNobrPatterns(ctx) {
  const sample = ctx.tag('###', 'span', { class: 'nowrap' });
  const cached = compileCache.get(sample);

  if (cached) {
    return cached;
  }

  const idx = sample.indexOf('###');
  const open = sample.slice(0, idx);
  const close = sample.slice(idx + 3);

  // No wrapper markup under `html: false` means no span boundary to scope to, and the patterns would
  // otherwise match every word.
  if (idx === -1 || (open === '' && close === '')) {
    return null;
  }

  const compiled = nobrPatterns(open, close);

  if (compileCache.size >= COMPILE_CACHE_CAP) {
    compileCache.delete(compileCache.keys().next().value);
  }

  compileCache.set(sample, compiled);

  return compiled;
}

// Manual triad split: the regex /\B(?=(\d{3})+(?!\d))/ form is O(n^2).
function splitNumber(num) {
  const s = String(num);

  if (s.length <= 3) {
    return s;
  }

  const head = s.length % 3;
  const parts = head ? [s.slice(0, head)] : [];

  for (let i = head; i < s.length; i += 3) {
    parts.push(s.slice(i, i + 3));
  }

  return parts.join(' ');
}

const NUMERO_MARK = `(?:${G.NUMERO}|${vaultedReference(G.NUMERO)})`;
const WRITTEN_GAP = `(?:\\s|${vaultedReference(G.NBSP)}|${vaultedReference(G.NNBSP)})`;
// Between a postal index and its city: one line break at most, with the `<br>` the next pass reads in
// front of it where `text.breakline` wrote one; a blank line parts paragraphs, not an address.
const ADDRESS_GAP = `(?:[^\\S\\r\\n]|${vaultedReference(G.NBSP)}|${vaultedReference(G.NNBSP)}){0,2}(?:(?:<${OPEN}L\\d{1,9}${CLOSE}>)?\\r?\\n)?`;
const IDENTIFIER_LABEL = String.raw`(?<![\p{L}\d])(?:ИНН|КПП|ОГРНИП|ОГРН|БИК|СНИЛС|ОКПО|[Сс]ч[её]т|[Рр]\/с|[Кк]\/с|[Ии]ндекс|[Кк]од|[Аа]рт\.)`;
// `strip_nbsp_in_nowrap` draws only the letters of a label into the wrapper before it, so the end of
// that wrapper stands inside the label: `н. э. р</span>/с 3786968270`, `и пр. арт</span>. 3539555`.
const LABEL_SPLIT_BY_WRAPPER_RE = new RegExp(
  String.raw`(?<![\p{L}\d])(?:[РрКк]${INLINE_END}\/с|[Аа]рт${INLINE_END}\.):?${WRITTEN_GAP}{0,2}$`,
  'u'
);
const DOTTED_SEGMENTS_AHEAD_RE = /\d+\.\d/y;
const dottedSegmentsAhead = (source, at) => {
  DOTTED_SEGMENTS_AHEAD_RE.lastIndex = at;

  return DOTTED_SEGMENTS_AHEAD_RE.test(source);
};

// A nowrap span inside another nowrap span says nothing the outer one does not already say, and it
// is how reprocessing grows: the phrase an earlier pass wrapped comes back with a tag boundary where
// a word boundary used to be, so a rule matches a shorter phrase inside the existing span and wraps
// that too. Dropping the inner pair makes the wrap settle instead of nesting one level per pass.
//
// Opens and closes are dropped in pairs by construction, so the markup stays balanced even where an
// unrelated span sharing the closing placeholder throws the depth count off. Every `</span>` the
// engine writes carries the same placeholder, so a close says only that a span ended, never which
// one, and pairing needs every span open.
function dropNestedNowrap(ctx) {
  const c = compileNobrPatterns(ctx);

  if (!c) {
    return;
  }

  const { open } = c;
  const { text } = ctx;

  // Nothing to collapse without a wrapper, and this guard is what keeps the walk below off every
  // document that has none.
  if (!text.includes(open)) {
    return;
  }

  const { drops } = nowrapContexts(ctx, text, open);

  if (drops.length === 0) {
    return;
  }

  const parts = [];
  let cursor = 0;

  for (const { start, end } of drops.toSorted((a, b) => a.start - b.start)) {
    parts.push(text.slice(cursor, start));
    cursor = end;
  }

  parts.push(text.slice(cursor));
  ctx.text = parts.join('');
}

// Where in `text` a close ends a no-break wrapper. Every close of one element name carries the same
// placeholder, an author's `</span>` the wrapper's own, so the element a close ends is read from the
// ones of that name open before it.
function wrapperCloses(text, c, tokens) {
  const closes = new Set();
  const stack = [];

  for (const m of text.matchAll(ANY_TAG_RE)) {
    if (!tokens.has(m[2])) {
      continue;
    }

    if (m[1] !== '/') {
      stack.push(m[0] === c.open);
    } else if (stack.pop() === true) {
      closes.add(m.index);
    }
  }

  return closes;
}

function wrapperTokens(ctx, c) {
  const spans = spanTokenSet(ctx);
  return spans.has(c.close.slice(2, -1))
    ? spans
    : new Set(tagTokens(ctx.tags, 'nobr'));
}

// Each outermost wrapper, its tags included, through `edit`. It ends at the close `wrapperCloses`
// reads as its own, not at an author's `</span>` inside it, `<span>и</span> пр.`.
function editWrappers(text, ctx, c, edit) {
  if (!text.includes(c.open)) {
    return text;
  }
  const tokens = wrapperTokens(ctx, c);
  const parts = [];
  const stack = [];
  let depth = 0;
  let start = 0;
  let cursor = 0;

  for (const m of text.matchAll(ANY_TAG_RE)) {
    if (!tokens.has(m[2])) {
      continue;
    }

    if (m[1] !== '/') {
      const wrapper = m[0] === c.open;
      stack.push(wrapper);
      if (wrapper && depth++ === 0) {
        start = m.index;
      }
    } else if (stack.pop() === true && --depth === 0) {
      const end = m.index + m[0].length;
      parts.push(text.slice(cursor, start), edit(text.slice(start, end)));
      cursor = end;
    }
  }

  parts.push(text.slice(cursor));
  return parts.join('');
}

const cleanupRules = sessionMap();

// Moving a wrapper boundary exposes new input to these rules on the next call.
export function bindNowrapRules(ctx, isOn) {
  cleanupRules.set(ctx, isOn);
}

const NBSP_GAP_RE = /[ \t]*\u{00A0}[ \t\u{00A0}]*/gu;
const HYPHEN = /[-\u2010\u2011]/u;
const WORD_CONTINUATION = /[\p{L}\d]+/uy;
const WORD_CHARACTER = /[\p{L}\d]/uy;
const WORD_BEFORE = /(?<=([\p{L}\d]+))/uy;
const WORD_CHARACTER_BEFORE = /(?<=[\p{L}\d])/uy;

// The head of a compound can continue inside an inline element, and the hyphen can have
// formatting of its own. Follow only that same visible word, stopping at whitespace or a block.
function inlineCompoundContinues(ctx, text, at) {
  if (text[at] !== '<' && !(HYPHEN.test(text[at]) && text[at + 1] === '<')) {
    return false;
  }
  let next = inlineTextStart(ctx, text, at);
  WORD_CONTINUATION.lastIndex = next;
  while (WORD_CONTINUATION.test(text)) {
    next = inlineTextStart(ctx, text, WORD_CONTINUATION.lastIndex);
    ctx.checkBudget?.('nowrap:content');
    WORD_CONTINUATION.lastIndex = next;
  }
  if (!HYPHEN.test(text[next])) {
    return false;
  }
  WORD_CHARACTER.lastIndex = inlineTextStart(ctx, text, next + 1);
  return WORD_CHARACTER.test(text);
}

function inlineCompoundPrecedes(ctx, text, at) {
  if (text[at - 1] !== '>' && !(HYPHEN.test(text[at - 1]) && text[at - 2] === '>')) {
    return false;
  }
  let end = inlineTextEnd(ctx, text, at);
  WORD_BEFORE.lastIndex = end;
  let part;
  while ((part = WORD_BEFORE.exec(text)) !== null) {
    end = inlineTextEnd(ctx, text, end - part[1].length);
    ctx.checkBudget?.('nowrap:content');
    WORD_BEFORE.lastIndex = end;
  }
  if (!HYPHEN.test(text[end - 1])) {
    return false;
  }
  WORD_CHARACTER_BEFORE.lastIndex = inlineTextEnd(ctx, text, end - 1);
  return WORD_CHARACTER_BEFORE.test(text);
}

function removeNbspInNobr(ctx) {
  const c = compileNobrPatterns(ctx);

  if (!c) {
    return;
  }

  const onLimit = (n) => {
    if (typeof ctx.onCycleLimit === 'function') {
      ctx.onCycleLimit('other.strip_nbsp_in_nowrap', n);
    }
  };

  const isOn = cleanupRules.get(ctx);
  const collapses = isOn?.('space', 'collapse_spaces') === true;
  const trims = isOn?.('space', 'trim_line_end') === true;
  const dots = isOn?.('nobr', 'initials_dots') === true;
  // The word's no-break space parted it from what the wrapper holds: written back as a space before
  // a gap or the end of the text, it is one the next pass takes again.
  const pulled = (m, lead, word, open, at, t) => {
    const start = at + m.length;
    // Pulling a word across this boundary exposes an undivided acronym to initials_dots
    // on the next call, where the new space makes it look like an unmarked pair of initials.
    if (
      (dots && startsWithCompactName(t, start)) ||
      inlineCompoundPrecedes(ctx, t, at + lead.length)
    ) {
      return m;
    }
    const next = t[start];
    const taken = next === undefined ? trims : collapses && (next === ' ' || next === '\t');
    return `${lead}${open}${word}${taken ? '' : ' '}`;
  };

  ctx.text = cycle(ctx.text, (t) => t.replace(c.m1, pulled), 100, onLimit, ruleBudgetOf(ctx));

  if (ctx.text.includes(c.close)) {
    const tokens = wrapperTokens(ctx, c);

    ctx.text = cycle(
      ctx.text,
      (t) => {
        const closes = wrapperCloses(t, c, tokens);

        return t.replace(c.m2, (m, close, word, after, at) => {
          if (
            !closes.has(at) ||
            inlineCompoundContinues(ctx, t, at + m.length - after.length) ||
            (after === '.' &&
              /^[А-ЯЁ]$/u.test(word) &&
              hasDottedLocationAfter(t, at + m.length - 1) &&
              followsCompleteName(ctx, t, at))
          ) {
            return m;
          }
          return ` ${word}${close}${after}`;
        });
      },
      100,
      onLimit,
      ruleBudgetOf(ctx)
    );
  }

  ctx.text = nbspInNowrapAsSpace(ctx.text, ctx);
}

function nbspInNowrapAsSpace(text, ctx) {
  const c = compileNobrPatterns(ctx);

  if (!c) {
    return text;
  }

  const collapses = cleanupRules.get(ctx)?.('space', 'collapse_spaces') === true;

  return editWrappers(text, ctx, c, (m) =>
    collapses ? m.replace(NBSP_GAP_RE, ' ') : m.replaceAll(G.NBSP, ' ')
  );
}

// A vault id is minted per process(), so a declared regex can only stand in for the real one. The
// wrapper markup is escaped into every pattern above, which is why one sample carries the same shape
// as any run: what differs between them is literal text.
const SAMPLE_NOBR = nobrPatterns(
  `${OPEN}T1${CLOSE}<span class="nowrap">`,
  `</span>${OPEN}T2${CLOSE}`
);

function nobrToNbsp(ctx) {
  const c = compileNobrPatterns(ctx);

  if (!c) {
    return;
  }
  ctx.text = editWrappers(ctx.text, ctx, c, (m) => m.replaceAll(' ', G.NBSP));
}

export const etcGroup = {
  title: 'Прочее',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'acute_accent',
      requires: F.BACKTICK,
      description: 'Ударение на гласной',
      // `\w` is ASCII-only and misses the Cyrillic letter after the backtick.
      pattern: /([уеыаоэяиюёУЕЫАОЭЯИЮЁ])`(\p{L})/gu,
      replacement: `$1${G.COMBINING_ACUTE}$2`
    },
    {
      id: 'sup_word',
      requires: F.CARET,
      description: 'Надстрочный текст после ^',
      // Under `html: false` the consumed leading space and `^` marker would vanish and glue two words
      // together.
      htmlOnly: true,
      pattern: /(?<!\s)(\s+|^)\^([a-zа-яё0-9.:,-]+)(\s|$|\.$)/giu,
      replacement: (m, ctx) => {
        const [, , p3, p4] = m;

        return `${ctx.tag(ctx.tag(p3, 'small'), 'sup')}${p4}`;
      }
    },
    {
      id: 'roman_range_dash',
      requires: F.LATIN | F.DASH,
      description: 'Среднее тире в диапазоне римских чисел',
      // Runs before en_century_range so the marked form still matches its dash class.
      pattern: /(^|[\s(])([XIV]{1,5})[-−]([XIV]{1,5})(?=[\s).,;:!?]|$)/gu,
      replacement: `$1$2${G.NDASH}$3`
    },
    {
      id: 'en_century_range',
      requires: F.LATIN | F.DASH,
      description: 'Тире между диапазоном веков',
      pattern: new RegExp(`([\\s(]|^)${CENTURY_RANGE}${CENTURY_MARKER}`, 'gu'),
      replacement: (m, ctx) => {
        const [, p1, p2, , p4] = m;
        const body = `${p2}${G.NDASH}${p4} вв.`;
        const start = m.at(-2) + p1.length;

        return `${p1}${nowrap(ctx, body, m.at(-1), start, m.at(-2) + m[0].length)}`;
      }
    },
    {
      id: 'en_time_range',
      requires: F.DIGIT | F.COLON | F.DASH,
      description: 'Тире и неразрывный пробел в диапазоне времени',
      // Leading boundary is a lookbehind: consuming it strands the second of two glued ranges.
      pattern: /(?<![\d>])(\d{1,2}:\d{2})([-—−–])(\d{1,2}:\d{2})([^\d<]|$)/gu,
      replacement: (m, ctx) => {
        const [, p2, , p4, p5] = m;
        const body = `${p2}${G.NDASH}${p4}`;
        const start = m.at(-2);
        const end = start + m[0].length - p5.length;

        return `${nowrap(ctx, body, m.at(-1), start, end)}${p5}`;
      }
    },
    {
      id: 'split_triads',
      requires: F.DIGIT,
      requiresPattern: /[1-9][0-9]{4}/u,
      description: 'Триады большого числа через узкий неразрывный пробел',
      // A digit run joined by hyphens to other digit groups, or by periods to two more, is an
      // identifier — an ISBN, a part number, a version — not a quantity, so `978-5-389-12345-6` and
      // `46173.6.4.5` must not gain a thousands separator; one period still ends a quantity. Only a
      // hyphen that itself follows a digit marks the run as a segment, which is what keeps a leading
      // minus working. `(?<!\d[ \t]+)` guards the other side: grouping `100644` behind a bare `8 `
      // builds `8 100 644`, which the next pass reads as one number, and so does grouping `74305` in
      // front of a bare ` 865`; the gap is the run of spaces and tabs `thin_space_triads` reads as
      // one. The digits of a numeric character
      // reference are an identifier for the same reason an ISBN's are — `&#128512;` is one codepoint.
      // Digits after a decimal separator are a fraction, read digit by digit and never grouped.
      // A number, not a quantity, is read as typed too: after `№` or a requisite's label (also
      // through the end of a no-break wrapper a later rule draws the label into), with a
      // leading zero, longer than any amount, or a postal index before its city, including glued
      // `125009г. Москва`. Unicode numbers keep a mixed numeric token whole. A Latin dotted token
      // and a leading-dot fraction do not introduce a quantity. Cyrillic references retain their
      // own normalization. The label keeps its capital spelled out: under the `i` flag `\p{Lu}` matches
      // lowercase as well. `№` and the spaces this engine writes are read in the references it
      // writes them as in XML, too, or a second run would group what the first left as typed.
      // The leading lookahead keeps the lookbehinds, `\p{L}` the costliest, off every non-digit.
      pattern: new RegExp(
        String.raw`(?=[1-9][0-9]{4})(?<![\p{L}\p{N}<)])(?<![A-Za-z]\.)(?<!^\.)(?<![^\p{L}]\.)(?<!\d-)(?<!\d[ \t]+)(?<!\d[.,])(?<!&#)(?<!${NUMERO_MARK}${WRITTEN_GAP}{0,2})(?<!${IDENTIFIER_LABEL}:?(?:${INLINE_END}){0,4}${WRITTEN_GAP}{0,2})(?![0-9]{6}(?:,${ADDRESS_GAP}|${LINE_GAP}{0,2}г\.${ADDRESS_GAP})(?:<${OPEN}[${TRANSPARENT_TAG_KINDS}]\d{1,9}${CLOSE}>){0,4}\p{Lu})([0-9]{5,15})(?!\p{N})(?![ \t]+[0-9]{3}(?![0-9]))([^a-zA-Z>(]|$)`,
        'gu'
      ),
      replacement: (m, ctx) => {
        const [m0, p1, p2] = m;

        if (
          p2 === '-' ||
          (p2 === '.' && dottedSegmentsAhead(m.at(-1), m.at(-2) + m0.length)) ||
          LABEL_SPLIT_BY_WRAPPER_RE.test(m.at(-1).slice(Math.max(0, m.at(-2) - 64), m.at(-2))) ||
          joinedNumericToken(ctx, m.at(-1), m.at(-2)) ||
          phoneContextAt(m.at(-1), m.at(-2)) === 1
        ) {
          return m0;
        }

        return `${splitNumber(p1).replaceAll(' ', G.NNBSP)}${p2}`;
      }
    },
    {
      id: 'drop_nested_nowrap',
      requires: F.MARKUP,
      description: 'Удаление nowrap-обёртки, вложенной в другую nowrap-обёртку',
      regexes: [SAMPLE_NOBR.marker],
      handler: dropNestedNowrap
    },
    {
      id: 'strip_nbsp_in_nowrap',
      requires: F.MARKUP,
      description: 'Удаление неразрывных пробелов в nowrap-конструкциях',
      regexes: [SAMPLE_NOBR.m1, SAMPLE_NOBR.m2, SAMPLE_NOBR.inner],
      handler: removeNbspInNobr
    },
    {
      id: 'nbsp_in_nowrap',
      requires: F.MARKUP,
      description: 'Преобразование nowrap-конструкций в неразрывные пробелы',
      enabled: false,
      regexes: [SAMPLE_NOBR.inner],
      handler: nobrToNbsp
    }
  ]
};
