import { clearSpecialChars } from '../clear-special.js';
import { NAME_START } from '../lib/tag-name.js';
import { CLOSE, OPEN, TRANSPARENT_BARE_KINDS } from './placeholders.js';

// Only a body already made of nothing but white space and character references can decode to
// nothing, and the test that says so fails at the first ordinary glyph — so the decode below is
// reached by the bodies that are almost empty already, never by a page of code.
const REFERENCES_ONLY = /^(?:\s|&[#0-9A-Za-z]+;)+$/u;
const NUMERIC_REFERENCE = /&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));/g;

// The two parts of a body whose visibility is settled before this question is asked: a tag carries
// no words of its own, and a placeholder of a hidden kind stands for a region an earlier layer
// already found to show nothing. `[^<>]*` is the same bound the tag alternation elsewhere keeps —
// a `>` inside a quoted attribute value leaves the tag unrecognised here, which errs towards
// visible.
const OPAQUE_PART_RE = new RegExp(
  String.raw`${OPEN}[${TRANSPARENT_BARE_KINDS}]\d+${CLOSE}|<\/?[${NAME_START}!?][^<>]*>`,
  'gu'
);

function decodesToBlank(body) {
  if (body.trim() === '') {
    return true;
  }

  if (!REFERENCES_ONLY.test(body)) {
    return false;
  }

  const decoded = clearSpecialChars(body).replace(NUMERIC_REFERENCE, (whole, decimal, hex) => {
    const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);

    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

  return decoded.trim() === '';
}

// Whether a protected region shows the reader anything at all. Protection runs before normalisation,
// so the bytes here still spell their character references and `<code>&nbsp;</code>` shows nothing.
// Nothing decoded here is written back, so a numeric reference is a value to read rather than one to
// substitute, and the reserved band cannot reach the document through it.
//
// The question composes: a region built out of parts that each show nothing shows nothing too, which
// is what a `<notg>` holding a `<script>` the layer before already vaulted needs.
export function showsNothing(body) {
  if (decodesToBlank(body)) {
    return true;
  }

  return (
    (body.includes('<') || body.includes(OPEN)) && decodesToBlank(body.replace(OPAQUE_PART_RE, ''))
  );
}
