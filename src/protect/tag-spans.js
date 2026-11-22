import { VOID_TAG_NAMES } from '../lib/block-tags.js';
import { isTagNameStart } from '../lib/tag-name.js';

export const COMMENT_OPEN = '<!--';
export const COMMENT_CLOSE = '-->';

// The `-->` of `<!-->` or `<!--->`, which close on the opener's own dashes: HTML's tokenizer and
// CommonMark 0.31.2 §6.6 both read them as empty comments. -1 for any other opener.
export function emptyCommentClose(text, at) {
  const after = at + COMMENT_OPEN.length;

  if (text[after] === '>') {
    return after - 2;
  }

  return text[after] === '-' && text[after + 1] === '>' ? after - 1 : -1;
}

// Where the `-->` closing the comment opened at `at` starts, or -1 when the document never closes it.
export function commentCloseAt(text, at) {
  const empty = emptyCommentClose(text, at);

  return empty === -1 ? text.indexOf(COMMENT_CLOSE, at + COMMENT_OPEN.length) : empty;
}

// Whether `at` falls inside a tag the document closes with `>`, such as in a quoted attribute value,
// over `tagSpans()` output, whose `[start, end]` include the `>`. `at` only grows between calls, so
// `cursor` never moves back.
export function insideTag(text, tags, cursor, at) {
  while (cursor.i < tags.length && tags[cursor.i][1] < at) {
    cursor.i++;
  }

  const span = tags[cursor.i];

  return span !== undefined && span[0] < at && text[span[1]] === '>';
}

// What may end a tag name in HTML. A `/` there is ignored on a start tag of a non-void element, so
// `<script/>` opens raw text as `<script>` does — the answer SafeBlocks' HTML opener gives too, and
// the two readers of that question have to give one answer.
const NAME_END = ' \t\n\r\f/>';

function nameMatchesAt(text, at, name, terminators) {
  const end = at + name.length;

  for (let k = 0; k < name.length; k++) {
    const expected = name.codePointAt(k);
    const ch = text.codePointAt(at + k);

    // name is lower-case ASCII, so folding case is the 0x20 bit and nothing else.
    if (ch !== expected && (ch | 0x20) !== expected) {
      return false;
    }
  }

  return end >= text.length || terminators.includes(text[end]);
}

// Whether the tag name at `at` is `name`, lower-case ASCII.
export const namedAt = (text, at, name) => nameMatchesAt(text, at, name, NAME_END);

// The raw-text element that opens at `at`, or '' — no element is named by the empty string.
function rawTextNameAt(text, at, rawText, caseSensitive) {
  for (const name of rawText) {
    if (caseSensitive && !text.startsWith(name, at)) {
      continue;
    }
    if (nameMatchesAt(text, at, name, NAME_END)) {
      return name;
    }
  }

  return '';
}

// Where a tag ends, as HTML's tokenizer reads it, HTML §13.2.5.6–13.2.5.40. Its states, merged
// where they answer every character alike: before an attribute name, after a quoted value and after
// a `/` are one; inside an attribute name and after one are another. A quote opens a value only
// after `=`, and `<`, a quote or `=` anywhere else is a character of a name or an unquoted value.
//
// Declarations own literal `<` and quoted stretches, including PHP's `"<b>"`. In fragments an
// element's tag stops at an unquoted `<`.
export const DOCUMENT_READING = 0;
export const FRAGMENT_READING = 1;
export const MARKDOWN_READING = 2;

const NAME = 0;
const BEFORE_ATTR = 1;
const ATTR = 2;
const BEFORE_VALUE = 3;
const DOUBLE_QUOTED = 4;
const SINGLE_QUOTED = 5;
const UNQUOTED = 6;
const DECLARATION = 7;
const DECLARATION_DOUBLE = 8;
const DECLARATION_SINGLE = 9;
const STATES = 10;
const ENDED = -1;
const FAILED = -2;

// Indexed by state: the quote that closes a quoted state, '' for the rest, and the state that quote
// returns to. Read once per character, so an array rather than a map.
const CLOSING_QUOTE = ['', '', '', '', '"', "'", '', '', '"', "'"];
const AFTER_QUOTE = [0, 0, 0, 0, BEFORE_ATTR, BEFORE_ATTR, 0, 0, DECLARATION, DECLARATION];

const isSpace = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

