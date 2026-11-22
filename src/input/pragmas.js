import {
  COMMENT_CLOSE,
  COMMENT_OPEN,
  commentCloseAt,
  insideTag,
  tagSpans
} from '../protect/tag-spans.js';
import { commentReader } from './markdown.js';

function htmlCommentReader(text) {
  let tags;
  const cursor = { i: 0 };
  return (from) => {
    for (let at = text.indexOf(COMMENT_OPEN, from); at !== -1;) {
      tags ??= tagSpans(text);
      if (insideTag(text, tags, cursor, at)) {
        at = text.indexOf(COMMENT_OPEN, at + COMMENT_OPEN.length);
        continue;
      }
      const close = commentCloseAt(text, at);
      if (close === -1) {
        return null;
      }
      return [at, close + COMMENT_CLOSE.length, close + COMMENT_CLOSE.length];
    }
    return null;
  };
}

export function scanPragmas(text, checkBudget, { markdown, restore, ignoreFile }) {
  const next = markdown ? commentReader(text, checkBudget) : htmlCommentReader(text);
  const spans = [];
  let start = -1;
  let depth = 0;
  let seen = 0;

  for (let comment = next(0); comment !== null; comment = next(comment[2])) {
    if ((seen++ & 0x3ff) === 0) {
      checkBudget?.('pragma');
    }
    const content = restore(
      text.slice(comment[0] + COMMENT_OPEN.length, comment[1] - COMMENT_CLOSE.length)
    ).trim();
    if (content === 'microtypo-ignore-file') {
      ignoreFile();
      return [[0, text.length]];
    }
    if (content === 'microtypo-ignore-start') {
      if (depth === 0) {
        start = comment[0];
      }
      depth += 1;
    } else if (content === 'microtypo-ignore-end' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        spans.push([start, comment[1]]);
        start = -1;
      }
    }
  }

  if (start !== -1) {
    spans.push([start, text.length, 'tail']);
  }
  return spans;
}
