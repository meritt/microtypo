import { MicroTypoInputError } from '../errors/index.js';
import { isFlowSpace } from '../lib/strings.js';
import { isTagNameStart } from '../lib/tag-name.js';

// Order matters: comment before pi so '<!--' is never split into '<' + '!--'.
export const xmlBlocks = [
  { id: 'xml-comment', open: '<!--', close: '-->' },
  { id: 'xml-cdata', open: '<![CDATA[', close: ']]>' },
  { id: 'xml-pi', open: '<?', close: '?>' }
];

const NAME_BODY_RE = /[^\s/>]/;

// Both walkers below ask the same thing of a `<`: which tag, opening or closing, and where its name
// ends. `null` means the `<` opens no tag, and the caller steps past it.
function readTagName(masked, i, n) {
  const isClose = masked[i + 1] === '/';
  const nameStart = isClose ? i + 2 : i + 1;

  // The first character decides whether there is a name here at all, and it is asked first: scanning
  // the whole run before rejecting it re-reads the same suffix from every `<` that opens nothing,
  // and this walk has no budget check of its own.
  //
  // The whole code point, not one UTF-16 unit: XML admits names from U+10000 upward, and half a
  // surrogate pair is not a letter.
  if (nameStart >= n || !isTagNameStart(masked.codePointAt(nameStart))) {
    return null;
  }

  let j = nameStart + 1;

  while (j < n && NAME_BODY_RE.test(masked[j])) {
    j += 1;
  }

  return { isClose, name: masked.slice(nameStart, j), end: j };
}

const ATTR_NAME_RE = /[^\s=/<>]/;

const NAMED_REF = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
const CHAR_REF_RE = /&(?:#(\d+)|#x([\da-fA-F]+)|(amp|lt|gt|quot|apos));/g;

// An attribute value means the characters its references stand for, and a literal tab or line break
// in one is a space, so `xml:space="pre&#115;erve"` normalizes to exactly `preserve`. XML §3.3.3.
//
// The result is compared with one word and never written back into the document, which is why a
// decoded reserved codepoint cannot reach the vault from here.
function normalizedAttrValue(raw) {
  return raw.replaceAll(/[\t\n\r]/g, ' ').replaceAll(CHAR_REF_RE, (full, dec, hex, named) => {
    if (named !== undefined) {
      return NAMED_REF[named];
    }

    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);

    return code <= 0x10ffff ? String.fromCodePoint(code) : full;
  });
}

function skipXmlSpace(masked, i, n) {
  let j = i;

  while (j < n && isFlowSpace(masked[j])) {
    j += 1;
  }

  return j;
}

// One walk over a tag's attributes, and the one place that decides where the tag ends: the validator
// and the preserve scanner have to agree on how far a malformed tag advances the cursor, or a
// document of unopened `<` is re-read from every one of them.
//
// The attributes are read as attributes rather than matched as one raw substring, where the answer
// could come from anywhere inside the tag: `note='xml:space="preserve"'` names an attribute called
// `note`, and `other-xml:space` is a different namespace.
function readTagAttributes(masked, from, n) {
  let j = from;
  let preserve = false;

  while (j < n) {
    const ch = masked[j];

    if (ch === '<' || ch === '>') {
      return { end: j, preserve, unterminated: false };
    }

    if (!ATTR_NAME_RE.test(ch)) {
      j += 1;
      continue;
    }

    const nameStart = j;

    while (j < n && ATTR_NAME_RE.test(masked[j])) {
      j += 1;
    }

    const name = masked.slice(nameStart, j);

    j = skipXmlSpace(masked, j, n);

    if (masked[j] !== '=') {
      continue;
    }

    j = skipXmlSpace(masked, j + 1, n);

    const quote = masked[j];

    if (quote !== '"' && quote !== "'") {
      continue;
    }

    const close = masked.indexOf(quote, j + 1);

    if (close === -1) {
      return { end: n, preserve, unterminated: true };
    }

    preserve ||=
      name === 'xml:space' && normalizedAttrValue(masked.slice(j + 1, close)) === 'preserve';
    j = close + 1;
  }

  return { end: n, preserve, unterminated: false };
}

function unterminated(construct, start) {
  return new MicroTypoInputError(`Unterminated XML ${construct} construct at offset ${start}`, {
    details: { offset: start, construct }
  });
}

function blockEnd(text, block, start, checkBudget) {
  const n = text.length;
  let i = start + block.open.length;
  let nextCheck = i + 0x4000;

  while (i <= n - block.close.length) {
    if (i >= nextCheck) {
      checkBudget?.(`${block.id}-scan`);
      nextCheck = i + 0x4000;
    }

    if (text.startsWith(block.close, i)) {
      return i + block.close.length;
    }

    i += 1;
  }

  throw unterminated(block.open, start);
}

