import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const paren = { html: true, render: { autolink: true } };
const html = { html: true, render: { paragraphs: false } };
const nowrap = (s) => `<span style="white-space:nowrap;">${s}</span>`;

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

describe('a scheme with nothing behind it is not an address (A25)', () => {
  test('makes no link', () => {
    assert.equal(microtypo('см. https:// тут', { html: true }), '<p>см.\u{00A0}https:// тут</p>');
    assert.equal(microtypo('http://', { html: true }), '<p>http://</p>');
    assert.equal(microtypo('ftp:// и всё', { html: true }), '<p>ftp:// и\u{00A0}всё</p>');
    assert.equal(microtypo('(https://) тут', { html: true }), '<p>(https://) тут</p>');
  });

  test('one character behind the scheme is an address', () => {
    assert.equal(
      microtypo('см. https://a тут', { html: true }),
      '<p>см.\u{00A0}<a href="https://a">a</a> тут</p>'
    );
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

  test('an ampersand that starts a character reference is not escaped again in href', () => {
    assert.equal(
      microtypo('http://arden.technology/?a=1&amp;b=2', html),
      '<a href="http://arden.technology/?a=1&amp;b=2">arden.technology/?a=1&amp;b=2</a>'
    );
    assert.equal(
      microtypo('http://arden.technology/?a=1&#38;b=2&#x26;c=3', html),
      '<a href="http://arden.technology/?a=1&amp;b=2&amp;c=3">arden.technology/?a=1&#38;b=2&#x26;c=3</a>'
    );
  });

  test('a character reference in an href a custom rule gives is escaped like any other text', () => {
    const typo = new MicroTypo({ html: true });
    typo.registerRuleGroup(
      {
        title: 'h',
        rules: [
          {
            id: 'h',
            handler: (ctx) => ctx.tag('Амбер', 'a', { href: '&#106;avascript:x&amp;y' })
          }
        ]
      },
      { name: 'h', position: 'end' }
    );

    assert.equal(typo.process('Корвин'), '<a href="&amp;#106;avascript:x&amp;amp;y">Амбер</a>');
  });

  test('a character reference in prose stays as written', () => {
    assert.equal(microtypo('AT&amp;T и Корвин', html), 'AT&amp;T и\u{00A0}Корвин');
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

  test('a nowrap wrapper next to an address takes in none of it', () => {
    const cases = [
      [
        'о 15.04.10\u{00A0}https://sub.domain.co.uk/a-b',
        `<p>${nowrap('о 15.04.10')}\u{00A0}<a href="https://sub.domain.co.uk/a-b">sub.domain.co.uk/a-b</a></p>`
      ],
      [
        'https://www.example.com/t?n=100000\u{00A0}и тд',
        `<p><a href="https://www.example.com/t?n=100000">www.example.com/t?n=100000</a>\u{00A0}${nowrap('и т. д.')}</p>`
      ],
      [
        'oberon@почта.рф\u{00A0}09.10.19',
        `<p><a href="mailto:oberon@почта.рф">oberon@почта.рф</a>\u{00A0}${nowrap('09.10.19')}</p>`
      ],
      [
        'нэ.\u{00A0}corwin.amber@mail.example.org',
        `<p>${nowrap('н. э.')}\u{00A0}<a href="mailto:corwin.amber@mail.example.org">corwin.amber@mail.example.org</a></p>`
      ],
      [
        '123e4567-e89b-12d3-a456-426614174000\u{00A0}09.10.19',
        `<p>123e4567-e89b-12d3-a456-426614174000\u{00A0}${nowrap('09.10.19')}</p>`
      ],
      [
        'о 05.09.75\u{00A0}2001:db8:85a3::8a2e:370:7334',
        `<p>${nowrap('о 05.09.75')}\u{00A0}2001:db8:85a3::8a2e:370:7334</p>`
      ]
    ];

    for (const [input, expected] of cases) {
      assert.equal(microtypo(input, { html: true }), expected, JSON.stringify(input));
    }
  });

  test('a nowrap wrapper still takes in a word bound to it', () => {
    assert.equal(
      microtypo('о 15.04.10\u{00A0}слово', { html: true }),
      `<p>${nowrap('о 15.04.10 слово')}</p>`
    );
    assert.equal(
      microtypo('слово\u{00A0}и тд', { html: true }),
      `<p>${nowrap('слово и т. д.')}</p>`
    );
  });

  test('a link to an address written without a scheme goes to http://', () => {
    assert.equal(
      microtypo('www.example.com', html),
      '<a href="http://www.example.com">www.example.com</a>'
    );
    assert.equal(
      microtypo('google.com/search', html),
      '<a href="http://google.com/search">google.com/search</a>'
    );
  });

  test('a link to an address with a scheme keeps it', () => {
    assert.equal(
      microtypo('https://example.com/a', html),
      '<a href="https://example.com/a">example.com/a</a>'
    );
    assert.equal(microtypo('ftp://x.ru/a', html), '<a href="ftp://x.ru/a">x.ru/a</a>');
  });

  test('an address without a scheme left as text gets none', () => {
    assert.equal(microtypo('Смотри www.example.com сегодня'), 'Смотри www.example.com сегодня');
  });

  test('an address in brackets or after an opening quote is linked', () => {
    assert.equal(
      microtypo('(https://example.com)', html),
      '(<a href="https://example.com">example.com</a>)'
    );
    assert.equal(
      microtypo('«https://example.com» и', html),
      '«<a href="https://example.com">example.com</a>» и'
    );
    assert.equal(
      microtypo('«цитата „https://example.com“ дальше»', html),
      '«цитата „<a href="https://example.com">example.com</a>“ дальше»'
    );
  });

  test('a closing quote or an ellipsis after an address stays out of the link', () => {
    assert.equal(
      microtypo('"м http://localhost:8080/search?q=a-b&x=1"', html),
      '«м\u{00A0}<a href="http://localhost:8080/search?q=a-b&amp;x=1">localhost:8080/search?q=a-b&x=1</a>»'
    );
    assert.equal(
      microtypo('http://arden.technology/search?q=a-b&x=1...', html),
      '<a href="http://arden.technology/search?q=a-b&amp;x=1">arden.technology/search?q=a-b&x=1</a>…'
    );
    assert.equal(
      microtypo('http://arden.technology/a… далее', html),
      '<a href="http://arden.technology/a">arden.technology/a</a>… далее'
    );
  });

  test('punctuation the address ends before stays out of the link', () => {
    assert.equal(
      microtypo('см. https://amber.ru/search?q=a-b&x=1? да', html),
      'см.\u{00A0}<a href="https://amber.ru/search?q=a-b&amp;x=1">amber.ru/search?q=a-b&x=1</a>? да'
    );
    assert.equal(
      microtypo('http://x.com/a: далее; http://x.com/b; и', html),
      '<a href="http://x.com/a">x.com/a</a>: далее; <a href="http://x.com/b">x.com/b</a>; и'
    );
  });

  test('a question mark or a colon inside an address stays in it', () => {
    assert.equal(
      microtypo('http://x.com:8080/a?b=c далее', html),
      '<a href="http://x.com:8080/a?b=c">x.com:8080/a?b=c</a> далее'
    );
  });

  test('an ellipsis inside an address stays in it', () => {
    assert.equal(
      microtypo('http://arden.technology/a…b далее', html),
      '<a href="http://arden.technology/a…b">arden.technology/a…b</a> далее'
    );
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
