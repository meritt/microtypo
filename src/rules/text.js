import {
  BLOCK_TAG_NAMES,
  IMPLIED_END_TAGS,
  VOID_BLOCK_TAG_NAMES,
  VOID_TAG_NAMES
} from '../lib/block-tags.js';
import { G } from '../lib/glyphs.js';
import { count } from '../lib/strings.js';
import {
  PARAGRAPH_OPEN,
  PARAGRAPH_CLOSE,
  BREAKLINE,
  OPEN,
  CLOSE,
  RESERVED_PUA_CLASS,
  TAG_PLACEHOLDER_SOURCE,
  TAIL_KINDS,
  TRANSPARENT_TAG_KINDS
} from '../protect/placeholders.js';

// A vault id is minted per `process()`, so every regex built from one is built per call. Keeping the
// shapes in these two builders is what lets the handler rules below declare exactly what they run to
// the static ReDoS check: the declaration calls them with a sample placeholder rather than restating
// the patterns, so a shape cannot change in one place and stay unchecked in the other. The
// lookbehind is the one `PARAGRAPH_SPLIT_RE` explains.
const blockBoundaryRes = (alternation) => [
  new RegExp(`(?<![ \\t])[ \\t]*[\\r\\n][\\r\\n \\t]*(?=<\\/?(?:${alternation})>)`, 'g'),
  new RegExp(`(<\\/?(?:${alternation})>)[ \\t]*[\\r\\n][\\r\\n \\t]*`, 'g')
];

const afterAuthorBreakRe = (alternation) => new RegExp(`(?<!<(?:${alternation})>)\\n`, 'g');

const SAMPLE_PLACEHOLDER = `${OPEN}T1${CLOSE}`;

const ANY_TAG_LIFT_RE = new RegExp(TAG_PLACEHOLDER_SOURCE, 'g');

// A line's indent reaches this group whole, so a run of spaces can be long here. A match starting
// inside one also starts at its first character, which is found first, and the lookbehind spares
// every later start a rescan of the rest of the run.
const PARAGRAPH_SPLIT_RE = /(?<![ \t])([ \t]+)?(\n)+([ \t]*)(\n)+/g;

const EMPTY_PARAGRAPH_RE = new RegExp(
  `${PARAGRAPH_OPEN}(?:[^${PARAGRAPH_OPEN[0]}${PARAGRAPH_CLOSE[0]}]*?)?${PARAGRAPH_CLOSE}`,
  'g'
);

const PARAGRAPH_GAP_RE = new RegExp(
  `(${PARAGRAPH_CLOSE})([\\r\\n \\t]+)(${PARAGRAPH_OPEN})`,
  'gms'
);

// One pass over every tag placeholder, not one pass per `<p>`: a document whose paragraphs each
// carry their own attributes mints a distinct placeholder for each, and a replace per placeholder
// made the lift quadratic in their count.
function liftParagraphs(text, ctx) {
  const ps = new Set(tagPlaceholders(ctx, /^p$/i));

  if (ps.size === 0) {
    return text;
  }

  return text.replace(ANY_TAG_LIFT_RE, (m, slash, ph) => {
    if (!ps.has(ph)) {
      return m;
    }

    return slash === '/' ? `${ph}${PARAGRAPH_CLOSE}` : `${PARAGRAPH_OPEN}${ph}`;
  });
}

function tagPlaceholders(ctx, nameOrRegex) {
  const { tags } = ctx;

  if (!tags) {
    return [];
  }

  return tags.findByTagName(nameOrRegex).map(({ prefix, id }) => `${OPEN}${prefix}${id}${CLOSE}`);
}

// The document's own elements stand where a block would: no paragraph goes around one.
const BLOCK_NAMES = new Set([...BLOCK_TAG_NAMES, ...VOID_BLOCK_TAG_NAMES, 'html', 'head', 'body']);

const VOID_BLOCKS = new Set(VOID_BLOCK_TAG_NAMES);

// Every tag placeholder and every blank-line run, in one pass over the chunk.
const BLOCK_SCAN_RE = new RegExp(`${TAG_PLACEHOLDER_SOURCE}|${PARAGRAPH_SPLIT_RE.source}`, 'g');

const PROSE = 0;
const RUN = 1;
const ELEMENT = 2;

const unwrapParagraph = (paragraph) =>
  paragraph.replaceAll(PARAGRAPH_OPEN, '').replaceAll(PARAGRAPH_CLOSE, '');

