import { tagSpans } from '../protect/tag-spans.js';

const SPACE = new Set([' ', '\t', '\n', '\r', '\f']);
const TEXT_META = new Set([
  'description',
  'og:title',
  'og:description',
  'twitter:title',
  'twitter:description'
]);
const asciiLower = (text) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

function attributes(text, start, end, checkBudget) {
  let at = start;
  const result = [];
  while (at < end) {
    if ((at & 0x3fff) === 0) {
      checkBudget?.('attributes');
    }
    while (SPACE.has(text[at])) {
      at += 1;
    }
    if (at >= end || text[at] === '>') {
      break;
    }
    if (text[at] === '/' && text[at + 1] === '>') {
      break;
    }
    const from = at;
    while (at < end && !SPACE.has(text[at]) && !['=', '>', '/'].includes(text[at])) {
      if ((at & 0x3fff) === 0) {
        checkBudget?.('attributes');
      }
      at += 1;
    }
    if (from === at) {
      at += 1;
      continue;
    }
    const name = asciiLower(text.slice(from, at));
    while (SPACE.has(text[at])) {
      at += 1;
    }
    if (text[at] !== '=') {
      result.push({ name, value: null });
      continue;
    }
    at += 1;
    while (SPACE.has(text[at])) {
      at += 1;
    }
    const quote = text[at] === '"' || text[at] === "'" ? text[at++] : '';
    const valueStart = at;
    while (at < end) {
      if (quote ? text[at] === quote : SPACE.has(text[at]) || text[at] === '>') {
        break;
      }
      if ((at & 0x3fff) === 0) {
        checkBudget?.('attributes');
      }
      at += 1;
    }
    if (quote && text[at] !== quote) {
      break;
    }
    result.push({ name, value: text.slice(valueStart, at), start: valueStart, end: at, quote });
    if (quote) {
      at += 1;
    }
  }
  return result;
}

const serialize = (value, quote) => {
  if (quote) {
    return value.replaceAll(quote, quote === '"' ? '&#34;' : '&#39;');
  }
  return value.replace(/[\t\n\r\f "'`=<>]/g, (character) => `&#${character.codePointAt(0)};`);
};

export function typesetAttributes(text, selected, transform, isProtected, checkBudget) {
  if (selected.size === 0 || !text.includes('<')) {
    return text;
  }
  const result = [];
  let cursor = 0;
  const tags = tagSpans(text);
  for (const [start, close] of tags) {
    checkBudget?.('attributes');
    if (close === text.length || text[start + 1] === '/') {
      continue;
    }
    const match = /^<([A-Za-z][A-Za-z0-9:-]*)/u.exec(text.slice(start, close + 1));
    if (match === null) {
      continue;
    }
    const name = asciiLower(match[1]);
    if (isProtected(name)) {
      continue;
    }
    const fields = attributes(text, start + match[0].length, close, checkBudget);
    const first = new Map();
    for (const field of fields) {
      if (!first.has(field.name)) {
        first.set(field.name, field);
      }
    }
    const textMeta =
      name === 'meta' &&
      ['name', 'property'].some((key) => TEXT_META.has(asciiLower(first.get(key)?.value ?? '')));
    for (const field of fields) {
      if (field.value === null || first.get(field.name) !== field || !selected.has(field.name)) {
        continue;
      }
      if (field.name === 'content' && !textMeta) {
        continue;
      }
      const value = serialize(transform(field.value), field.quote);
      if (value === field.value) {
        continue;
      }
      result.push(text.slice(cursor, field.start), value);
      cursor = field.end;
    }
  }
  result.push(text.slice(cursor));
  return result.join('');
}
