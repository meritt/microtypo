import { G } from '../lib/glyphs.js';
import { cycle } from '../lib/strings.js';

// Key on the full sample incl. placeholder id: a stripped key would reuse a stale regex from another process() call.
const compileCache = new Map();
const COMPILE_CACHE_CAP = 8;

export function compileCacheSize() {
  return compileCache.size;
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

  // No wrapper markup (html:false) means no span boundary to scope to; else the patterns would match every word.
  if (idx === -1 || (open === '' && close === '')) {
    return null;
  }

  const oRe = RegExp.escape(open);
  const cRe = RegExp.escape(close);

  const compiled = {
    open,
    close,
    m1: new RegExp(`(^|[^a-zа-яё])([a-zа-яё]+)\u{00A0}(${oRe})`, 'giu'),
    m2: new RegExp(`(${cRe})\u{00A0}([a-zа-яё]+)($|[^a-zа-яё])`, 'giu'),
    inner: new RegExp(`${oRe}.*?${cRe}`, 'giu')
  };

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

function nobrToNbsp(ctx) {
  const c = compileNobrPatterns(ctx);

  if (!c) {
    return;
  }
  // Transform the full match, not a capture group: the open/close placeholders would otherwise be dropped.
  ctx.text = ctx.text.replace(c.inner, (m) => m.replaceAll(' ', G.NBSP));
}

export const etcGroup = {
  title: 'Прочее',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'acute_accent',
      description: 'Ударение на гласной',
      // \w is ASCII-only and misses the Cyrillic letter after the backtick; use \p{L}.
      pattern: /([уеыаоэяиюёУЕЫАОЭЯИЮЁ])`(\p{L})/gu,
      replacement: `$1${G.COMBINING_ACUTE}$2`
    },
    {
      id: 'sup_word',
      description: 'Надстрочный текст после ^',
      // htmlOnly: under html:false the consumed leading space and ^ marker would vanish and glue words.
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
      pattern: /(?<![a-zA-Z0-9<)])([0-9]{5,})([^a-zA-Z>(]|$)/gu,
      replacement: (m) => {
        const [, p1, p2] = m;

        return `${splitNumber(p1).replaceAll(' ', G.NNBSP)}${p2}`;
      }
    },
    {
      id: 'strip_nbsp_in_nowrap',
      description: 'Удаление неразрывных пробелов в nowrap-конструкциях',
      handler: removeNbspInNobr
    },
    {
      id: 'nbsp_in_nowrap',
      description: 'Преобразование nowrap-конструкций в неразрывные пробелы',
      enabled: false,
      handler: nobrToNbsp
    }
  ]
};
