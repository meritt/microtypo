import { MicroTypoInputError } from '../errors/index.js';

// Order matters: comment before pi so '<!--' is never split into '<' + '!--'.
export const xmlBlocks = [
  { id: 'xml-comment', open: '<!--', close: '-->' },
  { id: 'xml-cdata', open: '<![CDATA[', close: ']]>' },
  { id: 'xml-pi', open: '<?', close: '?>' }
];

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

// Close on the first '>' at bracket-depth 0 outside quotes: a '>' inside a quoted value or the '[...]' internal subset doesn't end the DOCTYPE.
export function doctypeEnd(text, start, checkBudget) {
  const n = text.length;
  let j = start + '<!DOCTYPE'.length;
  let depth = 0;
  let quote = '';
  // Threshold, not an i-bitmask: a monotonic counter can alias past every check point; a threshold fires at least once per ~16K chars.
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
  // Threshold, not an i-bitmask: a match jumps i by a whole DOCTYPE span, so a fixed mask could stride past every budget check.
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

function scanXmlConstructs(text, checkBudget) {
  if (!text.includes('<!') && !text.includes('<?')) {
    return { masked: text, constructs: [], doctypes: [] };
  }

  const n = text.length;
  const constructs = [];
  const doctypes = [];
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
    let isDoctype = false;

    if (text.startsWith('<!DOCTYPE', i)) {
      end = doctypeEnd(text, i, checkBudget);
      isDoctype = true;
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

    const span = [i, end];
    constructs.push(span);

    if (isDoctype) {
      doctypes.push(span);
    }

    chunks.push(text.slice(chunkStart, i), ' '.repeat(end - i));
    chunkStart = end;
    i = end;
  }

  if (constructs.length === 0) {
    return { masked: text, constructs, doctypes };
  }

  chunks.push(text.slice(chunkStart));

  return {
    masked: chunks.join(''),
    constructs,
    doctypes
  };
}

export function maskConstructs(text, checkBudget) {
  return scanXmlConstructs(text, checkBudget).masked;
}

export function validateXml(text, checkBudget) {
  const { masked } = scanXmlConstructs(text, checkBudget);
  const n = masked.length;
  const stack = [];
  let i = 0;

  while (i < n) {
    if (masked[i] !== '<') {
      i += 1;
      continue;
    }

    const isClose = masked[i + 1] === '/';
    let j = isClose ? i + 2 : i + 1;
    const nameStart = j;

    while (j < n && /[^\s/>]/.test(masked[j])) {
      j += 1;
    }

    const name = masked.slice(nameStart, j);

    if (!name || !/^[A-Za-z]/.test(name)) {
      i += 1;
      continue;
    }

    let quote = '';

    while (j < n) {
      const ch = masked[j];

      if (quote) {
        if (ch === quote) {
          quote = '';
        }

        j += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        j += 1;
        continue;
      }

      if (ch === '<' || ch === '>') {
        break;
      }

      j += 1;
    }

    if (quote) {
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

const XML_SPACE_PRESERVE_RE = /\bxml:space\s*=\s*(["'])preserve\1/;

// Assumes well-formed input: validateXml runs first and would already have thrown on anything malformed.
export function scanXmlSpacePreserve(text, checkBudget) {
  if (!text.includes('xml:space')) {
    return [];
  }

  const { masked } = scanXmlConstructs(text, checkBudget);
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

    const isClose = masked[i + 1] === '/';
    let j = isClose ? i + 2 : i + 1;
    const nameStart = j;

    while (j < n && /[^\s/>]/.test(masked[j])) {
      j += 1;
    }

    const name = masked.slice(nameStart, j);

    if (!name || !/^[A-Za-z]/.test(name)) {
      i += 1;
      continue;
    }

    const attrsStart = j;
    let quote = '';

    while (j < n) {
      const ch = masked[j];

      if (quote) {
        if (ch === quote) {
          quote = '';
        }

        j += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        j += 1;
        continue;
      }

      if (ch === '<' || ch === '>') {
        break;
      }

      j += 1;
    }

    if (quote || masked[j] !== '>') {
      i += 1;
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
      if (preserveDepth === -1 && XML_SPACE_PRESERVE_RE.test(masked.slice(attrsStart, j))) {
        preserveDepth = stack.length;
        preserveStart = tagEnd;
      }

      stack.push(name);
    }

    i = tagEnd;
  }

  return spans;
}