// Closes on the first `>` at bracket depth 0 outside quotes: a `>` inside a quoted value or the
// `[...]` internal subset does not end the DOCTYPE.
export function doctypeEnd(text, start, checkBudget) {
  const n = text.length;
  let j = start + '<!DOCTYPE'.length;
  let depth = 0;
  let quote = '';
  // A threshold rather than a mask on `i`: a monotonic counter can alias past every check point,
  // while a threshold fires at least once per ~16K characters.
  let nextCheck = j + 0x4000;

  while (j < n) {
    if (j >= nextCheck) {
      checkBudget?.('xml-doctype-scan');
      nextCheck = j + 0x4000;
    }

    const c = text[j];

    if (quote) {
      if (c === quote) {
        quote = '';
      }

      j += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      j += 1;
      continue;
    }

    if (c === '<') {
      if (text.startsWith('<!--', j)) {
        j = blockEnd(text, xmlBlocks[0], j, checkBudget);
        continue;
      }

      if (text.startsWith('<?', j)) {
        j = blockEnd(text, xmlBlocks[2], j, checkBudget);
        continue;
      }
    }

    if (c === '[') {
      depth += 1;
      j += 1;
      continue;
    }

    if (c === ']') {
      if (depth > 0) {
        depth -= 1;
      }

      j += 1;
      continue;
    }

    if (c === '>' && depth === 0) {
      return j + 1;
    }

    j += 1;
  }

  throw unterminated('<!DOCTYPE', start);
}

export function scanDoctype(text, checkBudget) {
  if (!text.includes('<!DOCTYPE')) {
    return [];
  }

  const n = text.length;
  const spans = [];
  let i = 0;
  // A threshold rather than a mask on `i`: a match jumps `i` by a whole DOCTYPE span, so a fixed
  // mask could stride past every check.
  let nextCheck = 0;

  while (i < n) {
    if (i >= nextCheck) {
      checkBudget?.('xml-doctype-scan');
      nextCheck = i + 0x4000;
    }

    if (text[i] === '<' && text.startsWith('<!DOCTYPE', i)) {
      const end = doctypeEnd(text, i, checkBudget);
      spans.push([i, end]);
      i = end;
      continue;
    }

    i += 1;
  }

  return spans;
}

function maskXmlConstructs(text, checkBudget) {
  if (!text.includes('<!') && !text.includes('<?')) {
    return text;
  }

  const n = text.length;
  const chunks = [];
  let i = 0;
  let chunkStart = 0;
  let nextCheck = 0;

  while (i < n) {
    if (i >= nextCheck) {
      checkBudget?.('xml-construct-scan');
      nextCheck = i + 0x4000;
    }

    if (text[i] !== '<') {
      i += 1;
      continue;
    }

    let end = -1;

    if (text.startsWith('<!DOCTYPE', i)) {
      end = doctypeEnd(text, i, checkBudget);
    } else {
      const block = xmlBlocks.find(({ open }) => text.startsWith(open, i));

      if (block) {
        end = blockEnd(text, block, i, checkBudget);
      }
    }

    if (end === -1) {
      i += 1;
      continue;
    }

    chunks.push(text.slice(chunkStart, i), ' '.repeat(end - i));
    chunkStart = end;
    i = end;
  }

  if (chunks.length === 0) {
    return text;
  }

  chunks.push(text.slice(chunkStart));

  return chunks.join('');
}

export function validateXml(text, checkBudget) {
  const masked = maskXmlConstructs(text, checkBudget);
  const n = masked.length;
  const stack = [];
  let i = 0;

  while (i < n) {
    if (masked[i] !== '<') {
      i += 1;
      continue;
    }

    const tag = readTagName(masked, i, n);

    if (!tag) {
      i += 1;
      continue;
    }

    const { isClose, name } = tag;
    const attrs = readTagAttributes(masked, tag.end, n);
    const j = attrs.end;

    if (attrs.unterminated) {
      throw new MicroTypoInputError(`Unterminated attribute quote in XML tag at offset ${i}`, {
        details: { offset: i }
      });
    }

    if (masked[j] !== '>') {
      i = j;
      continue;
    }

    const selfClosing = masked[j - 1] === '/';

    if (isClose) {
      const top = stack.pop();

      if (top !== name) {
        throw new MicroTypoInputError(`Mismatched XML closing tag </${name}> at offset ${i}`, {
          details: { offset: i, name, expected: top ?? null }
        });
      }
    } else if (!selfClosing) {
      stack.push(name);
    }

    i = j + 1;
  }

  if (stack.length > 0) {
    throw new MicroTypoInputError(`Unclosed XML tag <${stack.at(-1)}> at end of document`, {
      details: { name: stack.at(-1) }
    });
  }
}

// Assumes well-formed input: `validateXml` runs first and has already thrown on anything malformed.
export function scanXmlSpacePreserve(text, checkBudget) {
  if (!text.includes('xml:space')) {
    return [];
  }

  const masked = maskXmlConstructs(text, checkBudget);
  const n = masked.length;
  const stack = [];
  const spans = [];
  let preserveDepth = -1;
  let preserveStart = 0;
  let i = 0;

  while (i < n) {
    if (masked[i] !== '<') {
      i += 1;
      continue;
    }

    const tag = readTagName(masked, i, n);

    if (!tag) {
      i += 1;
      continue;
    }

    const { isClose, name } = tag;
    const attrs = readTagAttributes(masked, tag.end, n);
    const j = attrs.end;

    // Past what has already been read, never one character on: a `<` that opens nothing is where the
    // next tag may start, and stepping into it re-read the whole suffix from every one of them.
    if (attrs.unterminated || masked[j] !== '>') {
      i = j;
      continue;
    }

    const selfClosing = masked[j - 1] === '/';
    const tagEnd = j + 1;

    if (isClose) {
      stack.pop();

      if (preserveDepth !== -1 && stack.length === preserveDepth) {
        spans.push([preserveStart, i]);
        preserveDepth = -1;
      }
    } else if (!selfClosing) {
      if (preserveDepth === -1 && attrs.preserve) {
        preserveDepth = stack.length;
        preserveStart = tagEnd;
      }

      stack.push(name);
    }

    i = tagEnd;
  }

  return spans;
}
