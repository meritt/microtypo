import { isDeepStrictEqual } from 'node:util';

import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { visible } from '../visible.mjs';

export const NAMES = {
  errors: 'типизированные ошибки',
  traces: 'нет следов хранилищ',
  protected: 'защищённое байт в байт',
  shape: 'форма документа',
  idempotence: 'идемпотентность'
};

const TRACES = [
  '\u{E000}',
  '\u{E001}',
  '\u{E100}',
  '\u{E101}',
  'A0SAFE',
  'A1SAFE',
  'AzSAFE',
  'simonenko-xyz'
];

const FRONTMATTER_RE = /^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/u;
const XML_TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/gu;

const isTyped = (error) =>
  typeof error?.code === 'string' && error.code.startsWith('ERR_MICROTYPO');
const errorKey = (error) =>
  `${error?.name ?? typeof error}: ${String(error?.message ?? error)
    .slice(0, 60)
    .replaceAll(/\d+/gu, 'N')}`;
const tooLong = (error) =>
  error?.code === 'ERR_MICROTYPO_INPUT' && error.details?.max !== undefined;

function parsed(format, text) {
  if (format === 'json') {
    return JSON.parse(text);
  }

  if (format === 'yaml') {
    return parseYaml(text);
  }

  if (format === 'toml') {
    return parseToml(text);
  }

  if (format === 'frontmatter') {
    const match = FRONTMATTER_RE.exec(text);

    if (match === null) {
      return null;
    }

    return match[1] === '---' ? parseYaml(match[2]) : parseToml(match[2]);
  }

  return null;
}

function tryParsed(format, text) {
  try {
    return { value: parsed(format, text) };
  } catch (error) {
    return { error };
  }
}

function strings(value, into = []) {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      strings(item, into);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      strings(item, into);
    }
  }

  return into;
}

// Where a protected piece or a placeholder can show: the document as written, and every string a
// data format holds once its escapes are decoded.
const haystack = (text, tree) => [text, ...strings(tree?.value)].join('\u{0}');

const plainObject = (value) =>
  Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;

function shape(value) {
  if (typeof value === 'string') {
    return '\u{0}string';
  }

  if (Array.isArray(value)) {
    return value.map(shape);
  }

  if (value !== null && typeof value === 'object') {
    return plainObject(value)
      ? Object.entries(value).map(([key, item]) => [key, shape(item)])
      : `${value.constructor?.name}:${String(value)}`;
  }

  return value;
}

