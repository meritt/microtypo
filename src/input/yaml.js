import { MicroTypoInputError } from '../errors/index.js';
import { decodeEscapes } from '../lib/escape-decoder.js';
import { isFlowSpace, skipSpaces } from '../lib/strings.js';
import { chainAppend, LocatedSpan } from './span-path.js';

// The words YAML resolves to something other than a string. `y`/`n` are in because 1.1 booleans are,
// and the list is matched whole: `no` is a boolean, `нет` is prose.
const PLAIN_KEYWORD = /^(?:~|null|true|false|yes|no|on|off|y|n|\.inf|\.nan|=|<<|---|\.\.\.)$/i;

// Everything YAML resolves to a number, a date or a time is spelled without letters, or spelled
// without spaces and opened by a digit, a sign or a dot — `0x1f`, `1e5`, `2001-12-14t21:59:43`. A
// plain scalar of either shape is data, and typesetting it would change its type. Prose is what is
// left, and `5 км по Ардену` stays prose because the space keeps it out of the second shape.
function resolvesToString(value) {
  if (value === '' || PLAIN_KEYWORD.test(value)) {
    return false;
  }

  if (!/\p{L}/u.test(value)) {
    return false;
  }

  return / /.test(value) || !/^[-+.0-9]/.test(value);
}

// What a plain scalar may not contain, because the parser would stop reading it as one value: a
// mapping colon, a comment, a line break, or an opening indicator in first position.
const PLAIN_BREAKS = /:(?:\s|$)|\s#|[\r\n]/;
const PLAIN_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

// The type is settled before the run, not after: prose does not become a number by gaining a dash or
// a narrow space, and asking for a letter here would refuse `100 000 руб.` the moment `руб.` became
// `₽`. What the result must still be is one plain scalar.
export function plainScalarSafe(typed) {
  return (
    typed !== '' &&
    typed.trim() === typed &&
    !PLAIN_BREAKS.test(typed) &&
    !PLAIN_INDICATOR.test(typed) &&
    !PLAIN_KEYWORD.test(typed)
  );
}

// Inside a flow collection a comma or a bracket ends the scalar, so a result carrying one would hand
// the rest of the value to the parser as structure. In block context both are ordinary text, which
// is why this guard is the flow scanner's own.
const FLOW_BREAKS = /[,[\]{}]/;

export function flowScalarSafe(typed) {
  return plainScalarSafe(typed) && !FLOW_BREAKS.test(typed);
}

// `?` is an indicator only where a plain scalar could not start instead, and YAML lets one start
// with `?` when the next character could go on being part of it — inside a flow collection that is
// everything but whitespace and the collection's own delimiters.
const isPlainAfterIndicator = (ch) => !isFlowSpace(ch) && !FLOW_BREAKS.test(ch);

// A plain scalar folds onto the following, more-indented line, and this scanner reads one line at a
// time, so a value that continues is left whole rather than typeset by halves. A blank line does not
// end it — a plain scalar carries blank lines through as line breaks — but a comment line is no
// continuation at any column: only an empty line may stand between the parts of a plain scalar
// (YAML 1.2.2 §7.3.3).
function foldsOntoNextLine(src, lineEnd, n, indent) {
  let lineStart = lineEnd + 1;

  while (lineStart < n) {
    const p = skipSpaces(src, lineStart, n);

    if (p >= n) {
      return false;
    }

    if (src[p] !== '\n' && src[p] !== '\r') {
      return src[p] !== '#' && p - lineStart > indent;
    }

    lineStart = src.indexOf('\n', p);
    lineStart = lineStart === -1 ? n : lineStart + 1;
  }

  return false;
}

// The value stops at a comment, and the spaces in front of that comment are not part of it either.
function plainScalarEnd(src, pos, lineEnd) {
  let end = lineEnd;

  for (let i = pos + 1; i < lineEnd; i += 1) {
    if (src[i] === '#' && (src[i - 1] === ' ' || src[i - 1] === '\t')) {
      end = i;
      break;
    }
  }

  while (end > pos && (src[end - 1] === ' ' || src[end - 1] === '\t')) {
    end -= 1;
  }

  return end;
}

// The escapes YAML has, for the shared key decoder. Its own `\` doubling is a single-quoted rule and
// stays with the caller.
const YAML_ESCAPE = Object.freeze({
  0: '\0',
  a: '',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '',
  _: ' ',
  L: ' ',
  P: ' '
});

const YAML_HEX = Object.freeze({ x: 2, u: 4, U: 8 });

function decodeQuotedKey(raw, quoteChar) {
  return quoteChar === "'" ? raw.replaceAll("''", "'") : decodeEscapes(raw, YAML_ESCAPE, YAML_HEX);
}

// One physical line of a quoted scalar, read once from the left: white space next to a line break is
// separation and goes, white space an escape wrote is content and stays, and only a backslash with
// nothing behind it escapes the break itself.
function scanQuotedLine(line, escapes) {
  let contentEnd = 0;
  let i = 0;

  while (i < line.length) {
    if (escapes && line[i] === '\\') {
      if (i + 1 === line.length) {
        return { content: line.slice(0, i), escapesBreak: true };
      }

      i += 2;
      contentEnd = i;
      continue;
    }

    const ch = line[i];

    i += 1;

    if (ch !== ' ' && ch !== '\t') {
      contentEnd = i;
    }
  }

  return { content: line.slice(0, contentEnd), escapesBreak: false };
}

// What a run of line breaks between two pieces of content folds to. One break is a space; k of them
// are k−1 line breaks, which is how a blank line inside a scalar stays a break rather than becoming
// a space. A `\` at the end of the content takes the first break away entirely, so the run it opens
// is one shorter. YAML 1.2.2 §6.5.
function foldBreaks(count, firstEscaped) {
  const n = firstEscaped ? count - 1 : count;

  if (n <= 0) {
    return '';
  }

  return n === 1 ? ' ' : '\n'.repeat(n - 1);
}

