import { G } from './glyphs.js';

const { LAQUO, RAQUO, BDQUO, LDQUO } = G;
// The English closing quote is read, but never emitted.
export const RDQUO = '\u{201D}';

export function matchingQuote(glyph) {
  if (glyph === LAQUO) {
    return RAQUO;
  }
  if (glyph === BDQUO) {
    return LDQUO;
  }
  if (glyph === LDQUO) {
    return RDQUO;
  }
  return null;
}

export function resolveAuthoredQuotePairs(buf, mayOpen, requireCompletePairs = false, visit) {
  // The closers due so far, innermost last: `»`, `“`, or the English `”`. A
  // `“` behind an open `„` closes it, as the engine's own output reads. It may yet be the opening
  // quote of an English pair written inside: the first such `“` at each depth that stands where a
  // quote opens is kept, and a `”` that finds no English pair open there takes it for its opener
  // and opens its `„` again. What stands between the two is balanced either way, so no role in
  // it changes.
  const open = [];
  const taken = [];
  const reopened = requireCompletePairs ? new Map() : null;
  const shut = (glyph) => {
    if (requireCompletePairs && open.at(-1) !== glyph) {
      return;
    }
    reopened?.delete(open.length);
    open.pop();
    taken.length = Math.min(taken.length, open.length + 1);
  };
  for (let i = 0; i < buf.length; i++) {
    visit?.();
    const ch = buf[i];
    if (ch === LAQUO) {
      open.push(matchingQuote(ch));
    } else if (
      ch === RDQUO &&
      taken[open.length] !== undefined &&
      !(requireCompletePairs && open.at(-1) === RDQUO)
    ) {
      // When indexing complete spans, an English frame already waiting for this closer
      // owns it. Reopening a completed German pair would borrow the following prose mark.
      const high = taken[open.length];
      buf[high] = '"';
      taken[open.length] = undefined;
      open.push(matchingQuote(BDQUO));
      if (requireCompletePairs) {
        reopened.set(open.length, high);
      }
      buf[i] = RAQUO;
    } else if (ch === RAQUO || ch === RDQUO) {
      shut(ch);
      buf[i] = RAQUO;
    } else if (ch === BDQUO) {
      open.push(matchingQuote(ch));
      buf[i] = LAQUO;
    } else if (ch === LDQUO) {
      if (open.at(-1) === LDQUO) {
        shut(ch);
        buf[i] = '"';
        if (taken[open.length] === undefined && mayOpen(i, true)) {
          taken[open.length] = i;
        }
        buf[i] = RAQUO;
      } else {
        buf[i] = '"';
        if (mayOpen(i, false)) {
          open.push(matchingQuote(ch));
        } else {
          shut(ch);
        }
      }
    }
  }
  // A closed local domain cannot lend an English closer to an already balanced German
  // pair unless the reopened German quotation also finds its closing mark in that domain.
  if (reopened !== null) {
    for (const high of reopened.values()) {
      visit?.();
      buf[high] = RAQUO;
    }
  }
}

// Annotate one domain (a paragraph, an address or a run of preserved references).
// Offsets and glyphs stay in the original spelling. Callers decide which spans belong to the
// domain and where a neutral quote may open. A boundary marked closeOnly can settle an
// existing level but cannot introduce an opening into that domain.
export function pairAuthoredQuotes(tokens, mayOpen, opensWithinPair, visibleRoles = false, visit) {
  const roles = visibleRoles
    ? null
    : tokens.map((token) => {
        visit?.();
        return token.glyph;
      });
  if (roles !== null) {
    resolveAuthoredQuotePairs(roles, mayOpen, true, visit);
  }
  pairQuoteTokens(tokens, roles, mayOpen, opensWithinPair, visit);
}

export function pairQuoteTokens(tokens, roles, mayOpen, opensWithinPair, visit) {
  const open = [];
  for (const [i, token] of tokens.entries()) {
    visit?.();
    const { glyph } = token;
    const top = open.at(-1);
    const straight = glyph === '"';
    // Visible prose can distinguish an English opener from the waiting German closer.
    // In an address the same role comes from the completed spans of its closed domain.
    const contextual = straight || (roles === null && glyph === LDQUO);
    const closes = contextual
      ? top?.closer === glyph && !opensWithinPair?.(i)
      : roles?.[i] === RAQUO;
    token.closer = matchingQuote(glyph);
    if (closes || token.closeOnly) {
      token.closer = null;
    } else if (straight && mayOpen(i, false)) {
      token.closer = glyph;
    }
    token.partner = null;
    token.outer = token.closer === null ? undefined : top;
    if (token.closer !== null) {
      open.push(token);
    } else if (top?.closer === glyph) {
      token.partner = top;
      top.partner = token;
      open.pop();
    }
  }
}