// Same content, same placeholder (the vault dedups), so the gap is all an otherwise-empty paragraph
// may still hold. Every other placeholder stands for real content — a fenced block, a template
// expression — and a paragraph holding one is not empty.
function dropEmptyParagraphs(text, gap) {
  const isEmpty = (paragraph) => !/\S/.test(unwrapParagraph(paragraph).replaceAll(gap, ''));

  return text.replace(EMPTY_PARAGRAPH_RE, (m) => (isEmpty(m) ? '' : m));
}

// The author elements open on `holder`, innermost last. An end tag closes the nearest open element
// of its name and every one opened inside it; one with nothing of its name open closes nothing, and
// the call says so. An element never closed stays open to the end. A start tag `tagNames` read as
// empty, `name/`, opens nothing, while its end tag is still one of `name`.
function trackElement(holder, tag, closing) {
  const empty = tag.endsWith('/');
  const name = empty ? tag.slice(0, -1) : tag;

  if (!closing) {
    if (empty) {
      return true;
    }

    (holder.elements ??= []).push(name);
    holder.counts ??= new Map();
    holder.counts.set(name, (holder.counts.get(name) ?? 0) + 1);

    return true;
  }

  if (!holder.counts?.get(name)) {
    return false;
  }

  let popped;

  do {
    popped = holder.elements.pop();
    holder.counts.set(popped, holder.counts.get(popped) - 1);
  } while (popped !== name);

  return true;
}

const insideElement = (holder) => holder.elements?.length > 0;

// Hands `onTop` every stretch of `text` outside the author's elements, an outermost element's start
// and end tags included, and returns what is still open at the end. An element holding no line break
// stays inside the stretch around it: nothing there is a line break's to change, and a document
// full of links would otherwise come apart into a stretch per word. A tag placeholder stands in
// `<…>` or `</…>`, except an author paragraph's, which `liftParagraphs` set beside its marker.
function topLevel(text, { elements, ids }, onTop) {
  const holder = {};
  let from = 0;
  let inner = 0;
  // The first line break from where it was last looked for, looked for again only once `inner`
  // passes it, so the search never reads a stretch twice.
  let lineBreak = -1;

  for (
    let i = elements.size > 0 ? text.indexOf(OPEN) : -1;
    i !== -1;
    i = text.indexOf(OPEN, i + 1)
  ) {
    const named = ids[text[i + 1]];

    if (named === undefined) {
      continue;
    }

    let id = 0;
    let end = i + 2;

    for (let d = text.codePointAt(end); d >= 48 && d <= 57; d = text.codePointAt(++end)) {
      id = id * 10 + d - 48;
    }

    end += 1;
    const name = named[id];

    if (name === undefined) {
      continue;
    }

    let start = i;
    let after = end;
    let closing = false;

    if (text[i - 1] === '<') {
      start -= 1;
      after += 1;
    } else if (text[i - 1] === '/') {
      start -= 2;
      after += 1;
      closing = true;
    } else if (text.startsWith(PARAGRAPH_CLOSE, end)) {
      closing = true;
    }

    const was = insideElement(holder);

    trackElement(holder, name, closing);

    if (!was && insideElement(holder)) {
      inner = after;
    } else if (was && !insideElement(holder)) {
      if (lineBreak < inner) {
        const at = text.indexOf('\n', inner);

        lineBreak = at === -1 ? Infinity : at;
      }

      if (lineBreak < start) {
        onTop(from, inner);
        from = start;
      }
    }
  }

  if (insideElement(holder)) {
    onTop(from, inner);
  } else {
    onTop(from, text.length);
  }

  return holder;
}

const asWritten = (segment) => segment.some((item) => item.wrapped);