function step(state, ch, fragment, markdown = false) {
  const quote = CLOSING_QUOTE[state];

  if (quote !== '') {
    return ch === quote ? AFTER_QUOTE[state] : state;
  }

  if (markdown && ch === '`' && state !== DECLARATION) {
    return FAILED;
  }

  if (ch === '>') {
    return ENDED;
  }

  if (ch === '<' && fragment && state !== DECLARATION) {
    return FAILED;
  }

  switch (state) {
    case NAME:
      return isSpace(ch) || ch === '/' ? BEFORE_ATTR : NAME;
    case BEFORE_ATTR:
      return isSpace(ch) || ch === '/' ? BEFORE_ATTR : ATTR;
    case ATTR:
      if (ch === '=') {
        return BEFORE_VALUE;
      }

      return ch === '/' ? BEFORE_ATTR : ATTR;
    case BEFORE_VALUE:
      if (isSpace(ch)) {
        return BEFORE_VALUE;
      }

      if (ch === '"') {
        return DOUBLE_QUOTED;
      }

      return ch === "'" ? SINGLE_QUOTED : UNQUOTED;
    case UNQUOTED:
      return isSpace(ch) ? BEFORE_ATTR : UNQUOTED;
    default:
      if (ch === '"') {
        return DECLARATION_DOUBLE;
      }

      return ch === "'" ? DECLARATION_SINGLE : DECLARATION;
  }
}

const opensDeclaration = (ch) => ch === '!' || ch === '?';
const firstState = (ch) => (opensDeclaration(ch) ? DECLARATION : NAME);

// The `>` ending the tag whose name starts at `at`; -1 when the text ends first, so the tag runs to
// its end; -2 when what opens there is no tag. Comments are read by their format's comment reader.
export function tagEnd(text, at, reading = DOCUMENT_READING, checkBudget, atomEnd) {
  const fragment = reading !== DOCUMENT_READING;
  const markdown = reading === MARKDOWN_READING;
  let state = firstState(text[at]);

  for (let i = at; i < text.length; i++) {
    if ((i & 0x3fff) === 0) {
      checkBudget?.('tag-end');
    }
    const atom = atomEnd?.(i) ?? -1;
    if (atom > i) {
      // An expression is one non-space atom; its quotes and `>` do not change the enclosing tag.
      state = step(state, 'x', fragment);
      i = atom - 1;
      continue;
    }
    const quote = CLOSING_QUOTE[state];

    if (quote !== '' && atomEnd === undefined) {
      const close = text.indexOf(quote, i);

      if (close === -1) {
        return -1;
      }

      i = close;
      state = AFTER_QUOTE[state];
      continue;
    }

    state = step(state, text[i], fragment, markdown);

    if (state === ENDED) {
      return i;
    }

    if (state === FAILED) {
      return FAILED;
    }
  }

  return -1;
}

export function quotedAttributeSpans(text, tags, checkBudget) {
  const quoted = [];
  for (const [start, end] of tags) {
    const from = start + (text[start + 1] === '/' ? 2 : 1);
    if (opensDeclaration(text[from])) {
      continue;
    }
    let state = firstState(text[from]);
    let open = -1;
    for (let at = from; at < Math.min(end, text.length); at += 1) {
      if ((at & 1023) === 0) {
        checkBudget?.('tag-quoted-values');
      }
      const before = CLOSING_QUOTE[state];
      state = step(state, text[at], false);
      const after = CLOSING_QUOTE[state];
      if (before === '' && after !== '') {
        open = at + 1;
      } else if (before !== '' && after === '') {
        quoted.push([open, at]);
        open = -1;
      }
    }
    if (open !== -1) {
      quoted.push([open, Math.min(end, text.length)]);
    }
  }
  return quoted;
}

