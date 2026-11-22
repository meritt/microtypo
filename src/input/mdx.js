import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from '../lib/block-tags.js';
import { isBackslashEscaped, skipSpaces } from '../lib/strings.js';
import { lineReader, precedesInline } from './span-path.js';

const NATIVE_BLOCK_AT = new RegExp(
  `</?(?:p|${[...BLOCK_TAG_NAMES, ...VOID_BLOCK_TAG_NAMES].join('|')})(?=[\\s/>])`,
  'uy'
);
const NAME_START = /[A-Za-z]/u;
const NAME_PART = /[A-Za-z0-9_.:-]/u;
const VALUE_PREFIX = new Set([
  'return',
  'throw',
  'case',
  'yield',
  'await',
  'typeof',
  'void',
  'delete',
  'new',
  'in',
  'of',
  'instanceof'
]);
const CONTROL_HEADS = new Set(['if', 'while', 'for', 'with', 'switch', 'catch']);
const BLOCK_HEADS = new Set(['else', 'try', 'finally', 'do']);

function paragraphEnds(text, checkBudget) {
  const endings = [];
  let start = 0;
  let previous = 0;
  for (let at = 0; at <= text.length; at += 1) {
    if ((at & 1023) === 0) {
      checkBudget?.('mdx');
    }
    if (at < text.length && text[at] !== '\n' && text[at] !== '\r') {
      continue;
    }
    if (skipSpaces(text, start, at) === at) {
      endings.push({ end: previous, next: start });
    }
    previous = at;
    if (text[at] === '\r' && text[at + 1] === '\n') {
      at += 1;
    }
    start = at + 1;
  }
  endings.push({ end: text.length, next: text.length });
  return endings;
}

export function paragraphEndReader(text, checkBudget) {
  const boundaries = paragraphEnds(text, checkBudget);
  let cursor = 0;
  return (from) => {
    while (cursor < boundaries.length && boundaries[cursor].end <= from) {
      cursor += 1;
    }
    return boundaries[cursor]?.end ?? text.length;
  };
}

const expressionFrame = (at, statementBody = false, returnsValue = true) => ({
  at,
  kind: 'expression',
  statementBody,
  statementStart: statementBody,
  returnsValue,
  expectValue: true
});

function expressionResult(frame, value) {
  frame.expectValue = !value;
  frame.statementStart = !value && frame.statementBody;
  frame.bodyNext = null;
  frame.property = false;
  frame.labelCandidate = false;
}

const groupDepth = (frame) => (frame.parens?.length ?? 0) + (frame.brackets ?? 0);

function braceFrame(at, parent) {
  const pendingClass = parent.classes?.at(-1);
  const classBody =
    parent.bodyNext == null && pendingClass?.depth === groupDepth(parent)
      ? parent.classes.pop()
      : null;
  const body = parent.bodyNext ?? classBody;
  const statement =
    (body !== null && body !== undefined) || parent.statementStart || !parent.expectValue;
  return expressionFrame(at, statement, body?.returnsValue ?? !statement);
}

