import {
  COMMENT_CLOSE,
  COMMENT_OPEN,
  commentCloseAt,
  insideTag,
  tagSpans
} from '../protect/tag-spans.js';
import { commentReader } from './markdown.js';

// A comment that starts its line and whose own `>` is what ends the tag around it stands in no
// attribute value: the tag is a `<` left open in the text before it, `x <y`, and the pragma on the
// next line is the author's all the same.
function endsStrayTag(text, span, at) {
  const close = span[1] - COMMENT_CLOSE.length + 1;
  if (!text.startsWith(COMMENT_CLOSE, close) || commentCloseAt(text, at) !== close) {
    return false;
  }
  let before = at;
  while (text[before - 1] === ' ' || text[before - 1] === '\t') {
    before -= 1;
  }
  return before > span[0] && (text[before - 1] === '\n' || text[before - 1] === '\r');
}

function htmlCommentReader(text) {
  let tags;
  let tried = -1;
  const cursor = { i: 0 };
  return (from) => {
    for (let at = text.indexOf(COMMENT_OPEN, from); at !== -1;) {
      tags ??= tagSpans(text);
      if (insideTag(text, tags, cursor, at)) {
        // Only the first comment of a tag can be the one whose end ends it.
        const first = tried !== cursor.i;
        tried = cursor.i;
        if (!first || !endsStrayTag(text, tags[cursor.i], at)) {
          at = text.indexOf(COMMENT_OPEN, at + COMMENT_OPEN.length);
          continue;
        }
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
