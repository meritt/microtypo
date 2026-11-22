import {
  NOT_AFTER_LONE_QUOTE,
  OPEN_LEFT,
  QUOTE_PUNCTUATION,
  OPEN_CYRILLIC_RE,
  QUOTE_WORD,
  openingQuoteNeighbours,
  WEAK_LEFT,
  WEAK_STOP
} from '../lib/boundaries.js';
import {
  authoredReferenceGlyph,
  characterReferenceEndingAt,
  keptGlyphAt,
  keptReferenceGlyph,
  quoteBoundaryGlyph,
  readCharacterReferenceAt
} from '../lib/character-reference.js';
import { G } from '../lib/glyphs.js';
import {
  inlineEndTagStart,
  inlineTextEnd,
  inlineTextStart,
  nativeTagEnd,
  nativeTagStart,
  tokenTagRaw,
  nativeVoidTag
} from '../lib/inline-boundaries.js';
import { heldBeforeNowrapEnd } from '../lib/nowrap-context.js';
import {
  matchingQuote,
  pairAuthoredQuotes,
  pairQuoteTokens,
  resolveAuthoredQuotePairs,
  RDQUO
} from '../lib/quote-pairs.js';
import { F } from '../lib/rule-features.js';
import { sessionMap } from '../lib/session-maps.js';
import { count } from '../lib/strings.js';
import { OPEN, CLOSE, INLINE_END, REFERENCE_HOLE } from '../protect/placeholders.js';
import { LINKABLE_SOURCE } from '../protect/sequences.js';
import { followsFeet } from './number.js';
import {
  INDENT_END_RE,
  QUOTE_CONTENT_REGEXES,
  SEPARATOR,
  SEPARATOR_RE,
  SPACED_CLOSER_LEFT,
  TITLE_CONTENT_CHAR,
  TITLE_WORD_CHAR,
  isDigit,
  digitBeforeQuote,
  isQuoteMark,
  canonicalQuoteRoles,
  authoredOpeningAt,
  canStartQuote,
  couldOpen,
  tokenStart,
  openingContentAt,
  openingContentStart,
  quoteFollower,
  quoteLeftDash,
  dashQuoteAt,
  quoteContentAt,
  quoteParagraphs,
  quoteParagraphTags,
  blockEndTagStart,
  processQuotes,
  QUOTE_MARKS
} from './quote-state.js';

const ANCHOR_OPEN_RE_STR = `<${OPEN}A\\d+${CLOSE}>`;
const ANCHOR_CLOSE_RE_STR = `<\\/${OPEN}A\\d+${CLOSE}>`;

const QUOTES_OUTSIDE_A_RE = new RegExp(
  `(${ANCHOR_OPEN_RE_STR})"([\\s\\S]+?)"(${ANCHOR_CLOSE_RE_STR})`,
  'g'
);

const FIRS_OPEN = G.LAQUO;
const FIRS_CLOSE = G.RAQUO;
const referencePairs = sessionMap();
const activeQuoteRule = sessionMap();
const labelAddressBefore = sessionMap();
const WORD_END_RE = new RegExp(`[a-zа-яё0-9${G.HELLIP}]$`, 'iu');
// The word end a closer stands behind. The backticks that close a Markdown code span, whose body is
// vaulted, end one as the `>` of a tag does: the lifted text reads the span as a word. The run is
// bounded, so the look behind a backtick is.
const CLOSER_LEFT = `[a-zа-яё0-9]|\\.|${G.HELLIP}|!|\\?|>|\\)|\\]|:|\\+|%|@|#|\\$|\\*|\`(?<=${OPEN}B\\d{1,9}${CLOSE}\`{1,16})`;

// A complete title can end in a word, symbol, closing or terminal punctuation.
// Other punctuation attached to text (such as a double prime after a digit) can end it too.
// Looking behind the boundary keeps a supplementary glyph whole.
const CLOSING_NEIGHBOUR_RE =
  /(?<=[\p{L}\p{M}\p{N}\p{S}\p{Pe}\p{Pf}\p{Terminal_Punctuation}]|\S\p{P})/uy;

const INDENT_MAX = 12;

function indentBefore(source, at) {
  if (source[at - 1] !== CLOSE) {
    return 0;
  }
  return INDENT_END_RE.exec(source.slice(Math.max(0, at - INDENT_MAX), at))?.[0].length ?? 0;
}

function endsBefore(ctx, source, raw, from, to) {
  const name = /^[^\s/>]+/u.exec(raw)?.[0];
  if (name === undefined) {
    return false;
  }
  for (
    let at = source.indexOf('</', from);
    at !== -1 && at < to;
    at = source.indexOf('</', at + 2)
  ) {
    const tagEnd = nativeTagEnd(source, at);
    if (tagEnd !== -1 && tokenTagRaw(ctx, source.slice(at + 2, tagEnd - 1)) === name) {
      return true;
    }
  }
  return false;
}

// A comment, a CDATA section, a processing instruction or a declaration between two offsets.
function nodeBetween(ctx, source, from, to) {
  for (let at = source.indexOf('<', from); at !== -1 && at < to; at = source.indexOf('<', at + 1)) {
    const tagEnd = nativeTagEnd(source, at);
    if (tagEnd !== -1 && /^[!?]/u.test(tokenTagRaw(ctx, source.slice(at + 1, tagEnd - 1)) ?? '')) {
      return true;
    }
  }
  return false;
}

function closeAtBoundary(m, ctx, replacement) {
  const source = m.at(-1);
  const end = m.at(-2) + 1;
  if (m[0][0] !== '>' || nativeTagStart(source, end) === -1) {
    return replacement;
  }
  // A straight quote has no direction of its own and closes behind the words its element ends on,
  // spaced from them or not. A `«` is an opening quote written the wrong way round only where it is
  // glued to a word, as `fix_orphan_open` reads it outside markup.
  const glued = m[0].includes(FIRS_OPEN);
  let before = end;
  while (true) {
    const previous = before;
    before = inlineTextEnd(ctx, source, before);
    let start;
    while (
      (start = inlineEndTagStart(source, before)) !== -1 ||
      (start = blockEndTagStart(source, before, ctx)) !== -1
    ) {
      before = start;
    }
    const tagStart = nativeTagStart(source, before);
    // A comment is a node the quote is glued to, as it is to a CDATA section, whatever spaces stand
    // in front of the comment: `"Текст <!-- c -->".` closes as `"Текст<!-- c -->".` does.
    const comment =
      tagStart !== -1 &&
      tokenTagRaw(ctx, source.slice(tagStart + 1, before - 1))?.startsWith('!--');
    if (comment) {
      before = tagStart;
    }
    const unspaced = before;
    while (source[before - 1] === ' ' || source[before - 1] === '\t') {
      if ((before & 1023) === 0) {
        ctx.checkBudget?.('quote:left');
      }
      before -= 1;
    }
    before -= indentBefore(source, before);
    if (glued && before !== unspaced && !comment) {
      return m[0];
    }
    if (before === previous) {
      break;
    }
  }
  const width = before >= 2 && source.codePointAt(before - 2) > 0xffff ? 2 : 1;
  const previous = source.slice(Math.max(0, before - width), before);
  const tag = previous === '>' ? nativeTagStart(source, before) : -1;
  // A void or empty element, a CDATA section, a processing instruction or a declaration is a whole
  // node, so it ends the content before the quote as a word does; the opening tag of an element still
  // open at the quote starts content instead.
  if (tag !== -1) {
    const raw = tokenTagRaw(ctx, source.slice(tag + 1, before - 1)) ?? '';
    return nativeVoidTag(ctx, source, tag, before) ||
      /^[!?]|\/$/u.test(raw) ||
      endsBefore(ctx, source, raw, before, end)
      ? replacement
      : m[0];
  }
  return previous !== '' && quoteContentAt(source, before - width, ctx) ? replacement : m[0];
}

function repeatChar(s, char) {
  return char.repeat(count(s, '"'));
}

function closesBeforeParen(p1, next, offset, source) {
  return next.startsWith('(') && /^\s$/u.test(p1) && WORD_END_RE.test(source.slice(0, offset));
}

// A strong neighbour cannot end content, so any non-separating follower opens. The follower is the
// quotation's first character and is taken with the quote, so a `>` or a dash quoted there is no
// strong neighbour of the next quote: `">". " м`. A `«` is only looked at: it is the strong neighbour
// of the quote after it.
const OPEN_AFTER_STRONG_RE = new RegExp(
  `(^|[${OPEN_LEFT}])((?:"|\\\\")+)(?=([^ \\t]))(?:(?!${G.LAQUO})[^ \\t])?`,
  'giu'
);

function openAfterStrong(full, p1, p2, p3, offset, source, ctx) {
  const follower = full.slice(p1.length + p2.length);
  const quote = full.slice(0, p1.length + p2.length);
  // Punctuation can finish the preceding quotation or begin the next title.
  // Let the paragraph's existing role assignment decide, as for a padded opener.
  const at = offset + p1.length;
  const dash = quoteLeftDash(source, at, ctx);
  if (
    (p2 === '"' &&
      dash !== undefined &&
      (p3 === G.NBSP || dashQuoteAt(source, at + 1, dash, ctx))) ||
    shutBehindNowrapEnd(p1, p2, p3, offset, source, ctx)
  ) {
    return full;
  }
  return openBeforeWord(quote, p1, p2, p3, offset, source, ctx) + follower;
}

// Two quotes glued behind it before a mark of the sentence are the empty quotation they are behind a
// strong neighbour: opening only the first leaves the second behind a `«`, where the next pass opens it.
const OPEN_AFTER_WEAK_RE = new RegExp(
  `([${WEAK_LEFT}${CLOSE}])((?:"|\\\\")+)(?=([^${WEAK_STOP}]|(?<=[${WEAK_LEFT}${CLOSE}]"")[.,;:!?)${G.HELLIP}]))`,
  'giu'
);

// The end tag of the engine's own no-wrap wrapper stands for nothing: later groups write the wrapper
// after the opening rules have read the text, so a quote behind it opens only where one of them opens
// it behind the character the wrapper holds last — `н. э."2` stays as `нэ."2` left it.
const OPENS_BEHIND = [OPEN_AFTER_STRONG_RE, OPEN_AFTER_WEAK_RE, OPEN_CYRILLIC_RE].map(
  (re) => new RegExp(re.source, 'iu')
);

function shutBehindNowrapEnd(p1, p2, p3, offset, source, ctx) {
  const held = p1 === '>' ? heldBeforeNowrapEnd(ctx, source, offset) : null;

  return held !== null && !OPENS_BEHIND.some((re) => re.test(`${held}${p2}${p3}`));
}