// A quoted scalar written across lines is one value: the indentation around each break is separation
// rather than content, and in a double-quoted scalar a `\` in front of the break takes the break
// itself away. Nothing follows the last line but the closing quote, so its trailing white space is
// content. YAML 1.2.2 §7.3.1.
function foldQuotedScalar(raw, quoteChar) {
  if (!raw.includes('\n')) {
    return raw;
  }

  const escapes = quoteChar === '"';
  const lines = raw.split('\n');
  const lastIndex = lines.length - 1;
  let out = '';
  let breaks = -1;
  let firstEscaped = false;

  for (let i = 0; i <= lastIndex; i += 1) {
    const last = i === lastIndex;
    const body = i === 0 ? lines[i] : lines[i].replace(/^[ \t]+/, '');
    // Nothing follows the last line but the closing quote, so whatever it holds is content — even
    // nothing at all, which is a key whose name ends in the space the last break folded to.
    const { content, escapesBreak } = last
      ? { content: body, escapesBreak: false }
      : scanQuotedLine(body.replace(/\r$/, ''), escapes);

    if (!last && content === '' && !escapesBreak && breaks >= 0) {
      breaks += 1;
      continue;
    }

    out = breaks < 0 ? content : out + foldBreaks(breaks, firstEscaped) + content;
    breaks = 1;
    firstEscaped = escapesBreak;
  }

  return out;
}

// The one place a quoted key becomes the name a selector carries: joining its physical lines and
// decoding its escapes is one question, and two readers answering it apart name one key two ways.
function quotedKeyName(raw, quoteChar) {
  return decodeQuotedKey(foldQuotedScalar(raw, quoteChar), quoteChar);
}

// `multiline` is collected here rather than measured afterwards: a backward search for the newline
// runs to the start of the document, which is quadratic over a flow collection of many scalars.
function scanQuoted(src, i, lineEnd) {
  const q = src[i];
  let j = i + 1;
  let hasEscape = false;
  let multiline = false;

  while (j < lineEnd) {
    const c = src[j];
    multiline ||= c === '\n';

    if (q === '"') {
      if (c === '\\') {
        hasEscape = true;
        multiline ||= src[j + 1] === '\n';
        j += 2;
        continue;
      }

      if (c === '"') {
        return { end: j + 1, eligible: !hasEscape, multiline };
      }
    } else if (c === "'") {
      if (src[j + 1] === "'") {
        hasEscape = true;
        j += 2;
        continue;
      }

      return { end: j + 1, eligible: !hasEscape, multiline };
    }

    j += 1;
  }

  return null;
}

function assertNoTrailingLineTokens(src, from, lineEnd) {
  const p = skipSpaces(src, from, lineEnd);

  if (p < lineEnd && src[p] !== '#') {
    throw new MicroTypoInputError(`Unexpected trailing content after YAML scalar at offset ${p}`, {
      details: { offset: p }
    });
  }
}

const FLOW_STRUCTURAL = new Set([' ', '\t', '\n', '\r', '[', ']', '{', '}', ',', ':', '"', "'"]);

// A flow collection is not line-structured, so a line break inside one is ordinary whitespace: the
// `:` that makes the scalar before it a key may stand on the next line, which the horizontal-only
// skip every other scanner uses cannot cross. A comment is not content either, and both sides of the
// walk have to agree on what may stand between two tokens.
function skipFlowSpace(src, i, n) {
  let j = i;

  for (;;) {
    while (j < n && isFlowSpace(src[j])) {
      j += 1;
    }

    if (j >= n || src[j] !== '#' || (j > 0 && !isFlowSpace(src[j - 1]))) {
      return j;
    }

    const line = src.indexOf('\n', j);

    if (line === -1) {
      return n;
    }

    j = line;
  }
}

// An anchor or a tag stands in front of the node it belongs to and is no part of it. A verbatim tag
// ends at its own `>`; otherwise the name ends at the collection's own delimiters and whitespace and
// nothing else, an anchor name being `ns-char` minus `,[]{}`, so a colon and a quote are part of it.
// YAML 1.2.2 §6.9.2.
function endOfNodeProperties(src, i, n) {
  let j = i;

  while (j < n && (src[j] === '&' || src[j] === '!')) {
    if (src[j] === '!' && src[j + 1] === '<') {
      const close = src.indexOf('>', j + 2);

      j = close === -1 ? n : close + 1;
    } else {
      j += 1;

      while (j < n && isPlainAfterIndicator(src[j])) {
        j += 1;
      }
    }

    j = skipFlowSpace(src, j, n);
  }

  return j;
}

// A sequence element is addressed by its index and a mapping entry by its key. A sequence element
// that is a compact single-pair mapping — `[ "ключ": значение ]`, the braces left out — is addressed
// by both.
const flowElementChain = (frame, base) => {
  if (!frame) {
    return base;
  }

  if (frame.type !== 'seq') {
    return chainAppend(frame.base, frame.key);
  }

  const element = chainAppend(frame.base, frame.index);

  return frame.key === null ? element : chainAppend(element, frame.key);
};

// Where a mapping is waiting for its key, whatever comes next is that key — a `:` behind it is not
// what makes it one. YAML lets the value be omitted entirely (`{ ключ }` is `{ключ: null}`) and lets
// a comment or a line break stand between the key and its `:`, so a lookahead would decide the
// question from evidence that need not be there.
const awaitsKey = (frame) => frame?.type === 'map' && frame.key === null;