// A head ending inside an inline element shares it with the author paragraph beside it, so its last
// paragraph, the one that element opens in, stays as written.
function doParagraphs(text, ctx, elements, edge) {
  const gap = ctx.iblock('\n\n');
  const split = (p1) => `${p1 ?? ''}${PARAGRAPH_CLOSE}${gap}${PARAGRAPH_OPEN}`;
  let result;

  if (elements.size === 0) {
    result = text.replace(PARAGRAPH_SPLIT_RE, (_, p1) => split(p1));
  } else {
    // The tags are read up to each blank line as the split reaches it: one alternation of both
    // shapes scans several times slower than the two apart.
    const holder = {};

    ANY_TAG_LIFT_RE.lastIndex = 0;
    let tag = ANY_TAG_LIFT_RE.exec(text);

    const readTo = (end) => {
      for (; tag !== null && tag.index < end; tag = ANY_TAG_LIFT_RE.exec(text)) {
        const [, slash, ph] = tag;
        const name = elements.get(ph);

        if (name !== undefined) {
          trackElement(holder, name, slash);
        }
      }
    };

    result = text.replace(PARAGRAPH_SPLIT_RE, (m, p1, _n, _s, _l, at) => {
      readTo(at);

      return insideElement(holder) ? m : split(p1);
    });

    if (edge === 'head') {
      readTo(text.length);
    }

    if (edge === 'head' && insideElement(holder)) {
      const body = `${PARAGRAPH_OPEN}${result}`;
      const at = body.lastIndexOf(`${PARAGRAPH_CLOSE}${gap}${PARAGRAPH_OPEN}`);

      if (at === -1) {
        return { text, inside: true };
      }

      const done = dropEmptyParagraphs(`${body.slice(0, at)}${PARAGRAPH_CLOSE}`, gap);

      return {
        text: `${done}${body.slice(at + PARAGRAPH_CLOSE.length + gap.length + PARAGRAPH_OPEN.length)}`,
        inside: true
      };
    }
  }

  return {
    text: dropEmptyParagraphs(`${PARAGRAPH_OPEN}${result}${PARAGRAPH_CLOSE}`, gap),
    inside: false
  };
}

const VOID_TAGS = new Set(VOID_TAG_NAMES);

// A start tag of either name makes a foreign element wherever it stands, and a self-closing flag
// empties a foreign element. One of another name self-closing inside an open `<svg>` or `<math>`
// needs no telling apart: that element's end tag closes it with the rest.
const FOREIGN_ROOTS = new Set(['svg', 'math']);

const AUTHOR_BREAK_RE = /^br\b/i;

// The placeholder of every tag that opens an element, with the name it stands for, and of the block
// ones among them, which the paragraphs go around. One of the rest read in `<…>` is an inline
// element's: a `<p>`'s is lifted out of its brackets before.
// `findByTagName` asks about each entry's name in the order it reports the entries, and that order
// is the only way to learn the name without reading the vault.
function tagNames(ctx) {
  const names = [];
  const found = ctx.tags
    ? ctx.tags.findByTagName((name, selfClosing) => names.push({ name, selfClosing }) > 0)
    : [];
  const elements = new Map();
  const blocks = new Map();
  // The same elements by prefix and id, for a walk that reads the id where it stands.
  const ids = { T: [], A: [], L: [] };
  const breaks = [];

  found.forEach(({ prefix, id }, i) => {
    const name = names[i].name.toLowerCase();
    const ph = `${OPEN}${prefix}${id}${CLOSE}`;

    if (name.startsWith('br') && AUTHOR_BREAK_RE.test(names[i].name)) {
      breaks.push(ph);
    }

    if (BLOCK_NAMES.has(name)) {
      blocks.set(ph, name);
    }

    if (!VOID_TAGS.has(name)) {
      const tag = names[i].selfClosing && FOREIGN_ROOTS.has(name) ? `${name}/` : name;

      elements.set(ph, tag);
      ids[prefix][id] = tag;
    }
  });

  return { elements, blocks, ids, breaks };
}

// `paragraphs` mints inline blocks only, so the tags `breakline` reads right after it are the ones
// `paragraphs` read.
const namesRead = new WeakMap();

// White space at the edge of a paragraphed level. A line break there survives, and `breakline` turns
// it into the blank line beside a block; spaces alone go, as they go from the side of a chunk that
// faces an author paragraph, so the result reads the same again.
const edgeSpace = (s) => (/[\r\n]/.test(s) ? s : '');

// The rules ran before the block parted this text from what stood in front of it, so a dash they
// bound to the word before now opens the paragraph; it binds to the word after, as a dash opening
// any paragraph does.
const DASH_BOUND_BACK = `${G.NBSP}${G.MDASH} `;

const rebindLeadingDash = (core) =>
  core.startsWith(DASH_BOUND_BACK)
    ? `${G.MDASH}${G.NBSP}${core.slice(DASH_BOUND_BACK.length)}`
    : core;

// Only ASCII white space: a no-break space at a paragraph's edge is the author's, as it is in a
// paragraph no block parts. Walked rather than matched: a lazy core in front of `[ \t\n]*$` rescans
// every run of spaces inside the paragraph, and an indent makes one long.
const isEdgeSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n';

