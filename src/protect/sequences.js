import { randomBytes } from 'node:crypto';

import { capacityError, MAX_ENTRIES } from '../errors/index.js';
import { URL_REGEX, EMAIL_REGEX, IPV6_REGEX, UUID_REGEX } from '../lib/url-email-regex.js';

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

// The namespace letter an id is minted under, and how a refusal names it to the caller.
const ENTRY_KINDS = Object.freeze({
  u: { name: 'URLs', reason: 'url' },
  e: { name: 'emails', reason: 'email' },
  t: { name: 'tokens', reason: 'token' }
});

function freshNonce() {
  return randomBytes(8).toString('hex').toUpperCase();
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

  protect(text) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    const nonce = this.#nonce;

    let result = text.replace(URL_REGEX, (m) => {
      const url = trimUrlParens(m);
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

  #storeToken(content) {
    const id = this.#idOf('t', this.#tokens, content);

    return `AzSAFE${this.#nonce}TOK${id}TK`;
  }

  restore(text) {
    const nonce = this.#nonce;

    URL_RESTORE_RE.lastIndex = 0;
    let result = text.replace(URL_RESTORE_RE, (m, n, id) =>
      n === nonce ? (this.#urls[Number(id)] ?? m) : m
    );
    URL_RESTORE_NOPROTO_RE.lastIndex = 0;

    result = result.replace(URL_RESTORE_NOPROTO_RE, (m, n, id) => {
      if (n !== nonce) {
        return m;
      }

      const u = this.#urls[Number(id)];

      return u == null ? m : u.replace(/^[^:]+:\/\//, '');
    });

    EMAIL_RESTORE_RE.lastIndex = 0;
    result = result.replace(EMAIL_RESTORE_RE, (m, n, id) =>
      n === nonce ? (this.#emails[Number(id)] ?? m) : m
    );
    TOKEN_RESTORE_RE.lastIndex = 0;
    result = result.replace(TOKEN_RESTORE_RE, (m, n, id) =>
      n === nonce ? (this.#tokens[Number(id)] ?? m) : m
    );

    return result;
  }

  // Token shapes for the forgery scrub, without the content. Matching any nonce is deliberately
  // broad, because the scrub only counts and `restore()` still enforces the live-nonce gate.
  get restoreRegexes() {
    return RESTORE_REGEXES;
  }
}
