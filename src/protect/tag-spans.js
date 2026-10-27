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
function rawTextNameAt(text, at, rawText) {
  for (const name of rawText) {
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
// Who asks decides the rest. `HTML_READING` is the browser's, for the scan that has to know where
// markup is: a comment runs to its `-->`, and `<!` or `<?` otherwise opens a bogus comment or a
// doctype ending at its first `>`. The tag vault only keeps a tag's bytes away from the rules and
// reads `<!` and `<?` as it always has: a quoted stretch holds its `>`, so `<?php echo "<b>"; ?>`
// stays whole, and a `<` before the `>` makes the opener no tag, so Markdown keeps a comment its
// paragraph does not close as text. Outside an HTML document, `FRAGMENT_READING`, an element's tag
// holds no `<` outside a quoted value either: neither CommonMark's raw HTML nor a value of a data
// format runs a stray `x<y` on through the text to the next `>`.
export const HTML_READING = 0;
export const DOCUMENT_READING = 1;
export const FRAGMENT_READING = 2;

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

function step(state, ch, fragment) {
  const quote = CLOSING_QUOTE[state];

  if (quote !== '') {
    return ch === quote ? AFTER_QUOTE[state] : state;
  }

  if (ch === '>') {
    return ENDED;
  }

  if (ch === '<' && (fragment || state === DECLARATION)) {
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
// its end; -2 when what opens there is no tag. A comment is the caller's to read in `HTML_READING`.
export function tagEnd(text, at, reading = HTML_READING) {
  if (reading === HTML_READING && opensDeclaration(text[at])) {
    return text.indexOf('>', at);
  }

  const fragment = reading === FRAGMENT_READING;
  let state = firstState(text[at]);

  for (let i = at; i < text.length; i++) {
    const quote = CLOSING_QUOTE[state];

    if (quote !== '') {
      const close = text.indexOf(quote, i);

      if (close === -1) {
        return -1;
      }

      i = close;
      state = AFTER_QUOTE[state];
      continue;
    }

    state = step(state, text[i], fragment);

    if (state === ENDED) {
      return i;
    }

    if (state === FAILED) {
      return FAILED;
    }
  }

  return -1;
}

// The vault's answer for every name start at or past `from` (a character behind `<` or `</`),
// indexed by that start, in one pass from the right: the outcome from each character is known for
// every state a run could arrive in, so a run from any start is looked up rather than walked. For a
// reader that goes on past a tag the text never ends, which walking from each later `<` would make
// quadratic.
export function tagEndsFrom(text, from, reading) {
  const fragment = reading === FRAGMENT_READING;
  const ends = new Int32Array(text.length);
  let row = new Int32Array(STATES).fill(-1);
  let next = new Int32Array(STATES);

  for (let i = text.length - 1; i >= from; i--) {
    const ch = text[i];

    for (let state = 0; state < STATES; state++) {
      const to = step(state, ch, fragment);

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
export function selfClosing(text, start, gt) {
  if (text[gt] !== '>' || text[gt - 1] !== '/') {
    return false;
  }

  let state = NAME;

  for (let i = start + 1; i < gt - 1; i++) {
    const quote = CLOSING_QUOTE[state];

    if (quote !== '') {
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

  get #html() {
    return this.#stack.length === 0 || this.#stack.at(-1).html;
  }

  // Whether `<![CDATA[` opens a CDATA section here rather than a bogus comment: HTML's tokenizer
  // asks whether the current node is an SVG or MathML element.
  get cdata() {
    const top = this.#stack.at(-1);

    return top !== undefined && !top.element;
  }

  // How the start tag reads here: as an HTML element, as a foreign one, or as opening nothing.
  start(text, nameStart, start, gt) {
    if (this.#html) {
      return this.#startHtml(text, nameStart, start, gt);
    }

    const name = tagName(text, nameStart);

    if (
      BREAKOUT.has(name) ||
      (name === 'font' && FONT_BREAKOUT_RE.test(text.slice(nameStart + 4, gt)))
    ) {
      this.#leave();

      return this.#startHtml(text, nameStart, start, gt);
    }

    const empty = selfClosing(text, start, gt);

    if (!empty) {
      const top = this.#stack.at(-1);
      const svg = top.svg || (name === 'svg' && top.name === 'annotation-xml');
      const html = svg
        ? SVG_HTML.has(name)
        : MATHML_HTML.has(name) ||
          (name === 'annotation-xml' && ANNOTATION_HTML_RE.test(text.slice(nameStart, gt)));

      this.#push(name, svg, html, false);
    }

    return empty ? OPENS_NOTHING : FOREIGN_ELEMENT;
  }

  #startHtml(text, nameStart, start, gt) {
    const svg = nameMatchesAt(text, nameStart, 'svg', NAME_END);

    if (svg || nameMatchesAt(text, nameStart, 'math', NAME_END)) {
      if (!selfClosing(text, start, gt)) {
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

    if (!this.#open.get(name)) {
      if (!this.#html) {
        this.#leave();
      }

      return;
    }

    // With an HTML element on top HTML's own rules apply, and an end tag they cannot place closes
    // nothing. With a foreign one it closes the foreign element it names or leaves foreign content.
    const html = this.#stack.at(-1).element;
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

    while (this.#stack.at(-1).element && closes?.has(this.#stack.at(-1).name)) {
      this.#pop();
    }

    if (BLOCK.has(name) && this.#stack.at(-1).element && this.#stack.at(-1).name === 'p') {
      this.#pop();
    }

    if (!VOID.has(name)) {
      this.#push(name, false, true, true);
    }
  }

  #push(name, svg, html, element) {
    this.#stack.push({ name, svg, html, element });
    this.#open.set(name, (this.#open.get(name) ?? 0) + 1);
  }

  #pop() {
    const frame = this.#stack.pop();

    this.#open.set(frame.name, this.#open.get(frame.name) - 1);

    return frame;
  }

  #leave() {
    while (!this.#html) {
      this.#pop();
    }
  }
}

// The end tag that closes a raw-text element, or -1 when the document never closes it.
function rawTextClose(text, from, name) {
  let i = from;

  while (i < text.length) {
    const lt = text.indexOf('</', i);

    if (lt === -1) {
      return -1;
    }

    if (nameMatchesAt(text, lt + 2, name, NAME_END)) {
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
export function tagSpans(text, rawText) {
  const spans = [];
  const n = text.length;
  const scanRaw = rawText !== undefined && rawText.size > 0;
  const foreign = scanRaw && FOREIGN_RE.test(text) ? new ForeignContent() : null;
  let quietUntil = 0;
  // The names this scan has already failed to find a closer for. `rawTextClose` reads forward from
  // the opener it is given and nothing else, and this walk's cursor only moves right, so a name
  // answered `-1` once is answered `-1` for every later opener. Per call and per name: nothing
  // crosses a document, and a name that does have a closer is looked up as before.
  let absentClosers;
  // Where the next `-->` starts, -1 once there is none; a start of -2 has not looked yet.
  let commentClose = -2;
  let i = 0;

  while (i < n) {
    i = text.indexOf('<', i);

    if (i === -1) {
      break;
    }

    let j = i + 1;
    const closing = text[j] === '/';

    if (closing) {
      j++;
    }

    if (!isTagNameStart(text.codePointAt(j))) {
      i++;
      continue;
    }

    const start = i;
    const nameStart = j;

    // Inside SVG or MathML a CDATA section is text up to its `]]>`, whatever tags, quotes and `>`
    // it holds, and its span says so.
    if (foreign?.cdata && start >= quietUntil && text.startsWith('<![CDATA[', start)) {
      const close = text.indexOf(']]>', start + 9);

      i = close === -1 ? n : close + 2;
    } else if (!closing && text.startsWith(COMMENT_OPEN, start)) {
      // A comment runs to its `-->`, which every comment after the first `-->` behind it shares,
      // so the search for it moves forward only.
      let close = emptyCommentClose(text, start);

      if (close === -1) {
        if (commentClose !== -1 && commentClose < start + COMMENT_OPEN.length) {
          commentClose = text.indexOf(COMMENT_CLOSE, start + COMMENT_OPEN.length);
        }

        close = commentClose;
      }

      // One never closed: the scan goes on behind its opener, for a reader that takes it as text,
      // while in an HTML document the tail pass takes it, and nothing behind it opens SVG or
      // MathML.
      if (close === -1) {
        quietUntil = n;
        i = start + 1;
        continue;
      }

      i = close + COMMENT_CLOSE.length - 1;
    } else {
      const gt = tagEnd(text, nameStart);

      i = gt === -1 ? n : gt;
    }

    let reading = HTML_ELEMENT;

    if (foreign !== null && start >= quietUntil && !opensDeclaration(text[nameStart])) {
      if (closing) {
        foreign.end(text, nameStart);
      } else {
        reading = foreign.start(text, nameStart, start, i);
      }
    }

    spans.push(reading === OPENS_NOTHING ? [start, i, true] : [start, i]);
    i++;

    if (scanRaw && !closing && reading === HTML_ELEMENT) {
      const name = rawTextNameAt(text, nameStart, rawText);

      if (name !== '' && !absentClosers?.has(name)) {
        const close = rawTextClose(text, i, name);

        if (close === -1) {
          (absentClosers ??= new Set()).add(name);
        } else {
          i = close;
        }
      }
    }
  }

  return spans;
}