const splitEdges = (s) => {
  let start = 0;
  let end = s.length;

  while (start < end && isEdgeSpace(s[start])) {
    start += 1;
  }

  while (end > start && isEdgeSpace(s[end - 1])) {
    end -= 1;
  }

  return [s.slice(0, start), s.slice(start, end), s.slice(end)];
};

// Paragraphs for one chunk of the document, laid over its top level only: a blank line there splits
// paragraphs and a block there is never inside one, while the line breaks inside an author element,
// block or inline, are its markup's and stay as written. A run at the top that opens and closes with
// block tags stays bare.
//
// `edge` names a chunk beside an author paragraph: `head` may end inside elements the paragraph goes
// on in, `tail` may start inside the elements `outer` holds open. `sep` goes between the chunk and
// the paragraph.
function paragraphChunk(raw, ctx, { blocks: names, elements }, edge, outer = {}) {
  const text = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();

  if (text === '') {
    return { text: '', sep: '' };
  }

  // The white space the chunk is trimmed of on its side facing the author paragraph. Inside an
  // element it goes back as it was.
  const facing =
    edge === 'head'
      ? raw.slice(raw.trimEnd().length)
      : raw.slice(0, raw.length - raw.trimStart().length);

  const flat = () => {
    const paragraphs = doParagraphs(text, ctx, elements, edge);

    return { text: paragraphs.text, sep: paragraphs.inside ? facing : '\n' };
  };

  const startsInside = insideElement(outer);

  if (names.size === 0 && !startsInside) {
    return flat();
  }

  const gap = ctx.iblock('\n\n');
  const out = [];
  const open = new Map();
  const stack = [{ items: [], keep: startsInside }];
  let cursor = 0;
  let shaped = false;
  let sep = startsInside ? facing : '\n';

  const top = () => stack.at(-1);

  const prose = (end) => {
    if (end > cursor) {
      top().items.push({ kind: PROSE, i: out.push(text.slice(cursor, end)) - 1 });
    }
  };

  const solid = (item) => item.kind === ELEMENT || (item.kind === PROSE && /\S/.test(out[item.i]));

  // Whether the stretch ends in a block end tag, the author's own or a stray one: what the unwrap
  // read as the end of a block.
  const endsClosed = (item) => {
    if (item.kind === ELEMENT) {
      return item.closed;
    }

    const s = out[item.i].trimEnd();
    const m = /^<\/(.+)>$/.exec(s.slice(s.lastIndexOf('</')));

    return m !== null && names.has(m[1]);
  };

  // One segment of a level: the stretch between two blank lines at it. `first` and `last` say
  // whether it touches the level's own edges, whose white space belongs to the element around it.
  // A segment holding a block inside an inline element, or the inline element a head ends in, stays
  // as written: a paragraph boundary there would end that element.
  const shapeSegment = (segment, first, last) => {
    if (asWritten(segment)) {
      return;
    }

    if (!segment.some((item) => item.kind === ELEMENT)) {
      const [item] = segment;

      if (item !== undefined) {
        const [lead, core, trail] = splitEdges(out[item.i]);
        const inner = `${first ? '' : lead}${core}${last ? '' : trail}`;

        out[item.i] =
          `${first ? edgeSpace(lead) : ''}${PARAGRAPH_OPEN}${inner}${PARAGRAPH_CLOSE}${last ? edgeSpace(trail) : ''}`;
      }

      return;
    }

    const from = segment.findIndex(solid);
    const to = segment.findLastIndex(solid);
    const bare = segment[from].opens && endsClosed(segment[to]);

    segment.forEach((item, k) => {
      if (item.kind === ELEMENT) {
        return;
      }

      // White space at a segment's edge goes, as the unwrap took it out of the `<p>` around a block.
      if (k < from || k > to) {
        out[item.i] = '';
      } else if (bare) {
        if (k === to) {
          out[item.i] = out[item.i].trimEnd();
        }
      } else {
        // A paragraph next to a block is parted from it by a line break, which `breakline` turns
        // into the blank line an author paragraph gets there, so the result reads the same again.
        const [lead, core, trail] = splitEdges(out[item.i]);
        const keepLead = k > 0 ? '\n' : (first && edgeSpace(lead)) || '';
        const keepTrail = k < segment.length - 1 ? '\n' : (last && edgeSpace(trail)) || '';
        const body = k > 0 ? rebindLeadingDash(core) : core;

        out[item.i] = `${keepLead}${PARAGRAPH_OPEN}${body}${PARAGRAPH_CLOSE}${keepTrail}`;
      }
    });
  };

  const shapeLevel = (items) => {
    const from = items.findIndex(solid);
    const to = items.findLastIndex(solid);
    let segment = [];
    const segments = [segment];

    items.forEach((item, k) => {
      if (k < from || k > to || from === -1) {
        out[item.i] = edgeSpace(out[item.i]);
      }
    });

    const runs = [];

    for (const item of items.slice(from, to + 1)) {
      if (item.kind === RUN) {
        runs.push(item);
        segments.push((segment = []));
      } else {
        segment.push(item);
      }
    }

    // Beside a segment left as written a blank line parts no paragraph, and `breakline` would make
    // it a `<br>` on the next pass.
    runs.forEach((run, k) => {
      out[run.i] = asWritten(segments[k]) || asWritten(segments[k + 1]) ? '' : gap;
    });

    // Past a blank line the white space that opens or ends a paragraph stays inside it, as it does
    // between two paragraphs with no block in sight.
    const leads = items.slice(0, from).some((item) => item.kind === RUN);
    const trails = items.slice(to + 1).some((item) => item.kind === RUN);

    segments.forEach((s, k) =>
      shapeSegment(s, k === 0 && !leads, k === segments.length - 1 && !trails)
    );
  };

  const finish = (frame, closed) => {
    const last = frame.items.findLast(solid);
    const ends = closed || (last !== undefined && endsClosed(last));

    open.set(frame.name, open.get(frame.name) - 1);
    top().items.push({ kind: ELEMENT, opens: true, closed: ends, wrapped: frame.wrapped });
  };

  // An end tag closing an element open before the tail: everything in front of it is that
  // element's content, left as written, and the level starts over behind it, inside whatever stays
  // open.
  const restart = (index, token) => {
    prose(index);
    cursor = index + token.length;
    shaped = true;

    while (stack.length > 1) {
      finish(stack.pop(), false);
    }

    out.push(token);
    stack[0] = { items: [], keep: insideElement(outer) };
  };

  for (const m of text.matchAll(BLOCK_SCAN_RE)) {
    const [token, slash, ph, p1] = m;

    if (ph === undefined) {
      // A blank line inside an inline element is that element's text, not a paragraph break.
      if (insideElement(top())) {
        continue;
      }

      const at = m.index + (p1?.length ?? 0);

      prose(at);
      top().items.push({ kind: RUN, i: out.push(text.slice(at, m.index + token.length)) - 1 });
      cursor = m.index + token.length;
      continue;
    }

    const name = names.get(ph);

    if (name === undefined) {
      const tag = elements.get(ph);

      if (tag === undefined || trackElement(top(), tag, slash)) {
        continue;
      }

      if (stack.length === 1 && trackElement(outer, tag, true)) {
        restart(m.index, token);
      }

      continue;
    }

    // One closing nothing is no tag a parser reads.
    if (slash && !open.get(name)) {
      if (trackElement(outer, name, true)) {
        restart(m.index, token);
      }

      continue;
    }

    prose(m.index);
    cursor = m.index + token.length;
    shaped = true;

    if (!slash) {
      while (IMPLIED_END_TAGS[name]?.includes(top().name)) {
        finish(stack.pop(), false);
      }

      const wrapped = insideElement(top());

      out.push(token);

      if (VOID_BLOCKS.has(name)) {
        top().items.push({ kind: ELEMENT, opens: false, closed: false, wrapped });
      } else {
        stack.push({ name, items: [], wrapped });
        open.set(name, (open.get(name) ?? 0) + 1);
      }
    } else {
      while (top().name !== name) {
        finish(stack.pop(), false);
      }

      const frame = stack.pop();

      out.push(token);
      finish(frame, true);
    }
  }

  prose(text.length);

  if (!shaped) {
    return startsInside ? { text, sep: facing } : flat();
  }

  // A head ending inside an element goes on in the author paragraph.
  const endsInside = edge === 'head' && insideElement(stack[0]);

  if (edge === 'head' && (stack.length > 1 || endsInside)) {
    sep = facing;
  }

  while (stack.length > 1) {
    finish(stack.pop(), false);
  }

  if (endsInside) {
    stack[0].items.at(-1).wrapped = true;
  }

  if (!stack[0].keep) {
    shapeLevel(stack[0].items);
  }

  return { text: dropEmptyParagraphs(out.join(''), gap), sep };
}

