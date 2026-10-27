import { MicroTypoInputError } from '../errors/index.js';
import { RESERVED_CHARS as RESERVED, RESERVED_PUA_CLASS } from './placeholders.js';

const RESERVED_TEST_RE = new RegExp(`[${RESERVED_PUA_CLASS}]`, 'u');
const RESERVED_RE = new RegExp(`[${RESERVED_PUA_CLASS}]`, 'gu');

const PUA_FIRST = 0xe000;
const PUA_LAST = 0xf8ff;

export function hasReserved(text) {
  return RESERVED_TEST_RE.test(text);
}

// The engine builds its placeholders out of the four reserved characters, so a document that
// carries them would forge placeholders. Each one present is swapped for a private-use character the
// fragment does not contain, which no rule reads differently from any other private-use character,
// and swapped back once the fragment is typeset. `null` when there is nothing to swap.
export function escapeReserved(text) {
  if (!hasReserved(text)) {
    return null;
  }

  const used = new Uint8Array(PUA_LAST - PUA_FIRST + 1);

  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i);

    if (code >= PUA_FIRST && code <= PUA_LAST) {
      used[code - PUA_FIRST] = 1;
    }
  }

  const forward = new Map();
  const back = new Map();
  let next = PUA_FIRST;

  for (const reserved of RESERVED) {
    if (!used[reserved.codePointAt(0) - PUA_FIRST]) {
      continue;
    }

    while (
      next <= PUA_LAST &&
      (used[next - PUA_FIRST] || RESERVED.includes(String.fromCodePoint(next)))
    ) {
      next++;
    }

    if (next > PUA_LAST) {
      throw new MicroTypoInputError(
        'Input uses too many distinct private-use characters to escape the reserved ones',
        { details: { reason: 'reserved-escape' } }
      );
    }

    const substitute = String.fromCodePoint(next++);

    forward.set(reserved, substitute);
    back.set(substitute, reserved);
  }

  const backRe = new RegExp(`[${[...back.keys()].join('')}]`, 'gu');

  return {
    text: text.replace(RESERVED_RE, (ch) => forward.get(ch)),
    unescape: (typeset) => typeset.replace(backRe, (ch) => back.get(ch))
  };
}