// The vault's answer for every name start at or past `from` (a character behind `<` or `</`),
// indexed by that start, in one pass from the right: the outcome from each character is known for
// every state a run could arrive in, so a run from any start is looked up rather than walked. For a
// reader that goes on past a tag the text never ends, which walking from each later `<` would make
// quadratic.
export function tagEndsFrom(text, from, reading, checkBudget, atomEnd) {
  const fragment = reading !== DOCUMENT_READING;
  const markdown = reading === MARKDOWN_READING;
  const ends = new Int32Array(text.length);
  let row = new Int32Array(STATES).fill(-1);
  let next = new Int32Array(STATES);
  const atoms = new Map();
  const afterAtoms = new Map();
  if (atomEnd !== undefined) {
    for (let i = from; i < text.length; i++) {
      if ((i & 0x3fff) === 0) {
        checkBudget?.('tag-atoms');
      }
      const end = atomEnd(i);
      if (end > i) {
        atoms.set(i, end);
        afterAtoms.set(end, null);
      }
    }
  }

  for (let i = text.length - 1; i >= from; i--) {
    if ((i & 0x3fff) === 0) {
      checkBudget?.('tag-ends');
    }
    const ch = text[i];
    if (afterAtoms.has(i + 1)) {
      afterAtoms.set(i + 1, new Int32Array(row));
    }
    const atom = atoms.get(i);

    for (let state = 0; state < STATES; state++) {
      if (atom !== undefined) {
        next[state] = afterAtoms.get(atom)[step(state, 'x', fragment)];
        continue;
      }
      const to = step(state, ch, fragment, markdown);

      if (to === ENDED) {
        next[state] = i;
      } else {
        next[state] = to === FAILED ? FAILED : row[to];
      }
    }

    [row, next] = [next, row];

    if (text[i - 1] === '<' || (text[i - 1] === '/' && text[i - 2] === '<')) {
      ends[i] = row[firstState(ch)];
    }
  }

  return ends;
}

// HTML's lists for content inside `<svg>` and `<math>`, from the rules for parsing tokens in foreign
// content: the start tags that leave it, and the elements whose content is HTML again.
// prettier-ignore
const BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta',
  'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table',
  'tt', 'u', 'ul', 'var'
]);
const SVG_HTML = new Set(['foreignobject', 'desc', 'title']);
const MATHML_HTML = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

// What HTML's tree builder needs to know to close the HTML elements opened at an integration point,
// from the same parsing rules. Void elements open nothing, and the tree builder reads the legacy
// names among them as void too.
const VOID = new Set([...VOID_TAG_NAMES, 'basefont', 'bgsound', 'frame', 'image', 'keygen']);
// Elements whose end tag may be left out. An end tag of an element in `BLOCK` or `TABLE` closes
// those above its element; any other end tag passes over only the ones in `INLINE_OPTIONAL`.
const INLINE_OPTIONAL = new Set(['option', 'optgroup', 'rb', 'rp', 'rt', 'rtc']);
// prettier-ignore
const OPTIONAL = new Set([
  ...INLINE_OPTIONAL, 'p', 'li', 'dd', 'dt', 'caption', 'colgroup', 'tbody', 'thead', 'tfoot', 'tr',
  'td', 'th'
]);
// A start tag of one of these also closes an open `p`.
// prettier-ignore
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div',
  'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hgroup', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search',
  'section', 'summary', 'ul'
]);
const TABLE = new Set([
  'table',
  'caption',
  'colgroup',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'td',
  'th'
]);
// The open siblings a start tag closes.
const SIBLINGS = new Map([
  ['li', new Set(['li', 'p'])],
  ['dd', new Set(['dd', 'dt', 'p'])],
  ['dt', new Set(['dd', 'dt', 'p'])],
  ['option', new Set(['option'])],
  ['optgroup', new Set(['option'])],
  ['td', new Set(['td', 'th'])],
  ['th', new Set(['td', 'th'])],
  ['tr', new Set(['td', 'th', 'tr'])]
]);
// How many open elements an end tag looks through for the one it closes. Past it the tag is read as
// leaving foreign content or as closing nothing, which only keeps an element protected; the bound
// keeps a run of end tags that close nothing linear.
const REACH = 64;
const FOREIGN_RE = /<(?:svg|math)[\s/>]/i;
// Read anywhere in the tag rather than as attributes: a false match only reads a tag as HTML, where
// the slash is ignored and the element stays protected.
const FONT_BREAKOUT_RE = /color|face|size/i;
const ANNOTATION_HTML_RE = /text\/html|application\/xhtml\+xml/i;

// How a start tag reads where it stands. Raw text is a mode of HTML's own elements: inside SVG or
// MathML a `<script>` or a `<style>` is a foreign element whose content is markup like any other.
const HTML_ELEMENT = 0;
const FOREIGN_ELEMENT = 1;
const OPENS_NOTHING = 2;