// Where a region protected to the end of the text begins: its placeholder, behind the inline tag or
// comment opener it runs on from, which goes with it. A block tag in front of it stays the block the
// paragraphs go around.
const TAIL_RE = new RegExp(
  `(?:<${OPEN}[${TRANSPARENT_TAG_KINDS}]\\d+${CLOSE}>|<!--)?${OPEN}[${TAIL_KINDS}]\\d+${CLOSE}`
);

// The text in front of such a region without the white space it ends with, that white space, and
// the region; null where the text has none. Paragraphs and line breaks are laid out in front of it
// alone, so nothing they write lands inside the region or behind it.
function splitTail(text) {
  const m = TAIL_RE.exec(text);

  if (m === null) {
    return null;
  }

  const head = text.slice(0, m.index);
  const core = head.trimEnd();

  return [core, head.slice(core.length), text.slice(m.index)];
}

const aroundTail = (text, layOut) => {
  const split = splitTail(text);

  if (split === null) {
    return layOut(text, false);
  }

  const [core, gap, tail] = split;

  return `${layOut(core, true)}${gap}${tail}`;
};

function buildParagraphs(ctx) {
  const names = tagNames(ctx);

  namesRead.set(ctx, names);
  ctx.text = aroundTail(ctx.text, (text, runsOn) => layOutParagraphs(text, ctx, names, runsOn));
}

