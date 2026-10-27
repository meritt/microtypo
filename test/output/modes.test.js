import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

describe('defaults', () => {
  test('default output is unicode', () => {
    const out = microtypo('"Корвин" — принц', PARAMS);
    assert.ok(out.includes('«Корвин»'), `Got: ${out}`);
    assert.ok(out.includes('—'), `Got: ${out}`);
    assert.ok(!out.includes('&laquo;'));
    assert.ok(!out.includes('&mdash;'));
  });

  test('default output uses raw NBSP (U+00A0) not &nbsp;', () => {
    const out = microtypo('Отряд шёл до Амбера', PARAMS);
    assert.ok(out.includes('до\u{00A0}'), `Got: ${out}`);
    assert.ok(!out.includes('&nbsp;'));
  });

  test('explicit entities:false matches the default', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: false });
    assert.equal(typo.process('"Corwin"'), '«Corwin»');
  });
});

describe('entity mode', () => {
  test('entities:true produces &laquo;/&raquo;/&mdash;', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('"Корвин" — принц');
    assert.ok(out.includes('&laquo;Корвин&raquo;'), `Got: ${out}`);
    assert.ok(out.includes('&mdash;'), `Got: ${out}`);
    assert.ok(!out.includes('«'));
    assert.ok(!out.includes('»'));
  });

  test('entities:true produces &nbsp;', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('Отряд шёл до Амбера');
    assert.ok(out.includes('до&nbsp;'), `Got: ${out}`);
  });

  test('entities:true converts the full glyph sweep', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.equal(typo.process('Корвин...'), 'Корвин&hellip;');
    assert.equal(typo.process('Амбер — истина'), 'Амбер&nbsp;&mdash; истина');
  });
});

