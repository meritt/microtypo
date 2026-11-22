// Priority labels only: never filters cases, changes a shrink predicate or reads engine output.
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { readScalarAt } from '../../../src/clear-special.js';
import { isOn } from '../../../src/core/options.js';
import { scanLeadingHeader, splitFrontmatter } from '../../../src/input/frontmatter.js';
import { scanJson, selectValueSpans } from '../../../src/input/json.js';
import { scanCodeSpans, scanFences, scanIndentedCode } from '../../../src/input/markdown.js';
import { scanMath } from '../../../src/input/math.js';
import { scanPragmas } from '../../../src/input/pragmas.js';
import { collectSpans } from '../../../src/input/span-path.js';
import { templateScanner } from '../../../src/input/template.js';
import { scanToml } from '../../../src/input/toml.js';
import { scanXmlSpacePreserve, validateXml, xmlConstructReader } from '../../../src/input/xml.js';
import { scanYaml } from '../../../src/input/yaml.js';
import { BLOCK_TAG_NAMES, IMPLIED_END_TAGS, VOID_TAG_NAMES } from '../../../src/lib/block-tags.js';
import {
  CHARACTER_REFERENCE_HEAD,
  readCharacterReferenceAt
} from '../../../src/lib/character-reference.js';
import { CHARS_TABLE } from '../../../src/lib/chars-table.js';
import { URL_REGEX } from '../../../src/lib/url-email-regex.js';
import { DOCUMENT_READING, FRAGMENT_READING, tagSpans } from '../../../src/protect/tag-spans.js';
import { isQuoteMark } from '../../../src/rules/quote-state.js';
import { INLINE_TAGS, SAFE_TAGS } from './grammar.mjs';
import { NAMED_REFERENCES } from './invariants.mjs';

export const STRUCTURE_REVISION = 4;

const VALUE_SCANNERS = { json: scanJson, yaml: scanYaml, toml: scanToml };
const VOID = new Set(VOID_TAG_NAMES);
const PROTECTED = new Set(SAFE_TAGS);
const REQUIRED = new Set([...INLINE_TAGS, ...SAFE_TAGS]);
const KNOWN = new Set([...REQUIRED, ...BLOCK_TAG_NAMES, ...VOID, 'p']);
const NAMED = new Set([
  ...Object.keys(NAMED_REFERENCES),
  ...Object.values(CHARS_TABLE).flatMap(({ html = [] }) =>
    html.filter((s) => /^&[A-Za-z][A-Za-z0-9]*;$/u.test(s)).map((s) => s.slice(1, -1))
  )
]);
const CUT_REFERENCE = new RegExp(`${CHARACTER_REFERENCE_HEAD}(?![A-Za-z0-9;])`, 'gu');
// Frozen v1 explicitly classifies Unicode Cc except TAB/LF/CR as malformed.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const RESERVED = /[\uE000\uE001\uE100\uE101]/u;
const TAG_NAME = /^<(\/?)([A-Za-z][A-Za-z0-9:._-]*)(?=[\s/>]|$)/u;
const count = (text, glyph) => text.split(glyph).length - 1;

function encodedQuote(text) {
  for (let at = text.indexOf('&'); at !== -1; at = text.indexOf('&', at + 1)) {
    const reference = readCharacterReferenceAt(text, at);
    if (reference !== null) {
      const { glyph } = readScalarAt(`${reference.head};`, 0);
      if (glyph === '"' || isQuoteMark(glyph)) {
        return true;
      }
      at = reference.end - 1;
    }
  }
  return false;
}

