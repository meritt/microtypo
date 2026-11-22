import { TAG_PLACEHOLDER_SOURCE, tagTokens } from '../protect/placeholders.js';
import { VOID_TAGS } from './block-tags.js';
import { inlineEndTagStart, tokenTagName, tokenTagRaw } from './inline-boundaries.js';
import { sessionMap } from './session-maps.js';

export const NOWRAP_TAG_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'g');
const WRAPPER_NAME_RE = /^(?:span|nobr)$/u;

const openers = sessionMap();

// The opening tag is read off a wrapper minted for the purpose, and minting one tells the engine
// which rule writes wrappers. A rule asks at every match, so the tag is kept for the group that
// asked until the next rule is bound: each rule on the lifted text still mints its own.
export function canonicalNowrapOpen(ctx) {
  const known = openers.get(ctx);
  if (known !== undefined && known.group === ctx.group) {
    return known.open;
  }
  const sample = ctx.tag('###', 'span', { class: 'nowrap', __style: 'white-space:nowrap;' });
  const open = sample.slice(0, sample.indexOf('###'));
  openers.set(ctx, { group: ctx.group, open });
  return open;
}

// Consecutive canonical openers add no visible content. No unrelated element is skipped.
export function canonicalNowrapContentStart(ctx, source, at, { skipPadding = true } = {}) {
  const open = canonicalNowrapOpen(ctx);
  if (open === '' || !source.startsWith(open, at)) {
    return -1;
  }
  let cursor = at;
  do {
    cursor += open.length;
    if (skipPadding) {
      while (source[cursor] === ' ' || source[cursor] === '\t' || source[cursor] === '\u{00A0}') {
        cursor += 1;
      }
    }
    ctx.checkBudget?.('nowrap:content');
  } while (source.startsWith(open, cursor));
  return cursor;
}

export function spanTokenSet(ctx) {
  return new Set(tagTokens(ctx.tags, WRAPPER_NAME_RE));
}

// All span openers participate: their closing placeholders are shared. An unrelated element
// can reset white-space, so its enclosing wrapper no longer proves a child redundant.
export function nowrapContexts(ctx, text, open) {
  const spans = spanTokenSet(ctx);
  const stack = [];
  const drops = [];
  NOWRAP_TAG_RE.lastIndex = 0;
  for (const m of text.matchAll(NOWRAP_TAG_RE)) {
    const span = { start: m.index, end: m.index + m[0].length, nowrap: m[0] === open };
    if (!spans.has(m[2])) {
      const enclosing = stack.at(-1);
      if (enclosing) {
        enclosing.nowrap = false;
      }
      continue;
    }
    if (m[1] !== '/') {
      span.nested = span.nowrap && Boolean(stack.at(-1)?.nowrap);
      stack.push(span);
    } else {
      const opened = stack.pop();
      if (opened?.nested) {
        drops.push(opened, span);
      }
    }
  }
  return { drops };
}

const ROOT = Object.freeze({ covered: false, parent: null, depth: 0 });
// An element with a style or a class of its own may reset `white-space` under the wrapper around it.
const RESETS_RE = /\s(?:style|class)\s*=/iu;

// The element tree as the stretches of text between tags, each with the innermost element open
// over it, and whether the engine's wrapper keeps that element's text together. An element's closing
// tag closes it wherever it stands open, and the ones left open inside it with it; a closing tag
// with nothing of its name open, and a void element, close nothing.
function elementStretches(ctx, text, open) {
  const spans = spanTokenSet(ctx);
  const starts = [];
  const nodes = [];
  const openNames = new Map();
  let node = ROOT;
  let cursor = 0;
  const close = (name) => {
    while (node !== ROOT) {
      const closed = node;
      openNames.set(closed.name, openNames.get(closed.name) - 1);
      node = closed.parent;
      if (closed.name === name) {
        return;
      }
    }
  };
  NOWRAP_TAG_RE.lastIndex = 0;
  for (const m of text.matchAll(NOWRAP_TAG_RE)) {
    starts.push(cursor);
    nodes.push(node);
    cursor = m.index + m[0].length;
    const span = spans.has(m[2]);
    const name = tokenTagName(ctx, m[2]) ?? (span ? 'span' : null);
    if (name === null || (!span && VOID_TAGS.has(name))) {
      continue;
    }
    if (m[1] === '/') {
      if (openNames.get(name) > 0) {
        close(name);
      }
      continue;
    }
    openNames.set(name, (openNames.get(name) ?? 0) + 1);
    const resets = RESETS_RE.test(tokenTagRaw(ctx, m[2]) ?? '');
    node = {
      covered: m[0] === open || (!resets && node.covered),
      parent: node,
      depth: node.depth + 1,
      name
    };
  }
  starts.push(cursor);
  nodes.push(node);
  return { starts, nodes };
}

function stretchAt(starts, at, from) {
  let i = from;
  while (i + 1 < starts.length && starts[i + 1] <= at) {
    i += 1;
  }
  return i;
}