test('bogus entities string throws a config error', () => {
  assert.throws(() => new MicroTypo({ entities: 'bogus' }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });

  assert.throws(() => new MicroTypo({ entities: 'mixed' }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

describe('input-form symmetry', () => {
  test('entity input normalises like unicode and ascii quotes', () => {
    const a = microtypo('&laquo;Амбер&raquo;', PARAMS);
    const b = microtypo('«Амбер»', PARAMS);
    const c = microtypo('"Амбер"', PARAMS);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  test('em-dash entity, ascii hyphen and unicode normalise alike', () => {
    const a = microtypo('Корвин - истина', PARAMS);
    const b = microtypo('Корвин — истина', PARAMS);
    const c = microtypo('Корвин &mdash; истина', PARAMS);
    assert.equal(a, b);
    assert.equal(b, c);
  });
});

describe('idempotency', () => {
  test('process twice equals once — unicode mode', () => {
    const text = '"Амбер" — истина 1000.';
    const once = microtypo(text, PARAMS);
    const twice = microtypo(once, PARAMS);
    assert.equal(twice, once, `\nonce:  ${once}\ntwice: ${twice}`);
  });

  test('process twice equals once — entity mode', () => {
    const text = '"Амбер" — истина 1000.';
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const once = typo.process(text);
    const twice = typo.process(once);
    assert.equal(twice, once);
  });
});

test('output mode is fixed per instance', () => {
  // entities is a constructor option, so two modes need two instances.
  const u = new MicroTypo({ ...PARAMS, entities: false });
  const e = new MicroTypo({ ...PARAMS, entities: true });
  assert.notEqual(u.process('"Corwin"'), e.process('"Corwin"'));
});

test('entity output equals post-converted unicode output', async () => {
  const { unicodeToEntities } = await import('../../src/lib/glyphs.js');
  const text = 'Вот «Козырь» — с меткой 1000.';
  const u = microtypo(text, PARAMS);
  const e = new MicroTypo({ ...PARAMS, entities: true }).process(text);
  assert.equal(unicodeToEntities(u), e);
});

test('hanging spans keep unicode glyphs in unicode mode', () => {
  const typo = new MicroTypo({ html: true, rules: { 'hanging.*': true } });
  const out = typo.process('Взгляни «Амбер» рядом');
  assert.ok(out.includes('»'), `Got: ${out}`);
  assert.ok(out.includes('<span style='), `Got: ${out}`);
});

describe('what is safe', () => {
  test('apostrophe becomes &rsquo; in entity mode', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.equal(typo.process("Corwin's"), 'Corwin&rsquo;s');
  });

  test('apostrophe becomes U+2019 in unicode mode', () => {
    assert.equal(microtypo("Corwin's", PARAMS), 'Corwin’s');
  });

  test('code content stays verbatim', () => {
    const typo = new MicroTypo({ entities: false });
    // <code> is a safe block: the inner "raw" quotes stay literal.
    const out = typo.process('Мерлин взял <code>"raw"</code> в Отражении');
    assert.ok(out.includes('<code>"raw"</code>'), `Got: ${out}`);
  });
});

describe('mode matrix', () => {
  // One input spanning every axis: quotes, em-dash, nowrap phrase, autolinkable URL, two paragraphs.
  const INPUT =
    'Идём в "Амбер" - истинный, и т. д. См. http://simonenko.xyz тут.\n\nВторой Козырь.';

  test('{html:false, entities:false}: bare unicode text, zero tags', () => {
    const out = microtypo(INPUT, { html: false, entities: false });

    assert.match(out, /«Амбер»/u);
    assert.match(out, /—/u);
    assert.match(out, /и\u{00A0}т\.\u{00A0}д\./u, `nowrap phrase not NBSP-degraded: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
    assert.match(out, /\n\n/, 'paragraph boundary must stay a bare \\n\\n');
    assert.ok(!out.includes('<'), `expected zero tags: ${out}`);
  });

  test('{html:false, entities:true}: HTML entities, still zero structural tags', () => {
    const out = microtypo(INPUT, { html: false, entities: true });

    assert.match(out, /&laquo;Амбер&raquo;/);
    assert.match(out, /&mdash;/);
    assert.match(out, /и&nbsp;т\.&nbsp;д\./, `nowrap phrase not NBSP-degraded: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
    assert.match(out, /\n\n/, 'paragraph boundary must stay a bare \\n\\n');
    assert.ok(!out.includes('«'), 'unicode glyph leaked in entity mode');
    assert.ok(!out.includes('<'), `expected zero structural tags: ${out}`);
  });

  test('{html:true, entities:false}: markup pipeline active', () => {
    const out = microtypo(INPUT, { html: true, entities: false });

    assert.match(out, /«Амбер»/u);
    assert.match(out, /—/u);
    assert.match(
      out,
      /<span style="white-space:nowrap;">и т\. д\.<\/span>/,
      `nowrap phrase not wrapped: ${out}`
    );
    assert.match(out, /<a href="http:\/\/simonenko\.xyz">/, `URL not autolinked: ${out}`);
    assert.match(out, /<p>/, 'paragraphs should wrap by default under html:true');

    const explicit = microtypo(INPUT, {
      html: true,
      entities: false,
      render: { paragraphs: true }
    });

    assert.match(explicit, /<p>Идём/);
    assert.match(explicit, /<p>Второй Козырь\.<\/p>/);
  });

  test('{html:true, entities:true}: markup pipeline + entities', () => {
    const out = microtypo(INPUT, { html: true, entities: true });

    assert.match(out, /&laquo;Амбер&raquo;/);
    assert.match(out, /&mdash;/);
    assert.match(
      out,
      /<span style="white-space:nowrap;">и т\. д\.<\/span>/,
      `nowrap phrase not wrapped: ${out}`
    );
    assert.match(out, /<a href="http:\/\/simonenko\.xyz">/, `URL not autolinked: ${out}`);
    assert.match(out, /<p>/, 'paragraphs should wrap by default under html:true');
    assert.ok(!out.includes('«'), 'unicode glyph leaked in entity mode');
  });

  test('nowrap phrase collapses to NBSP under html:false', () => {
    const out = microtypo('и т. д.', { html: false });

    assert.ok(!out.includes('<nobr>'), `nobr leaked under html:false: ${out}`);
    assert.match(out, /и\u{00A0}т\.\u{00A0}д\./u, `Got: ${out}`);
  });

  test('autolink degrades to plain URL text under html:false', () => {
    const out = microtypo('см. http://simonenko.xyz тут', { html: false });

    assert.ok(!out.includes('<a '), `anchor leaked under html:false: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
  });
});

describe('newline invariants', () => {
  // `html: false` disables the text group, paragraphs and breakline both, which isolates the raw
  // newline-collapse invariant.
  test('3+ consecutive newlines collapse to exactly \\n\\n', () => {
    assert.equal(microtypo('Корвин\n\n\n\nЭрик', { html: false }), 'Корвин\n\nЭрик');
  });

  test('a blank line (\\n\\n) is preserved as-is', () => {
    assert.equal(microtypo('Корвин\n\nЭрик', { html: false }), 'Корвин\n\nЭрик');
  });

  test('a single newline (soft break) is preserved as-is', () => {
    assert.equal(microtypo('Корвин\nЭрик', { html: false }), 'Корвин\nЭрик');
  });

  test('with <p> wrapping on, the boundary is </p>\\n\\n<p>', () => {
    assert.equal(microtypo('Корвин\n\nЭрик', { html: true }), '<p>Корвин</p>\n\n<p>Эрик</p>');
  });

  test('idempotent under repeated processing', () => {
    const once = microtypo('Корвин\n\n\n\nЭрик\n\nРэндом\nБенедикт');
    const twice = microtypo(once);

    assert.equal(twice, once);
  });
});

// `html: true` is more than one switch: inline markup plus `<p>` and `<br>`. Markdown source keeps
// its own block syntax, so only the inline half applies — the other half would wrap the heading, the
// list and the fence in one paragraph that is neither Markdown nor HTML.
describe('Markdown keeps its block syntax under html:true', () => {
  const md = { input: 'markdown', html: true };
  const source =
    '# Донесение\n\nКорвин - принц.\n\n- Оберон\n- Рэндом\n\n```js\nconst a = "b" - 1;\n```';

  test('no <p> and no <br> are emitted', () => {
    const out = microtypo(source, md);

    assert.ok(!out.includes('<p>'), out);
    assert.ok(!out.includes('<br>'), out);
    assert.ok(out.startsWith('# Донесение'), out);
    assert.ok(out.includes('- Оберон\n- Рэндом'), out);
  });

  test('a second pass leaves the fenced code untouched', () => {
    const once = microtypo(source, md);

    assert.equal(microtypo(once, md), once);
    assert.ok(once.includes('const a = "b" - 1;'), once);
  });

  test('inline markup still comes through', () => {
    const out = microtypo('Звони 8 800 555-35-35 и смотри https://amber.io/pattern.', md);

    assert.ok(out.includes('white-space:nowrap'), out);
    assert.ok(out.includes('<a href="https://amber.io/pattern">'), out);
  });

  test('render.paragraphs opts back in', () => {
    const out = microtypo('Корвин - принц\n\nРэндом - брат', {
      ...md,
      render: { paragraphs: true }
    });

    assert.ok(out.includes('<p>Корвин'), out);
  });

  test('a frontmatter body follows the same default', () => {
    const out = microtypo('---\na: "Корвин - раз"\n---\n\nТекст - вот', {
      input: 'frontmatter',
      html: true
    });

    assert.ok(!out.includes('<p>'), out);
  });

  test('text and html formats still wrap', () => {
    assert.ok(microtypo('Корвин - принц', { html: true }).includes('<p>'));
    assert.ok(microtypo('Корвин - принц', { input: 'html', html: true }).includes('<p>'));
  });
});

const wrapped = (input, config) => microtypo(input, { html: true, ...config });

describe('a paragraph of protected content survives <p> wrapping', () => {
  test('a fenced code block', () => {
    const out = wrapped('Текст.\n\n```\nкод\n```\n\nЕщё.', { input: 'markdown' });

    assert.ok(out.includes('```\nкод\n```'), out);
  });

  test('an indented code block', () => {
    const out = wrapped('Текст.\n\n    код\n\nЕщё.', { input: 'markdown' });

    assert.ok(out.includes('    код'), out);
  });

  test('a template expression', () => {
    const out = wrapped('Текст.\n\n{{ ссылка }}\n\nЕщё.', {
      input: { template: 'handlebars' }
    });

    assert.ok(out.includes('{{ ссылка }}'), out);
  });

  test('an HTML comment', () => {
    const out = wrapped('Текст.\n\n<!-- Дворкин -->\n\nЕщё.', { input: 'html' });

    assert.ok(out.includes('<!-- Дворкин -->'), out);
  });

  // An unwrap body of `[\\s\\S]*?` pairs an opening block tag in one paragraph with its closing tag
  // several paragraphs later and swallows every `</p>` and `<p>` between them, which reprocessing
  // then duplicates.
  test('a block tag split across blank lines keeps <p> balanced and stable', () => {
    const src = '<table>\n\n<caption>Пути из Амбера</caption>\n\n</table>';
    const once = microtypo(src, { input: 'html', html: true });

    let depth = 0;
    for (const token of once.match(/<\/?p>/gi) ?? []) {
      depth += token === '<p>' ? 1 : -1;
      assert.ok(depth >= 0, `a </p> closes a paragraph that was never opened: ${once}`);
    }

    assert.equal(depth, 0, `unbalanced paragraphs: ${once}`);
    assert.equal(microtypo(once, { input: 'html', html: true }), once);
  });

  test('a block holding an author paragraph keeps its structure', () => {
    const config = { input: 'html', html: true };

    for (const src of [
      '<table><tr><td><p>Корвин</p></td></tr></table>',
      '<div><p>Корвин</p></div>',
      '<blockquote><p>Корвин</p><p>Рэндом</p></blockquote>'
    ]) {
      assert.equal(microtypo(src, config), src);
    }
  });

  // HTML forbids a `<br>` across a block boundary, and the rule that turns whitespace into a
  // paragraph break has to cover all four sides: with `paragraphs` off, a chunk holding only block
  // markup brings back the two inner ones.
  test('whitespace inside a block boundary never becomes <br>', () => {
    const config = { input: 'html', html: true, render: { paragraphs: false } };

    for (const src of [
      '<div>\nКорвин - принц\n</div>',
      '<div>\n\nКорвин - принц\n\n</div>',
      '<blockquote>\nДворкин\n</blockquote>'
    ]) {
      const out = microtypo(src, config);

      assert.ok(!out.includes('<br>'), `<br> crossed a block boundary: ${out}`);
    }
  });

  test('a line break in ordinary prose still becomes <br>', () => {
    const out = microtypo('Корвин\nЭрик', { html: true, render: { paragraphs: false } });

    assert.ok(out.includes('<br>'), out);
  });
});

// Taking a block out of the `<p>` around it repairs markup the text group wrote; a code block's body
// and the author's own markup under html:false are text nobody wrapped, so neither is touched.
describe('a block tag the text group did not wrap stays where it is', () => {
  const BLOCK = '<p><div>Корвин</div></p>';

  test('inside a fenced code block', () => {
    const out = wrapped(`Текст.\n\n\`\`\`\n${BLOCK}\n\`\`\`\n\nЕщё.`, { input: 'markdown' });

    assert.ok(out.includes(`\`\`\`\n${BLOCK}\n\`\`\``), out);
  });

  test('inside a <pre> element', () => {
    const out = wrapped(`Текст.\n\n<pre>${BLOCK}</pre>\n\nЕщё.`, { input: 'html' });

    assert.ok(out.includes(`<pre>${BLOCK}</pre>`), out);
  });

  test('in the author markup under html:false', () => {
    assert.equal(microtypo(BLOCK, { html: false }), BLOCK);
  });

  test('a block the text group wrapped is still taken out of its paragraph', () => {
    const out = wrapped('Текст.\n\n<div>Корвин</div>\n\nЕщё.', { input: 'html' });

    assert.equal(out, '<p>Текст.</p>\n\n<div>Корвин</div>\n\n<p>Ещё.</p>');
  });
});

// A paragraph the text group writes belongs to the top level of the author's block tree: it never
// opens on one side of a block boundary and closes on the other, and a block is never inside one.
describe('paragraphs follow the author block tree', () => {
  const BLOCKS = new Set(['div', 'table', 'tr', 'td', 'ul', 'li', 'blockquote', 'section', 'h1']);
  const config = { html: true, rules: { 'hanging.*': false } };

  function assertSound(out) {
    const open = [];

    for (const [, slash, tag] of out.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/g)) {
      if (tag !== 'p' && !BLOCKS.has(tag) && tag !== 'hr') {
        continue;
      }

      if (slash) {
        assert.ok(open.includes(tag), `</${tag}> closes nothing: ${out}`);

        // What it closes past is an element whose end tag HTML lets the author leave out.
        while (open.at(-1) !== tag) {
          assert.notEqual(open.pop(), 'p', `</${tag}> leaves a paragraph open: ${out}`);
        }

        open.pop();
      } else {
        assert.notEqual(open.at(-1), 'p', `<${tag}> inside a paragraph: ${out}`);

        if (tag !== 'hr') {
          open.push(tag);
        }
      }
    }

    assert.deepEqual(open, [], `left open: ${out}`);
    assert.doesNotMatch(out, /<p>\s*<\/p>/, `empty paragraph: ${out}`);
    assert.equal(microtypo(out, config), out, `never settles: ${out}`);
  }

  const cases = [
    ['<div><p>Корвин</p></div>', '<div><p>Корвин</p></div>'],
    ['<div>Корвин\n\nЭрик</div>', '<div>Корвин\n\nЭрик</div>'],
    ['До<div>Амбер</div>После', '<p>До</p>\n\n<div>Амбер</div>\n\n<p>После</p>'],
    ['Корвин <hr> Эрик', '<p>Корвин</p>\n\n<hr>\n\n<p>Эрик</p>'],
    [
      'Абзац.\n\n\u{00A0}уже текст <div>блок</div>',
      '<p>Абзац.</p>\n\n<p>\u{00A0}уже текст</p>\n\n<div>блок</div>'
    ],
    ['<div>блок</div> - "Эрик" идёт', '<div>блок</div>\n\n<p>—\u{00A0}«Эрик» идёт</p>'],
    ['Корвин\n<hr>\nЭрик', '<p>Корвин</p>\n\n<hr>\n\n<p>Эрик</p>'],
    ['Принцы:\n<ul>\n<li>Корвин</li>\n</ul>', '<p>Принцы:</p>\n\n<ul>\n<li>Корвин</li>\n</ul>'],
    [
      '<table>\n<tr><td>Корвин\n\nЭрик</td></tr>\n</table>',
      '<table>\n<tr><td>Корвин\n\nЭрик</td></tr>\n</table>'
    ],
    [
      '<blockquote><p>Корвин</p><p>Рэндом</p></blockquote>',
      '<blockquote><p>Корвин</p><p>Рэндом</p></blockquote>'
    ],
    // The line breaks inside an author element are its markup's and stay as written.
    [
      '<section>\n<h1>Амбер</h1>\n\nКорвин\n</section>',
      '<section>\n<h1>Амбер</h1>\n\nКорвин\n</section>'
    ],
    [
      '<section>\n<h1>Амбер</h1>\n\nКорвин\n\nЭрик\n</section>',
      '<section>\n<h1>Амбер</h1>\n\nКорвин\n\nЭрик\n</section>'
    ],
    ['<div>Начало<p>Корвин</p>Конец</div>', '<div>Начало<p>Корвин</p>Конец</div>'],
    ['<div><p>Корвин</p>Конец</div>\n\nДальше', '<div><p>Корвин</p>Конец</div>\n\n<p>Дальше</p>'],
    ['<div>\n<p>Корвин</p>\n</div>', '<div>\n<p>Корвин</p>\n</div>'],
    // White space at the edge of a block's run goes, as the unwrap always took it.
    [
      'Корвин\n\n  <div>Эрик</div>  \n\nРэндом',
      '<p>Корвин</p>\n\n<div>Эрик</div>\n\n<p>Рэндом</p>'
    ],
    // An end tag HTML lets the author leave out is closed by its parent's.
    [
      '<ul>\n<li>Корвин\n<li>Эрик\n</ul>\n\nДальше',
      '<ul>\n<li>Корвин\n<li>Эрик\n</ul>\n\n<p>Дальше</p>'
    ]
  ];

  for (const [src, expected] of cases) {
    test(JSON.stringify(src), () => {
      const out = microtypo(src, config);

      assert.equal(out, expected);
      assertSound(out);
    });
  }

  test('a protected body inside a block is not touched', () => {
    const src = '<div>Корвин\n\nЭрик\n\n<pre>Рэндом\n\nи\n\nБлейз</pre></div>';

    assert.equal(microtypo(src, config), src);
  });

  test('a blank line inside a heading stays as written', () => {
    assert.equal(microtypo('<h1>Корвин\n\nЭрик</h1>', config), '<h1>Корвин\n\nЭрик</h1>');
  });

  // A self-closing flag empties an SVG or MathML element, so the text after one is outside it.
  test('a self-closing <svg/> holds nothing', () => {
    assert.equal(microtypo('<svg/>\none\n\ntwo', config), '<p><svg/><br>\none</p>\n\n<p>two</p>');
    assert.equal(
      microtypo('<svg/><math/>\nКорвин\n\nЭрик', config),
      '<p><svg/><math/><br>\nКорвин</p>\n\n<p>Эрик</p>'
    );
  });

  const emptyForeign = [
    ['<svg/>', '<svg></svg>'],
    ['<math/>', '<math></math>'],
    ['<svg width="1" viewBox="0 0 1 1" />', '<svg width="1" viewBox="0 0 1 1"></svg>'],
    ['<math display="block"/>', '<math display="block"></math>']
  ];
  const around = [
    (tag) => `${tag}\nКорвин\n\nЭрик`,
    (tag) => `Дворкин\n\n${tag} Корвин\nЭрик\n\nРэндом`,
    (tag) => `<div>Амбер</div>\n${tag}\nКорвин\n\nЭрик\n<div>Рэндом</div>`,
    (tag) => `<b>Амбер</b>${tag}<em>Блейз</em>\nКорвин\n\nЭрик`,
    (tag) => `<svg>${tag}</svg>\nКорвин\n\nЭрик`,
    (tag) => `${tag}\nКорвин\n\n<p>Эрик</p>\n\nРэндом`
  ];
  const settings = [
    ['paragraphs and breakline', config],
    ['paragraphs alone', { ...config, rules: { ...config.rules, 'text.breakline': false } }],
    ['breakline alone', { ...config, rules: { ...config.rules, 'text.paragraphs': false } }]
  ];

  for (const [self, pair] of emptyForeign) {
    for (const [label, options] of settings) {
      test(`${self} reads as ${pair} with ${label}`, () => {
        for (const wrap of around) {
          const out = microtypo(wrap(self), options);

          assert.equal(out.replaceAll(self, pair), microtypo(wrap(pair), options), out);
        }
      });
    }
  }
});

// In HTML the line breaks inside the author's markup lay out the source, so paragraphs and `<br>` go
// into the text outside every author element only. A paragraph boundary inside an inline element
// would also end it: a `</p>` closes every element opened inside its paragraph.
describe('line breaks inside an author element stay as written', () => {
  const config = { html: true, rules: { 'hanging.*': false } };
  const VOID = new Set(['br', 'hr', 'img']);

  // The elements open around every word, as the parser nests them, failing on an end tag that does
  // not close the innermost open element and on a repeated `id`. `marks` counts the `<p>` and `<br>`
  // standing inside an element other than a paragraph at the top.
  function ancestry(html) {
    const open = [];
    const ids = new Set();
    const words = new Map();
    let marks = 0;

    for (const [token, slash, tag, attrs, text] of html.matchAll(
      /<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/g
    )) {
      if (text !== undefined) {
        for (const word of text.split(/[\s\u{00A0}]+/u).filter(Boolean)) {
          words.set(word, open.join(''));
        }
      } else if (slash) {
        assert.equal(open.pop()?.slice(1, tag.length + 1), tag, `</${tag}> crosses: ${html}`);
      } else {
        const id = /\bid="([^"]*)"/.exec(attrs)?.[1];

        assert.ok(id === undefined || !ids.has(id), `id="${id}" repeated: ${html}`);
        ids.add(id);

        if (tag === 'p' && open.length > 0) {
          marks += 1;
        } else if (tag === 'br' && (open.length > 1 || (open.length === 1 && open[0] !== '<p>'))) {
          marks += 1;
        }

        if (!VOID.has(tag) && !attrs.endsWith('/')) {
          open.push(token);
        }
      }
    }

    assert.deepEqual(open, [], `left open: ${html}`);

    return { words, marks };
  }

  // The source of every case but the last ones is its expected output: inside an element nothing
  // changes.
  const unchanged = [
    ['<div>Корвин\nЭрик</div>', { Эрик: '<div>' }],
    ['<p>Корвин\nЭрик</p>', { Эрик: '<p>' }],
    ['<div><span class="red">Корвин\n\nЭрик</span></div>', { Эрик: '<div><span class="red">' }],
    [
      '<div><span style="color:red" id="s">Корвин\n\nЭрик</span></div>',
      { Эрик: '<div><span style="color:red" id="s">' }
    ],
    [
      '<div><em>Принцы <span id="s">Корвин\n\nЭрик\n\nРэндом</span></em></div>',
      { Эрик: '<em><span id="s">', Рэндом: '<em><span id="s">' }
    ],
    ['<div><a href="/amber">Корвин\n\nЭрик</a></div>', { Эрик: '<div><a href="/amber">' }],
    [
      '<div>Дворкин\n\n<span class="red">Корвин\n\nЭрик</span>\n\nРэндом</div>',
      { Дворкин: '<div>', Эрик: '<div><span class="red">', Рэндом: '<div>' }
    ],
    ['<a href="/amber">\n<div>Корвин\n\nЭрик</div>\n</a>', { Эрик: '<a href="/amber"><div>' }],
    [
      '<span class="red">Корвин\n\nЭрик<p>Рэндом</p>Блейз</span>',
      { Эрик: '<span class="red">', Рэндом: '<span class="red"><p>', Блейз: '<span class="red">' }
    ]
  ];

  const changed = [
    ['Корвин\nЭрик', '<p>Корвин<br>\nЭрик</p>', { Эрик: '<p>' }],
    ['Корвин\n\nЭрик', '<p>Корвин</p>\n\n<p>Эрик</p>', { Эрик: '<p>' }],
    [
      '<div><span class="red">Корвин\n\nЭрик</span></div>\n<div>Рэндом\n\nБлейз</div>',
      '<div><span class="red">Корвин\n\nЭрик</span></div>\n\n<div>Рэндом\n\nБлейз</div>',
      { Эрик: '<div><span class="red">', Блейз: '<div>' }
    ],
    // An inline element at the top stands in its paragraph, and keeps its line breaks.
    [
      '<span class="red">Корвин\n\nЭрик</span>',
      '<p><span class="red">Корвин\n\nЭрик</span></p>',
      { Эрик: '<p><span class="red">' }
    ],
    [
      'Дворкин\n\n<span class="red">Корвин\nЭрик</span>\nРэндом',
      '<p>Дворкин</p>\n\n<p><span class="red">Корвин\nЭрик</span><br>\nРэндом</p>',
      { Эрик: '<p><span class="red">', Рэндом: '<p>' }
    ],
    [
      'Корвин <b>Эрик\nРэндом</b> Блейз\nДворкин',
      '<p>Корвин <b>Эрик\nРэндом</b> Блейз<br>\nДворкин</p>',
      { Рэндом: '<p><b>', Дворкин: '<p>' }
    ],
    [
      'Корвин\n\n<em>Эрик\n\nРэндом</em><p>Блейз</p>\n<div>Дворкин</div>',
      '<p>Корвин</p>\n\n<p><em>Эрик\n\nРэндом</em></p>\n\n<p>Блейз</p>\n\n<div>Дворкин</div>',
      { Корвин: '<p>', Рэндом: '<p><em>', Дворкин: '<div>' }
    ],
    // A block inside an inline element is inside an element too, and the run around it stays bare.
    [
      'Дворкин\n\n<a href="/amber"><div>Корвин\n\nЭрик</div></a>\n\nРэндом',
      '<p>Дворкин</p><a href="/amber"><div>Корвин\n\nЭрик</div></a><p>Рэндом</p>',
      { Эрик: '<a href="/amber"><div>', Рэндом: '<p>' }
    ],
    // An element with no end tag wraps nothing.
    [
      '<img src="a.png">\n\nКорвин\nЭрик',
      '<p><img src="a.png"></p>\n\n<p>Корвин<br>\nЭрик</p>',
      { Эрик: '<p>' }
    ],
    [
      '<svg><path d="M0"/></svg> Корвин\n\nЭрик',
      '<p><svg><path d="M0"/></svg> Корвин</p>\n\n<p>Эрик</p>',
      { Эрик: '<p>' }
    ],
    // Text at the top beside an inline element that goes on past an author paragraph.
    [
      'Дворкин\n\n<span class="red">Корвин\n\nЭрик<p>Рэндом</p>Блейз</span>',
      '<p>Дворкин</p><span class="red">Корвин\n\nЭрик<p>Рэндом</p>Блейз</span>',
      { Дворкин: '<p>', Эрик: '<span class="red">', Блейз: '<span class="red">' }
    ],
    [
      'Дворкин\n\n<div>Амбер</div>\n\n<span class="red">Корвин\n\nЭрик<p>Рэндом</p>Блейз</span>',
      '<p>Дворкин</p>\n\n<div>Амбер</div><span class="red">Корвин\n\nЭрик<p>Рэндом</p>Блейз</span>',
      { Амбер: '<div>', Эрик: '<span class="red">', Блейз: '<span class="red">' }
    ],
    [
      '<div><p>Корвин</p>Эрик\n\nРэндом</div>Блейз\n\nДворкин',
      '<div><p>Корвин</p>Эрик\n\nРэндом</div><p>Блейз</p>\n\n<p>Дворкин</p>',
      { Рэндом: '<div>', Дворкин: '<p>' }
    ]
  ];

  for (const [src, expected, inside] of [
    ...unchanged.map(([same, path]) => [same, same, path]),
    ...changed
  ]) {
    test(JSON.stringify(src), () => {
      const out = microtypo(src, config);

      assert.equal(out, expected);

      const { words, marks } = ancestry(out);

      assert.equal(marks, ancestry(src).marks, `a <p> or <br> inside an element: ${out}`);

      for (const [word, path] of Object.entries(inside)) {
        assert.ok(words.get(word)?.endsWith(path), `${word} left ${path}: ${out}`);
      }

      assert.equal(microtypo(out, config), out, `never settles: ${out}`);
    });
  }

  // Open to the end, it holds every line break after it.
  test('an element never closed', () => {
    const out = microtypo('Корвин\n\n<b>Эрик\n\nРэндом\nБлейз', config);

    assert.equal(out, '<p>Корвин</p>\n\n<p><b>Эрик\n\nРэндом\nБлейз</p>');
    assert.equal(microtypo(out, config), out);
  });

  test('an end tag closes what opened inside its element past an author paragraph', () => {
    const out = microtypo('<div><p>Корвин</p><section>Эрик</div>Рэндом\n\nБлейз', config);

    assert.equal(out, '<div><p>Корвин</p><section>Эрик</div><p>Рэндом</p>\n\n<p>Блейз</p>');
    assert.equal(microtypo(out, config), out);
  });

  // HTML ignores the slash on a start tag of its own non-void element, and on one ending an unquoted
  // attribute value; inside an SVG the slash empties the element, which the SVG's end tag closes
  // anyway.
  test('a self-closing slash empties only a foreign element', () => {
    const breakline = { ...config, rules: { ...config.rules, 'text.paragraphs': false } };

    assert.equal(microtypo('<svg/>\nКорвин\nЭрик', breakline), '<svg/><br>\nКорвин<br>\nЭрик');
    assert.equal(microtypo('<math/>\nКорвин\nЭрик', breakline), '<math/><br>\nКорвин<br>\nЭрик');
    assert.equal(microtypo('<span/>\nКорвин\nЭрик', breakline), '<span/>\nКорвин\nЭрик');
    assert.equal(microtypo('<span/>\nКорвин\n\nЭрик', config), '<p><span/>\nКорвин\n\nЭрик</p>');
    assert.equal(
      microtypo('<svg width=1/>\nКорвин\n\nЭрик', config),
      '<p><svg width=1/>\nКорвин\n\nЭрик</p>'
    );
    assert.equal(
      microtypo('<svg><path d="M0"/>\nКорвин\n</svg>\nЭрик\n\nРэндом', config),
      '<p><svg><path d="M0"/>\nКорвин\n</svg><br>\nЭрик</p>\n\n<p>Рэндом</p>'
    );
  });

  test('Markdown with paragraphs on follows the same rule', () => {
    const markdown = {
      ...config,
      input: 'markdown',
      render: { paragraphs: true, breakline: true }
    };

    assert.equal(
      microtypo('Корвин <b>Эрик\nРэндом</b>\nБлейз\n\nДворкин', markdown),
      '<p>Корвин <b>Эрик\nРэндом</b><br>\nБлейз</p>\n\n<p>Дворкин</p>'
    );
  });
});