function tagName(text, at) {
  let end = at;

  while (end < text.length && !NAME_END.includes(text[end])) {
    end++;
  }

  return text.slice(at, end).toLowerCase();
}

// Whether the start tag spanning `[start, gt]`, from its `<`, carries the self-closing flag: a `/`
// right before its `>` read where `tagEnd` reads it — behind a name or a quoted value, not inside an
// unquoted one, as in `<a href=x/>` or `<script src=a'/>`.
export function selfClosing(text, start, gt, atomEnd, checkBudget) {
  if (text[gt] !== '>' || text[gt - 1] !== '/') {
    return false;
  }

  let state = NAME;

  for (let i = start + 1; i < gt - 1; i++) {
    if ((i & 0x3fff) === 0) {
      checkBudget?.('tag-self-close');
    }
    const atom = atomEnd?.(i) ?? -1;
    if (atom > i && atom <= gt) {
      state = step(state, 'x', false);
      i = atom - 1;
      continue;
    }
    const quote = CLOSING_QUOTE[state];

    if (quote !== '' && atomEnd === undefined) {
      const close = text.indexOf(quote, i);

      if (close === -1 || close >= gt - 1) {
        return false;
      }

      i = close;
      state = AFTER_QUOTE[state];
      continue;
    }

    state = step(state, text[i], false);
  }

  return state === NAME || state === BEFORE_ATTR || state === ATTR;
}

// The SVG and MathML elements open at the scan's cursor, enough to tell whether a start tag is read
// as HTML or as a foreign element that a self-closing slash closes, and the HTML elements opened
// inside them at an integration point, whose end tag a browser ignores while one is open. HTML
// elements outside foreign content are not tracked. Wherever the reading is unsure it settles on
// HTML: that only keeps an element protected that a browser would have closed.
class ForeignContent {
  #stack = [];
  #open = new Map();
  #undo = null;
  #reads = null;
  #parents = [];
  #checkBudget;

  constructor(checkBudget) {
    this.#checkBudget = checkBudget;
  }

