import {
  OPEN,
  CLOSE,
  PARAGRAPH_OPEN,
  PARAGRAPH_CLOSE,
  BREAKLINE,
  stripReservedPua
} from './placeholders.js';

// Every vault placeholder has this shape: PUA delimiters wrapping a letter prefix and a decimal id.
export const PLACEHOLDER_TOKEN_RE = new RegExp(`${OPEN}[A-Za-z]+\\d+${CLOSE}`, 'gu');

const PARAGRAPH_TOKEN_RE = new RegExp(
  [PARAGRAPH_OPEN, PARAGRAPH_CLOSE, BREAKLINE].map((t) => RegExp.escape(t)).join('|'),
  'g'
);

function countInto(text, re, into) {
  re.lastIndex = 0;

  for (const m of text.matchAll(re)) {
    into.set(m[0], (into.get(m[0]) ?? 0) + 1);
  }
}

// Budget forged placeholders by exact-string occurrence COUNT, not set membership: a rule may
// reuse and relocate a placeholder already in ctx.text (plus fresh mints in mintedTokens), but
// any occurrence beyond that count was forged by the rule and must be defused.
export function scrubForgedTokens(before, after, mintedTokens, sequenceRegexes) {
  if (before === after) {
    return after;
  }

  const allowed = new Map(mintedTokens);

  countInto(before, PLACEHOLDER_TOKEN_RE, allowed);
  countInto(before, PARAGRAPH_TOKEN_RE, allowed);

  for (const re of sequenceRegexes) {
    countInto(before, re, allowed);
  }

  const used = new Map();

  const consume = (token, neutralize) => {
    const cap = allowed.get(token) ?? 0;
    const seen = used.get(token) ?? 0;

    if (seen < cap) {
      used.set(token, seen + 1);

      return token;
    }

    return neutralize(token);
  };

  // Drop vault-placeholder forgeries outright, not PUA-stripped, so no bare "T0"/"B0" internal-id garbage survives.
  let result = after.replace(PLACEHOLDER_TOKEN_RE, (m) => consume(m, () => ''));

  result = result.replace(PARAGRAPH_TOKEN_RE, (m) => consume(m, stripReservedPua));

  for (const re of sequenceRegexes) {
    re.lastIndex = 0;
    result = result.replace(re, (m) => consume(m, () => ''));
  }

  return result;
}