// The three reasons a node keeps its own bytes, asked as one question because the answer is the
// same: a mapping still waiting for its key, a sequence element opened by `?` — a single-pair
// mapping, whose key half is settled by nothing else — and any node inside a subtree already
// answered this way.
const inKeyPosition = (frame) =>
  Boolean(frame) && (frame.opaque || frame.explicit || awaitsKey(frame));

// A scalar that spans lines cannot be rewritten in place: the pipeline collapses newlines, and a
// flow scalar's continuation indent is significant.
function recordFlowScalar(src, n, start, quoted, frame, base, spans, tagged) {
  // A sequence element may be a compact single-pair mapping, and there the `:` is the only thing
  // that says so.
  const isKey = inKeyPosition(frame) || src[skipFlowSpace(src, quoted.end, n)] === ':';
  // A key names its container, so it stops short of its own position, which is why this chain is
  // taken before `frame.key` becomes the key itself.
  const chain = isKey && frame?.type === 'map' ? frame.base : flowElementChain(frame, base);

  if (isKey && frame && !frame.opaque) {
    frame.key = quotedKeyName(src.slice(start + 1, quoted.end - 1), src[start]);
  }

  const eligible = quoted.eligible && !quoted.multiline && !tagged;

  spans.push(new LocatedSpan(start, quoted.end, isKey, chain, eligible, src[start]));
}

// YAML separates with the four ASCII characters `isFlowSpace` names and with nothing else, so
// `trimEnd` is the wrong tool: it would take NBSP, NNBSP and every other Unicode space with them,
// and in a plain scalar those are content.
function trimSeparators(text) {
  let end = text.length;

  while (end > 0 && isFlowSpace(text[end - 1])) {
    end -= 1;
  }

  return text.slice(0, end);
}

// The name a plain key spells, which stops where a comment begins: a `#` opens one only after white
// space, so `a#b` is one plain scalar and keeps its hash.
function plainKeyText(src, from, to) {
  for (let i = from; i < to; i += 1) {
    if (src[i] === '#' && (i === from || isFlowSpace(src[i - 1]))) {
      return trimSeparators(src.slice(from, i));
    }
  }

  return trimSeparators(src.slice(from, to));
}

// Where a plain scalar inside a flow collection stops being one and becomes a key: a `:` that
// separates, which in flow context is one followed by whitespace or by a delimiter of the
// collection. A `:` inside `http://arden.io` or `8:00` separates nothing and is content.
function flowKeyColon(src, from, end) {
  for (let i = from; i < end; i += 1) {
    if (
      src[i] === ':' &&
      (i + 1 >= end || isFlowSpace(src[i + 1]) || FLOW_BREAKS.test(src[i + 1]))
    ) {
      return i;
    }
  }

  return -1;
}

const FLOW_PLAIN_END = [',', ']', '}'];
const LINE_BREAK = ['\n', '\r'];

// The nearest of several characters, each searched forward only and each remembered on its own.
// `found` holds one position per character: a hit still ahead of the cursor is reused, and a -1 is
// final, because a character absent from the rest of the document is absent from every later suffix.
// Keeping only the nearest re-derives the others on every element, which is quadratic on a
// collection whose closer never comes.
//
// The cursors belong to the document, not to one collection: the scan only ever moves forward, so a
// hit found for one collection still answers the next, and re-seeding them per collection puts the
// same quadratic back one level up.
function newDelimiterCursors(src) {
  return {
    plainEnds: FLOW_PLAIN_END.map((ch) => src.indexOf(ch)),
    lineBreaks: LINE_BREAK.map((ch) => src.indexOf(ch))
  };
}

function nearestOf(src, from, chars, found) {
  let best = -1;

  for (let k = 0; k < chars.length; k += 1) {
    if (found[k] !== -1 && found[k] < from) {
      found[k] = src.indexOf(chars[k], from);
    }

    if (found[k] !== -1 && (best === -1 || found[k] < best)) {
      best = found[k];
    }
  }

  return best;
}

