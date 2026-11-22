import { readScalarAt } from '../clear-special.js';
import { capacityError, MAX_ENTRIES } from '../errors/index.js';
import {
  BLOCK_TAG_NAMES,
  VOID_BLOCK_TAG_NAMES,
  VOID_TAG_NAMES,
  DEFAULT_SAFE_TAGS
} from '../lib/block-tags.js';
import {
  dashQuotePunctuation,
  isQuoteDash,
  insideQuoteWord,
  openingQuoteNeighbours,
  opensGluedCyrillic
} from '../lib/boundaries.js';
import { G } from '../lib/glyphs.js';
import { matchingQuote, pairAuthoredQuotes, RDQUO } from '../lib/quote-pairs.js';
import {
  URL_REGEX,
  URL_START_REGEX,
  URL_UNBRACKETED_START_REGEX,
  EMAIL_REGEX,
  IPV6_REGEX,
  UUID_REGEX
} from '../lib/url-email-regex.js';
import { couldOpen, digitBeforeQuote } from '../rules/quote-state.js';
import { CLOSE, OPEN, PLACEHOLDER_TOKEN } from './placeholders.js';
import { insideTag, namedAt, tagSpans } from './tag-spans.js';

// Unknown ids are left intact, never blanked — silent erase enables defacement.

// The nonce is a captured group checked against the live instance nonce in `restore()`, so `reset()`
// is a cheap string swap rather than a recompile.
// The URL host carries no '.': text.autolink ends a match on '.', so a dotted host lets it match a
// prefix of the placeholder, splitting an opaque token into an unrestorable half.
const URL_RESTORE_RE = /http:\/\/simonenko-xyz\/A0SAFE([0-9A-F]+)NUM(\d+)ID/gms;
const URL_RESTORE_NOPROTO_RE = /simonenko-xyz\/A0SAFE([0-9A-F]+)NUM(\d+)ID/gms;
const EMAIL_RESTORE_RE = /A1SAFE([0-9A-F]+)NUM(\d+)ID@simonenko\.xyz/gms;
const TOKEN_RESTORE_RE = /AzSAFE([0-9A-F]+)TOK(\d+)TK/gms;

// The four in one frozen list: the forgery budget asks for them once per non-builtin group run, and
// a getter building a fresh array made that a per-run allocation of a constant.
const RESTORE_REGEXES = Object.freeze([
  URL_RESTORE_RE,
  URL_RESTORE_NOPROTO_RE,
  EMAIL_RESTORE_RE,
  TOKEN_RESTORE_RE
]);
const SEQUENCE_HINT_RE = /[.:@-]/u;
const BLOCK_TOKEN_RE = new RegExp(PLACEHOLDER_TOKEN, 'gu');
const ADDRESS_LINK_RE =
  /<a href="((?:https?|ftps?|mailto):\/\/)([^\s<>"']{4,})">([^\s<>"']{4,})<\/a>/giu;