function commonElement(a, b) {
  let x = a;
  let y = b;
  while (x.depth > y.depth) {
    x = x.parent;
  }
  while (y.depth > x.depth) {
    y = y.parent;
  }
  while (x !== y) {
    x = x.parent;
    y = y.parent;
  }
  return x;
}

const frames = sessionMap();
const cache = sessionMap();

// The existing inline projection restores authored reset elements for the context query, even
// while a rule reads their lifted text. Only the current rule's source is retained.
export function bindNowrapSource(ctx, visible, restore, lifted) {
  frames.set(ctx, {
    visible,
    restore,
    lifted,
    projection: null,
    asked: null,
    same: false,
    prefix: -1,
    suffix: 0,
    styled: null
  });
  cache.delete(ctx);
  openers.delete(ctx);
}

// Two strings that are not one object are read through to tell them apart, and a rule asks at every
// match of one text, long after the frame's own rule is done. The text asked about last stays with
// its answer, so asked again it is that very object.
function isFrameSource(frame, source) {
  if (frame.asked !== source) {
    frame.same = frame.visible === source;
    frame.prefix = -1;
  }
  frame.asked = source;
  return frame.same;
}

// How far a range of the changed text stands from its place in the frame's own text, when it lies
// wholly before the first change or after the last one; null when a change touches or surrounds it.
function unchangedShift(frame, source, start, end) {
  const { visible } = frame;
  if (frame.prefix === -1) {
    const limit = Math.min(source.length, visible.length);
    let prefix = 0;
    while (prefix < limit && source[prefix] === visible[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      source[source.length - 1 - suffix] === visible[visible.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    frame.prefix = prefix;
    frame.suffix = suffix;
  }
  if (end <= frame.prefix) {
    return 0;
  }
  return start >= source.length - frame.suffix ? visible.length - source.length : null;
}

// What a reader standing right behind the end tag of the engine's own no-wrap wrapper finds in its
// place: later groups write the wrapper, so the groups before them read the character it holds last.
// Null when the `>` at `gt` ends no such tag.
export function heldBeforeNowrapEnd(ctx, source, gt) {
  if (!ctx.html || source[gt] !== '>') {
    return null;
  }
  const start = inlineEndTagStart(source, gt + 1);
  return start > 0 && insideCanonicalNowrap(ctx, source, start - 1, start)
    ? source[start - 1]
    : null;
}

// Only an element that resets `white-space` inside the engine's wrapper can stand, unseen, between
// that wrapper and a phrase; one outside every wrapper resets nothing the wrapper holds.
function liftsStyled(ctx, frame, open) {
  if (frame.styled === null) {
    frame.projection ??= frame.restore();
    const { nodes } = elementStretches(ctx, frame.projection.source, open);
    frame.styled = nodes.some((node) => !node.covered && node.parent?.covered);
  }
  return frame.styled;
}

export function insideCanonicalNowrap(ctx, source, start, end) {
  if (!ctx.html) {
    return false;
  }
  let activeSource = source;
  let from = start;
  let to = end;
  const open = canonicalNowrapOpen(ctx);
  const frame = frames.get(ctx);
  let shift = null;
  if (frame !== undefined && isFrameSource(frame, source)) {
    shift = 0;
  } else if (frame?.lifted && liftsStyled(ctx, frame, open)) {
    // The preceding step changed the visible text: the lifted reset element keeps its position only
    // in the stretch before or after every change.
    shift = unchangedShift(frame, source, start, end);
    if (shift === null) {
      return false;
    }
  }
  if (shift !== null) {
    frame.projection ??= frame.restore();
    const { projection } = frame;
    activeSource = projection.source;
    from = projection.at(start + shift, true);
    to = projection.at(end + shift, false);
  }
  let state = cache.get(ctx);
  if (state?.source !== activeSource || state.open !== open) {
    state = { source: activeSource, open, ...elementStretches(ctx, activeSource, open), cursor: 0 };
    cache.set(ctx, state);
  }
  // The same holds for the stretches: an equal text of the next rule takes the place of the one
  // they were read from.
  state.source = activeSource;
  if (state.starts[state.cursor] > from) {
    state.cursor = 0;
  }
  state.cursor = stretchAt(state.starts, from, state.cursor);
  const last = stretchAt(state.starts, Math.max(from, to), state.cursor);
  // The innermost element holding the whole range decides: one lying inside it resets nothing there.
  return commonElement(state.nodes[state.cursor], state.nodes[last]).covered;
}

// Where every rule writes its no-wrap wrapper. A phrase the engine's wrapper already holds stays
// together without another: `other.strip_nbsp_in_nowrap` grows a wrapper over the word bound to
// the phrase, and one written inside it again would nest a level deeper on every pass.
export function nowrap(ctx, body, source, start, end) {
  return insideCanonicalNowrap(ctx, source, start, end)
    ? body
    : ctx.tag(body, 'span', { class: 'nowrap' });
}
