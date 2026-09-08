import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const paren = { html: true, render: { autolink: true } };
const html = { html: true, render: { paragraphs: false } };

describe('autolink paren trimming', () => {
  test('unbalanced closing paren stays out of href', () => {
    const out = microtypo('Эрик (см. http://amber.example/amber) далее', paren);
    assert.ok(!/href="[^"]*\)"/.test(out), out);
    assert.ok(out.includes('href="http://amber.example/amber"'), out);
  });

  test('balanced parens inside the path stay in href', () => {
    const out = microtypo('http://amber.example/a_(b) Корвин', paren);
    assert.ok(out.includes('href="http://amber.example/a_(b)"'), out);
  });

  test('trailing sentence dot is trimmed from href', () => {
    const out = microtypo('Corwin http://amber.example/pattern. Amber', paren);
    assert.ok(out.includes('href="http://amber.example/pattern"'), out);
  });
});

// The link text keeps raw bytes; the href attribute is escaped separately, so a query-string
// or local-part "&" must become "&amp;" inside href and stay single-escaped even with entities on.
describe('autolink href escaping', () => {
  test('query-string ampersand is escaped in href', () => {
    const out = microtypo('https://example.com/a?x=1&y=2', html);
    assert.ok(out.includes('href="https://example.com/a?x=1&amp;y=2"'), out);
    assert.ok(!/href="[^"]*&y=2/.test(out), out);
  });

  test('query-string ampersand with entities is not double-escaped', () => {
    const out = microtypo('https://example.com/a?x=1&y=2', { ...html, entities: true });
    assert.ok(out.includes('href="https://example.com/a?x=1&amp;y=2"'), out);
    assert.ok(!out.includes('&amp;amp;'), out);
  });

  test('mailto query-string ampersand is escaped in href', () => {
    const out = microtypo('mailto:corwin@example.com?subject=a&body=b', html);
    assert.ok(out.includes('href="mailto:corwin@example.com?subject=a&amp;body=b"'), out);
  });

  test('ampersand in bare-email local part is escaped in mailto href', () => {
    const out = microtypo('corwin&amber@example.com', html);
    assert.ok(out.includes('href="mailto:corwin&amp;amber@example.com"'), out);
  });

  test('bare-email ampersand with entities is escaped once', () => {
    const out = microtypo('corwin&amber@example.com', { ...html, entities: true });
    assert.ok(out.includes('href="mailto:corwin&amp;amber@example.com"'), out);
    assert.ok(!out.includes('&amp;amp;'), out);
  });

  test('url without ampersand is left unaffected', () => {
    const out = microtypo('https://example.com/amber', html);
    assert.ok(out.includes('href="https://example.com/amber"'), out);
  });

  // The URL vault swaps the address for a URL-shaped placeholder that autolink then re-matches, so a
  // rule matching only a prefix of it strands the rest as unrestorable internal text.
  test('a character right after a URL never strands vault machinery in the output', () => {
    const residue = /A0SAFE[0-9A-F]+NUM|A1SAFE[0-9A-F]+NUM|AzSAFE[0-9A-F]+TOK/;

    for (const after of ['"', "'", '“', '»', '`', ')', ';', ':', '=', '~', '#', '%', '&', '*']) {
      for (const before of ['', 'Корвин ', 'Корвин, ', '«']) {
        const input = `${before}https://amber.example/pattern${after}Арден`;
        const out = microtypo(input, html);

        assert.doesNotMatch(out, residue, `vault residue for ${JSON.stringify(input)}: ${out}`);
        assert.ok(
          out.includes('https://amber.example/pattern') ||
            out.includes('href="https://amber.example/pattern"'),
          `URL lost for ${JSON.stringify(input)}: ${out}`
        );
      }
    }
  });

  test('non-string href from a custom rule does not throw', () => {
    const typo = new MicroTypo({ html: true });
    typo.registerRuleGroup(
      { title: 'h', rules: [{ id: 'h', handler: (ctx) => ctx.tag('Амбер', 'a', { href: 5 }) }] },
      { name: 'h', position: 'end' }
    );
    const out = typo.process('Корвин');
    assert.ok(out.includes('href="5"'), out);
  });

  // A zone longer than four letters is an ordinary zone, and capping the scheme-less branch at four
  // leaves the whole URL unprotected.
  test('a scheme-less host with a long zone is protected whole', () => {
    const src = 'Смотри arden.technology/t?size=5x3&d=1990-2005&n=100000 сегодня';

    assert.equal(microtypo(src), src);
  });

  test('a scheme-less host with a short zone stays protected', () => {
    const src = 'Смотри arden.io/t?size=5x3 сегодня';

    assert.equal(microtypo(src), src);
  });

  // Consuming both boundaries gives the separator between two addresses to the first match and
  // leaves the second with no opening boundary of its own.
  test('two links parted by a single space are both linked', () => {
    const out = microtypo('https://amber.example http://arden.io', { html: true });

    assert.equal((out.match(/<a /g) ?? []).length, 2, out);
    assert.ok(!/[\u{E000}-\u{F8FF}]/u.test(out), `placeholder leaked: ${out}`);
    assert.equal(microtypo(out, { html: true }), out);
  });

  test('three links in a row are all linked', () => {
    const out = microtypo('https://amber.example http://arden.io https://rebma.example', {
      html: true
    });

    assert.equal((out.match(/<a /g) ?? []).length, 3, out);
  });

  test('two addresses parted by a single space are both linked', () => {
    const out = microtypo('corwin@amber.example random@arden.io', { html: true });

    assert.equal((out.match(/mailto:/g) ?? []).length, 2, out);
  });
});
