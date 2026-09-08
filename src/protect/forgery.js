import { PARAGRAPH_OPEN, PARAGRAPH_CLOSE, BREAKLINE, PLACEHOLDER_TOKEN } from './placeholders.js';

export const PLACEHOLDER_TOKEN_RE = new RegExp(PLACEHOLDER_TOKEN, 'gu');

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

// What one non-builtin group's run may keep, budgeted by exact-string occurrence COUNT rather than
// set membership: a rule may reuse and relocate a placeholder its input already carried, plus the
// ones the engine minted for it on the way, and any occurrence past that count it forged.
//
// One budget spans the whole run, not one call: `ctx.tag()` and `ctx.iblock()` vault what they are
// handed, where the scrub of the returned text can no longer read it, so the same token counted
// twice — once returned, once hidden — was the way to duplicate a protected block. Both draw here.
export class TokenBudget {
  #before;
  #allowed = null;
  #used = new Map();
  #sequenceRegexes;
  #touched = false;

  // Counting is deferred: the budget is opened around every non-builtin group, and a group that
  // neither mints nor hands anything back never makes anyone read it. Six passes over the text for a
  // rule that matched nothing is the cost this defers.
  constructor(before, sequenceRegexes) {
    this.#before = before;
    this.#sequenceRegexes = sequenceRegexes;
  }

  // Nothing has been minted and nothing scrubbed, so the run cannot have forged anything — the
  // caller may keep an unchanged result as it stands.
  get untouched() {
    return !this.#touched;
  }

  #budget() {
    if (this.#allowed === null) {
      this.#allowed = new Map();
      countInto(this.#before, PLACEHOLDER_TOKEN_RE, this.#allowed);
      countInto(this.#before, PARAGRAPH_TOKEN_RE, this.#allowed);

      for (const re of this.#sequenceRegexes) {
        countInto(this.#before, re, this.#allowed);
      }
    }

    return this.#allowed;
  }

  // A placeholder the engine itself just minted for this run, which its input could not have carried.
  mint(token) {
    const allowed = this.#budget();

    this.#touched = true;
    allowed.set(token, (allowed.get(token) ?? 0) + 1);
  }

  #consume(token, neutralize) {
    const cap = this.#budget().get(token) ?? 0;
    const seen = this.#used.get(token) ?? 0;

    if (seen < cap) {
      this.#used.set(token, seen + 1);

      return token;
    }

    return neutralize(token);
  }

  scrub(text) {
    this.#touched = true;

    // Every forgery is dropped whole, never PUA-stripped: what is left of a stripped token is its
    // internal name — a bare "T0"/"B0", or the "POP"/"PCL" a paragraph marker spells — and that is
    // engine bookkeeping standing in the document as text.
    let result = text.replace(PLACEHOLDER_TOKEN_RE, (m) => this.#consume(m, () => ''));

    result = result.replace(PARAGRAPH_TOKEN_RE, (m) => this.#consume(m, () => ''));

    for (const re of this.#sequenceRegexes) {
      re.lastIndex = 0;
      result = result.replace(re, (m) => this.#consume(m, () => ''));
    }

    return result;
  }
}