// A quote opens a string only right after `[`, `{`, `,` or `:`, so a mid-token apostrophe — `[don't,
// do]` — cannot start a runaway scan past the true close.
function scanFlowCollection(src, start, n, base, spans, checkBudget, cursors) {
  const stack = [];
  let j = start;
  let canOpenQuote = false;
  let steps = 0;
  // Inside a scalar that folds onto further lines: nothing of it is recorded until a delimiter the
  // walk actually reaches ends it.
  let folded = false;
  // Where the plain key of the current mapping entry began: the tokenizer stops at a space, so the
  // last token alone would name `full name` as `name`.
  let keyStart = -1;
  // An anchor or a tag was read and the node it belongs to has not been. That node's type is settled
  // by the property, so this scan leaves its bytes alone — but still reads its structure.
  let tagged = false;

  // A plain scalar inside a flow collection ends at the first `,`, `]` or `}` — YAML forbids all
  // three inside one, so the first is always the end. The word tokenizer below cannot answer this:
  // it stops at a space, and `Корвин - принц` is one scalar, not three tokens.
  const { plainEnds, lineBreaks } = cursors;

  while (j < n) {
    if ((steps++ & 0x3fff) === 0) {
      checkBudget?.('yaml-flow-scan');
    }

    const c = src[j];

    if (isFlowSpace(c)) {
      j += 1;
      continue;
    }

    // A comment runs to the end of its line and is not content, so it is consumed before anything
    // here reads a separator out of it. YAML requires the whitespace in front of `#`, which is also
    // what keeps a `#` inside a plain scalar out of this branch.
    if (c === '#' && (j === start || isFlowSpace(src[j - 1]))) {
      const lineEnd = nearestOf(src, j, LINE_BREAK, lineBreaks);

      j = lineEnd === -1 ? n : lineEnd;
      continue;
    }

    const frame = stack.at(-1);

    // A node property stands exactly where a node may begin, which is what `canOpenQuote` already
    // tracks: anywhere else `&` and `!` are ordinary content of a scalar already under way.
    if ((c === '&' || c === '!') && canOpenQuote) {
      j = endOfNodeProperties(src, j, n);
      tagged = true;
      continue;
    }

    // `? ` opens an explicit key, and a flow sequence element may be one: `[? ключ, …]` is a
    // single-pair mapping whose value may be missing entirely, so nothing else gives the key away. A
    // mapping frame needs no flag for this; it is already waiting for its key.
    if (c === '?' && canOpenQuote && (j + 1 >= n || !isPlainAfterIndicator(src[j + 1]))) {
      if (frame?.type === 'seq') {
        frame.explicit = true;
      }

      j += 1;
      continue;
    }

    if ((c === '"' || c === "'") && canOpenQuote) {
      const q = scanQuoted(src, j, n);

      if (!q) {
        return -1;
      }

      recordFlowScalar(src, n, j, q, frame, base, spans, tagged);
      j = q.end;
      canOpenQuote = false;
      tagged = false;
      continue;
    }

    if (c === '[' || c === '{') {
      stack.push({
        type: c === '[' ? 'seq' : 'map',
        index: 0,
        key: null,
        explicit: false,
        start: j,
        // Nothing inside is typeset. A key subtree says so because a key is never rewritten, a
        // property-bearing node because its type was settled by that property — the flag rides down
        // the nesting so a scalar at any depth knows it without re-deriving why.
        opaque: tagged || inKeyPosition(frame),
        // Where this collection's own spans begin. A sequence element cannot say whether it is a key
        // until its closer is behind it and a `:` follows, so what was recorded inside is taken back
        // then rather than guessed at here.
        spansAt: spans.length,
        base: flowElementChain(frame, base)
      });
      keyStart = -1;
      tagged = false;
      j += 1;
      canOpenQuote = true;
      continue;
    }

    if (c === ']' || c === '}') {
      // The closer has to be the one this frame opened. Popping on either of them accepted
      // `[ 1 }` and typeset the values inside it, while `[ 1` — the same malformation, spelled the
      // other way — was rejected. Protect-or-reject admits only one answer for both.
      if (frame?.type !== (c === ']' ? 'seq' : 'map')) {
        return -1;
      }

      stack.pop();
      j += 1;
      canOpenQuote = false;
      folded = false;
      tagged = false;

      // A collection standing where a key belongs is a key: what it holds names the entry rather
      // than being content of it. In a mapping that is known before the collection opens; in a
      // sequence only now, from the `:` behind the closer. Either way the whole subtree is the key,
      // so everything recorded inside it is taken back — including where no outer frame is there to
      // name, since the key of an implicit block mapping is a collection with nothing around it.
      const outer = stack.at(-1);

      if (inKeyPosition(outer) || src[skipFlowSpace(src, j, n)] === ':') {
        if (outer && !outer.opaque) {
          outer.key = src.slice(frame.start, j);
        }

        spans.length = frame.spansAt;
      }

      if (stack.length === 0) {
        return j;
      }

      continue;
    }

    if (c === ',') {
      if (frame?.type === 'seq') {
        frame.index += 1;
      }

      if (frame) {
        frame.key = null;
        // The entry the `?` opened ends here, whether or not it ever got a value.
        frame.explicit = false;
      }

      folded = false;
      tagged = false;
      keyStart = -1;
      j += 1;
      canOpenQuote = true;
      continue;
    }

    // The one place a mapping moves from key to value: the tokenizer stops at a space as readily as
    // at the `:`, and YAML allows `{title : "…"}`, so the tokenizer cannot be what closes a key.
    if (c === ':') {
      if (keyStart !== -1 && (awaitsKey(frame) || frame?.explicit)) {
        frame.key = plainKeyText(src, keyStart, j);
      } else if (awaitsKey(frame)) {
        // An entry whose key is written as nothing still has one, and the mapping is past it. Only a
        // mapping still waiting says so: an explicit entry whose key a scalar reader already
        // recorded would have that name overwritten with the empty one.
        frame.key = '';
      }

      if (frame) {
        frame.explicit = false;
      }

      keyStart = -1;
      tagged = false;
      j += 1;
      canOpenQuote = true;
      continue;
    }

    // A sequence element is always a value, and so is a mapping entry once its key is known. Only
    // there is a plain scalar prose; a key stays byte-exact, as everywhere else.
    if (!inKeyPosition(frame) && (frame?.type === 'seq' || frame?.type === 'map')) {
      const delimAt = nearestOf(src, j, FLOW_PLAIN_END, plainEnds);
      const breakAt = nearestOf(src, j, LINE_BREAK, lineBreaks);

      const wraps = delimAt !== -1 && breakAt !== -1 && breakAt < delimAt;

      // A scalar that folds onto the next line is one value, and this scan rewrites a value in
      // place, so nothing of it is recorded. Where it ends is not the nearest delimiter either: that
      // one may stand inside a comment, so the walk goes on line by line and only a delimiter it
      // actually reaches ends the scalar. Only a line carrying content folds it — a break with
      // nothing but separation behind it ends the scalar where its own line does.
      if (wraps && skipFlowSpace(src, breakAt, n) < delimAt) {
        folded = true;
        j = plainScalarEnd(src, j, breakAt);
        canOpenQuote = false;
        tagged = false;
        continue;
      }

      const limit = wraps ? breakAt : delimAt;
      const plainEnd = limit === -1 ? -1 : plainScalarEnd(src, j, limit);
      const colon =
        !tagged && plainEnd > j && frame.type === 'seq' && frame.key === null
          ? flowKeyColon(src, j, plainEnd)
          : -1;

      // A sequence element may be a compact single-pair mapping written without its braces —
      // `[ключ: значение]` — and there the `:` standing inside what looks like one scalar is the
      // separator.
      if (colon !== -1) {
        frame.key = plainKeyText(src, j, colon);
        j = colon + 1;
        canOpenQuote = true;
        continue;
      }

      // A node whose type a property settled keeps every byte of it, not just its first word.
      if (plainEnd > j) {
        if (!folded && !tagged && resolvesToString(src.slice(j, plainEnd))) {
          spans.push(
            new LocatedSpan(
              j,
              plainEnd,
              false,
              flowElementChain(frame, base),
              true,
              '',
              flowScalarSafe
            )
          );
        }

        j = plainEnd;
        canOpenQuote = false;
        continue;
      }
    }

    const tokenStart = j;

    while (j < n && !FLOW_STRUCTURAL.has(src[j])) {
      j += 1;
    }

    if (j === tokenStart) {
      j += 1;
    } else if ((awaitsKey(frame) || frame?.explicit) && keyStart === -1) {
      // Where the key began; the `:` branch above is what ends it.
      keyStart = tokenStart;
    }

    // `tagged` is deliberately left standing: this walk reads one word, and the node a property
    // settled may be several. The branches that consume a whole node clear it.
    canOpenQuote = false;
  }

  return -1;
}