function firstDifference(a, b, path = '$') {
  if (isDeepStrictEqual(a, b)) {
    return null;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);

      if (found !== null) {
        return found;
      }
    }
  }

  return `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
}

function xmlTags(text) {
  return [...text.matchAll(XML_TOKEN_RE)]
    .filter((m) => m[2] !== undefined)
    .map((m) => `${m[1]}${m[2]}${m[3]}`);
}

function checkShape(format, text, out, before, after) {
  if (format === 'xml') {
    const difference = firstDifference(xmlTags(text), xmlTags(out));

    return difference === null ? null : `последовательность тегов: ${difference}`;
  }

  if (before.error !== undefined || before.value === null) {
    return null;
  }

  if (after.error !== undefined) {
    return `вывод не разбирается: ${after.error.message.split('\n')[0]}`;
  }

  const difference = firstDifference(shape(before.value), shape(after.value));

  return difference === null ? null : `разбор отличается: ${difference}`;
}

// An address the text group turns into a link is kept byte for byte in its `href`, where HTML
// writes an `&` as `&amp;` unless it already starts a character reference.
const BARE_AMPERSAND_RE = /&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#[xX][0-9A-Fa-f]+;)/gu;

const forms = (item) =>
  item.kind === 'url' || item.kind === 'email'
    ? [item.text, `href="${item.text.replaceAll(BARE_AMPERSAND_RE, '&amp;')}"`]
    : [item.text];

// A fingerprint tells occurrences of one defect from another without running anything: letters and
// digits fold to their class, everything else is kept as it is.
function classes(text) {
  return text
    .replaceAll(/\p{Ll}+/gu, 'а')
    .replaceAll(/\p{Lu}+/gu, 'А')
    .replaceAll(/\p{Nd}+/gu, '0')
    .slice(0, 48);
}

// The first place a second pass changes the first one's output, with the classes of the characters
// around it: `а.[ →⍽]А` is a space after an abbreviation turned into a no-break space before a
// capital.
const show = (s) => visible(s).replaceAll('\n', '↵');

function firstEdit(a, b) {
  let p = 0;

  while (p < a.length && a[p] === b[p]) {
    p += 1;
  }

  const WINDOW = 6;

  for (let span = 0; span <= 8; span++) {
    for (let removed = 0; removed <= span; removed++) {
      const inserted = span - removed;

      if (
        a.slice(p + removed, p + removed + WINDOW) === b.slice(p + inserted, p + inserted + WINDOW)
      ) {
        return `${classes(show(a.slice(Math.max(0, p - 3), p)))}[${show(a.slice(p, p + removed))}→${show(b.slice(p, p + inserted))}]${classes(show(a.slice(p + removed, p + removed + 2)))}`;
      }
    }
  }

  return `[…]${classes(visible(a.slice(p, p + 8)))}`;
}

// One function per engine: `check(case)` runs a case through a `MicroTypo` built from its
// configuration and returns every invariant it breaks. The last instance is kept, since shrinking
// asks about one configuration many times over. `restart` runs before the first pass, so what a case
// gives depends on the case alone.
export function createChecker(MicroTypo, restart) {
  let cachedKey = null;
  let cached = null;

  function engine(config) {
    const key = JSON.stringify(config);

    if (key !== cachedKey) {
      cached = new MicroTypo(config);
      cachedKey = key;
    }

    return cached;
  }

  // `only` names the one invariant a caller asks about, so shrinking does not pay for the others.
  return function check({ format, config, text, protect }, only = null) {
    const wants = (invariant) => only === null || only === invariant;
    let typo;
    let out;

    restart();

    try {
      typo = engine(config);
      out = typo.process(text);
    } catch (error) {
      if (isTyped(error)) {
        return { violations: [] };
      }

      const key = errorKey(error);

      return { violations: [{ invariant: 'errors', key, fingerprint: key, detail: key }] };
    }

    const violations = [];
    let again;
    let secondError;

    if (wants('idempotence') || wants('errors')) {
      try {
        again = typo.process(out);
      } catch (error) {
        secondError = error;
      }
    }

    if (wants('traces') || wants('protected') || wants('shape')) {
      const before = tryParsed(format, text);
      const after = tryParsed(format, out);
      const input = haystack(text, before);
      const output = haystack(out, after);

      for (const trace of wants('traces') ? TRACES : []) {
        if (output.includes(trace) && !input.includes(trace)) {
          violations.push({
            invariant: 'traces',
            key: trace,
            fingerprint: trace,
            detail: `в выводе ${JSON.stringify(trace)}, которого нет во вводе`
          });
        }
      }

      const seen = new Set();

      for (const item of wants('protected') ? protect : []) {
        const applies =
          input.includes(item.text) && (item.context === null || item.context.test(text));

        if (!seen.has(item.text) && applies && !forms(item).some((f) => output.includes(f))) {
          violations.push({
            invariant: 'protected',
            key: `${item.kind}\u{0}${item.text}`,
            kind: item.kind,
            fingerprint: `${item.kind} ${classes(item.text)}`,
            detail: `${item.kind} не найден в выводе: ${JSON.stringify(item.text)}`
          });
        }

        seen.add(item.text);
      }

      const problem = wants('shape') ? checkShape(format, text, out, before, after) : null;

      if (problem !== null) {
        violations.push({
          invariant: 'shape',
          key: format,
          fingerprint: `${format} ${classes(problem)}`,
          detail: problem
        });
      }
    }

    if (secondError !== undefined && !isTyped(secondError)) {
      const key = errorKey(secondError);

      violations.push({
        invariant: 'errors',
        key,
        fingerprint: key,
        detail: `второй проход: ${key}`
      });
    } else if (secondError !== undefined && !tooLong(secondError)) {
      const key = `second:${errorKey(secondError)}`;

      violations.push({
        invariant: 'idempotence',
        key,
        fingerprint: key,
        detail: `второй проход бросил ${errorKey(secondError)}`
      });
    } else if (secondError === undefined && again !== undefined && again !== out) {
      violations.push({
        invariant: 'idempotence',
        key: 'idempotence',
        fingerprint: firstEdit(out, again)
      });
    }

    return { violations, out, again };
  };
}
