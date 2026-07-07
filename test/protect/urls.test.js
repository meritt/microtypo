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

  test('non-string href from a custom rule does not throw', () => {
    const typo = new MicroTypo({ html: true });
    typo.registerRuleGroup(
      { title: 'h', rules: [{ id: 'h', handler: (ctx) => ctx.tag('Амбер', 'a', { href: 5 }) }] },
      { name: 'h', position: 'end' }
    );
    const out = typo.process('Корвин');
    assert.ok(out.includes('href="5"'), out);
  });
});