// The gap is a horizontal run, not a single character: an author who separated the quote from its
// word rarely counts the spaces. Newlines stay out of it — paragraphs are still plain blank lines at
// this point in the pipeline, and swallowing one would join two paragraphs into one.
// A preserved reference ends in a semicolon. Its visible glyph decides whether the quote can open.
const OPEN_BEFORE_SPACE_RE = new RegExp(
  `(^|[${OPEN_LEFT}${CLOSE}]|(?<=${REFERENCE_HOLE});)("|\\\\")(?:([ \\t]+)([^${SEPARATOR}]+)|(?=[<${QUOTE_PUNCTUATION}])|(${G.NBSP}+)(?=[^${SEPARATOR}]))`,
  'giu'
);

// Two straight quotes glued together before a mark of the sentence are one quotation with nothing in
// it, `"",` as the `"" ,` written apart: no word follows for a second one to open on.
const EMPTY_PAIR_FOLLOWER_RE = /[.,;:!?)…]/u;
const LATIN_LETTER_RE = /\p{Script=Latin}/u;

// The same quotation written apart, `" ".`: the quote in front is one that could open, and the spaced
// walk pairs the two as an empty quotation, so this one is left for it rather than opened here.
function closesSpacedEmptyPair(p1, p2, p3, offset, source, ctx) {
  if (p2 !== '"' || (p1 !== ' ' && p1 !== '\t') || !EMPTY_PAIR_FOLLOWER_RE.test(p3)) {
    return false;
  }

  let before = offset - 1;

  while (source[before] === ' ' || source[before] === '\t') {
    before -= 1;
  }

  return source[before] === '"' && couldOpen(source, before, ctx);
}

// A typed opener delimits the address in a Markdown label. Once directed, it needs
// a visible separator to preserve the same address when the result is read again.
function openingQuotePadding(source, at, ctx) {
  return source[at - 1] === CLOSE && labelAddressBefore.get(ctx)?.(source, at) ? ' ' : '';
}

function openBeforeWord(full, p1, p2, p3, offset, source, ctx) {
  const at = offset + p1.length;
  if (p1 === ';' && endsAuthoredQuotePair(source, offset, ctx)) {
    return full;
  }
  if (!openingContentAt(source, offset + p1.length + p2.length, ctx)) {
    // A run with nothing behind it to quote opens on its own last quote: so the patterns read it at
    // the end of the text and before a space, where they cannot take the whole run, and an end tag
    // behind the run leaves it as little to quote.
    const last = p2.endsWith('\\"') ? 2 : 1;

    return p2.length > last
      ? `${openBeforeWord(full.slice(0, -last), p1, p2.slice(0, -last), p2.at(-last), offset, source, ctx)}${p2.slice(-last)}`
      : full;
  }

  const right =
    p2 === '""' && EMPTY_PAIR_FOLLOWER_RE.test(p3)
      ? '"'
      : quoteFollower(source, at + p2.length, ctx);
  if (
    !canStartQuote(source, at, right, ctx, p1 === FIRS_OPEN ? p1 : undefined) ||
    closesBeforeParen(p1, p3, offset, source) ||
    closesSpacedEmptyPair(p1, p2, p3, offset, source, ctx)
  ) {
    return full;
  }

  if (p2 === '""' && EMPTY_PAIR_FOLLOWER_RE.test(p3)) {
    return `${p1}${FIRS_OPEN}${FIRS_CLOSE}`;
  }

  return `${p1}${openingQuotePadding(source, at, ctx)}${repeatChar(p2, FIRS_OPEN)}`;
}

// What a quote glyph is here, and the single answer both the depth walk and the pairing below read.
// `«` was minted by the opening patterns a step ago or written by the author, `»` is the author's,
// and a straight quote glued to a word end closes. A straight quote still spaced on both sides is
// none of those: it is undecided, and which quotation it belongs to cannot be read off that quote —
// what settles it is not the next quote but how many are left.
const OPENS = 1;
const UNDECIDED = 0;
const CLOSES = -1;

function quoteRole(text, at, ctx) {
  const c = text[at];

  if (c === FIRS_OPEN) {
    return OPENS;
  }

  if (c === FIRS_CLOSE) {
    return CLOSES;
  }

  return couldOpen(text, at, ctx) ? UNDECIDED : CLOSES;
}

// The shape the walk below writes as one empty quotation: a straight quote whose next non-space
// character is another straight quote. Both halves belong to that pair and to nothing around it.
function emptyPairAt(text, at, j, end, immutable) {
  if (immutable?.has(at[j]) || immutable?.has(at[j + 1])) {
    return false;
  }
  if (j + 1 >= end || text[at[j]] !== '"' || text[at[j + 1]] !== '"') {
    return false;
  }

  const from = at[j] + 1;
  const to = tokenStart(text, at[j + 1]);

  if (to <= from) {
    return false;
  }

  for (let i = from; i < to; i += 1) {
    if (text[i] !== ' ' && text[i] !== '\t') {
      return false;
    }
  }

  return true;
}

// Every quote's part, decided for the whole paragraph at once, so the walk below only applies what
// was assigned: the part of a quote is not a local question, but depends on how many quotations
// stand open around it and on how many closers the rest of the text still has. One pass over the
// quotes, because scanning ahead per quote is quadratic in a rule that polls no budget.
function assignParagraphRoles(text, from, stop, at, roles, depths, pairs, ctx, immutable) {
  const base = at.length;
  let opens = 0;
  let closes = 0;
  let undecided = 0;
  let standing = 0;
  for (let i = from; i < stop; i += 1) {
    const c = text[i];

    if (c !== FIRS_OPEN && c !== FIRS_CLOSE && c !== '"') {
      continue;
    }
    if (c === '"' && immutable?.has(i)) {
      continue;
    }

    const role = quoteRole(text, i, ctx);

    // A straight quote that cannot open closes nothing where no quotation stands open: glued to a
    // digit it is a measurement, the one `tryConvertInches` turns into a prime later, and anywhere
    // else a stray `quote.nested` leaves straight. Counted as a closer, it would have the balance
    // below open a later quote for it, and no quote after a closer is its opener. What decides is how
    // many stand open here rather than how many quotes have been seen: a quotation that opened and
    // closed leaves nothing open, and a closer with nothing to close opens nothing either.
    if (role === CLOSES && standing === 0 && undecided === 0 && c === '"') {
      continue;
    }

    at.push(i);
    roles.push(role);

    if (role === OPENS) {
      opens += 1;
      standing += 1;
    } else if (role === CLOSES) {
      closes += 1;
      standing = Math.max(0, standing - 1);
    } else {
      undecided += 1;
    }
  }

  // How many of the undecided must open follows from the count: a balanced stretch has as many
  // openings as closings. Which ones is then the ordinary reading — a quote closes the quotation it
  // stands in — spending that allowance until it runs out, after which a quote with nothing open to
  // close opens one. An odd total cannot balance at all; the floor spends the odd one on closing,
  // which is this rule's default everywhere else.
  //
  // `depths` is how many quotations stand open where each quote is: the one number the walk below
  // asks for, taken from this assignment rather than from a second reading of the text.
  let closings = undecided - clamp(Math.floor((closes + undecided - opens) / 2), 0, undecided);
  const end = at.length;
  let depth = 0;

  // How deep the quotes still ahead need it to be here. A closer already settled has to have a
  // quotation open in front of it, so an undecided quote that closes one the suffix is going to need
  // leaves that closer with nothing to close, and everything after it lands on the wrong side.
  const need = new Int32Array(end - base + 1);

  for (let j = end - 1; j >= base; j -= 1) {
    const k = j - base;

    need[k] = roles[j] === CLOSES ? need[k + 1] + 1 : Math.max(0, need[k + 1] - 1);
  }

  let laterUndecided = undecided;

  for (let j = base; j < end; j += 1) {
    if (roles[j] === UNDECIDED) {
      laterUndecided -= 1;

      // A quote whose word is the next quote is an empty quotation, and the walk below writes both
      // halves in one step, so the plan spends them as a pair too. A quotation already standing open
      // changes what the pair is written as, never whether it is one.
      if (emptyPairAt(text, at, j, end, immutable)) {
        laterUndecided -= roles[j + 1] === UNDECIDED ? 1 : 0;
        closings -= closings > 0 ? 1 : 0;
        roles[j] = OPENS;
        roles[j + 1] = CLOSES;
        depths.push(depth, depth + 1);
        pairs.push(true, false);
        j += 1;
        continue;
      }

      // The count says how many undecided quotes close, never which ones, so a quote hands its turn
      // to a later one where a closer already settled would be left with nothing to close — but only
      // while a later one is still there to take it, since the count is what balances the paragraph
      // and deferring past the last undecided quote leaves the allowance unusable.
      const starves = depth - 1 < need[j - base + 1] && closings <= laterUndecided;
      const shuts = depth > 0 && closings > 0 && !starves;

      roles[j] = shuts ? CLOSES : OPENS;
      closings -= shuts ? 1 : 0;
    }

    depths.push(depth);
    pairs.push(false);
    depth = Math.max(0, depth + roles[j]);
  }
}

// Quote state does not cross a paragraph, and this is the same boundary `processQuotes` splits on
// one pass later.
function quoteRoleSource(text, ctx) {
  if (!text.includes(`${OPEN}N`)) {
    return { text, offsets: null, immutable: null };
  }
  const references = [];
  let seen = 0;
  for (let at = text.indexOf('&'); at !== -1; at = text.indexOf('&', at + 1)) {
    if ((seen++ & 1023) === 0) {
      ctx.checkBudget?.('quote:references');
    }
    const reference = readCharacterReferenceAt(text, at);
    if (reference === null) {
      continue;
    }
    const glyph = keptReferenceGlyph(reference);
    if (glyph !== null && isQuoteMark(glyph)) {
      references.push({ start: at, end: reference.end, glyph });
    }
    at = reference.end - 1;
  }
  if (references.length === 0) {
    return { text, offsets: null, immutable: null };
  }

  const pieces = [];
  const offsets = [];
  const immutable = new Set();
  const pushOffsets = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if ((i & 1023) === 0) {
        ctx.checkBudget?.('quote:references');
      }
      offsets.push(i);
    }
  };
  let cursor = 0;
  for (const reference of references) {
    pieces.push(text.slice(cursor, reference.start), reference.glyph);
    pushOffsets(cursor, reference.start);
    immutable.add(offsets.length);
    offsets.push(reference.start);
    cursor = reference.end;
  }
  pieces.push(text.slice(cursor));
  pushOffsets(cursor, text.length);
  return {
    text: canonicalQuoteRoles(pieces.join(''), quoteParagraphTags(ctx), ctx.checkBudget, ctx),
    offsets,
    immutable
  };
}