// `runsOn` says the text breaks off into a region protected to the end, where an author paragraph
// still open goes on: it stays as written, with no closer of ours.
function layOutParagraphs(text, ctx, names, runsOn) {
  const r = text.indexOf(PARAGRAPH_OPEN);
  const p = text.lastIndexOf(PARAGRAPH_CLOSE);

  if (runsOn && r !== -1 && text.lastIndexOf(PARAGRAPH_OPEN) > p) {
    const head = paragraphChunk(text.slice(0, r), ctx, names, 'head');

    return `${head.text}${head.sep}${text.slice(r)}`;
  }

  // The author's paragraphs run from the first opener to the last closer behind it. A closer in
  // front of every opener closes nothing of theirs, and reading it as their end would hand the text
  // between to both chunks around it.
  if (r !== -1 && p > r) {
    const start = p + PARAGRAPH_CLOSE.length;
    const mid = text.slice(r + PARAGRAPH_OPEN.length, p);
    const head = paragraphChunk(text.slice(0, r), ctx, names, 'head');
    const rest = text.slice(start);
    // A blank tail is dropped before anything reads what stays open in front of it.
    const outer = rest.trim() === '' ? {} : topLevel(text.slice(0, start), names, () => {});
    const tail = paragraphChunk(rest, ctx, names, 'tail', outer);

    return `${head.text}${head.sep}${PARAGRAPH_OPEN}${mid}${PARAGRAPH_CLOSE}${tail.sep}${tail.text}`;
  }

  return paragraphChunk(text, ctx, names, null).text;
}

function buildBreaklines(ctx) {
  const names = namesRead.get(ctx) ?? tagNames(ctx);

  namesRead.delete(ctx);
  ctx.text = aroundTail(ctx.text, (text) => breaklines(text, ctx, names));
}

// Line breaks for the text outside the author's elements; inside one they are its markup's.
function breaklines(text, ctx, names) {
  // Whitespace touching a block-level tag becomes a paragraph break, never a `<br>`: HTML forbids one
  // across a block boundary. Both sides of either tag, because the start and end tags of an element
  // at the top level both stand there. The opening form covers void block tags too, which have no
  // closing placeholder of their own.
  const { blocks, breaks } = names;
  const boundaries = blocks.size > 0 ? blockBoundaryRes([...blocks.keys()].join('|')) : null;
  let lineBreak = null;

  // An author <br> already breaks its line, so only its adjacent newline is suppressed.
  if (!text.includes(BREAKLINE)) {
    lineBreak = breaks.length > 0 ? afterAuthorBreakRe(breaks.join('|')) : /\n/g;
  }

  const breakTop = (part) => {
    let s = part.replace(
      PARAGRAPH_GAP_RE,
      (_, c, ws, o) => `${c}${ctx.iblock(/[\r\n]/.test(ws) ? '\n\n' : ws)}${o}`
    );

    if (boundaries !== null) {
      const [beforeBlock, afterBlock] = boundaries;

      s = s
        .replace(beforeBlock, () => ctx.iblock('\n\n'))
        .replace(afterBlock, (_, tag) => `${tag}${ctx.iblock('\n\n')}`);
    }

    return lineBreak === null ? s : s.replace(lineBreak, `${BREAKLINE}\n`);
  };

  const parts = [];
  let last = 0;

  topLevel(text, names, (from, to) => {
    parts.push(text.slice(last, from), breakTop(text.slice(from, to)));
    last = to;
  });
  parts.push(text.slice(last));

  return parts.join('');
}

