import { randomBytes } from 'node:crypto';

import { capacityError, MAX_ENTRIES } from '../errors/index.js';
import { URL_REGEX, EMAIL_REGEX, IPV6_REGEX, UUID_REGEX } from '../lib/url-email-regex.js';

// Unknown ids are left intact, never blanked — silent erase enables defacement.

// Nonce is a captured group checked against the live instance nonce in restore(), so reset() is a cheap string swap, not a recompile.
const URL_RESTORE_RE = /http:\/\/simonenko\.xyz\/A0SAFE([0-9A-F]+)NUM(\d+)ID/gms;
const URL_RESTORE_NOPROTO_RE = /simonenko\.xyz\/A0SAFE([0-9A-F]+)NUM(\d+)ID/gms;
const EMAIL_RESTORE_RE = /A1SAFE([0-9A-F]+)NUM(\d+)ID@simonenko\.xyz/gms;
const TOKEN_RESTORE_RE = /AzSAFE([0-9A-F]+)TOK(\d+)TK/gms;
const SEQUENCE_HINT_RE = /[.:@-]/u;

function freshNonce() {
  return randomBytes(8).toString('hex').toUpperCase();
}

// Trailing ')' belongs to the URL only if balanced by an earlier '('; one count pass + one trim pass keeps this O(n).
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
  #nonce = freshNonce();

  // Fresh nonce per process(): a placeholder from a prior call can't match this call's restore(), even if replayed.
  reset() {
    this.#nonce = freshNonce();
    this.resetFrame();
  }

  // Clears the id namespace per scalar fragment so one field's placeholder ids can't be referenced by a sibling field's rule.
  resetFrame() {
    this.#urls = [];
    this.#emails = [];
    this.#tokens = [];
  }

  protect(text) {
    if (!SEQUENCE_HINT_RE.test(text)) {
      return text;
    }

    const nonce = this.#nonce;

    let result = text.replace(URL_REGEX, (m) => {
      if (this.#urls.length >= MAX_ENTRIES) {
        throw capacityError('SafeSequences: too many URLs in input', {
          kind: 'url',
          max: MAX_ENTRIES
        });
      }

      const url = trimUrlParens(m);
      const tail = m.slice(url.length);
      const id = this.#urls.length;
      this.#urls.push(url);

      return `http://simonenko.xyz/A0SAFE${nonce}NUM${id}ID${tail}`;
    });

    // EMAIL_REGEX always requires '@'; skipping the scan when it's absent is behavior-neutral.
    if (result.includes('@')) {
      result = result.replace(EMAIL_REGEX, (m) => {
        if (this.#emails.length >= MAX_ENTRIES) {
          throw capacityError('SafeSequences: too many emails in input', {
            kind: 'email',
            max: MAX_ENTRIES
          });
        }

        const id = this.#emails.length;
        this.#emails.push(m);

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
    if (this.#tokens.length >= MAX_ENTRIES) {
      throw capacityError('SafeSequences: too many tokens in input', {
        kind: 'token',
        max: MAX_ENTRIES
      });
    }

    const id = this.#tokens.length;
    this.#tokens.push(content);

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

  // Exposes token shapes for the forgery scrub without leaking content; matching ANY nonce is intentionally broad (the scrub only counts), and restore() still enforces the live-nonce gate.
  get restoreRegexes() {
    return [URL_RESTORE_RE, URL_RESTORE_NOPROTO_RE, EMAIL_RESTORE_RE, TOKEN_RESTORE_RE];
  }
}
