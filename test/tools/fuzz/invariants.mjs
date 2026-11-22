import { isDeepStrictEqual } from 'node:util';

import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { visible } from '../visible.mjs';
import { checkTransparent } from './transparent.mjs';

export const NAMES = {
  responds: 'движок отвечает',
  errors: 'типизированные ошибки',
  traces: 'нет следов хранилищ',
  protected: 'защищённое байт в байт',
  prose: 'проза вне синтаксиса',
  shape: 'форма документа',
  idempotence: 'идемпотентность',
  convergence: 'сходимость',
  transparent: 'строчная разметка прозрачна',
  filtering: 'отсев не меняет вывод'
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

// An address the text group turns into a link reaches its `href` with its character references
// decoded once and then escaped as attribute text.
const REFERENCE_RE = /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/gu;
export const NAMED_REFERENCES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function hrefOf(address) {
  const decoded = address.replaceAll(REFERENCE_RE, (whole, name, decimal, hex) => {
    if (name !== undefined) {
      return NAMED_REFERENCES[name];
    }

    const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);

    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      ? '\u{FFFD}'
      : String.fromCodePoint(code);
  });

  return decoded
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// Only equal maximal backtick runs pair (CommonMark 6.1). Resolve their next equal run
// independently of the product scanner, then skip the complete spans in reading order.
function codeCoverage(text) {
  const runs = [];
  const next = new Map();
  const tokens = [...text.matchAll(/`+|\r?\n[ \t]*\r?\n/gu)];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const { [i]: token } = tokens;
    if (token[0][0] !== '`') {
      next.clear();
      continue;
    }
    let slashes = 0;
    for (let at = token.index - 1; at >= 0 && text[at] === '\\'; at -= 1) {
      slashes += 1;
    }
    const { length } = token[0];
    const escaped = slashes % 2;
    const close = length > escaped ? next.get(length - escaped) : undefined;
    runs.push({ start: token.index + escaped, end: token.index + length, close });
    next.set(length, token.index + length);
  }
  const spans = [];
  let after = 0;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.start >= after && run.close !== undefined) {
      spans.push([run.start, run.close]);
      after = run.close;
    }
  }
  return spans;
}

function holdsCode(text, needle, spans) {
  let at = text.indexOf(needle);
  let span = 0;
  while (at !== -1) {
    while (span < spans.length && spans[span][1] <= at) {
      span += 1;
    }
    if (span >= spans.length) {
      return false;
    }
    if (spans[span][0] <= at && at + needle.length <= spans[span][1]) {
      return true;
    }
    at = text.indexOf(needle, at + 1);
  }
  return false;
}

// A textual attribute the configuration selects is typeset (`input.attributes`, all five by default,
// in text, HTML, Markdown and a front-matter body): its tag keeps the shape, not the bytes of the
// value.
const TEXT_ATTRIBUTES = ['alt', 'title', 'aria-label', 'placeholder', 'content'];
const ATTRIBUTE_FORMATS = new Set(['text', 'html', 'markdown', 'frontmatter']);
const QUOTED_ATTRIBUTE_RE = /\s([A-Za-z-]+)=(?:(")([^"]*)"|(')([^']*)')/gu;

function typesetAttributes(format, config) {
  if (!ATTRIBUTE_FORMATS.has(format)) {
    return [];
  }
  const input = typeof config?.input === 'object' && config.input !== null ? config.input : {};
  return input.attributes ?? TEXT_ATTRIBUTES;
}

function tagShape(tag, names) {
  let pattern = '';
  let at = 0;
  for (const match of tag.matchAll(QUOTED_ATTRIBUTE_RE)) {
    if (names.includes(match[1].toLowerCase())) {
      const quote = match[2] ?? match[4];
      const text = match[3] ?? match[5];
      const value = match.index + match[0].length - 1 - text.length;
      pattern += `${RegExp.escape(tag.slice(at, value))}[^${quote}<>]*`;
      at = value + text.length;
    }
  }
  return at === 0 ? null : new RegExp(pattern + RegExp.escape(tag.slice(at)), 'u');
}