export const textGroup = {
  title: 'Текст и абзацы',
  classes: { nowrap: 'white-space:nowrap;' },
  rules: [
    {
      id: 'autolink',
      description: 'Выделение ссылок из текста',
      htmlOnly: true,
      // The body excludes `"'<>` so a URL cannot break out of the href attribute, and the reserved
      // delimiters so it cannot swallow a placeholder. The closing boundary is a lookahead: consuming
      // it would eat the separator the next address needs as its own opening boundary.
      pattern: new RegExp(
        String.raw`(\s|^)(http|ftp|mailto|https)(:\/\/)([^\s,!<>"'${RESERVED_PUA_CLASS}]{4,})(?=\s|\.|,|!|\?|<|$)`,
        'giu'
      ),
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4Raw] = m;
        let body = p4Raw;
        let tail = '';
        while (
          body.length > 4 &&
          (body.endsWith('.') || (body.endsWith(')') && count(body, '(') < count(body, ')')))
        ) {
          tail = body.slice(-1) + tail;
          body = body.slice(0, -1);
        }
        const href = `${p2}${p3}${body}`;

        return `${p1}${ctx.tag(body, 'a', { href })}${tail}`;
      }
    },
    {
      id: 'email',
      description: 'Выделение эл. почты из текста',
      htmlOnly: true,
      // Closing boundary is a lookahead for the same reason as autolink: two addresses parted by one
      // space must both match in one pass.
      pattern:
        /(\s|^|\()([a-z0-9\-_.]{2,})@([a-z0-9\-.]{2,})\.([a-z]{2,6})(?=\)|\s|\.|,|!|\?|$|<)/giu,
      replacement: (m, ctx) => {
        const [, p1, p2, p3, p4] = m;
        const addr = `${p2}@${p3}.${p4}`;

        return `${p1}${ctx.tag(addr, 'a', { href: `mailto:${addr}` })}`;
      }
    },
    {
      id: 'deduplicate_words',
      description: 'Удаление повторяющихся слов',
      enabled: false,
      // Writes no markup, but runs with the rest of its group, which plain-text output goes without.
      htmlOnly: true,
      pattern: [
        /([а-яё]{3,})( |\t|\u{00A0})\1/giu,
        /(\s|\u{00A0}|^|\.|!|\?)(([А-ЯЁ])([а-яё]{2,}))( |\t|\u{00A0})(([а-яё])\4)/gu
      ],
      replacement: [
        '$1',
        (m) => {
          const [, p1, p2, , p3, , , p7] = m;

          return p7 === p3.toLowerCase() ? `${p1}${p2}` : `${p1}${p2}${m[5]}${m[6]}`;
        }
      ]
    },
    {
      id: 'paragraphs',
      description: 'Простановка параграфов',
      htmlOnly: true,
      // `ANY_TAG_LIFT_RE` also runs in `preParse`, which the static ReDoS check does not read.
      regexes: [PARAGRAPH_SPLIT_RE, EMPTY_PARAGRAPH_RE, BLOCK_SCAN_RE, ANY_TAG_LIFT_RE],
      handler: buildParagraphs
    },
    {
      id: 'breakline',
      description: 'Простановка переносов строк',
      htmlOnly: true,
      regexes: [
        PARAGRAPH_GAP_RE,
        ...blockBoundaryRes(SAMPLE_PLACEHOLDER),
        afterAuthorBreakRe(SAMPLE_PLACEHOLDER),
        /\n/g
      ],
      handler: buildBreaklines
    }
  ],

  preParse(ctx) {
    // The lifted markers are only ever read by the two htmlOnly rules above.
    if (ctx.html) {
      ctx.text = liftParagraphs(ctx.text, ctx);
    }
  }
};