// Structure is consumed whole — a flow collection is not line-structured, so walking its interior as
// YAML lines rejects a valid multi-line collection on the comma after an element and rescans the
// collection once per line it spans. Its quoted scalars are still values and still get typeset.
function flowCollectionEnd(src, pos, n, chain, spans, checkBudget, cursors) {
  const end = scanFlowCollection(src, pos, n, chain, spans, checkBudget, cursors);

  if (end === -1) {
    throw new MicroTypoInputError(`Unclosed YAML flow collection at offset ${pos}`, {
      details: { offset: pos }
    });
  }

  return end;
}

// `-`, `?` and `:` indicate only where what follows them separates; anywhere else they are content,
// which is what keeps the `:` of `http://arden.io` out of a key.
function separates(src, at, lineEnd) {
  return at === lineEnd || src[at] === ' ' || src[at] === '\t';
}

function findKeyColon(src, pos, lineEnd) {
  for (let j = pos; j < lineEnd; j += 1) {
    if (src[j] === ':' && separates(src, j + 1, lineEnd)) {
      return j;
    }
  }

  return -1;
}

export function scanYaml(src, checkBudget) {
  const spans = [];
  const n = src.length;
  let lines = 0;
  const stack = [{ indent: 0, chain: null, seqIndex: 0 }];
  // Seeded by the first flow collection and shared by every one after it: block-only YAML reaches no
  // `[` or `{` and must not pay for the searches, and one cache per document is what keeps a
  // document of many small collections out of quadratic time.
  let cursors = null;
  const delimiterCursors = () => (cursors ??= newDelimiterCursors(src));
  let pendingChain = null;
  // One value spread over the lines under the one that opened it. A block scalar's lines are its
  // content and get typeset; an explicit key's and a folded plain scalar's are a value already
  // settled elsewhere, so the run is walked past instead.
  let runIndent = -1;
  let runChain = null;
  let runTypeset = false;
  // A property written on a line of its own says a node follows and nothing about its style, which
  // stands on the next line, so the run's answer cannot be decided at the property.
  let runPendingNode = false;
  let runInclusive = false;
  // Where a block scalar's content actually begins, which is not the column its header stands in:
  // the header may name it outright with an indentation indicator, and otherwise the first non-empty
  // line under it settles it.
  let runBlockIndent = -1;
  // The string an explicit key spells, when it spells one: the `: value` line of the same entry has
  // no key text of its own and would otherwise address its value by an empty segment.
  let explicitKey = null;
  // Where that key's own text ends: the lines a folded quoted key covers are the key itself, not a
  // second line joining it.
  let explicitKeyEnd = -1;
  let skipTo = -1;
  // The scan resumed inside a line — past a flow collection, or past a quote that only closed further
  // down. What follows the jump is a tail, not a value, so no plain scalar is recognized there.
  let midLine = false;

  // Where the content of the line holding `pos` ends, the `\r` of a CRLF pair excluded.
  function lineContentEnd(pos) {
    const brk = src.indexOf('\n', pos);
    const stop = brk === -1 ? n : brk;

    return stop > pos && src[stop - 1] === '\r' ? stop - 1 : stop;
  }

  // How far a run bounded by `indent` reaches: the first non-blank line no more indented ends it. A
  // multi-line key is read inside its own run, since scanning to the end of the document for a
  // closing quote that may not be there costs the whole suffix once per line that opens a key.
  function runLimit(from, indent) {
    let lineStart = from;

    while (lineStart < n) {
      const end = lineContentEnd(lineStart);
      const p = skipSpaces(src, lineStart, end);

      if (p < end && p - lineStart <= indent) {
        return lineStart;
      }

      const brk = src.indexOf('\n', lineStart);

      if (brk === -1) {
        return n;
      }

      lineStart = brk + 1;
    }

    return n;
  }

  // The name an explicit key spells, or null where it spells none a path can carry, together with
  // where the key's own text ends — the lines it covers are the key, not a second line joining it.
  function simpleKeyText(kp, lineEnd, keyIndent) {
    if (kp >= lineEnd) {
      return { text: null, end: lineEnd };
    }

    if (src[kp] === '"' || src[kp] === "'") {
      // A quoted key may run over more than one line, and its own `:` then stands below the closing
      // quote, so this line alone cannot spell the name.
      const quoted =
        scanQuoted(src, kp, lineEnd) ?? scanQuoted(src, kp, runLimit(lineEnd + 1, keyIndent));

      if (!quoted) {
        return { text: null, end: lineEnd };
      }

      // A comment behind the key is not part of it, and is no reason to refuse the name.
      const stop = lineContentEnd(quoted.end);
      const after = skipSpaces(src, quoted.end, stop);
      const named = after === stop || (after > quoted.end && src[after] === '#');
      return {
        text: named ? quotedKeyName(src.slice(kp + 1, quoted.end - 1), src[kp]) : null,
        end: quoted.end
      };
    }

    const text = src.slice(kp, plainScalarEnd(src, kp, lineEnd));

    return { text: text !== '' && !PLAIN_INDICATOR.test(text) ? text : null, end: lineEnd };
  }

  // An anchor or a tag may stand in front of the value, and the block header behind it is still one.
  // A comment is not a node, so a property trailed by one still stands alone on its line.
  function afterNodeProperty(pos, lineEnd) {
    let p = pos;

    while (p < lineEnd && (src[p] === '&' || src[p] === '!')) {
      while (p < lineEnd && src[p] !== ' ' && src[p] !== '\t') {
        p += 1;
      }

      p = skipSpaces(src, p, lineEnd);
    }

    return p < lineEnd && src[p] === '#' ? lineEnd : p;
  }

  // The indicators a block header may carry after `|` or `>`: a chomping sign in either order and,
  // at most once, a digit naming the content's indentation relative to the node's own column. `-1`
  // says the header named none and the first non-empty line has to.
  function blockContentIndent(pos, lineEnd, indent) {
    for (let p = pos; p < lineEnd; p += 1) {
      const ch = src[p];

      if (ch >= '1' && ch <= '9') {
        return indent + (ch.codePointAt(0) - 0x30);
      }

      if (ch !== '+' && ch !== '-') {
        return -1;
      }
    }

    return -1;
  }

  function checkBlockScalar(pos, lineEnd, indent, chain) {
    const ch = src[pos];

    if (ch !== '|' && ch !== '>') {
      return false;
    }

    runIndent = indent;
    runChain = chain;
    runTypeset = true;
    runInclusive = false;
    runBlockIndent = blockContentIndent(pos + 1, lineEnd, indent);

    return true;
  }

  // The node a lone property introduces starts on a later line, so the run is claimed here and the
  // style is read where it is written. Everything a property settled keeps its bytes, a block scalar
  // excepted, because its content is literal text whatever stands in front of it.
  //
  // `inclusive` says where the node may stand: a property behind a colon leaves its node on a more
  // indented line, while a property written on a line of its own shares that line's indent with the
  // node under it.
  function claimPropertyRun(indent, chain, inclusive = false) {
    runIndent = indent;
    runChain = chain;
    runTypeset = false;
    runPendingNode = true;
    runInclusive = inclusive;
  }

  // A plain scalar carries prose often enough to be worth typesetting, and both halves of the rail
  // hold for it: the type must survive, which `resolvesToString` decides before the run, and the
  // result must still read as one plain scalar, which `plainScalarSafe` decides after it.
  //
  // `ownLine` says the value begins where the line's own indentation ends, which is what makes a
  // lone property share its column with the node under it. Behind a `-` the property stands past the
  // marker instead, and a run measured from the marker's column would swallow the next item.
  function recordPlainScalar(pos, lineEnd, indent, chain, ownLine = true) {
    // A block scalar header was read on this line and owns the run below it already.
    if (midLine || runIndent !== -1) {
      return;
    }

    // What kind of value this is answers both questions below, and it is read past the anchor or tag
    // that may stand in front of it. An indicator opens something that is not a plain scalar at all,
    // and none of those fold onto the lines under them, so none may claim a run.
    const valueStart = afterNodeProperty(pos, lineEnd);

    // The same lone property, reached without a colon in front of it: `title:` on one line and `&a`
    // on the next introduces its node exactly as `title: &a` does.
    if (valueStart >= lineEnd) {
      if (valueStart > pos) {
        claimPropertyRun(indent, chain, ownLine);
      }

      return;
    }

    if (PLAIN_INDICATOR.test(src[valueStart])) {
      return;
    }

    // A plain scalar that folds onto more-indented lines is one value this line-at-a-time scan
    // cannot rewrite in place, so the whole run is claimed rather than only the first line.
    if (foldsOntoNextLine(src, lineEnd, n, indent)) {
      runIndent = indent;
      runTypeset = false;

      return;
    }

    // An anchor or a tag in front of the scalar keeps the whole node byte-verbatim: the safety rail
    // for scalar styles this scan does not rewrite.
    if (valueStart !== pos) {
      return;
    }

    const end = plainScalarEnd(src, pos, lineEnd);

    if (resolvesToString(src.slice(pos, end))) {
      spans.push(new LocatedSpan(pos, end, false, chain, true, '', plainScalarSafe));
    }
  }

  function parseValueAfterColon(pos, lineEnd, chain, indent) {
    if (pos >= lineEnd || src[pos] === '#') {
      return false;
    }

    const ch = src[pos];

    if (ch === '"' || ch === "'") {
      const result = scanQuoted(src, pos, lineEnd);

      if (result) {
        assertNoTrailingLineTokens(src, result.end, lineEnd);
        spans.push(new LocatedSpan(pos, result.end, false, chain, result.eligible, ch));
      } else {
        skipTo = scanQuoted(src, pos, n)?.end ?? n;
      }

      return true;
    }

    // A property in front of a flow collection keeps the node's bytes, but the collection is still
    // read, or an unterminated one behind an anchor would be accepted where the same collection
    // without it is rejected. Its spans are dropped rather than collected.
    const valueStart = afterNodeProperty(pos, lineEnd);

    if (ch === '[' || ch === '{') {
      skipTo = flowCollectionEnd(src, pos, n, chain, spans, checkBudget, delimiterCursors());
    } else if (src[valueStart] === '[' || src[valueStart] === '{') {
      skipTo = flowCollectionEnd(src, valueStart, n, null, [], checkBudget, delimiterCursors());
    }

    checkBlockScalar(valueStart, lineEnd, indent, chain);

    if (valueStart >= lineEnd && valueStart > pos) {
      claimPropertyRun(indent, chain);

      return true;
    }

    recordPlainScalar(pos, lineEnd, indent, chain);

    return true;
  }

  // `indent` bounds what a bare value may claim below itself, `keyIndent` what a mapping value may.
  // They differ for a sequence item: `- |` puts the block scalar under the item, bounded by the `-`,
  // while `- body: |` puts it under the mapping that starts two columns in, where a sibling key is
  // not part of it.
  function parseKeyOrValue(pos, lineEnd, chain, indent, keyIndent = indent) {
    const ch = src[pos];
    // The name an explicit `? ` line spelled belongs to the one entry that line opened, and the `:`
    // half below is the only thing that may claim it, so it is cleared on every path rather than in
    // the bare-key branch alone.
    const pendingKey = explicitKey;

    explicitKey = null;

    // `? ` opens an explicit key, and a complex key is still a key: its content stays byte-for-byte,
    // so a flow collection there is consumed only to find where it ends, `findKeyColon` knowing
    // nothing of flow syntax. The question is asked here rather than at the head of the line, since
    // a `-` prefix answers nothing about what stands behind it.
    if (ch === '?' && separates(src, pos + 1, lineEnd)) {
      const kp = skipSpaces(src, pos + 1, lineEnd);

      if (kp < lineEnd && (src[kp] === '[' || src[kp] === '{')) {
        skipTo = flowCollectionEnd(src, kp, n, null, [], checkBudget, delimiterCursors());
      }

      // `? title` names its entry exactly as `title:` does: the `?` says where the key ends, not
      // that the key stopped being a string. Only a key that is one plain or quoted scalar can name
      // one, and the run below takes the name back the moment a line outside the key's own text
      // joins it.
      const named = simpleKeyText(kp, lineEnd, keyIndent);

      explicitKey = named.text;
      explicitKeyEnd = named.end;

      // An explicit key runs over every following, more-indented line, all of it key, so it is
      // skipped rather than scanned as content. The run is bounded by the key's own column and not
      // the container's, because the `:` of the same entry stands there.
      runIndent = keyIndent;
      runTypeset = false;
      pendingChain = chain;

      return false;
    }

    if (ch === '"' || ch === "'") {
      const result = scanQuoted(src, pos, lineEnd);

      if (!result) {
        skipTo = scanQuoted(src, pos, n)?.end ?? n;
        pendingChain = chain;

        return false;
      }

      const cp = skipSpaces(src, result.end, lineEnd);

      const isKeyHere = src[cp] === ':' && separates(src, cp + 1, lineEnd);

      if (!isKeyHere) {
        assertNoTrailingLineTokens(src, result.end, lineEnd);
        spans.push(new LocatedSpan(pos, result.end, false, chain, result.eligible, ch));

        return false;
      }

      const rawKey = src.slice(pos + 1, result.end - 1);
      const fullChain = chainAppend(chain, decodeQuotedKey(rawKey, ch));

      spans.push(new LocatedSpan(pos, result.end, true, fullChain, result.eligible, ch));
      pendingChain = fullChain;

      const vp = skipSpaces(src, cp + 1, lineEnd);

      return parseValueAfterColon(vp, lineEnd, fullChain, keyIndent);
    }

    // A node opening with `[` or `{` is a flow collection, decided before any search for a key colon,
    // because `findKeyColon` knows nothing of flow syntax and would return one from inside the
    // collection. A property in front of it does not change that, and its contents keep their bytes
    // as they do everywhere a property settled a type.
    const nodeStart = afterNodeProperty(pos, lineEnd);

    if (ch === '[' || ch === '{' || src[nodeStart] === '[' || src[nodeStart] === '{') {
      const opaque = nodeStart !== pos;

      skipTo = flowCollectionEnd(
        src,
        nodeStart,
        n,
        opaque ? null : chain,
        opaque ? [] : spans,
        checkBudget,
        delimiterCursors()
      );
      pendingChain = chain;

      return false;
    }

    const colon = findKeyColon(src, pos, lineEnd);

    if (colon === -1) {
      checkBlockScalar(afterNodeProperty(pos, lineEnd), lineEnd, indent, chain);
      recordPlainScalar(pos, lineEnd, indent, chain, keyIndent === indent);
      pendingChain = chain;

      return false;
    }

    // A line opening with `:` is the value half of an explicit entry, and its key stood on the `?`
    // line above, so the empty text in front of the colon is not its name.
    const written = plainKeyText(src, pos, colon);
    const fullChain = chainAppend(
      chain,
      written === '' && pendingKey !== null ? pendingKey : written
    );

    pendingChain = fullChain;

    const vp = skipSpaces(src, colon + 1, lineEnd);

    return parseValueAfterColon(vp, lineEnd, fullChain, keyIndent);
  }

  // `p` is where parsing resumes and `lineStart` where the physical line holding it begins. The two
  // part company whenever a construct was consumed mid-line — a flow collection standing where a key
  // belongs, a quoted scalar that closed further down — and only `lineStart` can measure the
  // indentation the container stack is keyed by.
  function processLine(p, lineEnd, indent, lineStart) {
    if ((src.startsWith('---', p) || src.startsWith('...', p)) && separates(src, p + 3, lineEnd)) {
      stack.length = 1;
      stack[0] = { indent: 0, chain: null, seqIndex: 0 };
      pendingChain = null;
      explicitKey = null;

      const vp = skipSpaces(src, p + 3, lineEnd);

      parseValueAfterColon(vp, lineEnd, null, 0);

      return;
    }

    while (stack.length > 1 && stack.at(-1).indent > indent) {
      stack.pop();
    }

    if (stack.at(-1).indent < indent) {
      stack.push({ indent, chain: pendingChain, seqIndex: 0 });
    }

    const frame = stack.at(-1);

    const marksItem = (at) => src[at] === '-' && separates(src, at + 1, lineEnd);

    if (marksItem(p)) {
      // A new sequence item is a new entry, so the name an explicit `?` opened above cannot reach
      // it. The `?` branch below sets it again for the item that does open one.
      explicitKey = null;

      // A compact sequence writes its nesting along one line, and every marker on it is a level: the
      // item a marker opens is what the next marker stands in, and the node itself begins past the
      // last of them.
      let holder = frame;
      let marker = p;
      let itemChain = null;
      let vp = p;

      for (;;) {
        itemChain = chainAppend(holder.chain, holder.seqIndex);
        holder.seqIndex += 1;
        vp = skipSpaces(src, marker + 1, lineEnd);

        if (vp >= lineEnd || !marksItem(vp)) {
          break;
        }

        // The nested sequence stands at its own marker's column, so a later line there continues it
        // rather than opening one of its own.
        holder = { indent: vp - lineStart, chain: itemChain, seqIndex: 0 };
        stack.push(holder);
        marker = vp;
      }

      if (vp >= lineEnd) {
        pendingChain = itemChain;
        explicitKey = null;

        return;
      }

      // A bare value hangs off the marker and is bounded by it; a mapping value is bounded by the
      // column of its own key. `- - |` and `- - body: |` end their block scalar in different places.
      if (parseKeyOrValue(vp, lineEnd, itemChain, marker - lineStart, vp - lineStart)) {
        pendingChain = itemChain;
      }

      return;
    }

    parseKeyOrValue(p, lineEnd, frame.chain, indent);
  }

  let i = 0;
  // Set when the walk jumps past a construct it consumed, so the next turn begins inside a line
  // rather than at one.
  let resumed = false;
  let lineStart = 0;
  let lineIndent = 0;

  while (i < n) {
    if ((lines++ & 0x3ff) === 0) {
      checkBudget?.('yaml-scan');
    }

    let lineEnd = src.indexOf('\n', i);

    if (lineEnd === -1) {
      lineEnd = n;
    }

    let end = lineEnd;

    if (end > i && src[end - 1] === '\r') {
      end -= 1;
    }

    const p = skipSpaces(src, i, end);

    // Indentation is a fact about the line, not about where the walk happens to stand in it.
    if (resumed) {
      lineStart = src.lastIndexOf('\n', i - 1) + 1;
      lineIndent = skipSpaces(src, lineStart, end) - lineStart;
      resumed = false;
    } else {
      lineStart = i;
      lineIndent = p - i;
    }

    const indent = lineIndent;
    const blank = p === end;

    midLine = i !== lineStart;

    const comment = !blank && src[p] === '#';

    if (runIndent !== -1) {
      // A header with no indentation indicator leaves the column to the first non-empty line under
      // it; one standing no deeper than the header itself means the block holds nothing at all.
      if (runTypeset && runBlockIndent === -1 && !blank && indent > runIndent) {
        runBlockIndent = indent;
      }

      // The two kinds of run answer this differently. Inside a block scalar there are no comments —
      // `#` is content like any other byte — so the content's own column decides every line. Outside
      // one the run keeps a node's bytes, and a comment is not that node: it stands at whatever
      // column its author chose and neither continues the run nor ends it. The next node does.
      const inside = runTypeset
        ? blank || (runBlockIndent !== -1 && indent >= runBlockIndent)
        : blank || comment || indent > runIndent || (runInclusive && indent === runIndent);

      if (inside) {
        // The first line of the node a lone property introduced is where its style is written, and
        // a block scalar header is not content of anything: the run restarts under it. A comment is
        // no node and neither is a second property, so neither answers and the run keeps waiting.
        if (!blank && runPendingNode && src[p] !== '#') {
          const node = afterNodeProperty(p, end);

          if (node < end) {
            runPendingNode = false;

            if (checkBlockScalar(node, end, indent, runChain)) {
              i = lineEnd < n ? lineEnd + 1 : lineEnd;
              continue;
            }
          }
        }

        // Block scalar content is literal: no escape, no wrapper to reproduce, and the block ends at
        // an outdent — which a span starting past the indentation cannot touch. So the line's text is
        // safe to typeset whole, and it is the one place in YAML where long prose actually lives.
        if (!blank && runTypeset) {
          spans.push(new LocatedSpan(p, end, false, runChain, true, ''));
        }

        // A key that runs onto a second line is not the string the `?` line spelled, so the name it
        // offered is taken back. A blank line and a comment are not that second line, and neither
        // are the lines a folded quoted key spans: those are the key, and its text ends past them.
        if (!blank && src[p] !== '#' && i >= explicitKeyEnd) {
          explicitKey = null;
        }

        i = lineEnd < n ? lineEnd + 1 : lineEnd;
        continue;
      }

      // The whole state of a finished run goes, not the part that ends it: a property whose run held
      // nothing but blank lines never got its node, and any flag left standing is read by the run
      // after it.
      runIndent = -1;
      runPendingNode = false;
      runInclusive = false;
      runBlockIndent = -1;
    }

    if (!blank && src[p] !== '#') {
      processLine(p, end, indent, lineStart);
    }

    if (skipTo !== -1) {
      i = skipTo;
      skipTo = -1;
      resumed = true;
      continue;
    }

    i = lineEnd < n ? lineEnd + 1 : lineEnd;
  }

  return spans;
}