function excluded(spans) {
  const out = [];
  for (const [start, end] of spans.toSorted((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

// Keep offsets while later native scope readers inspect what earlier protection left visible.
function mask(text, spans) {
  const parts = [];
  let at = 0;
  for (const [start, end] of excluded(spans)) {
    parts.push(text.slice(at, start), text.slice(start, end).replace(/[^\r\n]/g, ' '));
    at = end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

function outside(text, spans) {
  const parts = [];
  let at = 0;
  for (const [start, end] of excluded(spans)) {
    if (start > at) {
      parts.push(text.slice(at, start));
    }
    at = Math.max(at, end);
  }
  parts.push(text.slice(at));
  return parts.join('');
}

export function classifyStructure({ text, format, config }) {
  const reasons = new Set();
  const uncertain = new Set();
  if (!text.isWellFormed()) {
    reasons.add('unicode:surrogate');
  }
  if (CONTROL.test(text)) {
    reasons.add('unicode:control');
  }
  if (RESERVED.test(text)) {
    reasons.add('unicode:reserved');
  }
  const input = typeof config.input === 'object' ? config.input : {};

  let ignoredFile = false;
  let uncertainDocumentProtection = false;
  const prose = (source, kind) => {
    if (kind === 'value' && /[<`]/u.test(source)) {
      uncertain.add('context:value-syntax');
      uncertainDocumentProtection = true;
      return;
    }
    let quoteScope = true;
    const spans = [];
    const template = input.template && templateScanner(input.template);
    if (template) {
      spans.push(...template(source));
      if (spans.length > 0 || /[{<]/u.test(source)) {
        uncertain.add('context:template');
        uncertainDocumentProtection = true;
        return;
      }
    }
    if ((input.placeholders ?? 'all') !== 'off' && source.includes('{')) {
      uncertain.add('context:placeholder');
      uncertainDocumentProtection = true;
      return;
    }
    if (kind === 'mdx') {
      uncertain.add('context:mdx');
      uncertainDocumentProtection = true;
      return;
    }
    if (kind === 'markdown') {
      if (format === 'markdown') {
        spans.push(...scanLeadingHeader(source));
      }
      spans.push(...scanFences(mask(source, spans)));
      spans.push(...scanIndentedCode(mask(source, spans)));
      spans.push(...scanCodeSpans(mask(source, spans)));
      if (/\]\s*[([]/u.test(mask(source, spans))) {
        uncertain.add('context:markdown-link');
        uncertainDocumentProtection = true;
        return;
      }
    }
    if (kind === 'markdown' && isOn(input.math ?? true)) {
      spans.push(...scanMath(mask(source, spans)));
    }
    if (
      (input.pragmas ?? 'microtypo') === 'microtypo' &&
      ['markdown', 'html', 'text'].includes(kind)
    ) {
      spans.push(
        ...scanPragmas(mask(source, spans), undefined, {
          markdown: kind === 'markdown',
          restore: (content) => content,
          ignoreFile: () => {
            ignoredFile = true;
          }
        })
      );
    }
    if (ignoredFile) {
      return;
    }
    const markup = !['plain', 'value'].includes(kind);
    let parsed = outside(source, spans);
    if (markup) {
      if (kind === 'xml') {
        spans.push(...scanXmlSpacePreserve(source, undefined, true));
        spans.push(...collectSpans(xmlConstructReader(source)));
      }
      const tags = tagSpans(
        source,
        undefined,
        kind === 'xml',
        undefined,
        kind === 'text' || kind === 'html' ? DOCUMENT_READING : FRAGMENT_READING,
        excluded(spans)
      );
      // SAFE_TAGS are protected elements, not the native HTML raw-text vocabulary. Without
      // that private mode/nesting owner, no stack or prose inference in this scope is proven.
      if (
        tags.some(([start, gt]) => {
          const match = TAG_NAME.exec(source.slice(start, gt + 1));
          return match !== null && !match[1] && PROTECTED.has(match[2].toLowerCase());
        })
      ) {
        uncertain.add('context:protected-element');
        uncertainDocumentProtection = true;
        return;
      }
      if (kind === 'xml') {
        try {
          validateXml(source);
        } catch {
          reasons.add('markup:xml');
        }
      }
      const stack = [];
      let omission = false;
      let structuralScope = true;
      for (const [start, gt] of tags) {
        const token = source.slice(start, gt + 1);
        const match = TAG_NAME.exec(token);
        spans.push([start, gt + 1]);
        if (match === null) {
          if (source[gt] !== '>' && structuralScope) {
            reasons.add('markup:unfinished-construct');
          }
          continue;
        }
        const name = match[2].toLowerCase();
        if (name === 'svg' || name === 'math' || !KNOWN.has(name)) {
          uncertain.add('context:foreign-or-unknown-tag');
          quoteScope = false;
          structuralScope = false;
        }
        if (source[gt] !== '>') {
          if (structuralScope && (match[1] || /=\s*["']/u.test(token))) {
            reasons.add('markup:unfinished-tag');
          } else {
            uncertain.add('context:tag-or-comparison');
          }
          quoteScope = false;
          continue;
        }
        if (kind === 'xml' || VOID.has(name) || !structuralScope) {
          continue;
        }
        if (!match[1]) {
          stack.push(name);
          continue;
        }
        const opened = stack.lastIndexOf(name);
        if (opened === -1 && KNOWN.has(name) && !omission && !(name in IMPLIED_END_TAGS)) {
          reasons.add('markup:stray-close');
        } else if (opened !== stack.length - 1) {
          omission = true;
          uncertain.add('context:html-omission');
        }
        if (opened !== -1) {
          stack.length = opened;
        }
      }
      if (kind !== 'xml' && structuralScope && stack.length > 0) {
        if (!omission && stack.some((name) => REQUIRED.has(name))) {
          reasons.add('markup:unclosed-element');
        } else {
          uncertain.add('context:html-omission');
        }
      }
      parsed = outside(source, spans);
    }
    const addressSpans = [...parsed.matchAll(URL_REGEX)].map((m) => [
      m.index,
      m.index + m[0].length
    ]);
    const withoutAddresses = outside(parsed, addressSpans);
    for (const m of withoutAddresses.matchAll(CUT_REFERENCE)) {
      if (!m[0].startsWith('&#') && !NAMED.has(m[0].slice(1))) {
        uncertain.add('reference:unknown');
      } else if (!quoteScope) {
        uncertain.add('reference:context');
      } else if (m.index === 0 || /[\s([{"']/u.test(withoutAddresses[m.index - 1])) {
        if (kind === 'value' || kind === 'plain') {
          uncertain.add('reference:literal');
        } else {
          reasons.add('reference:unfinished');
        }
      } else {
        uncertain.add('reference:literal');
      }
    }
    if (encodedQuote(withoutAddresses)) {
      uncertain.add('quote:encoded-context');
      return;
    }
    if (!quoteScope) {
      return;
    }
    if (count(withoutAddresses, '"') % 2) {
      if (/\d"/u.test(withoutAddresses)) {
        uncertain.add('quote:possible-inch');
      } else {
        reasons.add('quote:ascii');
      }
    }
    if (count(withoutAddresses, '«') !== count(withoutAddresses, '»')) {
      reasons.add('quote:guillemets');
    }
    if (
      count(withoutAddresses, '“') !==
      count(withoutAddresses, '„') + count(withoutAddresses, '”')
    ) {
      reasons.add('quote:curly');
    }
  };

  const values = (source, kind) => {
    if (kind === 'json') {
      JSON.parse(source);
    } else if (kind === 'yaml') {
      parseYaml(source);
    } else {
      parseToml(source);
    }
    const scan = VALUE_SCANNERS[kind];
    for (const span of selectValueSpans(scan(source), input)) {
      if (!span.eligible) {
        uncertain.add('context:ineligible-value');
        continue;
      }
      const { start, end, delim } = span;
      const value =
        kind === 'json'
          ? JSON.parse(source.slice(start, end))
          : source.slice(start + delim.length, end - delim.length);
      if (kind !== 'json' && value.includes('\\')) {
        uncertain.add('context:value-escape');
      } else {
        prose(value, 'value');
      }
    }
  };
  try {
    if (format === 'json') {
      values(text, 'json');
    } else if (format === 'yaml') {
      values(text, 'yaml');
    } else if (format === 'toml') {
      values(text, 'toml');
    } else if (format === 'frontmatter') {
      const header = splitFrontmatter(text);
      if (header?.malformed) {
        uncertain.add('context:frontmatter');
      } else if (header === null) {
        prose(text, 'markdown');
      } else {
        // An ignore-file in the body also protects the metadata values. If the body scope is
        // ambiguous, the classifier cannot prove a document-level directive was absent.
        prose(text.slice(header.bodyStart), 'markdown');
        if (!ignoredFile) {
          if ((input.pragmas ?? 'microtypo') === 'microtypo' && uncertainDocumentProtection) {
            uncertain.add('context:document-protection');
          } else {
            values(header.header, header.open === '---' ? 'yaml' : 'toml');
          }
        }
      }
    } else {
      prose(text, format);
    }
  } catch {
    uncertain.add('context:reader');
  }
  return {
    version: STRUCTURE_REVISION,
    class: reasons.size === 0 ? 'intact' : 'malformed',
    reasons: [...reasons],
    uncertain: [...uncertain]
  };
}
