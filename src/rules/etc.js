import { G } from '../lib/glyphs.js';
import { cycle } from '../lib/strings.js';
import { CLOSE, OPEN, TAG_PLACEHOLDER_SOURCE } from '../protect/placeholders.js';

// Keyed on the full sample, placeholder id and all: a stripped key would reuse a stale regex from
// another `process()` call.
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
    m1: new RegExp(`(^|[^a-zа-яё])([a-zа-яё]+)${G.NBSP}(${oRe})`, 'giu'),
    m2: new RegExp(`(${cRe})${G.NBSP}([a-zа-яё]+)($|[^a-zа-яё])`, 'giu'),
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

// Every tag in the text, as `<token>` or `</token>`. The spans are the ones this rule can pair; a
// tag that is not one is still an element standing between two wrappers, and what it does to
// `white-space` cannot be read from a placeholder — an `<em style="white-space:normal;">` resets
// the very property the wrapper carries, and the wrapper under it is not redundant at all.
const ANY_TAG_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'g');

function spanTokenSet(ctx) {
  return new Set(
    ctx.tags.findByTagName('span').map(({ prefix, id }) => `${OPEN}${prefix}${id}${CLOSE}`)
  );
}

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

  const spans = spanTokenSet(ctx);

  if (spans.size === 0) {
    return;
  }

  const stack = [];
  const drops = [];

  ANY_TAG_RE.lastIndex = 0;

  for (const m of text.matchAll(ANY_TAG_RE)) {
    // A tag this rule cannot pair still stands between the two wrappers, so whatever is open right
    // now stops being a parent that says everything its child would.
    if (!spans.has(m[2])) {
      const enclosing = stack.at(-1);

      if (enclosing) {
        enclosing.nowrap = false;
      }

      continue;
    }

    // `open` is the whole opening token, angle brackets and all: the sample tag is sliced, never
    // parsed.
    const span = { start: m.index, end: m.index + m[0].length, nowrap: m[0] === open };

    if (m[1] !== '/') {
      // Directly inside another wrapper, with nothing of its own in between: only there does the
      // inner one say what the outer already says.
      span.nested = span.nowrap && Boolean(stack.at(-1)?.nowrap);
      stack.push(span);
      continue;
    }

    const opened = stack.pop();

    // A close with no open before it belongs to markup this pass did not write, and unbalanced
    // markup is the author's to keep: dropping half of a pair re-parents everything after it.
    if (!opened) {
      continue;
    }

    if (opened.nested) {
      drops.push(opened, span);
    }
  }

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

  ctx.text = cycle(ctx.text, (t) => t.replace(c.m1, '$1$3$2 '), 100, onLimit, ctx.checkBudget);
  ctx.text = cycle(ctx.text, (t) => t.replace(c.m2, ' $2$1$3'), 100, onLimit, ctx.checkBudget);
  ctx.text = ctx.text.replace(c.inner, (m) => m.replaceAll(G.NBSP, ' '));
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
  // The full match is transformed rather than a capture group, or the open and close placeholders
  // would be dropped.
  ctx.text = ctx.text.replace(c.inner, (m) => m.replaceAll(' ', G.NBSP));
}

export const etcGroup = {
  title: 'Прочее',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'acute_accent',
      description: 'Ударение на гласной',
      // `\w` is ASCII-only and misses the Cyrillic letter after the backtick.
      pattern: /([уеыаоэяиюёУЕЫАОЭЯИЮЁ])`(\p{L})/gu,
      replacement: `$1${G.COMBINING_ACUTE}$2`
    },
    {
      id: 'sup_word',
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
      description: 'Среднее тире в диапазоне римских чисел',
      // Runs before en_century_range so the marked form still matches its dash class.
      pattern: /(^|[\s(])([XIV]{1,5})[-−]([XIV]{1,5})(?=[\s).,;:!?]|$)/gu,
      replacement: `$1$2${G.NDASH}$3`
    },
    {
      id: 'en_century_range',
      description: 'Тире между диапазоном веков',
      // Trailing letter lookahead stops the single-letter marker from matching into the next word.
      pattern:
        /([\s(]|^)([XIV]{1,5})([-—–])([XIV]{1,5})(( |\u{00A0})?(в\.в\.|вв\.|вв|в\.|в)(?![а-яёa-z]))/gu,
      replacement: (m, ctx) => {
        const [, p1, p2, , p4] = m;

        return `${p1}${ctx.tag(`${p2}${G.NDASH}${p4} вв.`, 'span', { class: 'nowrap' })}`;
      }
    },
    {
      id: 'en_time_range',
      description: 'Тире и неразрывный пробел в диапазоне времени',
      // Leading boundary is a lookbehind: consuming it strands the second of two glued ranges.
      pattern: /(?<![\d>])(\d{1,2}:\d{2})([-—−–])(\d{1,2}:\d{2})([^\d<]|$)/gu,
      replacement: (m, ctx) => {
        const [, p2, , p4, p5] = m;

        return `${ctx.tag(`${p2}${G.NDASH}${p4}`, 'span', { class: 'nowrap' })}${p5}`;
      }
    },
    {
      id: 'split_triads',
      description: 'Триады большого числа через узкий неразрывный пробел',
      // A digit run joined by hyphens to other digit groups is an identifier — an ISBN, a part
      // number — not a quantity, so `978-5-389-12345-6` must not gain a thousands separator. Only a
      // hyphen that itself follows a digit marks the run as a segment, which is what keeps a leading
      // minus working. `(?<!\d )` guards the other side: grouping `100644` behind a bare `8 ` builds
      // `8 100 644`, which the next pass reads as one number. The digits of a numeric character
      // reference are an identifier for the same reason an ISBN's are — `&#128512;` is one codepoint.
      pattern: /(?<![a-zA-Z0-9<)])(?<!\d-)(?<!\d )(?<!&#)([0-9]{5,})([^a-zA-Z>(]|$)/gu,
      replacement: (m) => {
        const [m0, p1, p2] = m;

        if (p2 === '-') {
          return m0;
        }

        return `${splitNumber(p1).replaceAll(' ', G.NNBSP)}${p2}`;
      }
    },
    {
      id: 'drop_nested_nowrap',
      description: 'Удаление nowrap-обёртки, вложенной в другую nowrap-обёртку',
      regexes: [SAMPLE_NOBR.marker],
      handler: dropNestedNowrap
    },
    {
      id: 'strip_nbsp_in_nowrap',
      description: 'Удаление неразрывных пробелов в nowrap-конструкциях',
      regexes: [SAMPLE_NOBR.m1, SAMPLE_NOBR.m2, SAMPLE_NOBR.inner],
      handler: removeNbspInNobr
    },
    {
      id: 'nbsp_in_nowrap',
      description: 'Преобразование nowrap-конструкций в неразрывные пробелы',
      enabled: false,
      regexes: [SAMPLE_NOBR.inner],
      handler: nobrToNbsp
    }
  ]
};