  #touch(depth) {
    this.#reads?.push(depth);
  }

  get #top() {
    this.#touch(this.#stack.length - 1);
    return this.#stack.at(-1);
  }

  get depth() {
    return this.#stack.length;
  }

  get mark() {
    return this.#reads?.length ?? 0;
  }

  begin() {
    this.#parents.push({ undo: this.#undo, reads: this.#reads });
    this.#undo = [];
    this.#reads = [];
  }

  finish(keep, through = this.#reads.length) {
    const undo = this.#undo;
    const reads = this.#reads;
    const parent = this.#parents.pop();
    this.#undo = null;
    const minimums = new Int32Array(through + 1).fill(0x7fffffff);
    for (let i = through - 1; i >= 0; i--) {
      if ((i & 0x3fff) === 0) {
        this.#checkBudget?.('foreign-dependencies');
      }
      minimums[i] = Math.min(minimums[i + 1], this.#reads[i]);
    }
    this.#reads = null;
    if (!keep) {
      for (let i = undo.length - 1; i >= 0; i--) {
        if ((i & 0x3fff) === 0) {
          this.#checkBudget?.('foreign-rollback');
        }
        const [push, frame] = undo[i];
        if (push) {
          this.#stack.push(frame);
          this.#open.get(frame.name).push(this.#stack.length - 1);
        } else {
          this.#pop();
        }
      }
    }
    this.#undo = parent.undo;
    this.#reads = parent.reads;
    if (keep && this.#undo !== null) {
      for (let i = 0; i < undo.length; i++) {
        if ((i & 0x3fff) === 0) {
          this.#checkBudget?.('foreign-commit');
        }
        this.#undo.push(undo[i]);
      }
    }
    if (this.#reads !== null) {
      for (let i = 0; i < reads.length; i++) {
        if ((i & 0x3fff) === 0) {
          this.#checkBudget?.('foreign-dependencies');
        }
        this.#reads.push(reads[i]);
      }
    }
    return minimums;
  }

  get context() {
    return this.#stack.at(-1) ?? null;
  }

  get #html() {
    return this.#top?.html ?? true;
  }

  // Whether `<![CDATA[` opens a CDATA section here rather than a bogus comment: HTML's tokenizer
  // asks whether the current node is an SVG or MathML element.
  get cdata() {
    const top = this.#top;

    return top !== undefined && !top.element;
  }

  // How the start tag reads here: as an HTML element, as a foreign one, or as opening nothing.
  start(text, nameStart, start, gt, atomEnd) {
    if (this.#html) {
      return this.#startHtml(text, nameStart, start, gt, atomEnd);
    }

    const name = tagName(text, nameStart);

    if (
      BREAKOUT.has(name) ||
      (name === 'font' && FONT_BREAKOUT_RE.test(text.slice(nameStart + 4, gt)))
    ) {
      this.#leave();

      return this.#startHtml(text, nameStart, start, gt, atomEnd);
    }

    const empty = selfClosing(text, start, gt, atomEnd, this.#checkBudget);

    if (!empty) {
      const top = this.#top;
      const svg = top.svg || (name === 'svg' && top.name === 'annotation-xml');
      const html = svg
        ? SVG_HTML.has(name)
        : MATHML_HTML.has(name) ||
          (name === 'annotation-xml' && ANNOTATION_HTML_RE.test(text.slice(nameStart, gt)));

      this.#push(name, svg, html, false);
    }

    return empty ? OPENS_NOTHING : FOREIGN_ELEMENT;
  }

  #startHtml(text, nameStart, start, gt, atomEnd) {
    const svg = nameMatchesAt(text, nameStart, 'svg', NAME_END);

    if (svg || nameMatchesAt(text, nameStart, 'math', NAME_END)) {
      if (!selfClosing(text, start, gt, atomEnd, this.#checkBudget)) {
        this.#push(svg ? 'svg' : 'math', svg, false, false);
      }
    } else if (this.#stack.length > 0) {
      this.#openHtml(tagName(text, nameStart));
    }

    return HTML_ELEMENT;
  }

  end(text, nameStart) {
    if (this.#stack.length === 0) {
      return;
    }

    const name = tagName(text, nameStart);

    const positions = this.#open.get(name);
    this.#touch(positions?.at(-1) ?? -1);
    if (!positions?.length) {
      if (!this.#html) {
        this.#leave();
      }

      return;
    }

    // With an HTML element on top HTML's own rules apply, and an end tag they cannot place closes
    // nothing. With a foreign one it closes the foreign element it names or leaves foreign content.
    const html = this.#top.element;
    const at = html
      ? this.#closes(name, BLOCK.has(name) || TABLE.has(name) ? OPTIONAL : INLINE_OPTIONAL)
      : this.#closes(name, null);

    if (at !== -1) {
      while (this.#stack.length > at) {
        this.#pop();
      }
    } else if (!html && !this.#html) {
      this.#leave();
    }
  }

  // Where the element an end tag closes sits in the stack, or -1. An HTML element is looked for
  // only past those in `skip`, a foreign one (`skip` null) only up to an HTML element.
  #closes(name, skip) {
    const html = skip !== null;
    const floor = Math.max(0, this.#stack.length - REACH);

    for (let k = this.#stack.length - 1; k >= floor; k--) {
      this.#touch(k);
      const frame = this.#stack[k];

      if (frame.element !== html) {
        return -1;
      }

      if (frame.name === name) {
        return k;
      }

      if (html && !skip.has(frame.name)) {
        return -1;
      }
    }

    return -1;
  }

  #openHtml(name) {
    const closes = SIBLINGS.get(name);

    while (this.#top.element && closes?.has(this.#top.name)) {
      this.#pop();
    }

    if (BLOCK.has(name) && this.#top.element && this.#top.name === 'p') {
      this.#pop();
    }

    if (!VOID.has(name)) {
      this.#push(name, false, true, true);
    }
  }

  #push(name, svg, html, element) {
    const frame = { name, svg, html, element };
    this.#stack.push(frame);
    this.#undo?.push([false, frame]);
    if (!this.#open.has(name)) {
      this.#open.set(name, []);
    }
    this.#open.get(name).push(this.#stack.length - 1);
  }

  #pop() {
    this.#touch(this.#stack.length - 1);
    const frame = this.#stack.pop();
    this.#undo?.push([true, frame]);

    this.#open.get(frame.name).pop();

    return frame;
  }

  #leave() {
    while (!this.#html) {
      this.#pop();
    }
  }
}