export function mdxReader(text, checkBudget) {
  const expressions = new Map();
  const strings = new Map();
  const attributes = new Map();
  const templates = new Map();
  const comments = new Map();
  let blockCommentEnds = null;
  const regexps = new Map();
  const jsxTags = new Map();
  const jsxTrees = new Map();
  const caches = { expression: expressions, template: templates, tag: jsxTags, jsx: jsxTrees };
  const blockEnd = paragraphEndReader(text, checkBudget);
  const lastTagClose = text.lastIndexOf('>');
  const opener = /\{|<(?:\/?[A-Za-z]|\/?>)/g;
  let nextCheck = 0;
  const tick = (at) => {
    if (at >= nextCheck) {
      checkBudget?.('mdx');
      nextCheck = at + 1024;
    }
  };
  const quoted = (at, multiline = false) => {
    const cache = multiline ? attributes : strings;
    if (cache.has(at)) {
      return cache.get(at);
    }
    const quote = text[at];
    let end = at + 1;
    while (end < text.length && text[end] !== quote) {
      tick(end);
      if (!multiline && (text[end] === '\r' || text[end] === '\n')) {
        cache.set(at, -1);
        return -1;
      }
      end += !multiline && text[end] === '\\' ? 2 : 1;
    }
    const found = end < text.length ? end + 1 : -1;
    cache.set(at, found);
    return found;
  };
  const comment = (at) => {
    if (comments.has(at)) {
      return comments.get(at);
    }
    let end;
    if (text[at + 1] === '/') {
      end = at + 2;
      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
        tick(end);
        end += 1;
      }
    } else {
      if (blockCommentEnds === null) {
        blockCommentEnds = new Map();
        let next = -1;
        let after = -1;
        for (let i = text.length - 2; i >= 0; i -= 1) {
          if ((i & 1023) === 0) {
            checkBudget?.('mdx-comment');
          }
          if (text[i] === '*' && text[i + 1] === '/') {
            after = next;
            next = i + 2;
          } else if (text[i] === '/' && text[i + 1] === '*') {
            blockCommentEnds.set(i, next === i + 3 ? after : next);
          }
        }
      }
      end = blockCommentEnds.get(at);
    }
    comments.set(at, end);
    return end;
  };
  const regexp = (start) => {
    if (regexps.has(start)) {
      return regexps.get(start);
    }
    let at = start + 1;
    let characterClass = false;
    while (at < text.length && text[at] !== '\n' && text[at] !== '\r') {
      tick(at);
      if (text[at] === '\\') {
        at += 2;
      } else if (text[at] === '/' && !characterClass) {
        at += 1;
        while (/[A-Za-z]/u.test(text[at] ?? '')) {
          tick(at);
          at += 1;
        }
        regexps.set(start, at);
        return at;
      } else {
        if (text[at] === '[') {
          characterClass = true;
        } else if (text[at] === ']') {
          characterClass = false;
        }
        at += 1;
      }
    }
    regexps.set(start, -1);
    return -1;
  };
  const readSyntax = (start, kind) => {
    const cache = caches[kind];
    if (cache.has(start)) {
      return cache.get(start);
    }
    const stack = [kind === 'expression' ? expressionFrame(start) : { at: start, kind }];
    let at = kind === 'tag' ? start : start + 1;
    const finish = (end) => {
      const frame = stack.pop();
      caches[frame.kind].set(frame.at, end);
      const parent = stack.at(-1);
      if (parent?.kind === 'expression') {
        expressionResult(parent, frame.kind !== 'expression' || frame.returnsValue);
      }
      return frame;
    };
    while (at < text.length && stack.length > 0) {
      tick(at);
      const frame = stack.at(-1);
      const character = text[at];
      if (frame.kind === 'tag') {
        if (at === frame.at) {
          const nameStart = at + (text[at + 1] === '/' ? 2 : 1);
          at = nameStart;
          if (text[at] !== '>' && !NAME_START.test(text[at] ?? '')) {
            break;
          }
          while (at < text.length && NAME_PART.test(text[at])) {
            tick(at);
            at += 1;
          }
          frame.name = text.slice(nameStart, at);
          frame.closing = text[frame.at + 1] === '/';
        } else if (character === '>') {
          const empty = text[at - 1] === '/';
          at += 1;
          const tag = finish(at);
          const parent = stack.at(-1);
          if (parent?.kind === 'jsx') {
            parent.names ??= [];
            if (tag.closing) {
              if (parent.names.pop() !== tag.name) {
                break;
              }
            } else if (!empty) {
              parent.names.push(tag.name);
            }
            if (parent.names.length === 0) {
              finish(at);
            }
          }
        } else if (character === '<') {
          break;
        } else if (character === '"' || character === "'") {
          at = quoted(at, true);
          if (at === -1) {
            break;
          }
        } else if (character === '{') {
          stack.push(expressionFrame(at));
          at += 1;
        } else {
          at += 1;
        }
        continue;
      }
      if (frame.kind === 'jsx') {
        if (character === '<') {
          stack.push({ at, kind: 'tag' });
        } else if (character === '{') {
          stack.push(expressionFrame(at));
          at += 1;
        } else {
          at += 1;
        }
        continue;
      }
      if (frame.kind === 'template') {
        if (character === '\\') {
          at += 2;
        } else if (character === '`') {
          finish(at + 1);
          at += 1;
        } else if (character === '$' && text[at + 1] === '{') {
          at += 1;
          stack.push(expressionFrame(at));
          at += 1;
        } else {
          at += 1;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        at = quoted(at);
        if (at === -1) {
          break;
        }
        expressionResult(frame, true);
      } else if (character === '/' && (text[at + 1] === '/' || text[at + 1] === '*')) {
        at = comment(at);
        if (at === -1) {
          break;
        }
      } else if (character === '/' && frame.expectValue) {
        at = regexp(at);
        if (at === -1) {
          break;
        }
        expressionResult(frame, true);
      } else if (character === '`') {
        if (templates.has(at)) {
          at = templates.get(at);
          if (at === -1) {
            break;
          }
          expressionResult(frame, true);
        } else {
          stack.push({ at, kind: 'template' });
          at += 1;
        }
      } else if (character === '{') {
        const child = braceFrame(at, frame);
        if (expressions.has(at)) {
          at = expressions.get(at);
          if (at === -1) {
            break;
          }
          expressionResult(frame, child.returnsValue);
        } else {
          stack.push(child);
          at += 1;
        }
      } else if (character === '}') {
        finish(at + 1);
        at += 1;
      } else if (
        character === '<' &&
        frame.expectValue &&
        (NAME_START.test(text[at + 1] ?? '') || text[at + 1] === '>')
      ) {
        stack.push({ at, kind: 'jsx' });
        stack.push({ at, kind: 'tag' });
      } else if (/[A-Za-z_$]/u.test(character)) {
        const from = at;
        at += 1;
        while (/[A-Za-z0-9_$]/u.test(text[at] ?? '')) {
          tick(at);
          at += 1;
        }
        const word = text.slice(from, at);
        const { property } = frame;
        const { statementStart } = frame;
        const forAwait = !property && frame.controlNext === 'for' && word === 'await';
        const control = !property && CONTROL_HEADS.has(word) ? word : null;
        frame.controlNext = forAwait ? 'for' : control;
        if (!property && word === 'function') {
          frame.functionHead = { returnsValue: !(statementStart || frame.asyncStatement) };
        }
        if (!property && word === 'class') {
          (frame.classes ??= []).push({
            returnsValue: !statementStart,
            depth: groupDepth(frame)
          });
        }
        frame.asyncStatement = !property && word === 'async' && statementStart;
        const block = !property && BLOCK_HEADS.has(word);
        frame.labelCandidate =
          statementStart && !property && !block && !CONTROL_HEADS.has(word) && word !== 'function';
        frame.statementStart = block;
        frame.expectValue = block || forAwait || (!property && VALUE_PREFIX.has(word));
        frame.property = false;
      } else if ((character === '+' || character === '-') && text[at + 1] === character) {
        frame.controlNext = null;
        frame.statementStart = false;
        frame.labelCandidate = false;
        at += 2;
      } else if (character === '[') {
        frame.brackets = (frame.brackets ?? 0) + 1;
        frame.expectValue = true;
        frame.statementStart = false;
        frame.labelCandidate = false;
        frame.property = false;
        at += 1;
      } else if (character === ']') {
        frame.brackets = Math.max(0, (frame.brackets ?? 0) - 1);
        expressionResult(frame, true);
        at += 1;
      } else if (character === '(') {
        (frame.parens ??= []).push({
          control: Boolean(frame.controlNext),
          functionHead: frame.functionHead
        });
        frame.functionHead = null;
        frame.controlNext = null;
        frame.expectValue = true;
        frame.statementStart = false;
        frame.labelCandidate = false;
        frame.property = false;
        at += 1;
      } else if (character === ')') {
        const header = frame.parens?.pop();
        frame.expectValue = Boolean(header?.control || header?.functionHead);
        frame.statementStart = Boolean(header?.control);
        frame.bodyNext = header?.functionHead ?? null;
        frame.controlNext = null;
        frame.labelCandidate = false;
        frame.property = false;
        at += 1;
      } else {
        if (!/\s/u.test(character)) {
          const arrow = character === '>' && text[at - 1] === '=';
          const label = character === ':' && frame.labelCandidate;
          frame.bodyNext = arrow ? { returnsValue: true } : null;
          frame.statementStart =
            label || (character === ';' && frame.statementBody && !frame.parens?.length);
          frame.expectValue = '([,:;=!?&|+*%<>~^/-'.includes(character);
          frame.property = character === '.' || (character === '#' && frame.property);
          frame.controlNext = null;
          frame.labelCandidate = false;
        }
        at += 1;
      }
    }
    for (const frame of stack) {
      caches[frame.kind].set(frame.at, -1);
    }
    return cache.get(start) ?? -1;
  };
  const tag = (start) => {
    if (lastTagClose < start) {
      return -1;
    }
    return readSyntax(start, 'tag');
  };

  return {
    next(from) {
      opener.lastIndex = from;
      for (let match; (match = opener.exec(text)) !== null;) {
        tick(match.index);
        if (isBackslashEscaped(text, match.index)) {
          continue;
        }
        return [match.index, match.index, match.index];
      }
      return null;
    },
    read(start) {
      let end;
      if (text[start] === '{') {
        end = readSyntax(start, 'expression');
      } else if (text[start] === '<') {
        end = tag(start);
      } else {
        end = start + 1;
      }
      const closed = end !== -1;
      if (!closed) {
        end = blockEnd(start);
      }
      return [start, end, end, closed];
    }
  };
}

export function mdxTagSpans(text, checkBudget, opaque = []) {
  const reader = mdxReader(text, checkBudget);
  const tags = [];
  let candidate = reader.next(0);
  let skip = 0;
  while (candidate !== null) {
    while (skip < opaque.length && opaque[skip][1] <= candidate[0]) {
      skip += 1;
    }
    if (skip < opaque.length && opaque[skip][0] <= candidate[0]) {
      candidate = reader.next(opaque[skip][1]);
      continue;
    }
    const span = reader.read(candidate[0]);
    if (text[span[0]] === '<' && span[3]) {
      tags.push([span[0], span[1] - 1, text[span[1] - 2] === '/']);
    }
    candidate = reader.next(span[2]);
  }
  return tags;
}

export function esmReader(text, checkBudget) {
  const boundaries = paragraphEnds(text, checkBudget);
  const start = /(?:import|export)(?=[ \t{*'"\r\n]|$)/y;
  let boundary = 0;
  return (at) => {
    start.lastIndex = at;
    if (!start.test(text)) {
      return null;
    }
    while (boundary < boundaries.length && boundaries[boundary].end <= at) {
      boundary += 1;
    }
    return boundaries[boundary] ?? { end: text.length, next: text.length };
  };
}

// Without `withMdx` it reads code spans, templates and what the owners keep, as Markdown does.
export function mdxLineReader(codeReader, templateReader, owned = [], withMdx = true) {
  return (text, checkBudget) => {
    const mdx = withMdx ? mdxReader(text, checkBudget) : null;
    const readers = [];
    for (const factory of [codeReader, templateReader]) {
      if (factory !== null) {
        const reader = factory(text, checkBudget);
        readers.push({ next: reader.next ?? reader, read: reader.read });
      }
    }
    for (const factory of owned) {
      const reader = factory(text, checkBudget, mdx);
      readers.push(reader.next === undefined ? { next: reader } : reader);
    }
    if (mdx !== null) {
      readers.push({ next: mdx.next, read: mdx.read });
    }
    return lineReader(readers);
  };
}

export function opaqueMdx(codeReader, templateReader, owned, reportTags = true) {
  return (text, checkBudget, resolve, codeEdges = false) => {
    const readers = [];
    const mdx = mdxReader(text, checkBudget);
    for (const readerFor of [codeReader, templateReader]) {
      if (readerFor === null) {
        continue;
      }
      const reader = readerFor(text, checkBudget, resolve);
      const next = reader.next ?? reader;
      readers.push({
        next,
        read: reader.read,
        at: next(0),
        report: true,
        code: readerFor === codeReader
      });
    }
    for (const readerFor of owned) {
      const reader = readerFor(text, checkBudget, mdx);
      const { next, read } = reader.next === undefined ? { next: reader } : reader;
      readers.push({ next, read, at: next(0), report: false });
    }
    readers.push({ next: mdx.next, at: mdx.next(0), read: mdx.read, report: true, mdx: true });
    const spans = [];
    let count = 0;
    while (readers.some((reader) => reader.report && reader.at !== null)) {
      if ((count++ & 1023) === 0) {
        checkBudget?.('mdx-inline');
      }
      let first = null;
      for (const reader of readers) {
        if (precedesInline(reader.at, first?.at)) {
          first = reader;
        }
      }
      const span = first.read ? first.read(first.at[0]) : first.at;
      const markup = span[4] === true || (first.mdx && text[span[0]] === '<');
      if (!markup || !reportTags) {
        for (const syntax of span.syntax ?? []) {
          spans.push(syntax);
        }
      }
      if (((first.report && span[4] !== false) || span[4] === true) && (reportTags || !markup)) {
        const interval = [span[0], span[1]];
        if (first.code && codeEdges && span[2] > span[1]) {
          interval.push('inline-code', span[2] - span[1]);
        } else if (span[3] === 'tail') {
          interval.push('tail');
        } else if (markup && text[span[0]] === '<') {
          // Uppercase names are components: only a native HTML block has a known display role.
          NATIVE_BLOCK_AT.lastIndex = span[0];
          if (NATIVE_BLOCK_AT.test(text)) {
            interval.push('line-block');
          }
        }
        spans.push(interval);
      }
      for (const reader of readers) {
        if (reader.at !== null && reader.at[0] < span[2]) {
          reader.at = reader.next(span[2]);
        }
      }
    }
    return spans;
  };
}