function forms(item, source) {
  if (item.kind !== 'url' && item.kind !== 'email') {
    return [item.text];
  }
  const matches = [item.text, `href="${hrefOf(item.text)}"`];
  if (item.kind === 'url') {
    for (let at = source.indexOf(item.text); at !== -1; at = source.indexOf(item.text, at + 1)) {
      const end = at + item.text.length;
      const tail = source.slice(end).match(/^[^\s<>"'`]+/u)?.[0] ?? '';
      let continued = item.text;
      for (const character of tail) {
        continued += character;
        matches.push(`href="${hrefOf(continued)}"`);
      }
    }
  }
  return matches;
}

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

// A case the engine gives no answer on within the limit. `check` cannot see one: the pool that runs
// the case on a worker does, and replaces the worker.
export function silence(format, seconds) {
  return {
    invariant: 'responds',
    key: format,
    fingerprint: format,
    detail: `нет ответа за ${seconds} с`
  };
}

// One function per engine: `check(case)` runs a case through a `MicroTypo` built from its
// configuration and returns every invariant it breaks. The last instance is kept, since shrinking
// asks about one configuration many times over. `restart` runs before the first pass, so what a case
// gives depends on the case alone.
export function createChecker(MicroTypo, restart, unfiltered) {
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

  let plainKey = null;
  let plainEngine = null;

  // The output with the configuration of `config` and no character references, or null.
  function typesetPlain(config, text) {
    const key = JSON.stringify(config);

    try {
      if (key !== plainKey) {
        plainEngine = new MicroTypo({ ...config, entities: false });
        plainKey = key;
      }

      restart();

      return plainEngine.process(text);
    } catch {
      return null;
    }
  }

  // A case built for the transparency invariant is checked for it too; asked about it alone, the
  // outputs returned are the two it compares.
  const transparent = (kase) => {
    const typo = engine(kase.config);

    return checkTransparent(
      kase,
      (text) => {
        restart();
        return typo.process(text);
      },
      typesetPlain,
      classes
    );
  };

  function checkFiltering({ config, text }) {
    const run = (withoutFilter) => {
      try {
        const typo = engine(config);
        restart();
        return {
          output: withoutFilter ? unfiltered(() => typo.process(text)) : typo.process(text)
        };
      } catch (error) {
        return {
          error: {
            name: error?.name,
            code: error?.code,
            message: error?.message,
            details: error?.details
          }
        };
      }
    };

    const filtered = run(false);
    const full = run(true);
    if (isDeepStrictEqual(filtered, full)) {
      return null;
    }

    return {
      invariant: 'filtering',
      key: 'filtering',
      fingerprint:
        typeof filtered.output === 'string' && typeof full.output === 'string'
          ? firstEdit(filtered.output, full.output)
          : classes(firstDifference(filtered, full)),
      detail: firstDifference(filtered, full)
    };
  }

  // `only` names the one invariant a caller asks about, so shrinking does not pay for the others.
  function check(kase, only = null) {
    if (only === 'transparent') {
      let violation = null;

      try {
        violation = transparent(kase);
      } catch {
        // An engine that cannot be built for the case breaks another invariant.
      }

      return {
        violations: violation === null ? [] : [violation],
        out: violation?.out,
        again: violation?.again
      };
    }

    const result = checkOne(kase, only);

    if (kase.transparent && only === null) {
      try {
        const violation = transparent(kase);

        if (violation !== null) {
          const { out: _out, again: _again, ...found } = violation;

          result.violations.push(found);
        }
      } catch {
        // As above.
      }
    }

    if (only === null || only === 'filtering') {
      const violation = checkFiltering(kase);
      if (violation !== null) {
        result.violations.push(violation);
      }
    }

    return result;
  }

  check.typesetPlain = typesetPlain;

  return check;

  function checkOne(
    { format, config, text, protect, attributeShapes = [], expectedProse = [] },
    only
  ) {
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
    for (const item of wants('prose') ? expectedProse : []) {
      if (text.includes(item.source) && !out.includes(item.expected)) {
        violations.push({
          invariant: 'prose',
          key: item.source,
          fingerprint: item.source,
          detail: `не обработана проза: ${JSON.stringify(item.source)}`
        });
      }
    }
    let again;
    let secondError;
    let third;
    let thirdError;
    let thirdFailed = false;

    if (wants('idempotence') || wants('convergence') || wants('errors')) {
      try {
        again = typo.process(out);
      } catch (error) {
        secondError = error;
      }
    }

    if (wants('convergence') && secondError === undefined && again !== undefined && again !== out) {
      try {
        third = typo.process(again);
      } catch (error) {
        thirdFailed = true;
        thirdError = error;
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
      const attributes = typesetAttributes(format, config);
      let codeSpans;

      for (const item of wants('protected') ? protect : []) {
        const applies =
          input.includes(item.text) &&
          (item.context === null || item.context.test(text)) &&
          (item.kind !== 'md-code' ||
            holdsCode(text, item.text, (codeSpans ??= codeCoverage(text))));
        const kept = () =>
          forms(item, text).some((f) => output.includes(f)) ||
          (item.kind === 'tag' && tagShape(item.text, attributes)?.test(output) === true);

        if (!seen.has(item.text) && applies && !kept()) {
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

      for (const { marker, pattern } of wants('shape') ? attributeShapes : []) {
        const attributeShape = new RegExp(pattern, 'u');
        if (attributeShape.test(text) && !attributeShape.test(out)) {
          violations.push({
            invariant: 'shape',
            key: marker,
            fingerprint: marker,
            detail: `атрибут изменил структуру ${marker}`
          });
        }
      }

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

    if (thirdFailed) {
      const key = errorKey(thirdError);
      if (!isTyped(thirdError)) {
        violations.push({
          invariant: 'errors',
          key,
          fingerprint: key,
          detail: `третий проход: ${key}`
        });
      }
      violations.push({
        invariant: 'convergence',
        key: `third:${key}`,
        fingerprint: key,
        detail: `третий проход бросил ${key}`
      });
    } else if (third !== undefined && third !== again) {
      violations.push({
        invariant: 'convergence',
        key: 'convergence',
        fingerprint: firstEdit(again, third),
        growing: out.length < again.length && again.length < third.length
      });
    }

    return {
      violations,
      out,
      again,
      third,
      thirdError: thirdFailed
        ? {
            name: thirdError?.name ?? typeof thirdError,
            code: thirdError?.code,
            message: String(thirdError?.message ?? thirdError),
            details: thirdError?.details
          }
        : undefined
    };
  }
}
