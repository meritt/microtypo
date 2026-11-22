import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypo, microtypo } from '../../src/index.js';

const paren = { html: true, render: { autolink: true } };
const html = { html: true, render: { paragraphs: false } };
const nowrap = (s) => `<span style="white-space:nowrap;">${s}</span>`;
const expectedLink = (address) =>
  `<a href="${address.replaceAll('&', '&amp;')}">${address.slice(8)}</a>`;

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

  test('an ellipsis before an unbalanced closing paren is text, not the address', () => {
    for (const [input, expected] of [
      [
        'Эрик (см. http://amber.example/amber...) далее',
        '<p>Эрик (см. <a href="http://amber.example/amber">amber.example/amber</a>…) далее</p>'
      ],
      [
        'Эрик (см. http://amber.example/a_(b)...) далее',
        '<p>Эрик (см. <a href="http://amber.example/a_(b)">amber.example/a_(b)</a>…) далее</p>'
      ]
    ]) {
      const typo = new MicroTypo(paren);
      const output = typo.process(input);
      assert.equal(output, expected);
      assert.equal(typo.process(output), output);
    }
  });
});

describe('an address before a closing quote and an unbalanced closing paren', () => {
  for (const [input, expected] of [
    ['("Сайт "www.amber.example"")', '(«Сайт „www.amber.example“»)'],
    ['(см. "www.amber.example")', '(см. «www.amber.example»)'],
    ['""" www.")', '«„“ www.»)']
  ]) {
    test(`ends before the quote the first pass writes: ${input}`, () => {
      const typo = new MicroTypo();
      const output = typo.process(input);
      assert.equal(output, expected);
      assert.equal(typo.process(output), output);
    });
  }
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

  test('a quoted address ends at its closing mark throughout the paragraph', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    const link = '<a href="http://x.ru/b">x.ru/b</a>';
    for (const gap of [' ', '\n']) {
      const words = `длинное слово `.repeat(10).trimEnd() + gap;
      for (const [open, close] of [
        ['«', '»'],
        ['„', '“'],
        ['"', '"'],
        ['&quot;', '&quot;']
      ]) {
        const input = `«ссылка ${open}${words}http://x.ru/b${close}+ потом»`;
        const expected = `«ссылка „${words}${link}“+ потом»`;
        assert.equal(engine.process(input), expected, input);
        assert.equal(engine.process(expected), expected);
      }
    }
    const url = 'http://x.ru/b“+ещё';
    for (const prefix of ['', '„другой абзац\n\n', '<p>„другой абзац</p> ']) {
      const once = engine.process(prefix + url);
      assert.ok(once.includes(`href="${url}"`), once);
      assert.equal(engine.process(once), once);
    }
  });

  test('a quoted address keeps paired marks in its query and path', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    for (const [left, right, path, href] of [
      ['"', '"', '?q=&quot;яблоко&quot;', '?q=&quot;яблоко&quot;'],
      ['«', '»', '?q=«яблоко»&page=2', '?q=«яблоко»&amp;page=2'],
      ['«', '»', 'wiki/Книга_«Слово»_в_издании', 'wiki/Книга_«Слово»_в_издании'],
      ['«', '»', 'имя_«слово»', 'имя_«слово»'],
      ['«', '»', '?q=one&x=2', '?q=one&amp;x=2']
    ]) {
      const input = `${left}https://x.ru/${path}${right}+ещё`;
      const expected = `«<a href="https://x.ru/${href}">x.ru/${path}</a>»+ещё`;
      assert.equal(engine.process(input), expected, input);
      assert.equal(engine.process(expected), expected);
    }
  });

  test('mixed opening quote spellings keep the same URL boundary on both passes', () => {
    const engine = new MicroTypo(html);
    const markdown = new MicroTypo({ input: 'frontmatter' });
    const address = 'https://example.org/книга';
    for (const [left, right] of [
      ['«„', '“»'],
      ['&#x22;«', '»&#x22;'],
      ['&#x22;"', '»&#x22;'],
      ['&quot;"', '»&quot;'],
      ['""', '»"'],
      ['««', '&#34;»']
    ]) {
      const source = `Редактор написал: ${left}Сайт ${address}${right} завтра.`;
      const plain = `Редактор написал: «„Сайт ${address}“» завтра.`;
      const linked = `Редактор написал: «„Сайт ${expectedLink(address)}“» завтра.`;
      assert.equal(markdown.process(source), plain, source);
      assert.equal(markdown.process(plain), plain);
      assert.equal(engine.process(source), linked, source);
      assert.equal(engine.process(linked), linked);
    }
  });

  test('a mixed speech boundary keeps a quote owned by a path or query', () => {
    const engine = new MicroTypo(html);
    for (const [before, path, hrefPath, after, typedBefore, typedAfter] of [
      ['"Сайт ', 'Имя»_и_Б', 'Имя»_и_Б', ' или каталог".', '«Сайт ', ' или каталог».'],
      [
        '«Сайт «Издание ',
        '?q=plain&quot;',
        '?q=plain&quot;',
        '» завтра».',
        '«Сайт „Издание ',
        '“ завтра».'
      ],
      ['«Сайт ', '?q=&quot;&quot;', '?q=&quot;&quot;', '».', '«Сайт ', '».'],
      ['&#34;"Сайт ', '?q=«А»&n=2', '?q=«А»&amp;n=2', '»&#x22;.', '«„Сайт ', '“».']
    ]) {
      const input = `${before}https://example.org/${path}${after}`;
      const anchor = `<a href="https://example.org/${hrefPath}">example.org/${path}</a>`;
      const expected = typedBefore + anchor + typedAfter;
      assert.equal(engine.process(input), expected, input);
      assert.equal(engine.process(expected), expected, input);
    }
  });

  test('two open quotations take their closers from an otherwise empty URL parameter', () => {
    const address = 'https://example.org/?q=';
    const markdown = new MicroTypo({ input: 'frontmatter' });
    const linked = new MicroTypo(html);
    for (const [lead, value] of [
      ['«Речь "Сайт ', '&quot;&#34;'],
      ['"Речь "Сайт ', '&quot;&#x22;'],
      ['„Речь "Сайт ', '&#34;&quot;'],
      ['«Речь „Сайт ', '&#x22;&#34;'],
      ['«Речь „Сайт ', '&quot;&#34;']
    ]) {
      for (const [engine, body] of [
        [markdown, address],
        [linked, expectedLink(address)]
      ]) {
        const source = `${lead}${address}${value} завтра.`;
        const expected = `«Речь „Сайт ${body}“» завтра.`;
        assert.equal(engine.process(source), expected);
        assert.equal(engine.process(expected), expected);
      }
    }
  });

  test('an older spelling of speech around a URL keeps the authored link or closes the bare address', () => {
    const markdown = new MicroTypo({ input: 'frontmatter' });
    const linked = new MicroTypo(html);
    const url = 'https://example.org/?q=';
    for (const value of ['&quot;&#34;', '&quot;&#x22;', '&#34;&quot;']) {
      const savedLink = `<a href="${url}&quot;&quot;">example.org/?q=${value}</a>`;
      const saved = `«Речь «Сайт ${savedLink} завтра.`;
      assert.equal(linked.process(saved), saved);
      assert.equal(
        markdown.process(`«Речь «Сайт ${url}${value} завтра.`),
        `«Речь „Сайт ${url}“» завтра.`
      );
    }
    const marks = '&quot;&#34;';
    for (const [source, expected] of [
      [`Сайт ${url}${marks} завтра.`, `Сайт ${url}${marks} завтра.`],
      [`«Сайт ${url}${marks} завтра.`, `«Сайт ${url}&quot;» завтра.`],
      [`«Речь „Сайт ${url}${marks} завтра».`, `«Речь „Сайт ${url}&quot;“ завтра».`]
    ]) {
      assert.equal(markdown.process(source), expected);
      assert.equal(markdown.process(expected), expected);
    }
  });

  test('a later prose closer keeps an earlier path continuation inside the address', () => {
    const markdown = new MicroTypo({ input: 'frontmatter' });
    const engine = new MicroTypo(html);
    for (const [open, close] of [
      ['"', '"'],
      ['&#34;', '&#x22;'],
      ['„', '“'],
      ['“', '”']
    ]) {
      for (const path of ['Имя»_и_Б', '?q=Слово»&page=2', '?q=»+ещё']) {
        const url = `https://example.org/${path}`;
        const source = `Редактор сказал: ${open}Сайт ${url} или каталог${close}.`;
        for (const [typo, address] of [
          [markdown, url],
          [engine, expectedLink(url)]
        ]) {
          const expected = `Редактор сказал: «Сайт ${address} или каталог».`;
          assert.equal(typo.process(source), expected, source);
          assert.equal(typo.process(expected), expected, source);
        }
      }
    }
  });

  test('the open levels of speech take the closing marks they need after a URL', () => {
    const linked = new MicroTypo(html);
    const prose = new MicroTypo({ input: 'frontmatter' });
    for (const [before, path, attribute, after, left, right] of [
      ['"Анна пишет: "Сайт ', 'Каталог', 'Каталог', '&#34;&#34;.', '«Анна пишет: „Сайт ', '“».'],
      [
        '«Анна пишет: "Сайт ',
        'Каталог',
        'Каталог',
        '&quot;&#34; завтра.',
        '«Анна пишет: „Сайт ',
        '“» завтра.'
      ],
      [
        '«Анна пишет: „Сайт ',
        'Каталог&quot;&#34;',
        'Каталог&quot;&quot;',
        ' доступен“».',
        '«Анна пишет: „Сайт ',
        ' доступен“».'
      ],
      [
        '«Анна пишет: „Сайт ',
        '?q=&quot;&#34;',
        '?q=&quot;&quot;',
        ' доступен“».',
        '«Анна пишет: „Сайт ',
        ' доступен“».'
      ],
      [
        '«Анна пишет: "Сайт ',
        'Каталог&quot;',
        'Каталог&quot;',
        '" доступен».',
        '«Анна пишет: „Сайт ',
        '“ доступен».'
      ],
      [
        '&#34;«Сайт ',
        '?q=Том»&page=2',
        '?q=Том»&amp;page=2',
        '»&#34; доступен.',
        '«„Сайт ',
        '“» доступен.'
      ],
      [
        '««Сайт ',
        '?q=Том»_А»_Б&page=2',
        '?q=Том»_А»_Б&amp;page=2',
        '&#34;» доступен.',
        '«„Сайт ',
        '“» доступен.'
      ],
      [
        '«Сайт ',
        'А»_Б»_В»_Г',
        'А»_Б»_В»_Г',
        ' или журнал «Полюс» доступен».',
        '«Сайт ',
        ' или журнал „Полюс“ доступен».'
      ],
      ['„Сайт ', '?q=Том“', '?q=Том“', ' или журнал“.', '«Сайт ', ' или журнал».']
    ]) {
      const url = `https://example.org/${path}`;
      const source = before + url + after;
      const anchor = `<a href="https://example.org/${attribute}">example.org/${path}</a>`;
      for (const [engine, body] of [
        [linked, anchor],
        [prose, url]
      ]) {
        const expected = left + body + right;
        assert.equal(engine.process(source), expected, source);
        assert.equal(engine.process(expected), expected, source);
      }
    }
  });

  test('each directional pair in prose and in a URL keeps its own closing quote', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    const pairs = [
      ['«', '»'],
      ['„', '“'],
      ['“', '”']
    ];
    for (const [outer, closeOuter] of pairs) {
      for (const [inner, closeInner] of pairs) {
        const address = `example.org/wiki/Имя_${inner}А${closeInner}_и_Б`;
        const input = `Он сказал: ${outer}Сайт https://${address}${closeOuter}Арден.`;
        const expected = `Он\u00a0сказал: «Сайт <a href="https://${address}">${address}</a>»Арден.`;
        assert.equal(engine.process(input), expected, input);
        assert.equal(engine.process(expected), expected);
      }
    }
  });

  test('an opening quote glued to the next Cyrillic word cannot close speech at an earlier address', () => {
    const address = 'https://example.org/Север';
    for (const [typo, body] of [
      [new MicroTypo(html), expectedLink(address)],
      [new MicroTypo({ input: 'frontmatter' }), address]
    ]) {
      for (const [first, second] of [
        ['&#34;', '&quot;'],
        ['&quot;', '&#x22;'],
        ['"', '"']
      ]) {
        const source = `Редактор назвал ${first}каталог ${address}${first}, затем напечатал слово${second}Север${second}.`;
        const expected = `Редактор назвал «каталог ${body}», затем напечатал слово «Север».`;
        assert.equal(typo.process(source), expected);
        assert.equal(typo.process(expected), expected);
      }
    }
  });

  test('a later quotation keeps the closer belonging to the earlier speech outside the link', () => {
    const catalogue = '<a href="https://example.org/Каталог">example.org/Каталог</a>';
    const north = '<a href="https://example.org/Север">example.org/Север</a>';
    settled(
      [
        [
          'Редактор пишет: «Справочник https://example.org/Каталог» сегодня, Анна ответила: "Том вышел».',
          `Редактор пишет: «Справочник ${catalogue}» сегодня, Анна ответила: «Том вышел».`
        ],
        [
          '“Компания написала: «Справочник https://example.org/Каталог» сегодня”, затем редактор добавил: "Том опубликован».',
          `«Компания написала: „Справочник ${catalogue}“ сегодня», затем редактор добавил: «Том опубликован».`
        ],
        [
          'Редактор передал: " Анна открыла «каталог https://example.org/Север» вчера ».',
          `Редактор передал: «Анна открыла „каталог ${north}“ вчера».`
        ]
      ],
      { html: true, render: { paragraphs: false, breakline: false } }
    );
  });

  test('an opening quote after an address in a Markdown label remains outside that address', () => {
    const url = 'https://example.org/Север';
    for (const format of ['markdown', 'frontmatter']) {
      for (const render of [false, true]) {
        const typo = new MicroTypo({ input: format, html: render });
        for (const [input, expected] of [
          [
            `См. [каталог ${url}"План](/doc)" сегодня.`,
            `См. [каталог ${url} «План](/doc)» сегодня.`
          ],
          [`[Каталог ${url}"Guide"](/doc)`, `[Каталог ${url} «Guide»](/doc)`],
          [`[Каталог ${url}/«План»_А](/doc)`, `[Каталог ${url}/«План»_А](/doc)`],
          [`[Каталог ${url}](/doc) «Север»`, `[Каталог ${url}](/doc) «Север»`],
          [`[Каталог ${url}](https://x.ru/«План»)`, `[Каталог ${url}](https://x.ru/«План»)`]
        ]) {
          assert.equal(typo.process(input), expected);
          assert.equal(typo.process(expected), expected);
        }
      }
    }
  });

  test('paired titles keep the visible edge of a Markdown label address', () => {
    const url = 'https://example.org/';
    for (const format of ['markdown', 'frontmatter', 'mdx']) {
      for (const render of [false, true]) {
        const typo = new MicroTypo({ input: format, html: render });
        for (const [input, expected] of [
          [
            `Читайте [${url}"„Север“: путеводитель"](/том) весной.`,
            `Читайте [${url} «„Север“: путеводитель»](/том) весной.`
          ],
          [`[См. ${url}"Сосна""Ясень"](/том).`, `[См. ${url} «Сосна»«Ясень»](/том).`],
          [`[${url} "Сосна""Ясень"](/том).`, `[${url} «Сосна»«Ясень»](/том).`],
          [
            `[См. ${url}«Сосна»_А "Лес""Ясень"](/«Том»).`,
            `[См. ${url}«Сосна»_А «Лес»«Ясень»](/«Том»).`
          ],
          [
            `[${url}"Сосна""Ясень"](https://example.org/%22«Книга»).`,
            `[${url} «Сосна»«Ясень»](https://example.org/%22«Книга»).`
          ]
        ]) {
          assert.equal(typo.process(input), expected);
          assert.equal(typo.process(expected), expected);
        }
      }
    }
  });

  test('a closing quote after a quoted dash preserves the preceding URL and its own data', () => {
    const url = 'https://x.ru/?q=&#x22;';
    const link = '<a href="https://x.ru/?q=&quot;">x.ru/?q=&#x22;</a>';
    for (const [config, address] of [
      [{}, url],
      [html, link]
    ]) {
      const typo = new MicroTypo(config);
      for (const dash of ['—', '&#8212;', '&#x2014;', '&mdash;']) {
        for (const [source, expected] of [
          [`Текст "адрес ${url} и знак ${dash}".`, `Текст «адрес ${address} и знак —».`],
          [
            `Текст "адрес ${url} и знак ${dash}" сегодня.`,
            `Текст «адрес ${address} и знак —» сегодня.`
          ],
          [`Текст «адрес ${url} и знак ${dash}».`, `Текст «адрес ${address} и знак —».`]
        ]) {
          assert.equal(typo.process(source), expected);
          assert.equal(typo.process(expected), expected);
        }
      }
    }
    const typo = new MicroTypo(html);
    for (const space of ['', ' ', ' ']) {
      const expected = 'Он пишет —«Сайт <a href="https://x.ru/Мир">x.ru/Мир</a>».';
      assert.equal(typo.process(`Он пишет —"${space}Сайт https://x.ru/Мир&#x22;.`), expected);
      assert.equal(typo.process(expected), expected);
    }
  });

  test('inline markup keeps both the query and the dash at the end of a quotation', () => {
    const url = 'https://x.ru/?q=&#34;';
    const linked = '<a href="https://x.ru/?q=&quot;">x.ru/?q=&#34;</a>';
    for (const render of [false, true]) {
      const typo = new MicroTypo({ input: 'html', html: render, render: { paragraphs: false } });
      for (const [source, expected] of [
        ['<em>"сайт URL и тире —"</em>.', '<em>«сайт URL и тире —»</em>.'],
        ['<em>"сайт URL и тире —".</em>', '<em>«сайт URL и тире —».</em>'],
        ['"сайт URL и тире —"<em>.</em>', '«сайт URL и тире —»<em>.</em>'],
        ['"сайт URL и тире <em>—</em>".', '«сайт URL и тире <em>—</em>».'],
        ['"сайт URL и тире —"<!-- помета -->.', '«сайт URL и тире —»<!-- помета -->.'],
        ['"сайт URL и тире —"<br>Далее.', '«сайт URL и тире —»<br>Далее.'],
        ['<em><b>"сайт URL и тире —"</b></em>.', '<em><b>«сайт URL и тире —»</b></em>.'],
        ['Пишут —"<em>Север</em>" весной.', 'Пишут —«<em>Север</em>» весной.']
      ]) {
        const output = expected.replace('URL', render ? linked : url);
        assert.equal(typo.process(source.replace('URL', url)), output);
        assert.equal(typo.process(output), output);
      }
    }
  });

  test('a later Markdown label preserves the same earlier links as its visible words', () => {
    const engine = new MicroTypo({ input: 'markdown', html: true, render: { paragraphs: false } });
    for (const [label, after] of [
      ['журнал', ' закрыли“».'],
      ['[журнал](/x)', ' закрыли“».'],
      ['[журнал](/x "«метка»")', ' закрыли“».'],
      ['*журнал*', ' закрыли“».'],
      ['`«код»`', ' проверили“».'],
      ['[журнал закрыли“](/x)', '».']
    ]) {
      const url = 'https://example.org/Каталог&quot;&#34;';
      const source = `«Анна написала: „Справочник ${url} доступен. Затем ${label}${after}`;
      const linked =
        '<a href="https://example.org/Каталог&quot;&quot;">example.org/Каталог&quot;&#34;</a>';
      const expected = source.replace(url, linked);
      assert.equal(engine.process(source), expected);
      assert.equal(engine.process(expected), expected);
    }
    const a = 'https://example.org/А»_Б»_В';
    const b = 'https://example.org/wiki/«Север»';
    const input = `«Сайты ${a} или ${b} по просьбе [совета](/x) доступны».`;
    const expected = `«Сайты ${expectedLink(a)} или ${expectedLink(b)} по\u00a0просьбе [совета](/x) доступны».`;
    assert.equal(engine.process(input), expected);
    assert.equal(engine.process(expected), expected);
  });

  test('a pair inside the address keeps every first character and the next parameter', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    const pairs = [
      ['«', '»'],
      ['„', '“'],
      ['“', '”']
    ];
    for (const [open, close] of pairs) {
      for (const [left, right] of pairs) {
        for (const content of ['№1', '(Слово)', '+1', '%D0%A1', 'Слово', '«А»']) {
          for (const prefix of ['wiki/Имя_', '?q=']) {
            for (const suffix of ['', '&page=2']) {
              const path = prefix + left + content + right + suffix;
              const source = `${open}Сайт https://x.ru/${path} в статье${close}.`;
              const href = `https://x.ru/${path.replaceAll('&', '&amp;')}`;
              const expected = `«Сайт <a href="${href}">x.ru/${path}</a> в\u00a0статье».`;
              assert.equal(engine.process(source), expected, source);
              assert.equal(engine.process(expected), expected, source);
            }
          }
        }
      }
    }
  });

  test('a single shared closing mark belongs to the speech, and two marks close both', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    for (const [open, close] of [
      ['«', '»'],
      ['„', '“'],
      ['“', '”']
    ]) {
      for (const value of [`буква${open}А`, `буква${open}А${close}`, 'буква%C2%ABА']) {
        const url = `https://x.ru/?q=${value}`;
        const source = `${open}Ищите на ${url}${close}, — сказала Анна.`;
        const expected = `«Ищите на\u00a0<a href="${url}">${url.slice(8)}</a>»,\u00a0— сказала Анна.`;
        assert.equal(engine.process(source), expected, source);
        assert.equal(engine.process(expected), expected, source);
      }
    }
    const minimal = '«<a href="https://x.ru/?q=«А">x.ru/?q=«А</a>»';
    assert.equal(engine.process('«https://x.ru/?q=«А»'), minimal);
    assert.equal(engine.process(minimal), minimal);
  });

  test('several addresses share a quotation and retain their complete queries and paths', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    for (const [open, close] of [
      ['«', '»'],
      ['„', '“'],
      ['“', '”']
    ]) {
      for (const continuation of ['&n=1', '/далее', '_издание', '+ещё', '']) {
        for (const innerEnd of ['', close]) {
          const first = `https://a.ru/?q=${open}А${close}${continuation}`;
          const middle = `https://b.ru/wiki/Книга_${open}Б${close}${continuation}`;
          const last = `https://c.ru/?q=${open}В${innerEnd}`;
          for (const addresses of [
            [first, last],
            [first, middle, last]
          ]) {
            const source = `${open}Сайты ${addresses.join(' и ')}${close}`;
            const expected = `«Сайты ${addresses.map(expectedLink).join(' и\u00a0')}»`;
            assert.equal(engine.process(source), expected, source);
            assert.equal(engine.process(expected), expected, source);
          }
        }
      }
    }
    const protectedText =
      '<em>здесь</em> <code>https://x.ru/?q=«Х»</code> <a href="https://keep.ru/?q=«К»">источник</a>';
    const htmlEngine = new MicroTypo({
      ...html,
      input: 'html',
      render: { paragraphs: false, breakline: false }
    });
    for (const data of ['?q=«А»&n=1', '?q=%C2%ABА%C2%BB', '?q=буква„Ю&n=1']) {
      const first = `https://a.ru/${data}`;
      const second = 'https://b.ru/?q=«Б';
      const source = `«Сайты ${first} ${protectedText} ${second}», — запись.`;
      const expected = `«Сайты ${expectedLink(first)} ${protectedText} ${expectedLink(second)}»,\u00a0— запись.`;
      assert.equal(htmlEngine.process(source), expected, source);
      assert.equal(htmlEngine.process(expected), expected, source);
    }
    const separate = '«Сайт https://a.ru/?q=«А»\n\nhttps://b.ru/?q=«Б»';
    const expected = `«Сайт ${expectedLink('https://a.ru/?q=«А')}»\n\n${expectedLink('https://b.ru/?q=«Б»')}`;
    assert.equal(engine.process(separate), expected);
    assert.equal(engine.process(expected), expected);
  });

  test('a closer matches its open English pair around a complete German pair in a URL', () => {
    const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
    for (const value of ['“Книга„Том“”', '“Книга„Том«Глава»“”', '“Книга„Раз“„Два“”']) {
      for (const tail of ['', '&page=2']) {
        const address = `https://x.ru/?q=${value}${tail}`;
        const source = `«Каталог „Сайт ${address}“ напечатан».`;
        const expected = `«Каталог „Сайт ${expectedLink(address)}“ напечатан».`;
        assert.equal(engine.process(source), expected, source);
        assert.equal(engine.process(expected), expected, source);
      }
    }
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

describe('bare domains with a root path', () => {
  test('protects the entire root URL beside a temperature or date', () => {
    for (const [input, expected] of [
      [
        '0F\u{00A0}example.com/',
        '<p><span style="white-space:nowrap;">0 °F</span>\u{00A0}<a href="http://example.com/">example.com/</a></p>'
      ],
      ['example.com/', '<p><a href="http://example.com/">example.com/</a></p>'],
      ['sub.domain.co.uk/', '<p><a href="http://sub.domain.co.uk/">sub.domain.co.uk/</a></p>'],
      [
        '28.08.10\u{00A0}sub.domain.co.uk/',
        '<p>28.08.10\u{00A0}<a href="http://sub.domain.co.uk/">sub.domain.co.uk/</a></p>'
      ]
    ]) {
      const typo = new MicroTypo({ html: true });
      const output = typo.process(input);
      assert.equal(output, expected);
      assert.equal(typo.process(output), output);
    }
  });
  test('keeps address boundaries, schemes and authored attributes', () => {
    for (const [input, expected] of [
      ['example.com', '<p>example.com</p>'],
      ['https://', '<p>https://</p>'],
      ['example.com/.', '<p><a href="http://example.com/">example.com/</a>.</p>'],
      [
        'example.com/?q=1&x=2',
        '<p><a href="http://example.com/?q=1&amp;x=2">example.com/?q=1&x=2</a></p>'
      ],
      ['example.com/#part', '<p><a href="http://example.com/#part">example.com/#part</a></p>'],
      ['example.com/x', '<p><a href="http://example.com/x">example.com/x</a></p>'],
      ['javascript:alert(1)', '<p>javascript: alert(1)</p>'],
      ['слово example слово', '<p>слово example слово</p>'],
      ['<a href="example.com/">слово</a>', '<p><a href="example.com/">слово</a></p>']
    ]) {
      assert.equal(microtypo(input, { html: true }), expected);
    }
  });
});

describe('a terminal character reference in an address', () => {
  const address = 'https://example.com/search?q=a-b&x=1';
  const href = 'https://example.com/search?q=a-b&amp;x=1';

  test('keeps an escaped straight quote inside the protected address', () => {
    for (const [reference, encoded] of [
      ['&quot;', '&quot;'],
      ['&#34;', '&quot;'],
      ['&#00034;', '&quot;'],
      ['&#x22;', '&quot;'],
      ['&#X00022;', '&quot;']
    ]) {
      const typo = new MicroTypo(html);
      const output = typo.process(address + reference);
      assert.equal(
        output,
        `<a href="${href}${encoded}">example.com/search?q=a-b&x=1${reference}</a>`,
        reference
      );
      assert.equal(typo.process(output), output, reference);
    }
  });

  test('ends the address before a guillemet reference, as before the guillemet', () => {
    for (const reference of ['&raquo;', '&#187;', '&#x00BB;']) {
      const typo = new MicroTypo(html);
      const output = typo.process(address + reference);
      assert.equal(output, `<a href="${href}">example.com/search?q=a-b&x=1</a>»`, reference);
      assert.equal(typo.process(output), output, reference);
    }
  });
});

// Each expectation is the input with its typography: the address and the e-mail byte for byte.
function settled(cases, config) {
  for (const [input, expected] of cases) {
    const typo = new MicroTypo(config);
    const output = typo.process(input);

    assert.equal(output, expected, input);
    assert.equal(typo.process(output), output, `second pass of ${input}`);
  }
}

describe('an address and an e-mail glued through a sign', () => {
  test('an e-mail behind an address takes no part of the address', () => {
    settled([
      ["www.a.ru'a@b.ru", "www.a.ru'a@b.ru"],
      ['www.a.ru`a@b.ru', 'www.a.ru`a@b.ru'],
      ["http://a.ru'a@b.ru", "http://a.ru'a@b.ru"],
      ["a.ru/x'`a@b.ru", "a.ru/x'`a@b.ru"],
      ["Сайт www.amber.ru'corwin@amber.ru и всё", "Сайт www.amber.ru'corwin@amber.ru и\u{00A0}всё"],
      ["www.a.ru www.b.ru'a@b.ru", "www.a.ru www.b.ru'a@b.ru"]
    ]);
    settled(
      [
        [
          "Сайт www.amber.ru'corwin@amber.ru и всё",
          '<p>Сайт <a href="http://www.amber.ru">www.amber.ru</a>\'corwin@amber.ru и\u{00A0}всё</p>'
        ]
      ],
      { html: true }
    );
    settled([['{"a":"www.a.ru\'a@b.ru - б"}', '{"a":"www.a.ru\'a@b.ru\u{00A0}— б"}']], {
      input: 'json'
    });
  });

  test('an e-mail in front of an address leaves the address its scheme', () => {
    settled([
      ['a@b.ru-https://a.ru', 'a@b.ru-https://a.ru'],
      ['a@b.ru.ftp://a.ru/f', 'a@b.ru.ftp://a.ru/f'],
      ['Почта a@b.ru-https://a.ru и всё', 'Почта a@b.ru-https://a.ru и\u{00A0}всё']
    ]);
  });
});

describe('an e-mail in front of a slash', () => {
  test('keeps its domain: no address without a scheme begins inside it', () => {
    settled([
      [
        'Пишите на ivan.petrov@mail.ru/ или звоните',
        'Пишите на\u{00A0}ivan.petrov@mail.ru/ или звоните'
      ],
      ['ivan.petrov@site.ru/support.team@site.ru', 'ivan.petrov@site.ru/support.team@site.ru'],
      ['d.e-f@g-h.ru/www.a.ru', 'd.e-f@g-h.ru/www.a.ru'],
      ['x.y@почта.site.ru/z', 'x.y@почта.site.ru/z']
    ]);
  });

  test('an address with a scheme or with no e-mail in front of it is still one', () => {
    settled(
      [
        [
          'см. site.ru/path и a.b@c.ru/d',
          '<p>см.\u{00A0}<a href="http://site.ru/path">site.ru/path</a> и\u{00A0}a.b@c.ru/d</p>'
        ],
        [
          'ftp://user@host.ru/path',
          '<p><a href="ftp://user@host.ru/path">user@host.ru/path</a></p>'
        ]
      ],
      { html: true }
    );
  });
});

describe('an address after mailto:', () => {
  test('is one address with an apostrophe or a backtick in the name', () => {
    settled([
      ["mailto:o'brien@mail.ru", "mailto:o'brien@mail.ru"],
      ["Пишите: mailto:o'brien@mail.ru и всё", "Пишите: mailto:o'brien@mail.ru и\u{00A0}всё"],
      ['mailto:o`b@mail.ru', 'mailto:o`b@mail.ru'],
      ["(mailto:o'brien@mail.ru), 'mailto:a@b.ru'", "(mailto:o'brien@mail.ru), 'mailto:a@b.ru'"],
      ["mailto:o'brien@mail.ru?subject=x", "mailto:o'brien@mail.ru?subject=x"]
    ]);
  });

  test('is linked as an address with a plain name is', () => {
    settled(
      [
        [
          "mailto:o'brien@mail.ru",
          '<p><a href="mailto:o\'brien@mail.ru">mailto:o\'brien@mail.ru</a></p>'
        ],
        ['mailto:ivan@mail.ru', '<p><a href="mailto:ivan@mail.ru">mailto:ivan@mail.ru</a></p>']
      ],
      { html: true }
    );
  });

  test('an e-mail with no mailto: in front and a mailto: with no e-mail behind stay as they were', () => {
    settled([
      ["o'brien@mail.ru", "o'brien@mail.ru"],
      ['mailto:ivan@mail.ru', 'mailto:ivan@mail.ru']
    ]);
  });
});

test('a seconds mark inside a coordinate cannot close speech around an earlier address', () => {
  const address = 'https://example.org/Север.png';
  const options = { input: 'html', html: true, render: { autolink: true, paragraphs: false } };
  for (const [coordinate, rendered] of [
    ['55°45\'20"N', '55°45\'20"N'],
    ["55°45'20&quot;N", '55°45\'20"N'],
    ['55°45′20″N', '55°45′20″N']
  ]) {
    const input = `Редактор подтвердил: "Смотрите ${address}» — координаты ${coordinate}.`;
    const expected = `Редактор подтвердил: «Смотрите ${expectedLink(address)}»\u00a0— координаты ${rendered}.`;
    assert.equal(microtypo(input, options), expected);
    assert.equal(microtypo(expected, options), expected);
  }
  const title = `Редактор подтвердил: "Смотрите ${address}» на карте".`;
  const expectedTitle = `Редактор подтвердил: «Смотрите ${expectedLink(`${address}»`)} на\u00a0карте».`;
  assert.equal(microtypo(title, options), expectedTitle);
  assert.equal(microtypo(expectedTitle, options), expectedTitle);
});

test('a terminal mark around an address leaves its later measurement to the number', () => {
  const url = 'https://x.ru/Карта';
  const config = { html: true, render: { autolink: true, paragraphs: false } };
  for (const [source, width, tail] of [
    ['экран 27".', `${url}»`, 'экран 27».'],
    ['ошибка 27".', `${url}»`, 'ошибка 27».'],
    ['каталог R2".', `${url}»`, 'каталог R2».'],
    ['шланг 1/2".', url, 'шланг 1/2″.'],
    ['координаты 55°45\'20" N.', url, "координаты 55°45'20″ N."],
    ['координаты 55°45\'20"<span>N</span>.', url, "координаты 55°45'20″<span>N</span>."],
    ['трубы 1/2" и 3/4".', url, 'трубы 1/2″ и\u00a03/4″.'],
    ['экран 27" внизу".', `${url}»`, 'экран 27″ внизу».'],
    ['экран 27" внизу».', `${url}»`, 'экран 27″ внизу».']
  ]) {
    const expected = `«Сайт ${expectedLink(width)}${width === url ? '»' : ''}\u00a0— ${tail}`;
    assert.equal(microtypo(`"Сайт ${url}» — ${source}`, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

test('an opening mark glued to an address opens the speech its closer after a space ends', () => {
  const engine = new MicroTypo({ ...html, render: { paragraphs: false, breakline: false } });
  const n = '\u{00A0}';
  const quoted = `«с${n}голову» и${n}всё.`;
  for (const [source, expected] of [
    [
      'Ссылка https://x.ru/a;«с голову» и всё.',
      `Ссылка ${expectedLink('https://x.ru/a')};${quoted}`
    ],
    [
      'Ссылка https://x.ru/a;"с голову" и всё.',
      `Ссылка ${expectedLink('https://x.ru/a')};${quoted}`
    ],
    [
      'Ссылка https://x.ru/a.«с голову» и всё.',
      `Ссылка ${expectedLink('https://x.ru/a')}.${quoted}`
    ],
    ['Ссылка https://x.ru/a«с голову» и всё.', `Ссылка ${expectedLink('https://x.ru/a')}${quoted}`],
    [
      'Ссылка https://x.ru/?q=„с голову“ и всё.',
      `Ссылка ${expectedLink('https://x.ru/?q=')}${quoted}`
    ],
    [
      'Ссылка https://x.ru/a;«с «вложенной» головой» и всё.',
      `Ссылка ${expectedLink('https://x.ru/a')};«с${n}„вложенной“ головой» и${n}всё.`
    ],
    [
      'Ссылки https://x.ru/a;«с и https://y.ru/b;«д» е» ж.',
      `Ссылки ${expectedLink('https://x.ru/a')};«с${n}и${n}${expectedLink('https://y.ru/b;«д»')} е»${n}ж.`
    ]
  ]) {
    assert.equal(engine.process(source), expected, source);
    assert.equal(engine.process(expected), expected, source);
  }

  const plain = new MicroTypo();
  for (const text of [
    `Ссылка https://example.com/file.html;«с${n}голову истории»${n}— спросил${n}он.`,
    `Ссылка www.x.ru/a;«с${n}голову» и${n}всё.`
  ]) {
    assert.equal(plain.process(text), text);
  }
  assert.equal(
    plain.process('Ссылка https://example.com/file.html;"с голову истории" — спросил он.'),
    `Ссылка https://example.com/file.html;«с${n}голову истории»${n}— спросил${n}он.`
  );

  // A pair inside the body, a sole closer an enclosing quotation can take, or no closer at all
  // leaves the mark in the address.
  for (const [source, address] of [
    ['Ссылка https://x.ru/wiki/«Имя» и всё.', 'https://x.ru/wiki/«Имя»'],
    ['«Смотри https://x.ru/?q=«А и всё»', 'https://x.ru/?q=«А'],
    ['Смотри https://x.ru/?q=«А и всё.', 'https://x.ru/?q=«А'],
    ['Смотри https://x.ru/?q=«А\n\nи всё».', 'https://x.ru/?q=«А']
  ]) {
    const output = engine.process(source);
    assert.ok(output.includes(`href="${address}"`), output);
    assert.equal(engine.process(output), output, source);
  }
});