function assignQuoteRoles(text, ctx) {
  const source = quoteRoleSource(text, ctx);
  const at = [];
  const roles = [];
  const depths = [];
  const pairs = [];
  for (const [from, to] of quoteParagraphs(source.text, quoteParagraphTags(ctx), ctx.checkBudget)) {
    assignParagraphRoles(source.text, from, to, at, roles, depths, pairs, ctx, source.immutable);
  }
  return {
    at: source.offsets === null ? at : at.map((i) => source.offsets[i]),
    roles,
    depths,
    pairs
  };
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

const spacedClosers = sessionMap();

// Every quote of the run the pattern takes third closes, behind what it takes first.
function closeQuoteRun(m, ctx) {
  return closeAtBoundary(m, ctx, `${m[1]}${repeatChar(m[3], FIRS_CLOSE)}`);
}

// The closing rule can run on its own. A gap after © can also lead into a quoted
// owner's name, so only the neutral mark of an open quotation may close here.
function closeAfterCopyright([full, before, quotes, at, text], ctx) {
  let plan = spacedClosers.get(ctx);
  if (plan?.text !== text) {
    const { at: positions, roles, depths } = assignQuoteRoles(text, ctx);
    plan = {
      text,
      closing: new Set(positions.filter((_, i) => roles[i] === CLOSES && depths[i] > 0))
    };
    spacedClosers.set(ctx, plan);
  }
  return plan.closing.has(at + before.length + (quotes[0] === '\\' ? 1 : 0))
    ? before + repeatChar(quotes, FIRS_CLOSE)
    : full;
}

// A quote parted from its word by a space. The heuristic — that the author meant it to open the next
// word — holds only while no quotation is open; inside one the same quote closes. A pattern
// replacement cannot tell the difference, because `String.replace` hands every callback the original
// text and never the substitutions made beside it, so the assignment above settles both questions
// for the whole stretch and this walk applies them.
function openSpacedQuotes(text, ctx) {
  if (!text.includes('"')) {
    return text;
  }

  // The walk drives `lastIndex` itself and resets it here; `lint:redos` reads the pattern's source
  // and flags without ever running it, so the declaration and the walk share one object.
  const re = OPEN_BEFORE_SPACE_RE;
  const parts = [];
  let m;

  // Built on the first candidate that needs it, and only walked forward: the questions come in
  // ascending order, so one cursor answers all of them.
  let assigned = null;
  let seen = 0;

  const quoteAt = (at) => {
    assigned ??= assignQuoteRoles(text, ctx);

    while (seen < assigned.at.length && assigned.at[seen] < at) {
      seen += 1;
    }

    if (seen >= assigned.at.length || assigned.at[seen] !== at) {
      return { role: UNDECIDED, depth: 0, pairEnd: -1 };
    }

    return {
      role: assigned.roles[seen],
      depth: assigned.depths[seen],
      // Where the pair this quote opens ends, so the walk consumes both halves the plan spent rather
      // than re-deciding the second one from the following word.
      pairEnd: assigned.pairs[seen] ? assigned.at[seen + 1] + 1 : -1
    };
  };

  let cursor = 0;

  re.lastIndex = 0;

  while ((m = re.exec(text)) !== null) {
    const [full, p1, p2, gap, p4, padding] = m;
    const afterLeft = m.index + p1.length;
    if (gap === undefined) {
      const after = afterLeft + p2.length;
      const dash = quoteLeftDash(text, afterLeft, ctx);
      if (dash && (padding || dashQuoteAt(text, after, dash, ctx))) {
        const { role, depth } = quoteAt(after - 1);
        if (depth === 0 || role === OPENS) {
          parts.push(text.slice(cursor, afterLeft), FIRS_OPEN);
          cursor = after + (padding?.length ?? 0);
        }
      }
      continue;
    }
    const { role, depth, pairEnd } = quoteAt(afterLeft + p2.length - 1);

    // The word this quote supposedly lost is another quote: that is an empty quotation, not an opener
    // looking for something to bind to, and both halves are settled in this pass.
    if (pairEnd !== -1) {
      parts.push(text.slice(cursor, m.index), p1, FIRS_OPEN, FIRS_CLOSE);
      cursor = pairEnd;
      re.lastIndex = cursor;
      continue;
    }

    // Inside an open quotation a spaced quote usually closes it, but not when a matching quote stands
    // further on, still inside that quotation: the pair then opens and closes a quotation of its own,
    // nested in the one already running. The word it binds to cannot answer this — `" Новый Амбер"`
    // carries its closing quote two words along — so the part this quote plays was settled for the
    // whole stretch at once and here it is only read.
    //
    // A `«` directly in front is one the opening patterns minted a step ago out of the author's own
    // straight quote, so what follows it is that quotation's closer, not a nested one opening.
    const opensNested = depth > 0 && p1 !== FIRS_OPEN && role === OPENS;

    if (
      !couldOpen(text, afterLeft + p2.length - 1, ctx) ||
      (!opensNested && (depth > 0 || closesBeforeParen(p1, p4, m.index, text)))
    ) {
      // Leave the quote for the closing rules, but step past it: it has been accounted for here.
      const afterQuote = afterLeft + p2.length;

      parts.push(text.slice(cursor, afterQuote));
      cursor = afterQuote;
      re.lastIndex = afterQuote;
      continue;
    }

    parts.push(text.slice(cursor, m.index), p1, FIRS_OPEN, p4);
    // The content this quote binds to has no quote separator, so it carries its own closing quote along with it —
    // `" Корвин"` is one match, not two, and the next candidate resumes past both.
    cursor = m.index + full.length;
    re.lastIndex = cursor;
  }

  parts.push(text.slice(cursor));

  return parts.join('');
}

// An unmatched closer falls back to the straight quote the closing rules most likely made it from,
// or turns round into an opener. Glued to an address, or to the end of the link made of it, a
// straight quote reads as part of the address — the end of an attribute value, which
// `text.autolink` leaves unlinked — so a guillemet the author wrote there stays as written. Which
// closers the author wrote is read off the text before any rule of this group ran: an address
// placeholder names every occurrence of its address, so it counts only where each occurrence was
// followed by `»`.
const ADDRESS_THEN_RE = new RegExp(`(${LINKABLE_SOURCE})(?:${ANCHOR_CLOSE_RE_STR})?(.?)`, 'gsu');
const authoredClosers = sessionMap();

// Where the text before `at` ends once the end of a link right before it is stepped over.
function beforeLinkEnd(buf, at) {
  if (buf[at - 1] !== '>' || buf[at - 2] !== CLOSE) {
    return at;
  }

  let i = at - 3;

  while (isDigit(buf[i])) {
    i -= 1;
  }

  const isLinkEnd =
    buf[i] === 'A' && buf[i - 1] === OPEN && buf[i - 2] === '/' && buf[i - 3] === '<';

  return isLinkEnd ? i - 3 : at;
}

// The same holds behind an inline end tag: it stands after the words of its element, so a `»` the
// author wrote there closes a quotation opened before the element, in this paragraph or an earlier
// one, and is no opener. A vaulted tag names every occurrence of its tag, so it counts only where no
// other quote mark ever follows it.
const END_TAG_THEN_QUOTE_RE = new RegExp(
  `(${INLINE_END})(["${G.LAQUO}${G.RAQUO}${G.BDQUO}${G.LDQUO}])`,
  'gu'
);

// The names the first group gives, each counted where every one of its occurrences the second group
// gives, followed by a quote, is followed by `»`.
function keptWhereAlwaysClosed(text, re) {
  const closed = new Set();
  const other = new Set();

  for (const [, name, next] of text.matchAll(re)) {
    (next === FIRS_CLOSE ? closed : other).add(name);
  }

  for (const name of other) {
    closed.delete(name);
  }

  return closed;
}

function authoredClosersIn(text) {
  if (!text.includes(FIRS_CLOSE)) {
    return { addresses: new Set(), endTags: new Set() };
  }

  return {
    addresses: keptWhereAlwaysClosed(text, ADDRESS_THEN_RE),
    endTags: keptWhereAlwaysClosed(text, END_TAG_THEN_QUOTE_RE)
  };
}

function keptCloser({ addresses, endTags }) {
  if (addresses.size === 0 && endTags.size === 0) {
    return;
  }

  const lengths = [...new Set(Array.from(addresses, (address) => address.length))];
  const longest = Math.max(0, ...lengths);

  return (buf, at) => {
    const tag = inlineEndTagStart(buf, at);

    if (tag !== -1 && endTags.has(buf.slice(tag, at).join(''))) {
      return true;
    }

    const end = beforeLinkEnd(buf, at);
    const before = buf.slice(Math.max(0, end - longest), end).join('');

    return lengths.some(
      (length) => length <= before.length && addresses.has(before.slice(-length))
    );
  };
}

const paddingStrip = sessionMap();
const MAY_STRIP_PADDING_RE = new RegExp(NOT_AFTER_LONE_QUOTE, 'uy');

function preservedQuote(glyph) {
  return matchingQuote(glyph) !== null || glyph === G.RAQUO || glyph === RDQUO || glyph === '"';
}

// Adjacent editable and preserved marks share a follower. Cache the run's answer so that
// reading each mark of an empty or deeply nested quotation takes linear time altogether.
function hasOpeningContentBeyondQuotes(text, from, ctx, content, visit) {
  let at = from;
  const run = [];
  while (!content.has(at)) {
    visit?.();
    run.push(at);
    at = inlineTextStart(ctx, text, at, true);
    if (text[at] === '"') {
      at += 1;
      continue;
    }
    if (text[at] === '&') {
      const ref = readCharacterReferenceAt(text, at);
      if (ref && preservedQuote(authoredReferenceGlyph(ref, true))) {
        at = ref.end;
        continue;
      }
    }
    content.set(
      at,
      openingContentAt(text, at, ctx) && openingQuoteNeighbours(';', text[at] ?? ' ')
    );
  }
  const result = content.get(at);
  for (const offset of run) {
    visit?.();
    content.set(offset, result);
  }
  return result;
}

// Only a typed mark needs evidence from the content on its left. A directional
// closing partner already supplies it, as does a just-closed quotation.
function closesContent(text, token, ctx) {
  if (token.glyph !== '"' || token.previous?.closer === null) {
    return true;
  }
  const before = inlineTextEnd(ctx, text, token.at, true);
  if (before === 0) {
    return false;
  }
  CLOSING_NEIGHBOUR_RE.lastIndex = before;
  return CLOSING_NEIGHBOUR_RE.test(text);
}

function indexMixedQuotePairs(text, ctx, ordered, readsInches, padded, inch, visit) {
  // A neutral mark can complete a directional pair at either end. Save that
  // reading until the other title proves there are two independent quotations.
  let frame;
  const directed = [];
  for (const token of ordered) {
    visit?.();
    if (token.next?.glyph === '"') {
      token.enclosing = frame;
    }
    // An unpaired high mark before punctuation or another opener can finish this
    // title. A sibling still needs both endpoints before the reading is used. It
    // ends the `„` it matches there too, across a node. Nor does it open anything
    // when nothing opens after its run and no mark in it can close it.
    const finishes =
      !openingQuoteNeighbours(';', token.follower) || (token.next && token.next.closer !== null);
    const turned =
      !token.preserved &&
      token.glyph === G.LDQUO &&
      !token.partner &&
      (frame?.glyph === '"'
        ? finishes
        : (frame?.closer === G.LDQUO && finishes) ||
          (!token.runEnd.contentAfterRun &&
            token.next?.glyph !== '"' &&
            token.next?.glyph !== RDQUO)) &&
      // It opens a touching run that has both its closers, as the next pass reads the run written
      // from it: `"а "о“",“«я"”`.
      !(token.next && !token.next.preserved && touchingClosers(text, ctx, token, token.next, inch));
    if (turned) {
      token.closer = null;
    }
    // Keep the endpoint of a directional outer title even when a stray typed
    // opener would hide it at the top of the ordinary stack.
    let owner;
    if (!token.preserved && token.glyph !== '"') {
      if (token.closer !== null) {
        directed.push(token);
      } else if (directed.at(-1)?.closer === token.glyph) {
        owner = directed.pop();
      }
    }
    if (token.closer !== null) {
      token.outer = frame;
      frame = token;
    } else if (token.partner) {
      frame = token.partner.outer;
    } else if (owner && !owner.partner) {
      if (owner.mixed) {
        owner.mixed.mixed = undefined;
      }
      owner.mixed = token;
      token.mixed = owner;
      frame = owner.outer;
    } else if (
      !owner &&
      frame &&
      !(frame.mixed && matchingQuote(frame.glyph) === frame.mixed.glyph) &&
      !token.preserved &&
      !frame.preserved &&
      (token.glyph === '"'
        ? !frame.partner &&
          frame.glyph !== '"' &&
          (!readsInches || digitBeforeQuote(text, token.at, padded) === -1)
        : frame.glyph === '"' || (!frame.partner && (turned || frame.closer === token.glyph)))
    ) {
      frame.mixed = token;
      token.mixed = frame;
      frame = frame.outer;
    } else {
      frame = undefined;
    }
  }
}

// A complete title can follow an empty value, or enclose one immediately before
// its directional closer. Neither endpoint of the empty value may already be
// required by a different quotation. A comment between them is a node, as a
// CDATA section is, and parts them: `""<!-- c -->“ щ ”`.
function pairEmptyAtBoundary(text, ctx, first, second, boundary, readsInches, padded) {
  const partner = boundary.partner ?? boundary.mixed;
  if (
    !first ||
    !partner ||
    (first.glyph !== '"' && (second.glyph !== '"' || first.closer === null)) ||
    (second.glyph !== '"' && second.closer !== null && second.glyph !== G.LDQUO) ||
    first.preserved ||
    second.preserved ||
    first.end !== second.at ||
    (first.partner && first.partner !== second) ||
    (second.partner && second.partner !== first) ||
    (first.mixed && first.mixed !== second) ||
    (second.mixed && second.mixed !== first) ||
    (boundary.previous !== second && openingContentStart(text, second.end, ctx) !== boundary.at) ||
    nodeBetween(ctx, text, second.end, boundary.at)
  ) {
    return false;
  }
  if (boundary.closer === null) {
    if (
      partner.at >= first.at ||
      matchingQuote(partner.glyph) !== boundary.glyph ||
      (readsInches && digitBeforeQuote(text, first.at, padded) !== -1)
    ) {
      return false;
    }
  } else if (
    first.closer === null ||
    (boundary.glyph === '"' && partner.glyph === '"' && boundary.next === partner)
  ) {
    // A run of neutral marks without any content has no independent second title.
    return false;
  }
  boundary.partner = partner;
  partner.partner = boundary;
  markEmptyValue(first, second);
  return true;
}

function markEmptyValue(first, second) {
  first.partner = second;
  second.partner = first;
  first.closer = matchingQuote(first.glyph) ?? first.glyph;
  second.closer = null;
  first.empty = true;
  second.empty = true;
}

function startsWithEmptyQuotation(token) {
  const open = token.next;
  const close = open?.next;
  return close && !open.preserved && !close.preserved && matchingQuote(open.glyph) === close.glyph;
}

// Step past complete sibling titles to the next unowned mark. A chain shared
// by several enclosing frames is traversed once in this paragraph.
function afterCompletedTitles(first, visit) {
  const seen = [];
  let token = first;
  while (token?.partner && token.closer !== null && !token.preserved) {
    visit?.();
    if (token.afterTitles !== undefined) {
      token = token.afterTitles;
      break;
    }
    seen.push(token);
    token = token.partner.following;
  }
  for (const title of seen) {
    visit?.();
    title.afterTitles = token ?? null;
  }
  return token;
}

// A complete directional frame keeps its closing endpoint past a completed
// inner title. Unmatched touching marks before the next title or a gap then
// belong to the inner level; they cannot close the outer frame early.
function keepEnclosedEmptyValues(text, token, pending, visit) {
  const title = token.partner;
  const outer = title?.outer;
  let end = outer?.partner ?? outer?.mixed;
  if (
    !title ||
    !end ||
    outer.preserved ||
    end.preserved ||
    title.preserved ||
    token.preserved ||
    title.next === token ||
    (matchingQuote(outer.glyph) ?? outer.glyph) !== end.glyph ||
    end.at <= token.at
  ) {
    return;
  }
  // The nearer copy of the same closing glyph need not end this frame:
  // the complete next title may be followed by an otherwise orphaned copy.
  let displaced;
  const sibling = token.runEnd;
  if (end.at < sibling.at && !sibling.preserved && sibling.closer !== null && sibling.partner) {
    const later = afterCompletedTitles(sibling, visit);
    if (
      later &&
      !later.preserved &&
      !later.partner &&
      !later.mixed &&
      later.glyph === end.glyph &&
      !(later.closer !== null && later.runEnd?.contentAfterRun)
    ) {
      displaced = end;
      end = later;
    }
  }
  let freeCount = 0;
  let last = token;
  let { next } = last;
  while (
    next &&
    last.end === next.at &&
    next !== end &&
    !next.preserved &&
    (next === displaced || (freeInsideFrame(next.partner, end) && freeInsideFrame(next.mixed, end)))
  ) {
    visit?.();
    freeCount++;
    last = next;
    ({ next } = last);
  }
  if (
    freeCount < 2 ||
    freeCount % 2 !== 0 ||
    (next
      ? next !== end &&
        (next.preserved || !next.partner || next.closer === null || next.partner.at >= end.at)
      : openingQuoteNeighbours(';', text[last.end] ?? ' '))
  ) {
    return;
  }
  if (displaced) {
    displaced.mixed = undefined;
    outer.mixed = undefined;
  }
  outer.partner = end;
  end.partner = outer;
  end.closer = null;
  pending.push(outer, token);
  for (let left = token.next; left !== next; left = left.next.next) {
    visit?.();
    releaseLaterPartners(left, end);
    releaseLaterPartners(left.next, end);
    left.mixed = undefined;
    left.next.mixed = undefined;
    markEmptyValue(left, left.next);
    pending.push(left);
  }
}

const VISIBLE_CONTENT_END_RE = new RegExp(`(?<=${TITLE_CONTENT_CHAR.source})`, 'uy');

function hasTitleContent(text, ctx, open, end, visit) {
  // An authored pair can enclose a title consisting entirely of another
  // quotation. Follow its actual opening marks to the first visible content.
  let at = openingContentStart(text, open.end, ctx);
  let outerEnd = end;
  let child = open.following;
  while (child && child.at === at && child !== outerEnd) {
    visit?.();
    if (!child.partner || child.closer === null || child.partner.at >= outerEnd.at) {
      return false;
    }
    outerEnd = child.partner;
    at = openingContentStart(text, child.end, ctx);
    child = child.following;
  }
  if (
    at < 0 ||
    at >= outerEnd.at ||
    (/\p{Quotation_Mark}/u.test(text[at]) &&
      (at + 1 >= outerEnd.at || !openingContentAt(text, at + 1, ctx)))
  ) {
    return false;
  }
  VISIBLE_CONTENT_END_RE.lastIndex = inlineTextEnd(ctx, text, end.at, true);
  return VISIBLE_CONTENT_END_RE.test(text);
}

// A neutral mark beyond an earlier matching directional end was only a
// provisional partner. A directional or preserved endpoint retains its owner.
function freeInsideFrame(owner, end) {
  return !owner || (owner.at > end.at && owner.glyph === '"' && !owner.preserved);
}

function belongsWithin(token, first, second, end) {
  const { partner, mixed } = token;
  return (
    (partner === first || partner === second || freeInsideFrame(partner, end)) &&
    (mixed === first || mixed === second || freeInsideFrame(mixed, end))
  );
}

function releaseLaterPartners(token, end) {
  const { partner, mixed } = token;
  if (partner?.at > end.at && partner.partner === token) {
    partner.partner = null;
  }
  if (mixed?.at > end.at && mixed.mixed === token) {
    mixed.mixed = undefined;
  }
}

function connectTitles(first, previous, token, last, pending) {
  if (first.partner && first.partner !== previous) {
    first.partner.partner = null;
  }
  previous.partner = first;
  first.partner = previous;
  token.partner = last;
  last.partner = token;
  pending.push(token, previous);
}

// The ordinary walk never closes with a typed mark glued to the next word or number: `а"1`,
// `96"USD`.
function gluedToWord(text, token) {
  if (token.glyph !== '"') {
    return false;
  }
  const next = text[token.after] === '&' ? token.follower : text.codePointAt(token.after);
  return TITLE_WORD_CHAR.test(
    typeof next === 'number' ? String.fromCodePoint(next) : (next ?? ' ')
  );
}

const canClose = (glyph) => glyph !== G.LAQUO && glyph !== G.BDQUO;
const PUNCTUATION_GAP_RE = /^[.,;:!?…]+$/u;

// The outer opener's own mark standing apart between a word and a space closes it when no mark
// follows, as it is written: `""<![CDATA[]]>" щ " и`.
function closesLast(text, outer, closer) {
  const own = outer.partner ?? outer.mixed;
  if ((own && own !== closer) || closer.following || !/[ \t]/u.test(text[closer.end] ?? '')) {
    return false;
  }
  const { at: start } = closer;
  let at = start;
  while (text[at - 1] === ' ' || text[at - 1] === '\t') {
    at--;
  }
  return at < start && WORD_END_RE.test(text[at - 1] ?? '');
}

function nestTouchingClosers(text, ctx, outer, inner, inch) {
  const closers = touchingClosers(text, ctx, outer, inner, inch);
  if (closers) {
    nest(outer, inner, ...closers);
  }
  return closers !== null;
}

// Two touching openers keep the closers that nest as they do after a space, whatever their spelling:
// the inner opener takes the first closer, the outer one the second, `“«с”»` and `""«да”»` as
// `«„с“»`. The closers are the ones read so far; failing them, the two that touch the end of the
// inner quotation.
function touchingClosers(text, ctx, outer, inner, inch) {
  if (!openingContentAt(text, inner.after, ctx)) {
    return null;
  }
  const own = inner.partner ?? inner.mixed;
  const enclosing = outer.partner ?? outer.mixed;
  const run = inner.following;
  // A closer the inner opener passed over on its way to its own closer is the inner one's, and the
  // outer opener takes the closer the inner one leaves; one it hid from the outer one crosses. A
  // typed inner opener passes them on the way to a typed closer, `""а»′"`, but not to an inch.
  const skipped =
    enclosing ??
    (matchingQuote(inner.glyph) === own?.glyph ||
    (inner.glyph === '"' && own?.glyph === '"' && !inch(own))
      ? run
      : undefined);
  const passed = own?.at > skipped?.at ? [skipped, own] : [];
  // Punctuation between the closers keeps them one run: `"«да".»`.
  const after =
    run?.next ??
    (run?.following && PUNCTUATION_GAP_RE.test(text.slice(run.end, run.following.at))
      ? run.following
      : undefined);
  // An outer opener with no closer of its own takes the one after the inner closer, as it does once
  // it is written typed: `"«ы «я их»т"<![CDATA[]]>"`. A high mark may close a frame instead.
  const left = enclosing || outer.glyph === G.LDQUO ? [] : [own, own?.following];
  for (const [first, second] of [[own, enclosing], passed, [run, after], left]) {
    if (
      first &&
      second &&
      first.at < second.at &&
      inner.next !== first &&
      !first.preserved &&
      !second.preserved &&
      second.closer === null &&
      !gluedToWord(text, first) &&
      !gluedToWord(text, second) &&
      closesContent(text, first, ctx) &&
      (closesContent(text, second, ctx) || closesLast(text, outer, second)) &&
      // A pair glued to the end of the word is no empty quotation while two openers wait for it.
      (first.closer === null || (first === run && (first.partner ?? first.mixed) === second)) &&
      canClose(first.glyph)
    ) {
      return [first, second];
    }
  }
  return null;
}

function nest(outer, inner, first, second) {
  for (const token of [outer, inner, first, second]) {
    if (token.partner && token.partner.partner === token) {
      token.partner.partner = null;
    }
  }
  outer.partner = second;
  second.partner = outer;
  inner.partner = first;
  first.partner = inner;
  first.closer = null;
}

// Two substantive titles can share a mixed seam under matching authored end
// marks. Settle their endpoints while a directional closing quote after a
// number can still be distinguished from the physical mark of a measurement.
function pairContentTitles(text, ctx, right, padded, pending, visit) {
  const left = right.previous;
  const first = left.partner?.at < left.at ? left.partner : left.enclosing;
  if (
    !first ||
    first.preserved ||
    left.preserved ||
    first.at >= left.at ||
    (left.glyph !== '"' && left.glyph !== G.LDQUO) ||
    left.end !== right.at ||
    (left.glyph === '"' && digitBeforeQuote(text, left.at, padded) !== -1)
  ) {
    return false;
  }
  const end = afterCompletedTitles(right.following, visit);
  // A forward pair still inside the frame can be its own empty value between
  // quoted titles. Only a partner beyond the actual closer can be displaced.
  if (
    !end ||
    end.preserved ||
    (left.partner?.at > left.at && left.partner.at <= end.at) ||
    matchingQuote(first.glyph) !== end.glyph ||
    TITLE_WORD_CHAR.test(quoteFollower(text, end.end, ctx)) ||
    !belongsWithin(first, left, end, end) ||
    !belongsWithin(left, first, right, end) ||
    !belongsWithin(right, left, end, end) ||
    !belongsWithin(end, right, first, end) ||
    !hasTitleContent(text, ctx, first, left, visit) ||
    !hasTitleContent(text, ctx, right, end, visit)
  ) {
    return false;
  }
  // Both marks of a later empty value, or the inch mark of another number,
  // can have acquired provisional links into this already complete domain.
  for (const token of [first, left, right, end]) {
    releaseLaterPartners(token, end);
  }
  first.mixed = undefined;
  left.mixed = undefined;
  left.closer = null;
  right.mixed = undefined;
  right.closer = right.glyph;
  end.mixed = undefined;
  end.closer = null;
  connectTitles(first, left, right, end, pending);
  return true;
}

function hasAuthoredPartner(token) {
  const peer = token.partner;
  if (!peer || peer.partner !== token) {
    return false;
  }
  const first = token.at < peer.at ? token : peer;
  const last = first === token ? peer : token;
  const closer = first.glyph === '"' ? '"' : matchingQuote(first.glyph);
  // Provisional links may even join two closing glyphs as an empty value.
  return first.closer !== null && last.closer === null && closer === last.glyph;
}

function measuredFeet(text, ctx, token, visit) {
  return (token.followsFeet ??= followsFeet(text, token.measureDigit, ctx, visit));
}

// Track the earliest and latest existing directional endpoints inside each
// proposed frame. A replacement may regroup whole children, but cannot take
// one end of a pair whose other end remains outside.
function indexDirectedSpeech(
  text,
  ctx,
  tokens,
  ranges,
  complete,
  requireCompletePairs,
  measures,
  nestedNeutral,
  visit
) {
  const roles = [];
  const pairs = [];
  const positions = measures && new Map();
  for (const [index, token] of tokens.entries()) {
    visit?.();
    const glyph = measures?.has(token) ? G.PRIME : token.glyph;
    roles[index] = glyph;
    pairs[index] = { glyph, index };
    positions?.set(token, index);
  }
  const mayOpen = (index, afterLow) => {
    const token = tokens[index];
    const left = tokens[index - 1]?.end === token.at ? roles[index - 1] : undefined;
    return (
      openingContentAt(text, token.end, ctx) &&
      authoredOpeningAt(text, token.at, afterLow, ctx, left)
    );
  };
  resolveAuthoredQuotePairs(roles, mayOpen, requireCompletePairs, visit);
  pairQuoteTokens(
    pairs,
    roles,
    mayOpen,
    (i) => {
      const { previous } = tokens[i];
      return (
        (!previous ||
          (nestedNeutral &&
            previous.glyph === '"' &&
            pairs[i - 1].closer !== null &&
            TITLE_WORD_CHAR.test(tokens[i].follower ?? ' '))) &&
        mayOpen(i)
      );
    },
    visit
  );
  let lastUnresolved = -1;
  let lastGerman = -1;
  let lastEnglish = -1;
  let lastMeasure = -1;
  let lastDirected = -1;
  let lastNeutralCluster = -1;
  let lastUnpairedSource = -1;
  let lastQuotedTitle = -1;
  let lastNumericPair = -1;
  let lastReassigned = -1;
  let frame;
  for (const [i, pair] of pairs.entries()) {
    visit?.();
    const token = tokens[i];
    if (
      token.glyph === '"' &&
      token.previous?.glyph === '"' &&
      token.previous.previous?.glyph === '"'
    ) {
      lastNeutralCluster = i;
    }
    const owner = token.partner;
    const authored = measures && hasAuthoredPartner(token);
    if (measures && !authored) {
      lastUnpairedSource = i;
    }
    const endpoint =
      owner &&
      (measures ||
        matchingQuote(token.glyph) === owner.glyph ||
        matchingQuote(owner.glyph) === token.glyph)
        ? owner.at
        : token.at;
    if (pair.glyph === G.PRIME) {
      lastMeasure = i;
      // A numeric mark can instead open a real title. When its own closer
      // is also numeric, the two readings can share every other boundary.
      if (authored && owner.at > token.at && token.next !== owner) {
        if (measures.has(owner)) {
          if (!measuredFeet(text, ctx, token, visit) && !measuredFeet(text, ctx, owner, visit)) {
            lastNumericPair = i;
          }
        } else if (openingContentAt(text, token.end, ctx)) {
          lastQuotedTitle = i;
        }
      }
      if (frame) {
        frame.left = Math.min(frame.left, endpoint);
        frame.right = Math.max(frame.right, endpoint);
        // Removing the end of a title must also explain its unclosed parent,
        // whether its matching endpoint was directional or mixed. A parent the
        // source pairing closes stays open when this reading takes its closer.
        const alternate = token.mixed;
        const parent = alternate?.mixed === token ? alternate.outer : undefined;
        if (parent && (!parent.partner || !pairs[positions.get(parent)]?.partner)) {
          frame.left = Math.min(frame.left, parent.at);
        }
        if (authored && owner.at < token.at && owner.outer && !owner.outer.partner) {
          frame.left = Math.min(frame.left, owner.outer.at);
        }
      }
      continue;
    }
    if (measures && owner !== tokens[pair.partner?.index]) {
      lastReassigned = i;
    }
    if (
      !pair.partner ||
      ((token.preserved || owner?.preserved) && owner !== tokens[pair.partner.index]) ||
      (pair.closer !== null &&
        (!openingContentAt(text, token.end, ctx) || (!token.previous && !mayOpen(i))))
    ) {
      lastUnresolved = i;
    }
    if (pair.glyph === G.BDQUO) {
      lastGerman = i;
    }
    if (pair.glyph === RDQUO) {
      lastEnglish = i;
    }
    if (pair.closer !== null) {
      frame = pair;
      pair.left = endpoint;
      pair.right = endpoint;
      pair.depth = 1;
      continue;
    }
    const opening = pair.partner;
    if (!opening) {
      continue;
    }
    frame = opening.outer;
    const left = Math.min(opening.left, endpoint);
    const right = Math.max(opening.right, endpoint);
    if (opening.outer) {
      opening.outer.left = Math.min(opening.outer.left, left);
      opening.outer.right = Math.max(opening.outer.right, right);
      opening.outer.depth = Math.max(opening.outer.depth, opening.depth + 1);
    }
    const start = opening.index;
    if (opening.glyph !== '"') {
      lastDirected = Math.max(lastDirected, start);
    }
    if (start <= lastUnresolved || tokens[start].at > left || right > token.at) {
      continue;
    }
    if (!measures) {
      complete[start] = Math.max(complete[start] ?? -1, i);
    } else {
      const parent = tokens[start].outer;
      const retainsTitle =
        start <= lastQuotedTitle || (start <= lastNumericPair && start > lastReassigned);
      // Keep a title with its own content and ends. If both numeric marks
      // bound the same speech, its deletion alone cannot prove two inches.
      if (
        start > lastMeasure ||
        (retainsTitle && start > lastUnpairedSource && (!parent || parent.partner))
      ) {
        continue;
      }
    }
    const mixed = start <= lastGerman && start <= lastEnglish;
    // Arbitrary runs of straight marks do not prove a new nested speech. A
    // measurement can reveal a longer frame with its own directed quotation,
    // opened by a mark that the source pairing also reads as an opener.
    const measured =
      measures &&
      tokens[start].closer !== null &&
      start <= lastDirected &&
      start > lastNeutralCluster &&
      opening.depth > 1 &&
      (complete[start] ?? -1) < i;
    if ((mixed || measured) && (!ranges[start] || ranges[start].end < i)) {
      ranges[start] = { end: i, pairs };
    }
  }
}

function speechMeasurements(text, ctx, tokens, padded, visit) {
  const spare = new Set();
  const possible = new Set();
  for (const [i, token] of tokens.entries()) {
    visit?.();
    if (token.preserved || token.glyph === G.LAQUO || token.glyph === G.BDQUO) {
      continue;
    }
    const digit = digitBeforeQuote(text, token.at, padded);
    // A mark glued to a Latin word reads as a code beside the number, `96"USD`, not as a unit sign.
    if (digit === -1 || LATIN_LETTER_RE.test(token.follower)) {
      continue;
    }
    token.measureDigit = digit;
    const prior = tokens[i - 1];
    const closer = prior?.glyph === '"' ? '"' : matchingQuote(prior?.glyph);
    // A numeric title retains its apparent closer unless another physical
    // closer can take its place. First try reserving only the unmatched marks.
    if (
      closer !== token.glyph ||
      (token.partner !== prior && !authoredOpeningAt(text, prior.at, false, ctx))
    ) {
      spare.add(token);
      possible.add(token);
      continue;
    }
    const after = tokens[i + 1];
    if (
      after?.glyph === closer &&
      digitBeforeQuote(text, after.at, padded) === -1 &&
      (after.previous === token || !authoredOpeningAt(text, after.at, false, ctx))
    ) {
      possible.add(token);
    }
  }
  return { spare, possible };
}

function completeDirectedSpeech(text, ctx, tokens, pending, readsInches, padded, visit) {
  let english = false;
  let german = false;
  let nestedStraight = false;
  for (const token of tokens) {
    visit?.();
    english ||= token.glyph === RDQUO;
    german ||= token.glyph === G.BDQUO;
    nestedStraight ||=
      token.glyph === '"' &&
      token.previous?.glyph === '"' &&
      TITLE_WORD_CHAR.test(token.follower ?? ' ');
    if (english && german && nestedStraight) {
      break;
    }
  }
  const mixed = english && german;
  const measures = readsInches && speechMeasurements(text, ctx, tokens, padded, visit);
  if (!mixed && !measures?.possible?.size) {
    return;
  }
  // A high mark can close a German quotation or open an English one. The
  // existing resolver first tries ordinary prose, then reserves a closing mark
  // for a waiting English frame. Among complete intervals prefer the outermost.
  const ranges = [];
  const complete = [];
  const index = (units, nestedNeutral = false) => {
    indexDirectedSpeech(text, ctx, tokens, ranges, complete, false, units, nestedNeutral, visit);
    indexDirectedSpeech(text, ctx, tokens, ranges, complete, true, units, nestedNeutral, visit);
  };
  index();
  if (measures?.possible?.size) {
    // A mark following a digit can belong to the measurement inside a speech.
    // Try this reading after the ordinary one: an equally long frame already
    // accounts for a numeric title's closer. Only a longer completed frame
    // can certify an inch without disturbing a completed numeric title.
    const { spare, possible } = measures;
    if (spare.size && spare.size < possible.size) {
      index(spare);
    }
    index(possible);
    if (spare.size && nestedStraight) {
      index(spare, true);
    }
  }
  for (let i = 0; i < ranges.length; i++) {
    visit?.();
    const range = ranges[i];
    if (!range) {
      continue;
    }
    for (let j = i; j <= range.end; j++) {
      visit?.();
      const token = tokens[j];
      if (token.partner?.partner === token) {
        token.partner.partner = null;
      }
      if (token.mixed?.mixed === token) {
        token.mixed.mixed = undefined;
      }
    }
    for (let j = i; j <= range.end; j++) {
      visit?.();
      const token = tokens[j];
      const pair = range.pairs[j];
      if (pair.glyph === G.PRIME) {
        token.partner = null;
        token.mixed = undefined;
        token.measureAt = token.measureDigit + 1;
        continue;
      }
      token.partner = tokens[pair.partner.index];
      token.closer = pair.closer;
      token.mixed = undefined;
      token.empty = token.next === token.partner || token.previous === token.partner;
      pending.push(token);
    }
    i = range.end;
  }
}

function connectedEditablePairs(
  text,
  ctx,
  editable,
  ordered,
  preserved,
  readsInches,
  writesNeutralClosers,
  visit
) {
  // Decide the roles while both authored endpoints are still available. A complete
  // writable quotation is represented by the same canonical pair for every spelling.
  for (let i = 1; i < ordered.length; i++) {
    visit?.();
    const left = ordered[i - 1];
    const right = ordered[i];
    left.following = right;
    if (left.end === inlineTextEnd(ctx, text, right.at, true)) {
      left.next = right;
      right.previous = left;
    }
  }
  // The whole touching run reads its follower once, including through inline tags.
  for (let i = editable.length - 1; i >= 0; i--) {
    visit?.();
    const token = editable[i];
    token.after = inlineTextStart(ctx, text, token.end, true);
    token.follower = keptGlyphAt(text, token.after).glyph ?? ' ';
    if (token.next && !token.next.preserved) {
      token.runEnd = token.next.runEnd;
      continue;
    }
    token.runEnd = token;
    token.contentAfterRun = token.next
      ? token.next.partner !== null && token.next.closer !== null
      : openingQuoteNeighbours(';', token.follower) && openingContentAt(text, token.after, ctx);
  }
  const opensEditable = (i) => {
    const token = editable[i];
    const before = inlineTextEnd(ctx, text, token.at, true);
    const left = token.previous ? ';' : (text[before - 1] ?? '');
    // Behind a closer, an apostrophe ending a larger quotation supplies no
    // first word for a sibling. An apostrophe attached to its word still does.
    if (
      token.glyph === '"' &&
      token.previous?.closer === null &&
      !token.next &&
      /\p{Quotation_Mark}/u.test(text[token.after]) &&
      !openingContentAt(text, token.after + 1, ctx)
    ) {
      return false;
    }
    return openingQuoteNeighbours(left, token.follower) && openingContentAt(text, token.after, ctx);
  };
  const padded = readsInches && paddingStrip.get(ctx)?.() === true;
  const inch = (token) => readsInches && digitBeforeQuote(text, token.at, padded) !== -1;
  const opensWithin = (i) => {
    const token = editable[i];
    // An English empty pair can follow the closing mark of the first title
    // even though it has no word to distinguish its opener from a German close.
    if (
      token.glyph === G.LDQUO &&
      token.next?.glyph === RDQUO &&
      token.previous?.glyph === '"' &&
      token.previous.closer === null &&
      !token.previous.partner &&
      closesContent(text, token.previous, ctx) &&
      (!readsInches || digitBeforeQuote(text, token.previous.at, padded) === -1)
    ) {
      return true;
    }
    // At a protected span's end, the first of several touching writable marks can
    // close the waiting frame; remaining marks can open the sibling on its word.
    return (
      !(
        (token.previous?.preserved ||
          (token.previous?.closer === null && token.previous.partner)) &&
        token.next &&
        !token.next.preserved
      ) &&
      !(token.runEnd.next?.preserved && token.previous?.closer === null) &&
      // An English quotation can start with a complete empty quotation.
      // Its own closer is checked before this high mark keeps the opening role.
      (token.runEnd.contentAfterRun ||
        (token.glyph === G.LDQUO && startsWithEmptyQuotation(token))) &&
      opensEditable(i)
    );
  };
  pairAuthoredQuotes(editable, opensEditable, opensWithin, true, visit);
  // A high mark may open an English quotation inside a German one. If that
  // reading leaves both the touching German opener and its enclosing English
  // frame unfinished, the same two closers can finish both authored pairs.
  const unpaired = new Set(
    editable.filter((token) => {
      visit?.();
      if (token.glyph !== G.LDQUO || token.closer !== RDQUO) {
        return false;
      }
      const german = token.previous;
      return (
        !token.partner ||
        (german?.glyph === G.BDQUO &&
          !german.partner &&
          german.outer?.closer === RDQUO &&
          !german.outer.partner)
      );
    })
  );
  if (unpaired.size) {
    pairAuthoredQuotes(
      editable,
      opensEditable,
      (i) => !unpaired.has(editable[i]) && opensWithin(i),
      true,
      visit
    );
  }
  if (readsInches) {
    // Prefer a balanced interpretation of two completed titles. A spare typed
    // mark can close the first in place of its measurement mark, leaving the
    // following opener to its own completed quotation.
    for (const token of editable) {
      visit?.();
      const { previous } = token;
      if (
        token.glyph !== '"' ||
        token.partner ||
        !token.next?.partner ||
        token.next.closer === null ||
        previous?.glyph !== '"' ||
        previous.closer !== null ||
        !previous.partner ||
        digitBeforeQuote(text, previous.at, padded) === -1
      ) {
        continue;
      }
      token.closer = null;
      token.partner = previous.partner;
      token.partner.partner = token;
      previous.partner = null;
    }
  }
  indexMixedQuotePairs(text, ctx, ordered, readsInches, padded, inch, visit);
  // Roles travel across a touching run of marks and along its matched intervals.
  // Ordinary prose elsewhere in this paragraph keeps its usual quote resolution.
  const pending = preserved.filter((token) => {
    visit?.();
    return token.partner !== null;
  });
  let precedingTitle;
  for (const [i, token] of ordered.entries()) {
    visit?.();
    if (
      readsInches &&
      token.glyph === '"' &&
      !token.preserved &&
      token.previous &&
      pairContentTitles(text, ctx, token, padded, pending, visit)
    ) {
      continue;
    }
    if (readsInches && token.closer === null && token.next?.next) {
      keepEnclosedEmptyValues(text, token, pending, visit);
    }
    if (
      pairEmptyAtBoundary(text, ctx, ordered[i - 2], ordered[i - 1], token, readsInches, padded)
    ) {
      pending.push(ordered[i - 2], token);
    }
    const nearest = token.previous;
    if (!nearest || nearest.partner || nearest.mixed) {
      precedingTitle = nearest?.closer === null ? nearest : undefined;
    }
    if (token.preserved) {
      continue;
    }
    // A complete new title has both endpoints even if surplus marks stand
    // between its opening and the end of the previous title in the same run.
    const own = token.partner ?? token.mixed;
    const opensTitle = own && token.closer !== null && token.next !== own;
    const previous = readsInches && opensTitle ? (precedingTitle ?? nearest) : nearest;
    if (!previous || token.closer === null) {
      continue;
    }
    // A title after the previous one still nests in the opener touching it.
    if (
      previous !== nearest &&
      nearest.closer !== null &&
      !nearest.preserved &&
      nestTouchingClosers(text, ctx, nearest, token, inch)
    ) {
      pending.push(token, nearest);
    }
    if (previous.closer !== null) {
      if (
        nestTouchingClosers(text, ctx, previous, token, inch) ||
        (previous.partner &&
          token.partner &&
          token.next !== token.partner &&
          (previous.glyph !== '"' || token.glyph !== '"'))
      ) {
        pending.push(token, previous);
      }
      continue;
    }
    const first = previous.partner ?? previous.mixed;
    const last = token.partner ?? token.mixed;
    if (!first || !last || !closesContent(text, previous, ctx)) {
      continue;
    }
    if (token.next === last) {
      // The final depth walk owns neutral marks left over after a completed
      // title. Preserve source roles that distinguish a number from an inch.
      if (
        readsInches &&
        token.glyph === '"' &&
        last.glyph === '"' &&
        !token.outer &&
        digitBeforeQuote(text, previous.at, padded) === -1
      ) {
        continue;
      }
      // A complete empty sibling needs neither a word nor a borrowed endpoint.
      // Leave an ambiguous straight closing mark after a number with its unit.
      if (
        (first.next === previous && (token.glyph === '"' || last.glyph === '"')) ||
        (previous.glyph === '"' &&
          readsInches &&
          digitBeforeQuote(text, previous.at, padded) !== -1) ||
        (token.glyph === '"' && token.outer && !token.outer.partner)
      ) {
        continue;
      }
      token.empty = true;
      last.empty = true;
    }
    // A later straight mark, including an inch sign, cannot claim this opener
    // across the visible end of the first title and the complete second title.
    connectTitles(first, previous, token, last, pending);
  }
  if (writesNeutralClosers) {
    completeDirectedSpeech(text, ctx, ordered, pending, readsInches, padded, visit);
  }
  const connected = new Set();
  while (pending.length) {
    visit?.();
    const token = pending.pop();
    if (!token || connected.has(token) || token.partner === null) {
      continue;
    }
    connected.add(token);
    pending.push(token.previous, token.next, token.partner);
  }
  return connected;
}

function indexAuthoredQuotes(text, ctx, pieces, writesNeutralClosers, readsInches) {
  const closing = new Set();
  const content = new Map();
  let cursor = 0;
  let addedPadding = 0;
  // Ranges can jump and the worklist can grow. Count visited index entries
  // across passes so either traversal still checks the same processing budget.
  let visits = 0;
  const visit =
    ctx.checkBudget &&
    (() => {
      if ((++visits & 1023) === 0) {
        ctx.checkBudget('quote:authoredIndex');
      }
    });
  for (const [from, stop] of quoteParagraphs(text, ctx.tags, ctx.checkBudget)) {
    // A touching pair or a preserved reference enables early pairing only in
    // its own paragraph. Keep original offsets for all indexed endpoints.
    const paragraph = pieces && text.slice(from, stop);
    const writable =
      pieces &&
      (paragraph === text || needsAuthoredQuotes(paragraph, paragraph.includes(`${OPEN}N`)));
    if (pieces && !writable && !paragraph.includes('&')) {
      continue;
    }
    const tokens = [];
    const editable = [];
    const ordered = [];
    for (let at = from; at < stop; at++) {
      if ((at & 1023) === 0) {
        ctx.checkBudget?.('quote:references');
      }
      if (writable && (isQuoteMark(text[at]) || text[at] === '"' || text[at] === RDQUO)) {
        const token = { at, end: at + 1, glyph: text[at] };
        editable.push(token);
        ordered.push(token);
      }
      if (text[at] !== '&') {
        continue;
      }
      const reference = readCharacterReferenceAt(text, at);
      if (reference === null) {
        continue;
      }
      const glyph = authoredReferenceGlyph(reference, true);
      if (preservedQuote(glyph)) {
        const token = { at, end: reference.end, glyph, preserved: true };
        tokens.push(token);
        if (writable) {
          ordered.push(token);
        }
      }
      at = reference.end - 1;
    }
    const mayOpen = (i) => {
      const token = tokens[i];
      const before = inlineTextEnd(ctx, text, token.at, true);
      const after = inlineTextStart(ctx, text, token.end, true);
      const prior = tokens[i - 1];
      if (prior?.end === before) {
        return hasOpeningContentBeyondQuotes(text, after, ctx, content, visit);
      }
      const previous = text[before - 1] ?? '';
      if (preservedQuote(previous)) {
        return openingQuoteNeighbours(';', text[after] ?? ' ');
      }
      return (
        openingQuoteNeighbours(previous, ' ') ||
        (openingQuoteNeighbours(previous, text[after] ?? ' ') &&
          hasOpeningContentBeyondQuotes(text, after, ctx, content, visit))
      );
    };
    pairAuthoredQuotes(tokens, mayOpen, (i) => i + 1 < tokens.length && mayOpen(i), false, visit);
    const connected = editable.length
      ? connectedEditablePairs(
          text,
          ctx,
          editable,
          ordered,
          tokens,
          readsInches,
          writesNeutralClosers,
          visit
        )
      : null;
    for (const token of writable ? ordered : tokens) {
      visit?.();
      if (token.measureAt !== undefined) {
        pieces.push(text.slice(cursor, token.measureAt), G.PRIME);
        addedPadding -= token.at - token.measureAt;
        cursor = token.end;
        continue;
      }
      if (token.preserved) {
        if (token.closer === null && token.partner !== null) {
          closing.add(token.end - 1 + addedPadding);
        }
        continue;
      }
      // Directional partners enter normalization together: replacing just the low
      // opener loses the frame that makes its high partner a closer. Only typing a
      // neutral closer requires quote.close. Adjacent neutral marks with no content
      // between them still belong to the ordinary empty-quotation rule.
      if (
        !connected.has(token) ||
        (token.glyph === '"' &&
          (((token.empty || token.closer === null) && !writesNeutralClosers) ||
            (!token.empty && (token.partner.at === token.end || token.partner.end === token.at))))
      ) {
        continue;
      }
      const role = token.closer === null ? FIRS_CLOSE : FIRS_OPEN;
      if (token.glyph !== role) {
        const padding =
          role === FIRS_OPEN && token.glyph === '"' ? openingQuotePadding(text, token.at, ctx) : '';
        addedPadding += padding.length;
        pieces.push(text.slice(cursor, token.at), padding + role);
        cursor = token.end;
      }
    }
  }
  if (pieces?.length) {
    pieces.push(text.slice(cursor));
  }
  return { text, closing };
}

const EDITABLE_QUOTE_RE = new RegExp(`[${QUOTE_MARKS}]`, 'u');
const TOUCHING_QUOTE_RE = new RegExp(`[${QUOTE_MARKS}](?=[${QUOTE_MARKS}<])`, 'u');

function needsAuthoredQuotes(text, hasReferences) {
  return (hasReferences ? EDITABLE_QUOTE_RE : TOUCHING_QUOTE_RE).test(text);
}

export function prepareAuthoredQuotes(text, ctx, writesNeutralClosers, readsInches) {
  const hasReferences = text.includes(`${OPEN}N`);
  if (!needsAuthoredQuotes(text, hasReferences)) {
    return text;
  }
  const pieces = [];
  const pairs = indexAuthoredQuotes(
    text,
    ctx,
    pieces,
    writesNeutralClosers,
    writesNeutralClosers && readsInches
  );
  pairs.text = pieces.length ? pieces.join('') : text;
  if (hasReferences) {
    referencePairs.set(ctx, pairs);
  }
  return pairs.text;
}

// A pair of preserved references bounds content without introducing a writable quotation
// level. Its closing reference is a content boundary to an adjacent editable mark.
function endsAuthoredQuotePair(text, at, ctx) {
  const reference = characterReferenceEndingAt(text, at);
  const glyph = authoredReferenceGlyph(reference, true);
  if (glyph !== '"' && glyph !== G.LDQUO && glyph !== RDQUO && glyph !== G.RAQUO) {
    return false;
  }
  let previous = referencePairs.get(ctx);
  if (previous?.text !== text) {
    previous = indexAuthoredQuotes(text, ctx);
    referencePairs.set(ctx, previous);
  }
  // A later replacement can supply an equal string from a different allocation. All
  // further callbacks for that replacement compare with the string they actually receive.
  previous.text = text;
  return previous.closing.has(at);
}

function closeBehindCloser([full, inner, outer, at, source], ctx) {
  if (inner === ';') {
    return quoteBoundaryGlyph(characterReferenceEndingAt(source, at)) === G.RAQUO ||
      endsAuthoredQuotePair(source, at, ctx)
      ? inner + repeatChar(outer, FIRS_CLOSE)
      : full;
  }
  let left = at;
  if (paddingStrip.get(ctx)?.() === true) {
    while (source[left - 1] === ' ' || source[left - 1] === '\t' || source[left - 1] === G.NBSP) {
      left -= 1;
    }
    if (left < at) {
      MAY_STRIP_PADDING_RE.lastIndex = left;
      if (!MAY_STRIP_PADDING_RE.test(source)) {
        left = at;
      }
    }
  }
  return source[left - 1] !== FIRS_OPEN && canStartQuote(source, left, '"', ctx)
    ? full
    : inner + repeatChar(outer, FIRS_CLOSE);
}

// Whether `space.strip_quote_padding` runs in this call: the padding it takes from a closing quote
// does not part that quote from a measurement's digit.
export function bindQuotePaddingStrip(ctx, active) {
  paddingStrip.set(ctx, active);
}

// Which built-in quote rules can write in this call.
export function bindQuoteRules(ctx, active, addressBefore) {
  if (addressBefore) {
    labelAddressBefore.set(ctx, addressBefore);
  }
  activeQuoteRule.set(ctx, active);
}

// What `open` writes for the straight quotes glued behind a `«` at `at`, or null where it leaves
// them: `quote.nested` turns a closer standing where an opener stands after `open` has run, and the
// next pass opens these behind the `«` it reads there.
function openedBehind(source, at, ctx) {
  let end = at + 1;
  while (source[end] === '"') {
    end += 1;
  }
  const quotes = source.slice(at + 1, end);
  const follower = source[end];
  if (quotes === '' || follower === undefined || SEPARATOR_RE.test(follower)) {
    return null;
  }
  const full = `${FIRS_OPEN}${quotes}`;
  const written = openAfterStrong(full, FIRS_OPEN, quotes, follower, at, source, ctx);
  return written === full ? null : written.slice(1);
}

function applyInnerQuotes(ctx) {
  const settings = ctx.group?.settings ?? {};
  const active = activeQuoteRule.get(ctx);
  const opens = active?.('open') === true;
  ctx.text = processQuotes(ctx.text, {
    allowNested: settings.allowNested !== false,
    pairRemainder: opens && active('close'),
    convertInches: settings.convertInches !== false,
    stripsPadding: paddingStrip.get(ctx)?.() === true,
    checkBudget: ctx.checkBudget,
    tags: quoteParagraphTags(ctx),
    inlineContext: ctx,
    keptCloser: keptCloser(authoredClosers.get(ctx) ?? authoredClosersIn('')),
    openedBehind: opens ? (source, at) => openedBehind(source, at, ctx) : null
  });
}

export const quoteGroup = {
  title: 'Кавычки',
  rules: [
    {
      id: 'around_link',
      requires: F.QUOTE,
      description: 'Кавычки вынесены за тег <a>',
      pattern: QUOTES_OUTSIDE_A_RE,
      replacement: '"$1$2$3"'
    },
    {
      // Before the opening rules: the part every other quote plays is planned from how many
      // quotations stand open, and this `«` closes one rather than opening it.
      id: 'fix_orphan_open',
      requires: F.QUOTE,
      description: 'Открывающая «, приклеенная к концу слова перед пробелом/концом → закрывающая »',
      pattern: /([a-zа-яё0-9])«(?=\s|$)/giu,
      replacement: `$1${FIRS_CLOSE}`
    },
    {
      id: 'open',
      requires: F.QUOTE,
      description: 'Открывающая кавычка',
      // A handler rather than three patterns: the last step needs to know whether a quotation is open
      // where it stands, and a pattern replacement cannot see the substitutions made beside it.
      // The runner ignores `regexes`; it is what keeps these three under `lint:redos`, which walks
      // declared rule patterns and would otherwise stop seeing a rule that scans on its own.
      regexes: [
        OPEN_AFTER_STRONG_RE,
        OPEN_AFTER_WEAK_RE,
        OPEN_BEFORE_SPACE_RE,
        ...QUOTE_CONTENT_REGEXES
      ],
      handler: (ctx) => {
        // All three steps need a straight quote to do anything, and a value that has none is the
        // ordinary case in a structured document — where this runs once per value.
        if (!ctx.text.includes('"')) {
          return;
        }

        const stepped = ctx.text
          .replace(OPEN_AFTER_STRONG_RE, (...args) => openAfterStrong(...args, ctx))
          .replace(OPEN_AFTER_WEAK_RE, (...args) => openBeforeWord(...args, ctx));

        ctx.text = openSpacedQuotes(stepped, ctx);
      }
    },
    {
      id: 'open_cyrillic',
      requires: F.QUOTE,
      description: 'Приклеенная кавычка у кириллицы → « с пробелом',
      pattern: OPEN_CYRILLIC_RE,
      replacement: `$1 ${FIRS_OPEN}$2`
    },
    {
      id: 'close',
      requires: F.QUOTE,
      // What each pattern below cannot match without: a straight quote, an opening guillemet before a
      // tag, or one after a tag before a mark.
      requiresPattern: new RegExp(`"|${G.LAQUO}<|>${G.LAQUO}[.,:;)]`, 'u'),
      description: 'Закрывающая кавычка',
      pattern: [
        // `\"` is defused as a path close only behind a backslash-ASCII run, so ordinary `\"escaped\"`
        // prose is untouched.
        /(?<=\\[\w:]*)\\"(?=$|\s|[.,;:!?)]|<)/u,
        // The follower may be an opening quote: what stands in front of this one is a word end, and a
        // quote glued to a word end closes whatever the next quotation does.
        new RegExp(`(${CLOSER_LEFT})((?:"|\\\\")+)(?!${QUOTE_WORD})`, 'giu'),
        new RegExp(`([${G.RAQUO};])((?:"|\\\\")+)(?!["\\p{L}\\p{N}])`, 'gu'),
        new RegExp(
          `(${CLOSER_LEFT})((?:"|\\\\"|${G.LAQUO})+)(<[^>]+>)(\\.|${G.HELLIP}|;|:|\\?|!|,|\\)|<\\/|$| )`,
          'giu'
        ),
        new RegExp(
          `(${CLOSER_LEFT})(\\s+)((?:"|\\\\")+)(\\s+)(\\.|${G.HELLIP}|;|:|\\?|!|,|\\)|\\(|<\\/|$| )`,
          'giu'
        ),
        // A quote still spaced on both sides after the opening rules have run is a closer that lost
        // its word: an opener in that position was already claimed there, and only a quotation that is
        // open leaves one behind. The space before it goes, the one after stays.
        new RegExp(`(${SPACED_CLOSER_LEFT})(\\s+)((?:"|\\\\")+)(?=\\s)`, 'giu'),
        // The copyright rule binds this horizontal gap later. Keep it for the padding rule,
        // as for an already authored NBSP before a closer.
        new RegExp(`(${G.COPY}[ \\t]+)((?:"|\\\\")+)(?=\\s)`, 'gu'),
        // The quotation an opening quote marks may hold no words at all, and `« "` is that empty one.
        // Its gap is horizontal and nothing else: the rule above spans line breaks, where a blank line
        // between the two quotes is a paragraph boundary rather than a gap.
        new RegExp(`(${G.LAQUO})([ \\t]+)((?:"|\\\\")+)(?=\\s)`, 'gu'),
        />«\.($|\s|<)/gu,
        />«,($|\s|<|\S)/gu,
        />«:($|\s|<|\S)/gu,
        />«;($|\s|<|\S)/gu,
        />«\)($|\s|<|\S)/gu,
        // The spaces a format keeps at the end until `space.trim_line_end` takes them stand for nothing.
        /((?:"|\\")+)(?=[ \t]*$)/giu,
        // A closing guillemet after the quote ends the quotation around this one, so this one closes:
        // `“` reaches here as a straight quote, and in `«„к'“»` nothing else would close it. The
        // follower is only looked at: a closer it is closes a quote glued behind it in turn.
        new RegExp(
          `([^${SEPARATOR}])((?:"|\\\\")+)(?=\\.|${G.HELLIP}|;|:|\\?|!|,|\\s|\\)|<\\/|<|${G.RAQUO}|&|$)`,
          'giu'
        )
      ],
      replacement: [
        () => `\\${FIRS_CLOSE}`,
        (m, ctx) => {
          const [, p1, p2] = m;

          return closeAtBoundary(m, ctx, `${p1}${repeatChar(p2, FIRS_CLOSE)}`);
        },
        closeBehindCloser,
        (m, ctx) => {
          const [, p1, p2, p4, p5] = m;
          const dq = count(p2, '"');
          const lq = count(p2, G.LAQUO);

          return closeAtBoundary(m, ctx, `${p1}${FIRS_CLOSE.repeat(dq + lq)}${p4}${p5}`);
        },
        (m, ctx) => {
          const [, p1, p2, p3, p5, p6] = m;
          const dq = count(p3, '"');
          const lq = count(p3, G.LAQUO);

          return closeAtBoundary(m, ctx, `${p1}${p2}${FIRS_CLOSE.repeat(dq + lq)}${p5}${p6}`);
        },
        closeQuoteRun,
        closeAfterCopyright,
        closeQuoteRun,
        (m, ctx) => closeAtBoundary(m, ctx, `>${FIRS_CLOSE}.${m[1]}`),
        (m, ctx) => closeAtBoundary(m, ctx, `>${FIRS_CLOSE},${m[1]}`),
        (m, ctx) => closeAtBoundary(m, ctx, `>${FIRS_CLOSE}:${m[1]}`),
        (m, ctx) => closeAtBoundary(m, ctx, `>${FIRS_CLOSE};${m[1]}`),
        (m, ctx) => closeAtBoundary(m, ctx, `>${FIRS_CLOSE})${m[1]}`),
        (m) => FIRS_CLOSE.repeat(count(m[1], '"')),
        (m, ctx) => {
          const [, p1, p2] = m;
          const source = m.at(-1);
          const after = m.at(-2) + m[0].length;
          if (source[after] === '&' && quoteFollower(source, after, ctx) !== G.RAQUO) {
            return m[0];
          }
          return closeAtBoundary(m, ctx, `${p1}${FIRS_CLOSE.repeat(count(p2, '"'))}`);
        }
      ]
    },
    {
      id: 'nested',
      requires: F.QUOTE,
      description: 'Внутренние кавычки-лапки и дюймы',
      // processQuotes is a character-by-character state machine and runs no regex at all.
      regexes: [],
      handler: applyInnerQuotes
    }
  ],

  preParse(ctx) {
    authoredClosers.set(ctx, authoredClosersIn(ctx.text));
  }
};