// The end tag that closes a raw-text element, or -1 when the document never closes it.
function rawTextClose(text, from, name, caseSensitive, checkBudget) {
  let i = from;

  while (i < text.length) {
    checkBudget?.('raw-text-close');
    const lt = text.indexOf('</', i);

    if (lt === -1) {
      return -1;
    }

    if (
      (!caseSensitive || text.startsWith(name, lt + 2)) &&
      nameMatchesAt(text, lt + 2, name, NAME_END)
    ) {
      return lt;
    }

    i = lt + 2;
  }

  return -1;
}

// One linear left-to-right scan with no backtracking, collecting each tag's `[start, end]` span as
// `tagEnd` reads it, so a `>` inside a quoted attribute value does not end the span early. A tag the
// text never ends runs to its end, where `end` is the length of the text and the scan stops.
//
// `rawText` names the elements whose content HTML parses as text and nothing else: inside one of
// them the tag grammar does not apply, so the scan jumps from the opener to its end tag. Read as
// ordinary markup, a quote in a script's own source opens an attribute value running past the
// element's end and every opener behind it stops being a tag span. An opener the document never
// closes is not raw text, because `SafeBlocks` does not protect that one either.
//
// Raw text is an HTML parsing mode, so with it the scan also follows `<svg>` and `<math>`: a start
// tag that closes itself there opens nothing, which its span says with a third element, `true`, and
// one of a raw-text name there is no raw text. A comment's span runs to its `-->`, so a tag inside
// one is no span, and a tag inside a CDATA section changes nothing there.
export function tagSpans(
  text,
  rawText,
  caseSensitive = false,
  readComment,
  mode = DOCUMENT_READING,
  opaque = []
) {
  const spans = [];
  const reader = tagSpanReader(text, rawText, caseSensitive, readComment, mode);
  const atomEnds = new Map(opaque.map(([start, end]) => [start, end]));
  const atomEnd = opaque.length === 0 ? undefined : (at) => atomEnds.get(at) ?? -1;
  let from = 0;
  let skip = 0;
  let candidate;
  while ((candidate = reader.next(from)) !== null) {
    while (skip < opaque.length && opaque[skip][1] <= candidate[0]) {
      skip += 1;
    }
    if (skip < opaque.length && opaque[skip][0] <= candidate[0]) {
      from = opaque[skip][1];
      continue;
    }
    const { span, after } = reader.read(candidate[0], undefined, atomEnd);
    if (span !== null) {
      spans.push(span);
    }
    from = after;
  }
  return spans;
}

