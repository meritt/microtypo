import { equalRanges } from './diff.js';

const ENDING_RE = /\r\n?|\n/g;

export function fileLineStyle(source, checkBudget) {
  if (!source.includes('\r')) {
    return '\n';
  }

  const counts = new Map();
  let style;
  let seen = 0;
  ENDING_RE.lastIndex = 0;

  for (let found; (found = ENDING_RE.exec(source)) !== null;) {
    if ((seen++ & 0x3ff) === 0) {
      checkBudget?.('file-line-endings');
    }
    style ??= found[0];
    counts.set(found[0], (counts.get(found[0]) ?? 0) + 1);
  }

  for (const [candidate, count] of counts) {
    if (count > counts.get(style)) {
      style = candidate;
    }
  }

  return style;
}

function restoreMixed(source, result, endings, style, checkBudget) {
  const before = source.replace(/\r\n?/g, '\n');
  const after = result.replace(/\r\n?/g, '\n');
  const mapped = new Map();
  let next = 0;

  for (const [from, to, length] of equalRanges(before, after, checkBudget)) {
    while (next < endings.length && endings[next].at < from) {
      next += 1;
    }

    while (next < endings.length && endings[next].at < from + length) {
      const ending = endings[next++];

      mapped.set(to + ending.at - from, ending.text);
    }
  }

  return after.replace(/\n/g, (_, at) => mapped.get(at) ?? style);
}

export function restoreFileEndings(source, result, style, checkBudget) {
  let output = result;

  if (source.includes('\r') || style !== '\n') {
    const endings = [];
    let uniform = true;
    let removed = 0;
    let seen = 0;
    ENDING_RE.lastIndex = 0;

    for (let found; (found = ENDING_RE.exec(source)) !== null;) {
      if ((seen++ & 0x3ff) === 0) {
        checkBudget?.('file-line-endings');
      }
      const text = found[0];

      endings.push({ at: found.index - removed, text });
      uniform &&= text === endings[0].text;
      removed += text.length - 1;
    }

    output =
      endings.length > 0 && uniform && endings[0].text === style
        ? result.replace(ENDING_RE, endings[0].text)
        : restoreMixed(source, result, endings, style, checkBudget);
  }

  return output;
}

function beforeFinalEndings(text) {
  let end = text.length;

  while (end > 0 && (text[end - 1] === '\r' || text[end - 1] === '\n')) {
    end -= 1;
  }

  return end;
}

export function restoreFileTail(source, result) {
  return result.slice(0, beforeFinalEndings(result)) + source.slice(beforeFinalEndings(source));
}
