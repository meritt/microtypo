import { capacityError, MAX_ENTRIES } from '../errors/index.js';
import { URL_REGEX, EMAIL_REGEX, IPV6_REGEX, UUID_REGEX } from '../lib/url-email-regex.js';
import { CLOSE, OPEN } from './placeholders.js';

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

// A URL placeholder behind its scheme.
export const URL_CORE_SOURCE = String.raw`simonenko-xyz\/A0SAFE[0-9A-F]+NUM\d+ID`;

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

  // `cuts` are ascending offsets no address or token runs across. Markdown gives the `](` of a link
  // and the `)` that closes its destination: an address may hold either, a bracketed IPv6 address
  // the `]`, and the link scanner would then not see the destination to protect.
  protect(text, cuts = []) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    if (cuts.length === 0) {
      return this.#protect(text);
    }

    const parts = [];
    let from = 0;

    for (const at of cuts) {
      parts.push(this.#protect(text.slice(from, at)));
      from = at;
    }

    parts.push(this.#protect(text.slice(from)));

    return parts.join('');
  }

  protectTokens(text, pattern, accepts) {
    pattern.lastIndex = 0;
    return text.replace(pattern, (token) => (accepts(token) ? this.#storeToken(token) : token));
  }

  #protect(text) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    const nonce = this.#nonce;

    let result = text.includes('<a href="') ? this.#protectAddressLinks(text) : text;

    result = result.replace(URL_REGEX, (m) => {
      const url = trimUrlParens(m);

      if (BARE_SCHEME_RE.test(url)) {
        return m;
      }

      const tail = m.slice(url.length);
      const id = this.#idOf('u', this.#urls, url);

      return `http://simonenko-xyz/A0SAFE${nonce}NUM${id}ID${tail}`;
    });

    // EMAIL_REGEX always requires '@'; skipping the scan when it's absent is behavior-neutral.
    if (result.includes('@')) {
      result = result.replace(EMAIL_REGEX, (m) => {
        const id = this.#idOf('e', this.#emails, m);

        return `A1SAFE${nonce}NUM${id}ID@simonenko.xyz`;
      });
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
  restore(text, href = false) {
    const nonce = this.#nonce;
    const string = typeof text === 'string';
    let result = text;

    if (!string || this.#urls.length > 0) {
      URL_RESTORE_RE.lastIndex = 0;
      result = result.replace(URL_RESTORE_RE, (m, n, id) => {
        const url = n === nonce ? this.#urls[Number(id)] : undefined;

        if (url === undefined || !href) {
          return url ?? m;
        }

        return SCHEME_RE.test(url) ? decodeReferences(url) : `http://${decodeReferences(url)}`;
      });
      URL_RESTORE_NOPROTO_RE.lastIndex = 0;

      result = result.replace(URL_RESTORE_NOPROTO_RE, (m, n, id) => {
        if (n !== nonce) {
          return m;
        }

        const u = this.#urls[Number(id)];

        return u == null ? m : u.replace(/^[^:]+:\/\//, '');
      });
    }

    if (!string || this.#emails.length > 0) {
      EMAIL_RESTORE_RE.lastIndex = 0;
      result = result.replace(EMAIL_RESTORE_RE, (m, n, id) => {
        const email = n === nonce ? this.#emails[Number(id)] : undefined;

        if (email === undefined || !href) {
          return email ?? m;
        }

        return decodeReferences(email);
      });
    }
    if (!string || this.#tokens.length > 0) {
      TOKEN_RESTORE_RE.lastIndex = 0;
      result = result.replace(TOKEN_RESTORE_RE, (m, n, id) =>
        n === nonce ? (this.#tokens[Number(id)] ?? m) : m
      );
    }

    return result;
  }

  // A placeholder is text to the rules, so a rule that moves a word across markup can take part of
  // one along, and the rest no longer restores. A change that leaves fewer whole placeholders than
  // it found is made again on the text with each placeholder sealed into a vault-shaped token no
  // pattern matches inside, and dropped if it still does.
  keep(before, after, rerun) {
    if (after === before || this.#urls.length + this.#emails.length + this.#tokens.length === 0) {
      return after;
    }

    const found = before === this.#counted ? this.#counts : this.#census(before);
    const now = this.#census(after);

    if (holds(found, now)) {
      return this.#remember(after, now);
    }

    const sealed = [];
    const nonce = this.#nonce;
    const text = before.replace(WHOLE_RE, (m, lead, url, email, token) => {
      if ((url ?? email ?? token) !== nonce) {
        return m;
      }

      const link = lead === undefined || lead === 'http://' ? '' : lead;

      sealed.push(m.slice(link.length));

      return `${link}${OPEN}S${sealed.length - 1}${CLOSE}`;
    });
    const again = rerun(text).replace(SEALED_RE, (m, id) => sealed[Number(id)] ?? m);
    const kept = this.#census(again);

    return holds(found, kept) ? this.#remember(again, kept) : this.#remember(before, found);
  }

  #remember(text, counts) {
    this.#counted = text;
    this.#counts = counts;

    return text;
  }

  #census(text) {
    const nonce = this.#nonce;
    const counts = [0, 0, 0, 0];
    WHOLE_RE.lastIndex = 0;

    for (let found; (found = WHOLE_RE.exec(text)) !== null;) {
      if (found[2] === nonce) {
        counts[0] += 1;
        counts[1] += found[1] === undefined ? 1 : 0;
      } else if (found[3] === nonce) {
        counts[2] += 1;
      } else if (found[4] === nonce) {
        counts[3] += 1;
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
