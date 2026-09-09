// A quoted key spelled with an escape names the field that escape decodes to: `"\x74itle"` and
// `"\U00000074itle"` both name `title`, so reading either back as its own source text names no field
// a selector can reach.
//
// The policy both formats share is what lives here rather than in either of them: an escape the
// format does not have leaves the key unreadable, and guessing at it would name the field something
// the document never spelled — so the raw text is the honest answer, whole.
//
// Only keys come through here, and a key is compared with a selector, never written back into the
// document — which is why a decoded reserved PUA codepoint cannot reach the vault from here.
export function decodeEscapes(raw, simple, hexWidths) {
  if (!raw.includes('\\')) {
    return raw;
  }

  let out = '';

  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '\\') {
      out += raw[i];
      continue;
    }

    const marker = raw[i + 1];
    const width = hexWidths[marker];

    if (width !== undefined) {
      const digits = raw.slice(i + 2, i + 2 + width);
      const code = /^[0-9a-fA-F]+$/.test(digits) ? Number.parseInt(digits, 16) : Number.NaN;

      if (!Number.isFinite(code) || digits.length !== width || code > 0x10ffff) {
        return raw;
      }

      out += String.fromCodePoint(code);
      i += 1 + width;
      continue;
    }

    if (!(marker in simple)) {
      return raw;
    }

    out += simple[marker];
    i += 1;
  }

  return out;
}