// The schemes `URL_REGEX` opens an address with; its other branches take one with none.
const SCHEME_RE = /^(?:https?|ftps?|mailto):/i;
// A scheme with nothing behind it but its slashes names no address, and `text.autolink` would make
// an empty link of it.
const BARE_SCHEME_RE = /^(?:https?|ftps?|mailto):\/*$/i;
// The character references an author may spell an address with: the five XML names and the numeric
// forms. Any other name stays as written.
const REFERENCE_RE = /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/g;
const NAMED_REFERENCES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

// Decoded once on the way into an `href`, which escapes every `&` it then holds: the browser follows
// the address the author meant, and no reference reaches it undecoded. The scheme is the literal
// text the address opens with, so a reference cannot spell one. A code point HTML has no character
// for decodes to U+FFFD, as a browser would decode it.
function decodeReferences(address) {
  return address.replace(REFERENCE_RE, (whole, name, decimal, hex) => {
    if (name !== undefined) {
      return NAMED_REFERENCES[name];
    }

    const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);

    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      ? '\u{FFFD}'
      : String.fromCodePoint(code);
  });
}

// Every whole placeholder, the nonce captured by kind. A URL core is whole with its scheme in front
// or with the link `text.autolink` opened around it, which takes the scheme into the `href`; a core
// with neither has been cut off from its scheme.
const WHOLE_RE = new RegExp(
  String.raw`(http:\/\/|<${OPEN}A\d+${CLOSE}>)?simonenko-xyz\/A0SAFE([0-9A-F]+)NUM\d+ID|A1SAFE([0-9A-F]+)NUM\d+ID@simonenko\.xyz|AzSAFE([0-9A-F]+)TOK\d+TK`,
  'g'
);
const SEALED_RE = new RegExp(`${OPEN}S(\\d+)${CLOSE}`, 'g');
// The parts of `WHOLE_RE` around the `SAFE` and nonce of a placeholder, read where they stand.
const URL_HOST = 'simonenko-xyz/';
const URL_LEAD_RE = new RegExp(String.raw`(?<=http:\/\/|<${OPEN}A\d+${CLOSE}>)`, 'y');
const URL_TAIL_RE = /NUM\d+ID/y;
const EMAIL_TAIL_RE = /NUM\d+ID@simonenko\.xyz/y;
const TOKEN_TAIL_RE = /TOK\d+TK/y;

function stickyAt(re, text, at) {
  re.lastIndex = at;
  return re.test(text);
}

// A URL placeholder behind its scheme.
export const URL_CORE_SOURCE = String.raw`simonenko-xyz\/A0SAFE[0-9A-F]+NUM\d+ID`;

// An address is a placeholder by the time e-mails are read, and an e-mail may hold every character of
// one but its `:`: the local part behind the address, the domain in front of it. E-mails are read in
// the stretches between the placeholders, so none takes a part of one.
const ADDRESS_PLACEHOLDER_RE = new RegExp(`(?:http:\\/\\/)?${URL_CORE_SOURCE}`, 'g');
const URL_CORE_HEAD = 'simonenko-xyz/A0SAFE';

// The placeholders `text.autolink` and `text.email` turn into links.
export const LINKABLE_SOURCE = String.raw`http:\/\/${URL_CORE_SOURCE}|A1SAFE[0-9A-F]+NUM\d+ID@simonenko\.xyz`;

// URL cores, cores cut off from their scheme, emails, tokens.
const holds = (found, now) =>
  now[0] >= found[0] && now[1] <= found[1] && now[2] >= found[2] && now[3] >= found[3];

// The namespace letter an id is minted under, and how a refusal names it to the caller.
const ENTRY_KINDS = Object.freeze({
  u: { name: 'URLs', reason: 'url' },
  e: { name: 'emails', reason: 'email' },
  t: { name: 'tokens', reason: 'token' }
});

// Web Crypto rather than `node:crypto`: the library runs in a browser too. One call fills bytes for
// 64 nonces, each byte spent once, since a short `process()` call otherwise pays mostly for this.
const randomPool = new Uint8Array(512);
let poolHex = '';
let poolAt = 0;

function freshNonce() {
  if (poolAt === poolHex.length) {
    poolHex = globalThis.crypto.getRandomValues(randomPool).toHex().toUpperCase();
    poolAt = 0;
  }

  const nonce = poolHex.slice(poolAt, poolAt + 16);

  poolAt += 16;

  return nonce;
}

// A trailing `)` belongs to the URL only where an earlier `(` balances it; one count pass and one
// trim pass keep this linear.
function trimUrlParens(url) {
  let open = 0;
  let close = 0;

  for (const ch of url) {
    if (ch === '(') {
      open++;
    } else if (ch === ')') {
      close++;
    }
  }

  let end = url.length;

  while (end > 0 && url[end - 1] === ')' && close > open) {
    close--;
    end--;
  }

  return url.slice(0, end);
}

// Once a `)` nothing opens is cut off, the address still ends where `URL_REGEX` lets one end: on
// the last `)` an earlier `(` balances, or on the last character it may end on, whichever is
// later. `www.ya.ru»)` is the address `www.ya.ru`, as `www.ya.ru")` is.
function urlIn(match) {
  const url = trimUrlParens(match);

  if (url === match) {
    return url;
  }

  URL_UNBRACKETED_START_REGEX.lastIndex = 0;

  let end = URL_UNBRACKETED_START_REGEX.exec(url)?.[0].length ?? 0;
  let open = 0;

  for (let i = 0; i < url.length; i++) {
    if (url[i] === '(') {
      open++;
    } else if (url[i] === ')' && --open >= 0 && i >= end) {
      end = i + 1;
    }
  }

  return url.slice(0, end);
}

const QUOTE_CONTEXT = /["«»„“”&<\u2029]|(?:\r\n|\r(?!\n)|\n)[ \t]*[\r\n]/gu;
const BLOCK_TAG = new RegExp(
  `^<\\/?(?:p|${[...BLOCK_TAG_NAMES, ...VOID_BLOCK_TAG_NAMES].join('|')})(?=[\\s/>])`,
  'iu'
);

// The tag lexer owns both ends, including quoted attributes and comments.
const NON_PROSE_TAG = new RegExp(
  `^</?(?:p|${[...BLOCK_TAG_NAMES, ...VOID_TAG_NAMES, ...DEFAULT_SAFE_TAGS, 'xmp', 'noembed', 'title'].join('|')})(?=[\\s/>])`,
  'iu'
);
function proseInlineTag(source, span) {
  const raw = source.slice(span[0], span[1] + 1);
  return raw.startsWith('<!--') || (/^<\/?[a-z]/iu.test(raw) && !NON_PROSE_TAG.test(raw));
}

// Raw offsets are retained for slicing the address and for reading neighbours in prose.
function addressQuoteTokens(source, tags) {
  const tokens = [];
  const tag = { i: 0 };
  let dashEnd = -1;
  const follow = { i: 0 };
  const nextInline = (at) => {
    insideTag(source, tags, follow, at);
    const span = tags[follow.i];
    if (span?.[0] !== at) {
      return at;
    }
    if (namedAt(source, at + 1, 'br') || BLOCK_TAG.test(source.slice(at, span[1] + 1))) {
      return -1;
    }
    return proseInlineTag(source, span) ? span[1] + 1 : at;
  };
  for (const match of source.matchAll(QUOTE_CONTEXT)) {
    const at = match.index;
    if (insideTag(source, tags, tag, at)) {
      continue;
    }
    if (match[0] === '<') {
      const span = tags[tag.i];
      if (span?.[0] !== at || !BLOCK_TAG.test(source.slice(at, span[1] + 1))) {
        continue;
      }
    }
    if (match[0] === '<' || match[0] === '\u2029' || match[0].length > 1) {
      tokens.push({ at, end: at + match[0].length, glyph: null });
      continue;
    }
    const { glyph, end } = readScalarAt(source, at, true);
    if (isQuoteDash(glyph)) {
      // References are read on their ampersand. A following quote sees that dash
      // while the address keeps its original physical offsets.
      dashEnd = end;
    } else if (
      matchingQuote(glyph) !== null ||
      glyph === '"' ||
      glyph === G.RAQUO ||
      glyph === RDQUO
    ) {
      let before = at;
      for (
        let j = tag.i - 1;
        j >= 0 && tags[j][1] + 1 === before && proseInlineTag(source, tags[j]);
        j--
      ) {
        before = tags[j][0];
      }
      const afterDash = dashEnd === before || isQuoteDash(source[before - 1]);
      const afterDashBoundary =
        afterDash &&
        (/\s/u.test(source[end] ?? ' ') || dashQuotePunctuation(source, end, G.MDASH, nextInline));
      tokens.push({
        at,
        end,
        glyph,
        afterDash,
        afterDashBoundary,
        internal: false,
        closer: null,
        partner: null
      });
    }
  }
  return tokens;
}

// A pending level may take a quote from a URL only when a later closing mark
// has not already settled that level. A whole terminal run can settle several.
function closesSpeech(opener, token, unpaired, openCount) {
  if (opener === undefined) {
    return false;
  }
  if (token.internal && token.run !== undefined && token.run === token.partner.run) {
    return token.glyph === '"' && token.remaining <= openCount - token.laterClosers;
  }
  const numericAlternative =
    !token.internal &&
    token.run !== undefined &&
    opener.partner?.measuredValue &&
    !opener.partner.alternative;
  if (
    token.inAddress &&
    !numericAlternative &&
    opener.partner?.at > token.at &&
    (unpaired === 0 || (token.run === undefined && opener.partner.run?.length > unpaired))
  ) {
    return false;
  }
  if (opener.closer === token.glyph) {
    return true;
  }
  return (
    (opener.glyph === '"' || token.glyph === '"') &&
    !token.internal &&
    (token.closer === null || token.glyph === '"') &&
    token.run !== undefined &&
    (numericAlternative ||
      opener.partner === null ||
      (unpaired > 0 && opener.partner.run === token.run))
  );
}

// A closing mark can move only within the same enclosing quotation. Walking back
// through a matched pair hides its outer candidates until we reach its opener.
function reserveProseClosers(tokens) {
  let available = [];
  let laterClosers = 0;
  for (let j = tokens.length - 1; j >= 0; j--) {
    const token = tokens[j];
    if (token.glyph === null) {
      available = [];
      laterClosers = 0;
      continue;
    }
    if (token.inAddress) {
      token.laterClosers = laterClosers;
    } else if (token.closer === null) {
      laterClosers++;
    } else {
      laterClosers = Math.max(0, laterClosers - 1);
    }
    if (token.internal || (token.inAddress && !token.run)) {
      continue;
    }
    if (token.closer !== null) {
      available = token.outside ?? [];
    } else if (token.partner) {
      const opener = token.partner;
      const later = available.at(-1)?.glyph;
      // A later explicit closing guillemet also settles a neutral prose opener.
      // Its address alternative keeps the same spelling across pass boundaries.
      if (
        (token.measurement && available.length > 0) ||
        (token.inAddress && (later === token.glyph || (opener.glyph === '"' && later === G.RAQUO)))
      ) {
        token.alternative = available.pop();
      }
      opener.outside = available;
      available = [];
    } else if (token.inAddress) {
      available = [];
    } else if (!token.measurement) {
      available.push(token);
    }
  }
}

function quotedAddresses(source, original, readsInches) {
  const tags = source.includes('<') ? tagSpans(source) : [];
  const tokens = addressQuoteTokens(source, tags);
  const tag = { i: 0 };
  let i = 0;
  let previousAddressEnd = 0;
  // A word, a number or punctuation may begin a quoted value. Match pairs inside each lexical
  // address independently of prose, including a closing mark the ordinary URL ending trims.
  for (const match of source.matchAll(URL_REGEX)) {
    if (insideTag(source, tags, tag, match.index)) {
      continue;
    }
    while (i < tokens.length && tokens[i].at < match.index) {
      i++;
    }
    const before = tokens[i - 1];
    if (before?.glyph === '"' && before.end === match.index && !before.inAddress) {
      // A word can end the preceding speech right before the next address. A delimiter
      // between two protected values has no such prose neighbour. Inspect only the
      // disjoint stretch after the preceding quote or URL with the existing mail lexer.
      const from = Math.max(previousAddressEnd, tokens[i - 2]?.end ?? 0);
      const left = source.slice(from, before.at);
      let emailEnd = -1;
      if (left.includes('@')) {
        for (const mail of left.matchAll(EMAIL_REGEX)) {
          emailEnd = mail.index + mail[0].length;
        }
      }
      before.beforeAddress = emailEnd !== left.length;
    }
    previousAddressEnd = match.index + match[0].length;
    const from = i;
    let limit = match.index + match[0].length;
    while (i < tokens.length && tokens[i].at <= limit && tokens[i].glyph !== null) {
      limit = Math.max(limit, tokens[i].end);
      i++;
    }
    if (i > from) {
      const region = tokens.slice(from, i);
      pairAuthoredQuotes(region, () => true);
      // A run of closing marks can have several spellings and lengths. Remember its
      // physical end so a mixed closer in the middle of a path cannot end the URL.
      let tail = limit;
      const run = { end: limit, length: 0 };
      for (let j = region.length - 1; j >= 0; j--) {
        const token = region[j];
        token.inAddress = true;
        token.internal = token.partner !== null;
        if (token.end === tail) {
          token.run = run;
          token.remaining = ++run.length;
          tail = token.at;
        }
      }
    }
  }

  // Match the remaining marks as prose. A completed pair in a query cannot close a citation
  // in the paragraph or supply an opener to another address.
  // A mark inside an alphanumeric run, e.g. the seconds in 20"N, can neither close
  // speech nor introduce another quotation unless quote.open_cyrillic can open there.
  // Address data stays under the address lexer, including character references.
  const speech = tokens.filter((token) => {
    if (token.inAddress || token.beforeAddress || token.glyph !== '"') {
      return true;
    }
    if (readsInches && digitBeforeQuote(source, token.at, false) !== -1) {
      let start = token.at - 1;
      while (start > 0 && digitBeforeQuote(source, start, false) !== -1) {
        start--;
      }
      const before = source[start - 1] ?? '';
      token.measurement = !insideQuoteWord(before, source[start]);
      token.measuredValue =
        (before === '/' || before === "'" || before === '′') &&
        digitBeforeQuote(source, start - 1, false) !== -1;
    }
    const left = source[token.at - 1] ?? '';
    const right = source[token.end] ?? '';
    return !insideQuoteWord(left, right) || opensGluedCyrillic(left, right);
  });
  let paragraph = [];
  let openers = [];
  // An address cannot hold a space, so an opener no mark in its body closes starts the speech
  // that a closer prose left unpaired ends, when nothing opened in prose encloses either.
  const claimSpeech = () => {
    const open = [];
    const pending = [];
    let next = 0;
    for (const token of paragraph) {
      while (next < openers.length && openers[next].at < token.at) {
        if (open.length === 0) {
          pending.push(openers[next]);
        }
        next++;
      }
      if (token.closer !== null) {
        open.push(token);
      } else if (token.partner !== null) {
        open.pop();
      } else if (
        !token.inAddress &&
        open.length === 0 &&
        matchingQuote(pending.at(-1)?.glyph) === token.glyph
      ) {
        pending.pop().speechStart = true;
      }
    }
    openers = [];
  };
  const finish = () => {
    const mayOpen = (index) => {
      const { at, end, inAddress, afterDash } = paragraph[index];
      const left = afterDash ? G.MDASH : (source[at - 1] ?? '');
      const next = source[end] ?? ' ';
      const previous = paragraph[index - 1];
      const touches = previous?.end === at;
      // The second mark in an opening run sees the first opener, including one that
      // was spelled as a reference. Its final semicolon is not punctuation in prose.
      return (
        (!inAddress &&
          paragraph[index].glyph === '"' &&
          (couldOpen(source, at, undefined, end, afterDash ? left : undefined) ||
            opensGluedCyrillic(source[at - 1] ?? '', next))) ||
        (!/\s/u.test(next) &&
          ((touches && !inAddress && !previous.inAddress && previous.closer !== null) ||
            openingQuoteNeighbours(touches ? previous.glyph : left, next)))
      );
    };
    pairAuthoredQuotes(
      paragraph,
      mayOpen,
      (index) => !paragraph[index].inAddress && mayOpen(index),
      true
    );
    for (const [index, token] of paragraph.entries()) {
      // A complete opener after a dash retains its partner. An unmatched one
      // at an outer separator is available to the pending quotation instead.
      if (
        !token.inAddress &&
        token.glyph === '"' &&
        token.partner === null &&
        token.afterDashBoundary
      ) {
        token.closer = null;
      }
      if (
        !token.inAddress &&
        token.glyph === G.LDQUO &&
        token.partner === null &&
        !mayOpen(index)
      ) {
        token.closer = null;
      }
    }
    claimSpeech();
    paragraph = [];
  };
  for (const token of speech) {
    if (token.glyph === null) {
      finish();
    } else if (!token.internal && (!token.inAddress || token.run !== undefined)) {
      token.closeOnly = token.inAddress;
      paragraph.push(token);
    } else if (token.inAddress && !token.internal && token.closer !== null && token.glyph !== '"') {
      openers.push(token);
    }
  }
  finish();

  reserveProseClosers(speech);

  // Only a mark at the physical end of the address can also end the paragraph's quotation.
  // With several eligible addresses the last compatible boundary closes it. A later explicit
  // partner already owns the ending; all earlier completed pairs remain in their URLs.
  const enclosing = [];
  // Exact partners take precedence. A mixed mark may share an exact partner's
  // final run only if another still-open level would otherwise have no closer.
  let unpaired = 0;
  for (const token of speech) {
    const opener = enclosing.at(-1);
    // A pending level without an exact partner has first claim on this closer.
    if (token.alternative && token.partner === opener && unpaired === 0) {
      opener.partner = token.alternative;
      token.alternative.partner = opener;
      token.partner = null;
      if (token.measurement) {
        continue;
      }
    }
    if (
      token.inAddress &&
      token.run !== undefined &&
      unpaired === 0 &&
      opener?.partner?.at > token.at &&
      !opener.partner.inAddress
    ) {
      token.addressEnd = true;
    }
    if (token.glyph === null) {
      enclosing.length = 0;
      unpaired = 0;
    } else if (!token.inAddress && token.closer !== null) {
      enclosing.push(token);
      if (token.partner === null) {
        unpaired++;
      }
    } else if (closesSpeech(opener, token, unpaired, enclosing.length)) {
      const shared = token.internal && (token.run === undefined || token.partner.run !== token.run);
      if (!shared || (token.end === token.run?.end && token.closer === null)) {
        if (opener.sharedEnd !== undefined) {
          opener.sharedEnd.speechEnd = false;
        }
        token.speechEnd = true;
        if (!shared) {
          enclosing.pop();
          if (opener.partner === null) {
            unpaired--;
          }
          continue;
        }
        opener.sharedEnd = token;
      }
    }
  }

  i = 0;
  tag.i = 0;
  return (address, at) => {
    while (i < tokens.length && tokens[i].at < at) {
      i++;
    }
    if (source[at] !== original[at] || insideTag(source, tags, tag, at)) {
      return address;
    }
    const limit = at + address.length;
    let pairedEnd = at;
    while (i < tokens.length && tokens[i].at <= Math.max(limit, pairedEnd)) {
      const token = tokens[i];
      // An encoded quote can be address data. A literal straight quote terminates the URL.
      if (token.glyph === null || source[token.at] === '"') {
        break;
      }
      // A sole compatible mark at the common end belongs to the enclosing quotation. Its
      // own later closer, or the second of two adjacent closers, settles an internal pair.
      if (token.speechEnd || token.speechStart) {
        if (token.at >= limit) {
          break;
        }
        URL_START_REGEX.lastIndex = 0;
        const usual = URL_START_REGEX.exec(source.slice(at, token.at))?.[0].length ?? 0;
        return original.slice(at, Math.max(at + usual, pairedEnd));
      }
      if (token.addressEnd || (token.internal && token.closer === null)) {
        pairedEnd = token.end;
      }
      if (token.at >= limit && !token.internal && !token.addressEnd) {
        break;
      }
      i++;
    }
    return original.slice(at, Math.max(limit, pairedEnd));
  };
}

export class SafeSequences {
  #urls = [];
  #emails = [];
  #tokens = [];
  // The same sequence twice is one entry and one placeholder, as in the tag vault: two ids would
  // make a Markdown reference label read as different text in its definition and in its use.
  #ids = new Map();
  #nonce = freshNonce();
  // The last text `keep` counted and what it found: one rule's output is the next one's input.
  #counted = null;
  #counts = null;

  // A fresh nonce per `process()`, so a placeholder from a prior call cannot match this call's
  // `restore()` even if replayed.
  reset() {
    this.#nonce = freshNonce();
    this.resetFrame();
  }

  // Whether a placeholder of this call still stands in `text`. The nonce is the call's own, so no
  // input holds it: one left in the output is an address or a token nothing put back.
  leftIn(text) {
    return text.includes(`SAFE${this.#nonce}`);
  }

  // The id namespace is cleared per scalar fragment, so one field's placeholder ids cannot be
  // referenced by a sibling field's rule.
  resetFrame() {
    this.#urls = [];
    this.#emails = [];
    this.#tokens = [];
    this.#ids.clear();
    this.#counted = null;
    this.#counts = null;
  }

  // `kind` keeps the three namespaces apart: the same bytes may be both a URL and a token. The
  // capacity bound sits here rather than at each caller so that no protect path can mint an id
  // without passing it; checked before the dedup lookup, so a repeat at capacity still refuses.
  #idOf(kind, entries, content) {
    if (entries.length >= MAX_ENTRIES) {
      const { name, reason } = ENTRY_KINDS[kind];

      throw capacityError(`SafeSequences: too many ${name} in input`, {
        kind: reason,
        max: MAX_ENTRIES
      });
    }

    const key = `${kind}${content}`;
    const known = this.#ids.get(key);

    if (known !== undefined) {
      return known;
    }

    const id = entries.length;
    entries.push(content);
    this.#ids.set(key, id);

    return id;
  }

  protectAddressLinks(text) {
    return text.includes('<a href="') ? this.#protectAddressLinks(text) : text;
  }

  // Markdown supplies two ordered lists of lexical boundaries: link destinations and the
  // outer edges of complete code spans. Quote roles still see the whole prose context.
  protect(text, syntax = [], checkBudget, readsInches = true, codeCuts) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    const source = codeCuts ? text : this.protectAddressLinks(text);
    const layout = typeof syntax === 'function' ? syntax(source, checkBudget) : null;
    const cuts = layout?.cuts ?? syntax;
    const context = { source, layout, readsInches, blocksVaulted: codeCuts !== undefined };
    if (cuts.length === 0 && !codeCuts?.length) {
      return this.#protect(source, context, 0);
    }

    const parts = [];
    let from = 0;

    let link = 0;
    let code = 0;
    while (link < cuts.length || code < (codeCuts?.length ?? 0)) {
      const at =
        (cuts[link] ?? Infinity) < (codeCuts?.[code] ?? Infinity) ? cuts[link++] : codeCuts[code++];
      if (at === from) {
        continue;
      }
      parts.push(this.#protect(source.slice(from, at), context, from));
      from = at;
    }

    parts.push(this.#protect(source.slice(from), context, from));

    return parts.join('');
  }

  protectTokens(text, pattern, accepts) {
    pattern.lastIndex = 0;
    return text.replace(pattern, (token) => (accepts(token) ? this.#storeToken(token) : token));
  }

  #protect(text, context, offset) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    if (context.blocksVaulted && text.includes(OPEN)) {
      // An address may touch an MDX tag or a hidden block. Its lexical range stops where
      // that opaque span starts, even when the original tag has already become a vault token.
      const parts = [];
      let from = 0;
      for (const token of text.matchAll(BLOCK_TOKEN_RE)) {
        parts.push(
          this.#protectAddresses(text.slice(from, token.index), context, offset + from),
          token[0]
        );
        from = token.index + token[0].length;
      }
      parts.push(this.#protectAddresses(text.slice(from), context, offset + from));
      return parts.join('');
    }
    return this.#protectAddresses(text, context, offset);
  }

  #protectAddresses(text, context, offset) {
    const nonce = this.#nonce;

    let result = text;
    const parts = [];
    let cursor = 0;
    for (const { 0: m, index: at } of result.matchAll(URL_REGEX)) {
      if (
        context.quoted === undefined &&
        (/[«»„“”&]/u.test(m) || /[»“”&]/u.test(result[at + m.length] ?? ''))
      ) {
        context.quoted = quotedAddresses(
          context.layout?.prose() ?? context.source,
          context.source,
          context.readsInches
        );
      }
      const url = urlIn(context.quoted === undefined ? m : context.quoted(m, offset + at));

      if (url === '' || BARE_SCHEME_RE.test(url)) {
        continue;
      }

      const id = this.#idOf('u', this.#urls, url);
      parts.push(result.slice(cursor, at), `http://simonenko-xyz/A0SAFE${nonce}NUM${id}ID`);
      cursor = at + url.length;
    }
    if (parts.length > 0) {
      parts.push(result.slice(cursor));
      result = parts.join('');
    }

    // EMAIL_REGEX always requires '@'; skipping the scan when it's absent is behavior-neutral.
    if (result.includes('@')) {
      result = this.#protectEmails(result);
    }

    // UUID before IPv6 keeps token ids deterministic when both appear in one input.
    // UUID_REGEX always requires '-'; IPV6_REGEX always requires ':'.
    if (result.includes('-')) {
      result = result.replace(UUID_REGEX, (m) => this.#storeToken(m));
    }

    if (result.includes(':')) {
      result = result.replace(IPV6_REGEX, (m) => this.#storeToken(m));
    }

    return result;
  }

  #protectEmails(text) {
    const nonce = this.#nonce;
    const stored = (m) => `A1SAFE${nonce}NUM${this.#idOf('e', this.#emails, m)}ID@simonenko.xyz`;
    const read = (stretch) =>
      stretch.includes('@') ? stretch.replace(EMAIL_REGEX, stored) : stretch;

    if (!text.includes(URL_CORE_HEAD)) {
      return read(text);
    }

    const parts = [];
    let cursor = 0;

    for (const m of text.matchAll(ADDRESS_PLACEHOLDER_RE)) {
      parts.push(read(text.slice(cursor, m.index)), m[0]);
      cursor = m.index + m[0].length;
    }

    parts.push(read(text.slice(cursor)));

    return parts.join('');
  }

  // A link in the form `text.autolink` writes, its text the address behind the scheme, holds an
  // address whatever the address looks like: the next pass reads it as the pass that wrote it did.
  #protectAddressLinks(text) {
    return text.replace(ADDRESS_LINK_RE, (m, scheme, href, body) => {
      if (decodeReferences(href) !== decodeReferences(body)) {
        return m;
      }

      const id = this.#idOf('u', this.#urls, `${scheme}${body}`);

      return `<a href="${scheme}${href}">simonenko-xyz/A0SAFE${this.#nonce}NUM${id}ID</a>`;
    });
  }

  #storeToken(content) {
    const id = this.#idOf('t', this.#tokens, content);

    return `AzSAFE${this.#nonce}TOK${id}TK`;
  }

  // In an `href` an address written without a scheme gets `http://`, as GFM links `www.` addresses;
  // written in a link with none, it would be a path relative to the page.
  restore(text, href = false, mapping) {
    const nonce = this.#nonce;
    const string = typeof text === 'string';
    let result = text;

    // Each of the restore patterns spells `SAFE`.
    if (string && !text.includes('SAFE')) {
      return text;
    }

    if (!string || this.#urls.length > 0) {
      URL_RESTORE_RE.lastIndex = 0;
      const urlReplacement = (m, n, id) => {
        const url = n === nonce ? this.#urls[Number(id)] : undefined;

        if (url === undefined || !href) {
          return url ?? m;
        }

        return SCHEME_RE.test(url) ? decodeReferences(url) : `http://${decodeReferences(url)}`;
      };
      result =
        mapping?.replace(result, URL_RESTORE_RE, urlReplacement) ??
        result.replace(URL_RESTORE_RE, urlReplacement);
      URL_RESTORE_NOPROTO_RE.lastIndex = 0;

      const coreReplacement = (m, n, id) => {
        if (n !== nonce) {
          return m;
        }

        const u = this.#urls[Number(id)];

        return u == null ? m : u.replace(/^[^:]+:\/\//, '');
      };
      result =
        mapping?.replace(result, URL_RESTORE_NOPROTO_RE, coreReplacement) ??
        result.replace(URL_RESTORE_NOPROTO_RE, coreReplacement);
    }

    if (!string || this.#emails.length > 0) {
      EMAIL_RESTORE_RE.lastIndex = 0;
      const emailReplacement = (m, n, id) => {
        const email = n === nonce ? this.#emails[Number(id)] : undefined;

        if (email === undefined || !href) {
          return email ?? m;
        }

        return decodeReferences(email);
      };
      result =
        mapping?.replace(result, EMAIL_RESTORE_RE, emailReplacement) ??
        result.replace(EMAIL_RESTORE_RE, emailReplacement);
    }
    if (!string || this.#tokens.length > 0) {
      TOKEN_RESTORE_RE.lastIndex = 0;
      const tokenReplacement = (m, n, id) => (n === nonce ? (this.#tokens[Number(id)] ?? m) : m);
      result =
        mapping?.replace(result, TOKEN_RESTORE_RE, tokenReplacement) ??
        result.replace(TOKEN_RESTORE_RE, tokenReplacement);
    }

    return result;
  }

  // A placeholder is text to the rules, so a rule that moves a word across markup can take part of
  // one along, and the rest no longer restores. A change that leaves fewer whole placeholders than
  // it found is made again on the text with each placeholder sealed into a vault-shaped token no
  // pattern matches inside, and dropped if it still does.
  keep(before, after, rerun, reject, mapping) {
    if (after === before || this.#urls.length + this.#emails.length + this.#tokens.length === 0) {
      return after;
    }

    const found = before === this.#counted ? this.#counts : this.#census(before);
    const now = this.#census(after);

    if (holds(found, now)) {
      return this.#remember(after, now);
    }

    const sealed = [];
    const sealEdits = mapping === undefined ? null : [];
    const nonce = this.#nonce;
    const text = before.replace(WHOLE_RE, (m, lead, url, email, token, at) => {
      if ((url ?? email ?? token) !== nonce) {
        return m;
      }

      const link = lead === undefined || lead === 'http://' ? '' : lead;

      sealed.push(m.slice(link.length));

      const replacement = `${link}${OPEN}S${sealed.length - 1}${CLOSE}`;
      sealEdits?.push({ start: at, end: at + m.length, text: replacement });
      return replacement;
    });
    if (mapping !== undefined) {
      mapping.seal(text, sealEdits);
    }
    const raw = rerun(text);
    const unsealEdits = mapping === undefined ? null : [];
    const again = raw.replace(SEALED_RE, (m, id, at) => {
      const replacement = sealed[Number(id)] ?? m;
      if (replacement !== m) {
        unsealEdits?.push({ start: at, end: at + m.length, text: replacement });
      }
      return replacement;
    });
    if (mapping !== undefined) {
      mapping.unseal(again, unsealEdits);
    }
    const kept = this.#census(again);

    if (holds(found, kept)) {
      return this.#remember(again, kept);
    }
    reject?.();
    return this.#remember(before, found);
  }

  #remember(text, counts) {
    this.#counted = text;
    this.#counts = counts;

    return text;
  }

  // The whole placeholders of this call `WHOLE_RE` finds in `text`, read from the `SAFE` and nonce
  // each one holds: no two of them overlap, and a hex run longer than the nonce is another call's.
  #census(text) {
    const head = `SAFE${this.#nonce}`;
    const counts = [0, 0, 0, 0];

    for (let at = text.indexOf(head); at !== -1; at = text.indexOf(head, at + head.length)) {
      const kind = at >= 2 && text[at - 2] === 'A' ? text[at - 1] : '';
      const tail = at + head.length;

      if (kind === '0') {
        const start = at - 2 - URL_HOST.length;
        if (start >= 0 && text.startsWith(URL_HOST, start) && stickyAt(URL_TAIL_RE, text, tail)) {
          counts[0] += 1;
          counts[1] += stickyAt(URL_LEAD_RE, text, start) ? 0 : 1;
        }
      } else if (kind === '1') {
        counts[2] += stickyAt(EMAIL_TAIL_RE, text, tail) ? 1 : 0;
      } else if (kind === 'z') {
        counts[3] += stickyAt(TOKEN_TAIL_RE, text, tail) ? 1 : 0;
      }
    }

    return counts;
  }

  // Token shapes for the forgery scrub, without the content. Matching any nonce is deliberately
  // broad, because the scrub only counts and `restore()` still enforces the live-nonce gate.
  get restoreRegexes() {
    return RESTORE_REGEXES;
  }
}
