import {
  CLOSE,
  OPEN,
  TAG_PLACEHOLDER_SOURCE,
  TRANSPARENT_TAG_KINDS
} from '../protect/placeholders.js';
import { VOID_TAGS } from './block-tags.js';
import { sessionMap } from './session-maps.js';

// Native vaulted inline tags carry their kind; this reads no HTML or vaulted payload.
export function nativeTagStart(text, end) {
  if (text[end - 1] !== '>' || text[end - 2] !== CLOSE) {
    return -1;
  }
  let at = end - 3;
  while (at >= 0 && /[A-Za-z0-9]/u.test(text[at])) {
    at -= 1;
  }
  if (text[at] !== OPEN) {
    return -1;
  }
  let start = -1;
  if (text[at - 1] === '<') {
    start = at - 1;
  } else if (text[at - 1] === '/' && text[at - 2] === '<') {
    start = at - 2;
  }
  return start !== -1 && nativeTagEnd(text, start) === end ? start : -1;
}

export function inlineTagStart(text, end) {
  const start = nativeTagStart(text, end);
  if (start === -1) {
    return -1;
  }
  const tokenStart = start + (text[start + 1] === '/' ? 2 : 1);
  return TRANSPARENT_TAG_KINDS.includes(text[tokenStart + 1]) ? start : -1;
}

const NATIVE_TAG_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'uy');
export const NATIVE_TAG_REGEXES = [NATIVE_TAG_RE];

export function nativeTagEnd(text, start) {
  const tokenStart = start + (text[start + 1] === '/' ? 2 : 1);
  if (text[start] !== '<' || text[tokenStart] !== OPEN) {
    return -1;
  }
  if (Array.isArray(text)) {
    const close = text.indexOf(CLOSE, tokenStart + 1);
    if (close === -1) {
      return -1;
    }
    NATIVE_TAG_RE.lastIndex = 0;
    const match = NATIVE_TAG_RE.exec(text.slice(start, close + 2).join(''));
    return match === null ? -1 : start + match[0].length;
  }
  NATIVE_TAG_RE.lastIndex = start;
  const match = NATIVE_TAG_RE.exec(text);
  return match === null ? -1 : NATIVE_TAG_RE.lastIndex;
}

export function inlineEndTagStart(text, end) {
  const start = inlineTagStart(text, end);
  return start !== -1 && text[start + 1] === '/' ? start : -1;
}

export const inlineEndTagEndsAt = (text, gt) => inlineEndTagStart(text, gt + 1) !== -1;

const readers = sessionMap();

// Session transparent is the same authority as inline lifting; XML retains its element reading.
export function bindInlineBoundaries(ctx, nameOf, rawOf, referenceNameOf) {
  readers.set(ctx, { nameOf, rawOf, referenceNameOf });
}

const nameReader = (ctx, preservedReference = false) =>
  readers.get(ctx)?.[preservedReference ? 'referenceNameOf' : 'nameOf'];

function nativeName(nameOf, source, start, end) {
  const prefix = source[start + 1];
  const digits = source.slice(start + 2, end - 1);
  const id = Number(Array.isArray(digits) ? digits.join('') : digits);
  return nameOf(prefix, id);
}

function textInline(nameOf, source, start, end) {
  if (!TRANSPARENT_TAG_KINDS.includes(source[start + 1])) {
    return false;
  }
  const name = nativeName(nameOf, source, start, end);
  return name !== null && !VOID_TAGS.has(name);
}

// The element name of a placeholder token `${OPEN}${prefix}${id}${CLOSE}`, or null.
export function tokenTagName(ctx, token) {
  const nameOf = nameReader(ctx);
  return nameOf == null ? null : nameOf(token[1], Number(token.slice(2, -1)));
}

// The opening tag of a placeholder token as written between its angle brackets, or null.
export function tokenTagRaw(ctx, token) {
  const rawOf = readers.get(ctx)?.rawOf;
  return rawOf == null ? null : rawOf(token[1], Number(token.slice(2, -1)));
}

export function nativeVoidTag(ctx, source, start, end) {
  const nameOf = nameReader(ctx);
  const tokenStart = start + (source[start + 1] === '/' ? 2 : 1);
  return nameOf != null && VOID_TAGS.has(nativeName(nameOf, source, tokenStart, end - 1));
}

export function inlineTextEnd(ctx, source, offset, preservedReference = false, visit) {
  const nameOf = nameReader(ctx, preservedReference);
  if (nameOf == null) {
    return offset;
  }
  let before = offset;
  let start;
  while ((start = inlineTagStart(source, before)) !== -1) {
    visit?.();
    const tokenStart = start + (source[start + 1] === '/' ? 2 : 1);
    if (!textInline(nameOf, source, tokenStart, before - 1)) {
      break;
    }
    before = start;
  }
  return before;
}

export function inlineTextStart(ctx, source, offset, preservedReference = false) {
  const nameOf = nameReader(ctx, preservedReference);
  if (nameOf == null) {
    return offset;
  }
  let after = offset;
  let end;
  while ((end = nativeTagEnd(source, after)) !== -1) {
    const tokenStart = after + (source[after + 1] === '/' ? 2 : 1);
    if (!textInline(nameOf, source, tokenStart, end - 1)) {
      break;
    }
    after = end;
  }
  return after;
}