// Searching never reads a candidate's body or changes foreign-content state. Only the winning
// owner calls read(); next() may resume behind another owner's opaque bytes.
export function tagSpanReader(
  text,
  rawText,
  caseSensitive = false,
  readComment,
  mode = DOCUMENT_READING,
  checkBudget
) {
  const n = text.length;
  const scanRaw = rawText !== undefined && rawText.size > 0;
  const foreign = scanRaw && FOREIGN_RE.test(text) ? new ForeignContent(checkBudget) : null;
  let quietUntil = 0;
  // A failed search applies at or beyond its source position, including after a rolled-back probe.
  const absentClosers = new Map();
  const ends = [null, null, null, null];
  const furthestSyntax = [-1, -1, -1, -1];
  let comments;
  const quietStack = [];

  return {
    get context() {
      return foreign?.context ?? null;
    },
    get scope() {
      const top = foreign?.context;
      return `${quietUntil}:${top == null ? '' : `${top.name}:${top.svg}:${top.html}:${top.element}`}`;
    },
    get depth() {
      return foreign?.depth ?? 0;
    },
    get mark() {
      return foreign?.mark ?? 0;
    },
    begin() {
      quietStack.push(quietUntil);
      foreign?.begin();
    },
    finish(keep, through) {
      const minimums = foreign?.finish(keep, through) ?? [0];
      const savedQuiet = quietStack.pop();
      if (!keep) {
        quietUntil = savedQuiet;
      }
      return minimums;
    },
    next(from) {
      for (let at = text.indexOf('<', from); at !== -1; at = text.indexOf('<', at + 1)) {
        checkBudget?.('tag-opener');
        const nameStart = at + (text[at + 1] === '/' ? 2 : 1);
        if (isTagNameStart(text.codePointAt(nameStart))) {
          return [at, at, at];
        }
      }
      return null;
    },
    read(start, tagClose, atomEnd, limit) {
      checkBudget?.('tag-read');
      const closing = text[start + 1] === '/';
      const nameStart = start + (closing ? 2 : 1);
      const readAtom = opensDeclaration(text[nameStart]) ? undefined : atomEnd;
      let i;
      const inline = limit !== undefined && !opensDeclaration(text[nameStart]);
      const syntaxMode = inline ? MARKDOWN_READING : mode;
      const flavor = (readAtom === undefined ? 0 : 1) + (inline ? 2 : 0);

      // Inside SVG or MathML a CDATA section is text up to its `]]>`, whatever tags, quotes and `>`
      // it holds, and its span says so.
      if (foreign?.cdata && start >= quietUntil && text.startsWith('<![CDATA[', start)) {
        const close = text.indexOf(']]>', start + 9);

        i = close === -1 ? n : close + 2;
      } else if (!closing && text.startsWith(COMMENT_OPEN, start)) {
        if (readComment === undefined && comments === undefined) {
          comments = new Map();
          let next = -2;
          for (
            let at = text.indexOf(COMMENT_OPEN);
            at !== -1;
            at = text.indexOf(COMMENT_OPEN, at + 1)
          ) {
            checkBudget?.('html-comment-ends');
            let close = emptyCommentClose(text, at);
            if (close === -1) {
              if (next !== -1 && next < at + COMMENT_OPEN.length) {
                next = text.indexOf(COMMENT_CLOSE, at + COMMENT_OPEN.length);
              }
              close = next;
            }
            comments.set(at, close);
          }
        }
        const close = readComment === undefined ? comments.get(start) : readComment(start);

        // One never closed: the scan goes on behind its opener, for a reader that takes it as text,
        // while in an HTML document the tail pass takes it, and nothing behind it opens SVG or
        // MathML.
        if (close === -1) {
          if (readComment === undefined) {
            quietUntil = n;
          }
          return { span: null, after: start + 1 };
        }

        i = close + COMMENT_CLOSE.length - 1;
      } else {
        if (start < furthestSyntax[flavor]) {
          ends[flavor] ??= tagEndsFrom(text, 0, syntaxMode, checkBudget, readAtom);
        }
        const gt =
          tagClose ??
          (ends[flavor] === null
            ? tagEnd(text, nameStart, syntaxMode, checkBudget, readAtom)
            : ends[flavor][nameStart]);
        furthestSyntax[flavor] = Math.max(furthestSyntax[flavor], gt === -1 ? n : gt);

        if (gt === FAILED) {
          return { span: null, after: start + 1 };
        }
        if (gt === -1) {
          ends[flavor] ??= tagEndsFrom(text, 0, syntaxMode, checkBudget, readAtom);
          if (opensDeclaration(text[nameStart])) {
            return { span: null, after: start + 1 };
          }
        }

        i = gt === -1 ? n : gt;
        if (limit !== undefined && i >= limit && !opensDeclaration(text[nameStart])) {
          return { span: null, after: start + 1 };
        }
      }

      let reading = HTML_ELEMENT;
      const mark = foreign?.mark ?? 0;

      if (foreign !== null && start >= quietUntil && !opensDeclaration(text[nameStart])) {
        if (closing) {
          foreign.end(text, nameStart);
        } else {
          reading = foreign.start(text, nameStart, start, i, readAtom);
        }
      }

      const span = reading === OPENS_NOTHING ? [start, i, true] : [start, i];
      i++;

      if (scanRaw && !closing && reading === HTML_ELEMENT) {
        const name = rawTextNameAt(text, nameStart, rawText, caseSensitive);

        if (name !== '' && i < (absentClosers.get(name) ?? Infinity)) {
          const close = rawTextClose(text, i, name, caseSensitive, checkBudget);

          if (close === -1) {
            absentClosers.set(name, i);
          } else {
            i = close;
          }
        }
      }
      const syntax = [];
      if (readAtom !== undefined) {
        for (let at = nameStart; at <= Math.min(span[1], n - 1); at++) {
          if ((at & 0x3fff) === 0) {
            checkBudget?.('tag-syntax');
          }
          const end = readAtom(at);
          if (end > at && end <= span[1] + 1) {
            syntax.push([at, end]);
            at = end - 1;
          }
        }
      }
      return { span, after: i, mark, syntax };
    }
  };
}
