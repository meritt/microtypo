const NAMED = new Map([
  ['\u{A0}', '⍽'],
  ['\u{202F}', '⎵'],
  ['\r', '␍'],
  ['\t', '⇥']
]);

const INVISIBLE_RE = /[\u{A0}\u{202F}\r\t]|[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]|(?! )\p{Zs}|\p{Cs}/gu;

// A string as a reader can tell it apart: the two no-break spaces the engine emits under their own
// signs, every other character that shows nothing by its code point. A line break stays a line break.
export function visible(text) {
  return text.replaceAll(INVISIBLE_RE, (c) => {
    if (c === '\n') {
      return c;
    }

    return NAMED.get(c) ?? `⟨U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
}
