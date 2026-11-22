import { G } from './glyphs.js';
import { nowrap } from './nowrap-context.js';
import { ruleBudgetOf } from './rule-budget.js';

export const INDEFINITE_HEAD = 'кто|кем|когда|зачем|почему|как|что|чем|где|чего|кого';
export const INDEFINITE_TAIL = 'то|либо|нибудь';

const COLON_PHRASE = new RegExp(
  `(?:${INDEFINITE_HEAD})-?[ \\t${G.NBSP}]+-?(?:${INDEFINITE_TAIL}):`,
  'iuy'
);
const CHAIN_WORD = /[a-zа-яё]+/iuy;
export const INDEFINITE_COLON_REGEXES = [COLON_PHRASE, CHAIN_WORD];

// Only an NBSP chain may carry this colon inside a newly created nowrap: otherwise
// stripping its NBSP would hide the colon from dash.indefinite_pronoun on the next pass.
function attachedColon(text, start, checkBudget) {
  let at = start;
  let words = 0;

  while (text[at] === G.NBSP) {
    if ((++words & 1023) === 0) {
      checkBudget?.('nowrap-indefinite-colon');
    }
    COLON_PHRASE.lastIndex = at + 1;
    if (COLON_PHRASE.test(text)) {
      return text.slice(start, COLON_PHRASE.lastIndex);
    }
    CHAIN_WORD.lastIndex = at + 1;
    if (!CHAIN_WORD.test(text)) {
      break;
    }
    at = CHAIN_WORD.lastIndex;
  }

  return '';
}

export function nowrapWithIndefiniteColon(ctx, pattern, textOf) {
  const parts = [];
  const checkBudget = ruleBudgetOf(ctx);
  let end = 0;
  let matches = 0;

  for (const m of ctx.text.matchAll(pattern)) {
    if ((++matches & 1023) === 0) {
      checkBudget?.('nowrap-indefinite-colon');
    }
    const phraseStart = m.index + m[1].length;
    if (phraseStart < end) {
      continue;
    }
    const after = m.index + m[0].length;
    const suffix = attachedColon(ctx.text, after, checkBudget);

    parts.push(
      ctx.text.slice(end, phraseStart),
      nowrap(ctx, textOf(m) + suffix, ctx.text, phraseStart, after + suffix.length)
    );
    end = after + suffix.length;
  }
  if (parts.length > 0) {
    ctx.text = parts.join('') + ctx.text.slice(end);
  }
}
