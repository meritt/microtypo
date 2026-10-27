import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoConfigError, MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { SafeBlocks } from '../../src/protect/blocks.js';

const HTML_ONLY = { html: true, render: { paragraphs: false } };

// presets:false runs only protect/restore, so no rule touches the text.
function plain() {
  return new MicroTypo({ presets: false });
}

test('pipeline round-trips arbitrary text with no rules active', () => {
  const typo = plain();

  const inputs = [
    'дорога в Амбер',
    '<pre>сырой "код" Лабиринта 1-2-3</pre>',
    'посети https://example.com/corwin?x=1 затем пиши на corwin@example.org',
    '<script>const a = "<b>";</script> тень',
    'data URI: data:text/plain;base64,YQo= затем ещё'
  ];

  for (const text of inputs) {
    assert.equal(typo.process(text), text.trim(), `round-trip differs for: ${text}`);
  }
});

test('functional api returns a string', () => {
  const out = microtypo('Corwin in Amber', {});
  assert.equal(typeof out, 'string');
});

test('safe blocks preserve content inside <pre> exactly', () => {
  const typo = plain();
  const text = '<pre>"единорог" --- не тронут -- в Амбере</pre>';
  assert.equal(typo.process(text), text);
});

test('<notg> wrapper is replaced with span markers by default', () => {
  const typo = plain();
  const text = '<notg>"Грейсвандир"</notg>';
  const expected = '<span class="_notg_start"></span>"Грейсвандир"<span class="_notg_end"></span>';
  assert.equal(typo.process(text), expected);
});

test('internal markers never leak into output', () => {
  const typo = plain();

  const inputs = [
    '<pre>Козырь</pre>',
    'http://example.com Арден',
    'corwin@amber.example',
    '<a href="amber">Козырь</a>',
    '<span>Корвин</span>'
  ];

  for (const text of inputs) {
    const out = typo.process(text);

    assert.ok(
      !/[-]/u.test(out),
      `marker leaked in output of: ${text}\nGot: ${JSON.stringify(out)}`
    );
  }
});

// A literal opener may end in a line break, which leaves the body standing where a line's indent
// would: neither the paragraphs nor the line breaks may open it.
describe('a safe block whose opener ends in a line break', () => {
  const BLOCK = { id: 'custom', open: 'BEGIN\n', close: 'END' };
  const NO_HANGING = { 'hanging.*': false };
  const run = (src, options, block = BLOCK) => {
    const typo = new MicroTypo({ ...options, rules: NO_HANGING });

    typo.addSafeBlock(block);

    return typo.process(src);
  };
  const markup = 'before\nBEGIN\n<div>\n</div>\nEND\nafter';
  const spaces = 'before\nBEGIN\n  \nEND\nafter';

  for (const [label, render, br, wrap] of [
    ['paragraphs and line breaks', {}, '<br>', (s) => `<p>${s}</p>`],
    ['line breaks alone', { paragraphs: false }, '<br>', (s) => s],
    ['paragraphs alone', { breakline: false }, '', (s) => `<p>${s}</p>`],
    ['neither', { paragraphs: false, breakline: false }, '', (s) => s]
  ]) {
    test(`keeps a body of markup with ${label}`, () => {
      assert.equal(
        run(markup, { html: true, render }),
        wrap(`before${br}\nBEGIN${br}\n<div>\n</div>\nEND${br}\nafter`)
      );
    });

    test(`keeps a body of white space with ${label}`, () => {
      assert.equal(
        run(spaces, { html: true, render }),
        wrap(`before${br}\nBEGIN${br}\n  \nEND${br}\nafter`)
      );
    });
  }

  test('keeps both bodies without markup', () => {
    assert.equal(run(markup, {}), markup);
    assert.equal(run(spaces, {}), spaces);
  });

  test('keeps a body behind an opener with no line break', () => {
    assert.equal(
      run('before\nBEGIN<div>\n</div>END\nafter', { html: true }, { ...BLOCK, open: 'BEGIN' }),
      '<p>before<br>\nBEGIN<div>\n</div>END<br>\nafter</p>'
    );
  });

  test('keeps the CRLF of a body behind a CRLF opener', () => {
    assert.equal(
      run(
        'before\r\nBEGIN\r\n<div>\r\n</div>\r\nEND\r\nafter',
        { html: true },
        {
          ...BLOCK,
          open: 'BEGIN\r\n'
        }
      ),
      '<p>before<br>\nBEGIN<br>\n<div>\r\n</div>\r\nEND<br>\nafter</p>'
    );
  });

  test('keeps an indented body whole', () => {
    assert.equal(
      run('before\nBEGIN\n    стих - тут\nEND\nafter', { html: true }),
      '<p>before<br>\nBEGIN<br>\n    стих - тут\nEND<br>\nafter</p>'
    );
  });
});

test('empty safe-block delimiters are rejected', () => {
  const typo = new MicroTypo();
  assert.throws(() => typo.addSafeBlock({ id: 'e', open: '', close: '' }), /delimiter|open|close/i);
});

test('capturing groups in unsafeRegex delimiters do not corrupt the body', () => {
  const typo = new MicroTypo({ presets: false });
  typo.addSafeBlock({ id: 'g', open: '(<<)', close: '(>>)', unsafeRegex: true });
  assert.equal(typo.process('Тир <<"тень" - Корвин>> Амбер'), 'Тир <<"тень" - Корвин>> Амбер');
});

test('nested same-name safe tags protect the outer region', () => {
  const out = microtypo('<code><code>"и" - Тень</code> "о" - Козырь</code>', {
    render: { paragraphs: false }
  });
  assert.ok(!out.includes('«о»') && !out.includes('«и»') && !out.includes('—'), out);
});

test('safe-tag opener with ">" in a quoted attr is not truncated', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<code title="Амбер > Тень">Корвин - Козырь</code>';
  const protectedText = sb.protect(src);
  assert.ok(
    protectedText.startsWith('<code title="Амбер > Тень">'),
    `opener truncated: ${JSON.stringify(protectedText.slice(0, 30))}`
  );
});

test('comment with inner ">" preserved in text mode', () => {
  assert.equal(
    microtypo('<!-- Амбер > Тень - Колвир --> Корвин - Козырь', { render: { paragraphs: false } }),
    '<!-- Амбер > Тень - Колвир --> Корвин\u{00A0}— Козырь'
  );
});

test('paren inside a character class is not turned into a group', () => {
  const sb = new SafeBlocks();
  // "[(]" is a literal "("; corrupted to a group, "?" would open and vault "Тень (Козырь".
  sb.add({ id: 'paren', open: '[(]', close: '[)]', unsafeRegex: true });
  const protectedText = sb.protect('Корвин ? Тень (Козырь) Амбер');
  assert.ok(
    protectedText.startsWith('Корвин ? Тень ('),
    `character class corrupted: ${JSON.stringify(protectedText)}`
  );
});

test('</tag> inside a quoted attr is not a close event (double quotes)', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<code data-x="</code>">Корвин - Козырь</code> Эрик - Хаос';
  const out = sb.protect(src);
  assert.ok(out.startsWith('<code data-x="</code>">'), `opener corrupted: ${out}`);
  assert.ok(!out.includes('</code></code>'), `spurious close inserted: ${out}`);
  assert.ok(out.endsWith('</code> Эрик - Хаос'), `tail corrupted: ${out}`);
});

test('</tag> inside a single-quoted attr is not a close event', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = "<code data-x='</code>'>Корвин</code> Эрик";
  const out = sb.protect(src);
  assert.ok(!out.includes('</code></code>'), `spurious close inserted: ${out}`);
});

test('a safe-tag opener inside another tag attr does not start a block', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<a title="<code>">Корвин - Эрик</a></code> Грейсвандир';
  const out = sb.protect(src);
  // Nothing is vaulted: the `<code>` is attribute text and the `</code>` has no opener.
  assert.equal(out, src);
});

test('nested same-name safe tags still vault the outermost span', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const out = sb.protect('<code><code>i</code> o</code>');
  assert.ok(out.startsWith('<code>') && out.endsWith('</code>'), out);
  assert.ok(!out.includes('<code><code>'), `inner not vaulted: ${out}`);
});

test('safe-tag body with </tag> in its attr stays verbatim; tail is typeset', () => {
  const typo = new MicroTypo({ html: true, render: { paragraphs: false } });
  const out = typo.process('<code data-x="</code>">Корвин - Эрик</code> Хаос - Логрус');
  assert.ok(
    out.startsWith('<code data-x="</code>">Корвин - Эрик</code>'),
    `body not verbatim: ${out}`
  );
  assert.ok(out.includes('Хаос\u{00A0}— Логрус'), `tail not typeset: ${out}`);
});

// A named group is still a capturing group: left alone it shifts the skeleton's positional
// groups, so the replace callback reads the wrong captures and the block loses its delimiters.
test('unsafeRegex delimiters with a named group protect the same span as a non-capturing one', () => {
  const src = 'Дворкин [[код -- Лабиринта]] начертил.';

  const named = new MicroTypo(HTML_ONLY);
  named.addSafeBlock({ id: 'n', open: '(?<mark>\\[\\[)', close: '\\]\\]', unsafeRegex: true });

  const grouped = new MicroTypo(HTML_ONLY);
  grouped.addSafeBlock({ id: 'g', open: '(?:\\[\\[)', close: '\\]\\]', unsafeRegex: true });

  assert.equal(named.process(src), src);
  assert.equal(named.process(src), grouped.process(src));
});

test('unsafeRegex lookbehind is not rewritten into a non-capturing group', () => {
  const typo = new MicroTypo(HTML_ONLY);
  typo.addSafeBlock({ id: 'lb', open: '(?<!x)\\[\\[', close: '\\]\\]', unsafeRegex: true });

  assert.equal(
    typo.process('Дворкин [[код -- тут]] начертил.'),
    'Дворкин [[код -- тут]] начертил.'
  );
});

test('unsafeRegex named group without a closing angle bracket is rejected', () => {
  assert.throws(
    () =>
      new MicroTypo().addSafeBlock({ id: 'bad', open: '(?<mark', close: ']]', unsafeRegex: true }),
    MicroTypoConfigError
  );
});

// A textarea's content is the form's value: typesetting it changes what the reader submits.
test('textarea content is protected while the text around it is typeset', () => {
  const out = new MicroTypo(HTML_ONLY).process(
    '<textarea>Дворкин -- "черновик"</textarea> и "Амбер" -- тут'
  );

  assert.ok(out.includes('<textarea>Дворкин -- "черновик"</textarea>'), out);
  assert.ok(out.includes('«Амбер»'), out);
});

describe('a raw-text element ends at the first closing tag, whatever its own text says', () => {
  const NO_BREAKS = { html: true, render: { paragraphs: false, breakline: false } };

  test('a quote in script content does not open an attribute over the real closer', () => {
    const source = "<script>const note = '<x title=\"'; // Корвин - принц</script>";

    assert.equal(microtypo(source, NO_BREAKS), source);
  });

  test('a same-named tag written inside script content is text, not a nested element', () => {
    const source = '<script>const open = "<script>"; // Мерлин - чародей</script>';

    assert.equal(microtypo(source, NO_BREAKS), source);
  });

  test('a form feed before the closing angle bracket still closes an HTML safe tag', () => {
    const source = '<code>Корвин - принц</code\f>';

    assert.equal(microtypo(source, NO_BREAKS), source);
  });

  test('in XML a same-named element really nests, so the first closer is not the end', () => {
    const source = '<r><script><script>Корвин</script>Мерлин - принц</script></r>';

    assert.equal(microtypo(source, { input: 'xml', ...NO_BREAKS }), source);
  });

  // XML has no tail to run to: an end tag the protected elements cannot pair is malformed, and the
  // document is refused rather than read with that element open.
  test('in XML a form feed is not white space, so the closer is malformed', () => {
    for (const source of [
      '<r><code>Корвин</code\f> Эрик - принц</r>',
      '<r><code>Корвин</code x> Эрик - принц</r>'
    ]) {
      assert.throws(() => microtypo(source, { input: 'xml', ...NO_BREAKS }), MicroTypoInputError);
    }
  });

  test('in XML a closer with XML white space before its > still closes the tag', () => {
    const source = '<r><code>Корвин - принц</code \t\r\n> Эрик - принц</r>';

    assert.equal(
      microtypo(source, { input: 'xml', ...NO_BREAKS }),
      '<r><code>Корвин - принц</code \t\r\n> Эрик\u{00A0}— принц</r>'
    );
  });

  // The tag scanner reads the whole document to decide which `<` begins a real tag, so an unpaired
  // quote inside raw text read as markup opens an attribute value running past the element's end.
  for (const raw of ['script', 'style', 'textarea']) {
    for (const next of ['script', 'code']) {
      test(`a fake attribute quote in ${raw} does not hide the following <${next}>`, () => {
        const source = `<${raw}><x title="</${raw}><${next}>Корвин - принц</${next}>`;

        assert.equal(microtypo(source, NO_BREAKS), source);
      });
    }
  }

  test('an opener written inside a real attribute value is still not a tag', () => {
    const source = '<a title="<code>">Корвин - принц</a>';

    assert.equal(microtypo(source, NO_BREAKS), '<a title="<code>">Корвин\u{00A0}— принц</a>');
  });

  test('an unclosed raw-text opener does not swallow the safe tags behind it', () => {
    const source = '<script>Корвин <code>Мерлин - чародей</code>';

    assert.equal(microtypo(source, NO_BREAKS), '<script>Корвин <code>Мерлин - чародей</code>');
  });

  test('a custom safe tag accepts the same HTML form feed as a default one', () => {
    const typo = new MicroTypo(NO_BREAKS).addSafeTag('amber-safe');
    const source = '<amber-safe>Корвин - принц</amber-safe\f>';

    assert.equal(typo.process(source), source);
  });

  test('in XML a custom safe tag does not accept a form feed either', () => {
    const typo = new MicroTypo({ input: 'xml', ...NO_BREAKS }).addSafeTag('amber-safe');
    const source = '<r><amber-safe>Корвин</amber-safe\f> Эрик - принц</r>';

    assert.throws(() => typo.process(source), MicroTypoInputError);
  });
});

// HTML ignores a slash ending the start tag of an element that is not void, so `<script/>` opens a
// script; XML reads the same tag as an empty element with nothing to protect.
describe('a slash ending an opener', () => {
  const PLAIN = { render: { paragraphs: false, breakline: false } };

  test('does not expose a script body to the rules with default options', () => {
    const source = '<script/>const x = "hello" - 1;</script>';

    assert.equal(microtypo(source), source);
  });

  // A registered tag may be foreign, and `<svg/>` closes itself in HTML too.
  test('opens nothing for a tag the caller registered', () => {
    for (const opener of ['<svg/>', '<svg />', '<svg a="1"/>']) {
      const typo = new MicroTypo(PLAIN).addSafeTag('svg');

      assert.equal(typo.process(`${opener} Текст "а" - б`), `${opener} Текст «а»\u{00A0}— б`);
    }

    const typo = new MicroTypo(PLAIN).addSafeTag('svg');

    assert.equal(
      typo.process('<svg>"а" - б</svg> Текст "в" - г'),
      '<svg>"а" - б</svg> Текст «в»\u{00A0}— г'
    );
  });

  for (const input of ['text', 'html']) {
    for (const opener of ['<script/>', '<textarea/>', '<pre/>', '<code/>', '<pre/class="x">']) {
      const tag = opener.slice(1).split(/[/ ]/u)[0];

      test(`${opener} in ${input} keeps its body and the prose after it is typeset`, () => {
        const source = `${opener}Корвин - "принц"</${tag}> Эрик - Козырь`;

        assert.equal(
          microtypo(source, { ...PLAIN, input }),
          `${opener}Корвин - "принц"</${tag}> Эрик\u{00A0}— Козырь`
        );
      });
    }

    test(`an unclosed <script/> in ${input} keeps its tail verbatim`, () => {
      const out = microtypo('Корвин - Козырь <script/>Эрик - "Хаос"', { ...PLAIN, input });

      assert.equal(out, 'Корвин\u{00A0}— Козырь <script/>Эрик - "Хаос"');
    });
  }

  test('inside a quoted attribute value neither opens nor closes an element', () => {
    const inside = '<pre title="/>">Корвин - "принц"</pre> Эрик - Козырь';
    const around = '<p title="<pre/>">Корвин - Козырь</p>';

    assert.equal(
      microtypo(inside, PLAIN),
      '<pre title="/>">Корвин - "принц"</pre> Эрик\u{00A0}— Козырь'
    );
    assert.equal(microtypo(around, PLAIN), '<p title="<pre/>">Корвин\u{00A0}— Козырь</p>');
  });

  test('with white space or attributes before it in HTML still opens a script', () => {
    for (const opener of ['<script />', '<script a="1"/>']) {
      const source = `${opener}Корвин - "принц"</script> Эрик - Козырь`;

      assert.equal(
        microtypo(source, { ...PLAIN, input: 'html' }),
        `${opener}Корвин - "принц"</script> Эрик\u{00A0}— Козырь`
      );
    }
  });

  for (const empty of ['<pre/>', '<script/>', '<pre />', '<pre a="1"/>', '<script />']) {
    test(`in XML ${empty} is an empty element, so the prose after it is typeset`, () => {
      const source = `<r>${empty}Корвин - Козырь</r>`;

      assert.equal(
        microtypo(source, { input: 'xml', ...PLAIN }),
        `<r>${empty}Корвин\u{00A0}— Козырь</r>`
      );
    });
  }

  test('in XML an empty element does not pair with a later closer', () => {
    const source = '<r><pre/>Эрик - Козырь <pre>Корвин - "принц"</pre></r>';

    assert.equal(
      microtypo(source, { input: 'xml', ...PLAIN }),
      '<r><pre/>Эрик\u{00A0}— Козырь <pre>Корвин - "принц"</pre></r>'
    );
  });

  test('in XML a slash inside a quoted attribute value does not empty the element', () => {
    const source = '<r><pre a="/>" b="c/">Корвин - "принц"</pre> Эрик - Козырь</r>';

    assert.equal(
      microtypo(source, { input: 'xml', ...PLAIN }),
      '<r><pre a="/>" b="c/">Корвин - "принц"</pre> Эрик\u{00A0}— Козырь</r>'
    );
  });
});

// Inside `<svg>` and `<math>` an element belongs to a foreign namespace, where a slash ending the
// start tag closes it. HTML content comes back at an integration point such as `<foreignObject>`, and
// at a start tag that breaks out of foreign content, such as `<p>` or `<pre>`.
// Inside SVG or MathML a `<script>`, a `<style>` or a `<textarea>` is a foreign element whose content
// is markup, so its end tag is the one the markup reads as a tag, never a name in an attribute value.
describe('a raw-text name inside SVG or MathML', () => {
  const PLAIN = { render: { paragraphs: false, breakline: false } };

  for (const input of ['text', 'html']) {
    for (const root of ['svg', 'math']) {
      for (const name of ['style', 'script', 'textarea']) {
        test(`a </${name}> in an attribute value inside <${root}> in ${input} closes nothing`, () => {
          const source = `<${root}><${name}><a id="</${name}><img src=x>">Корвин - "принц"</a></${name}></${root}>`;

          assert.equal(microtypo(source, { ...PLAIN, input }), source);
          assert.equal(
            microtypo(`${source} Эрик - Козырь`, { ...PLAIN, input }),
            `${source} Эрик\u{00A0}— Козырь`
          );
        });
      }
    }
  }

  test('outside foreign content the same element is raw text to its first closer', () => {
    assert.equal(
      microtypo('<style>a[title="</style>Эрик - Козырь', PLAIN),
      '<style>a[title="</style>Эрик\u{00A0}— Козырь'
    );
  });
});

describe('a slash ending an opener in SVG or MathML', () => {
  const PLAIN = { render: { paragraphs: false, breakline: false } };
  const TYPESET = '<p>Корвин\u{00A0}— «принц»</p>';

  for (const input of ['text', 'html']) {
    for (const root of ['svg', 'math', 'SVG']) {
      for (const empty of ['<script/>', '<style/>', '<textarea/>', '<kbd/>', '<script a="1"/>']) {
        test(`${empty} in <${root}> in ${input} is empty and the prose after it is typeset`, () => {
          const source = `<${root}>${empty}</${root}><p>Корвин - "принц"</p>`;

          assert.equal(
            microtypo(source, { ...PLAIN, input }),
            `<${root}>${empty}</${root}>${TYPESET}`
          );
        });
      }
    }
  }

  test('an empty SVG script does not pair with a later script closer', () => {
    const source = '<svg><script/></svg> Эрик - Козырь <script>a - "b"</script>';

    assert.equal(
      microtypo(source, { ...PLAIN, input: 'html' }),
      '<svg><script/></svg> Эрик\u{00A0}— Козырь <script>a - "b"</script>'
    );
  });

  test('a closed script inside SVG keeps its body', () => {
    const source = '<svg><script>Корвин - "принц"</script></svg> Эрик - Козырь';

    assert.equal(
      microtypo(source, { ...PLAIN, input: 'html' }),
      '<svg><script>Корвин - "принц"</script></svg> Эрик\u{00A0}— Козырь'
    );
  });

  // `a/` is an unquoted attribute value, so the tag carries no self-closing slash.
  test('a slash ending an unquoted attribute value does not empty an SVG script', () => {
    for (const value of ['a', "a'", 'a"b', '=']) {
      const source = `<svg><script href=${value}/>Корвин - "принц"</script></svg> Эрик - Козырь`;

      assert.equal(
        microtypo(source, { ...PLAIN, input: 'html' }),
        source.replace('Эрик - Козырь', 'Эрик\u{00A0}— Козырь'),
        value
      );
    }
  });

  for (const [name, prefix, suffix] of [
    ['foreignObject', '<svg><foreignObject>', '</foreignObject></svg>'],
    ['desc', '<svg><desc>', '</desc></svg>'],
    ['mtext', '<math><mtext>', '</mtext></math>'],
    [
      'annotation-xml as HTML',
      '<math><annotation-xml encoding="text/html">',
      '</annotation-xml></math>'
    ],
    ['an element breaking out of SVG', '<svg><p>x</p>', '</svg>'],
    ['font with a size breaking out of SVG', '<svg><font size="2">', '</svg>'],
    ['an SVG that closed itself', '<svg/>', ''],
    ['an SVG inside a comment', '<!-- <svg> -->', '']
  ]) {
    test(`a <script/> after ${name} opens a script`, () => {
      const source = `${prefix}<script/>Корвин - "принц"</script>${suffix} Эрик - Козырь`;

      assert.equal(
        microtypo(source, { ...PLAIN, input: 'html' }),
        `${prefix}<script/>Корвин - "принц"</script>${suffix} Эрик\u{00A0}— Козырь`
      );
    });
  }

  test('a <pre/> breaking out of SVG is an HTML pre and opens its body', () => {
    const source = '<svg><pre/>Корвин - "принц"</pre> Эрик - Козырь';

    assert.equal(
      microtypo(source, { ...PLAIN, input: 'html' }),
      '<svg><pre/>Корвин - "принц"</pre> Эрик\u{00A0}— Козырь'
    );
  });

  for (const [name, source] of [
    ['a closed foreignObject', '<svg><foreignObject><p>x</p></foreignObject><script/></svg>'],
    ['a closed nested SVG', '<svg><svg></svg><script/></svg>'],
    ['font without presentational attributes', '<svg><font><script/></font></svg>']
  ]) {
    test(`a <script/> after ${name} is still SVG and empty`, () => {
      assert.equal(
        microtypo(`${source}<p>Корвин - "принц"</p>`, { ...PLAIN, input: 'html' }),
        `${source}${TYPESET}`
      );
    });
  }

  // Text in a CDATA section closes nothing, and the SVG ends at its own end tag; a browser ignores
  // the end tag of foreignObject while an HTML element inside it is open. Either way the slash
  // opener that follows is an HTML element whose body stays as written.
  const ROOTS = [
    '<svg><![CDATA[x > <svg>]]></svg>',
    `<svg><![CDATA[" > </svg> <math> ' ]]></svg>`,
    '<math><![CDATA[> <math>]]></math>',
    '<svg><foreignObject><![CDATA[> </foreignObject>]]>',
    '<svg><foreignObject><div></foreignObject>',
    '<svg><foreignObject><p>foo</foreignObject>'
  ];

  for (const options of [
    { ...PLAIN, input: 'text' },
    { ...PLAIN, input: 'html' },
    { ...PLAIN, input: 'html', html: true }
  ]) {
    const mode = `${options.input}${options.html ? ' with html' : ''}`;

    for (const root of ROOTS) {
      for (const tag of ['script', 'style', 'textarea']) {
        // Only the body and the prose after it: the text of a CDATA section is SVG text.
        test(`<${tag}/> after ${root} in ${mode} keeps its body`, () => {
          const out = microtypo(
            `${root}<${tag}/>const x = "hello" - 1;</${tag}> Эрик - Козырь`,
            options
          );
          const tail = `<${tag}/>const x = "hello" - 1;</${tag}> Эрик\u{00A0}— Козырь`;

          assert.ok(out.endsWith(tail), out);
        });
      }
    }

    for (const source of [
      '<svg><![CDATA[x > <svg>]]><script/></svg>',
      '<svg><foreignObject><p>a<p>b</p></foreignObject><script/></svg>',
      '<svg><foreignObject><div><p>a</div><br></foreignObject><style/></svg>',
      '<svg><foreignObject><ul><li>a<li>b</ul></foreignObject><script/></svg>',
      '<svg><foreignObject><table><tr><td>a<td>b</table></foreignObject><script/></svg>'
    ]) {
      test(`a <script/> in SVG after ${source.slice(5, 30)}… in ${mode} is empty`, () => {
        assert.equal(microtypo(`${source}<p>Корвин - "принц"</p>`, options), `${source}${TYPESET}`);
      });
    }
  }

  test('in XML a slash opener after a CDATA section in SVG is still an empty element', () => {
    const source = '<r><svg><![CDATA[x > <svg>]]></svg><script/>Корвин - Козырь</r>';

    assert.equal(
      microtypo(source, { ...PLAIN, input: 'xml' }),
      '<r><svg><![CDATA[x > <svg>]]></svg><script/>Корвин\u{00A0}— Козырь</r>'
    );
  });

  test('in XML a script under foreignObject is still an empty element', () => {
    const source = '<svg><foreignObject><script/>Корвин - Козырь</foreignObject></svg>';

    assert.equal(
      microtypo(source, { ...PLAIN, input: 'xml' }),
      '<svg><foreignObject><script/>Корвин\u{00A0}— Козырь</foreignObject></svg>'
    );
  });
});

// A body with nothing a reader can see is a body with no words in it, so a sentence looking for its
// end has to see straight through it — whichever layer holds the bytes.
describe('a protected body that shows nothing keeps the sentence in front of it', () => {
  const CURRENCY = {
    html: true,
    render: { paragraphs: false },
    rules: { 'hanging.*': false }
  };

  test('an empty notg does not take the period after a sum', () => {
    const out = microtypo('Корвин заплатил 100 руб. <notg></notg>', CURRENCY);

    assert.ok(out.includes('100\u{00A0}₽.'), out);
  });

  test('a code span holding only a character reference does not take it either', () => {
    for (const body of ['&nbsp;', '&#32;', '&#x20;']) {
      const out = microtypo(`Корвин заплатил 100 руб. <code>${body}</code>`, CURRENCY);

      assert.ok(out.includes('100\u{00A0}₽.'), `${body}: ${out}`);
    }
  });

  // The other side of the same question: words the reader does see carry the sentence on, so the
  // period belongs to the abbreviation alone and goes with it.
  test('a code span holding a word carries the sentence on', () => {
    const out = microtypo('Корвин заплатил 100 руб. <code>Амбер</code>', CURRENCY);

    assert.ok(out.includes('<code>Амбер</code>'), out);
    assert.ok(out.includes('100\u{00A0}₽ <code>'), out);
  });

  // The layer under this one had already answered for the element's body; the question is asked
  // again one layer up, and a region built out of parts that each show nothing shows nothing too.
  for (const body of ['<script>void 0;</script>', '<style>a{}</style>', '<b></b>', '<br>']) {
    test(`a notg holding only ${body} does not take the period either`, () => {
      const out = microtypo(`Корвин заплатил 100 руб. <notg>${body}</notg>`, CURRENCY);

      assert.ok(out.includes('100\u{00A0}₽.'), out);
      assert.ok(out.includes(body), out);
    });
  }

  test('a notg holding words still carries the sentence on', () => {
    const out = microtypo('Корвин заплатил 100 руб. <notg>за книгу</notg>', CURRENCY);

    assert.ok(out.includes('100\u{00A0}₽ <span'), out);
  });

  test('a notg holding a code span with words carries it on too', () => {
    const out = microtypo('Корвин заплатил 100 руб. <notg><code>Амбер</code></notg>', CURRENCY);

    assert.ok(out.includes('100\u{00A0}₽ <span'), out);
    assert.ok(out.includes('<code>Амбер</code>'), out);
  });
});

// A browser reads an element or a comment that is never closed as running to the end of the
// document, so the rest of the text is its body and not prose.
describe('an unclosed protected region runs to the end of the text', () => {
  const NO_PARAGRAPHS = { render: { paragraphs: false } };
  const PROSE = 'Корвин\u{00A0}— Козырь';

  for (const tag of ['script', 'code']) {
    test(`an unclosed <${tag}> keeps its tail verbatim`, () => {
      const out = microtypo(`Корвин - Козырь <${tag}>Эрик - "Хаос"`, NO_PARAGRAPHS);

      assert.equal(out, `${PROSE} <${tag}>Эрик - "Хаос"`);
    });
  }

  test('an unclosed outer <code> keeps its tail verbatim past a closed inner one', () => {
    const out = microtypo('Корвин - Козырь <code>Эрик <code>Хаос</code> - "Тень"', NO_PARAGRAPHS);

    assert.equal(out, `${PROSE} <code>Эрик <code>Хаос</code> - "Тень"`);
  });

  for (const format of ['text', 'html']) {
    test(`an unclosed HTML comment keeps its tail verbatim in ${format}`, () => {
      const out = microtypo('Корвин - Козырь <!-- Эрик - "Хаос"', {
        ...NO_PARAGRAPHS,
        input: format
      });

      assert.equal(out, `${PROSE} <!-- Эрик - "Хаос"`);
    });
  }

  test('a comment opener inside an attribute value opens no comment', () => {
    const out = microtypo('<img alt="<!--"> Корвин - Козырь', { ...NO_PARAGRAPHS, input: 'html' });

    assert.equal(out, `<img alt="<!--"> ${PROSE}`);
  });

  test('a closed HTML comment in markdown keeps its body and the prose after it is typeset', () => {
    const out = microtypo('Корвин - Козырь <!-- Эрик - "Хаос" --> Бранд - Тень', {
      ...NO_PARAGRAPHS,
      input: 'markdown'
    });

    assert.equal(out, `${PROSE} <!-- Эрик - "Хаос" --> Бранд\u{00A0}— Тень`);
  });

  // HTML's tokenizer and CommonMark read both as whole, empty comments.
  for (const empty of ['<!-->', '<!--->']) {
    for (const format of ['text', 'html', 'markdown']) {
      test(`${empty} closes itself in ${format}`, () => {
        const out = microtypo(`${empty} Корвин - Козырь <!-- Эрик - "Хаос" -->`, {
          ...NO_PARAGRAPHS,
          input: format
        });

        assert.equal(out, `${empty} ${PROSE} <!-- Эрик - "Хаос" -->`);
      });
    }
  }

  test('a closer with its > on an indented line closes a tag registered later', () => {
    const typo = new MicroTypo({ input: 'html' }).addSafeTag('x-note');
    const out = typo.process(
      '<div>\n  <x-note\n    >Эрик - "Хаос"</x-note\n  >\n</div>\nКорвин - Козырь'
    );

    assert.equal(out, `<div>\n  <x-note\n    >Эрик - "Хаос"</x-note\n  >\n</div>\n${PROSE}`);
  });

  test('a markdown comment in a list item keeps its body past a blank line', () => {
    const source = '- <!-- Эрик > Хаос\n\n  Эрик - "Хаос" -->\n\nКорвин - Козырь';

    assert.equal(
      microtypo(source, { ...NO_PARAGRAPHS, input: 'markdown' }),
      source.replace('Корвин - Козырь', PROSE)
    );
  });
});

// What runs to the end of an HTML document — the rest behind an element or comment never closed, or a
// tag the document never ends — is the author's, and markup written into or behind it would close
// their element or finish their tag: paragraphs and line breaks end in front of it.
describe('nothing is written into or behind a region that runs to the end', () => {
  const TAILS = [
    '<pre>x\n\n- "y"',
    '<textarea>x\n ',
    '<script>x\n\n- y',
    '<style>a {}\n\nb',
    '<!-- x\n\n- y',
    '<img src=x onerror=f x=',
    '<img src=x\nonerror=f x=',
    '<svg><img src=x\nonerror=f x=',
    '<math><mi x="y\n'
  ];
  const HEADS = ['Текст - "один"\nвторой', '<p>a', '<p class="x">a</p>\nb'];

  for (const render of [{}, { paragraphs: false }, { breakline: false }]) {
    for (const tail of TAILS) {
      test(`${JSON.stringify(tail)} with ${JSON.stringify(render)}`, () => {
        for (const head of HEADS) {
          const out = microtypo(`${head} ${tail}`, { html: true, render });

          assert.ok(out.endsWith(` ${tail}`) || out.endsWith(`\n${tail}`), out);
          assert.equal(microtypo(out, { html: true, render }), out, 'not stable');
        }
      });
    }
  }

  test('a paragraph closes in front of a tag the document never ends', () => {
    assert.equal(
      microtypo('Текст <img src=x onerror=f x=', { html: true }),
      '<p>Текст</p> <img src=x onerror=f x='
    );
    assert.equal(
      microtypo('Текст <svg><img src=x\nonerror=f x=', { html: true }),
      '<p>Текст</p> <svg><img src=x\nonerror=f x='
    );
  });

  test('an inline element left open takes no closer inside it', () => {
    assert.equal(microtypo('<textarea>x\n ', { html: true }), '<textarea>x\n ');
    assert.equal(
      microtypo('Корвин - "принц"\n\n<script>x\n\n- y', { html: true }),
      '<p>Корвин\u{00A0}— «принц»</p>\n\n<script>x\n\n- y'
    );
  });

  test('an author paragraph open where the region begins stays as written', () => {
    assert.equal(microtypo('<p>a <pre>b</p>', { html: true }), '<p>a <pre>b</p>');
    assert.equal(
      microtypo('Корвин - принц <p class="x">a <textarea>b</p>', { html: true }),
      '<p>Корвин\u{00A0}— принц</p>\n\n<p class="x">a <textarea>b</p>'
    );
  });

  test('a tag the document never ends keeps its bytes without markup too', () => {
    for (const input of ['text', 'html']) {
      for (const src of ['Текст <img alt="a - b', 'Текст <a href=x title="«c» - d\n\ne']) {
        assert.equal(microtypo(src, { input }), src);
      }
    }
  });
});

// A value of a data format is a fragment, not a document a browser reads to its end, so an element
// or comment it leaves open protects nothing past itself. A pair it closes is still protected.
describe('an unclosed element or comment in a value of a data format', () => {
  const OPENERS = ['<pre>', '<script>', '<textarea>', '<!--'];
  const PROSE = 'Корвин - принц';
  const PROSE_TYPESET = 'Корвин\u{00A0}— принц';
  const CLOSED = 'Тег <pre>Эрик - "Хаос"</pre> Корвин - Козырь';
  const CLOSED_TYPESET = 'Тег <pre>Эрик - "Хаос"</pre> Корвин\u{00A0}— Козырь';

  for (const [format, wrap] of [
    ['json', (value) => JSON.stringify({ a: value })],
    ['yaml', (value) => `a: ${value}`],
    ['toml', (value) => `a = '${value}'`],
    ['frontmatter', (value) => `---\na: ${value}\n---\nТело`]
  ]) {
    for (const opener of OPENERS) {
      test(`${opener} leaves the rest of a ${format} value typeset`, () => {
        assert.equal(
          microtypo(wrap(`Тег ${opener} ${PROSE}`), { input: format }),
          wrap(`Тег ${opener} ${PROSE_TYPESET}`)
        );
      });
    }

    test(`a closed pair in a ${format} value keeps its body`, () => {
      assert.equal(microtypo(wrap(CLOSED), { input: format }), wrap(CLOSED_TYPESET));
    });
  }

  test('in an HTML document the same opener still protects the rest', () => {
    for (const format of ['text', 'html']) {
      const source = 'Тег <pre> и Корвин - "принц"';

      assert.equal(microtypo(source, { input: format, render: { paragraphs: false } }), source);
    }
  });
});

// The protections a document's markup is read through come first, so an opener inside a template
// expression, a closed comment or `<notg>` is not markup and opens nothing.
describe('an opener that is not markup where it stands leaves the rest typeset', () => {
  const NO_PARAGRAPHS = { render: { paragraphs: false } };
  const HANDLEBARS = { ...NO_PARAGRAPHS, input: { format: 'html', template: 'handlebars' } };
  const TAIL = ' Дальше\u{00A0}— «текст».';

  const cases = [
    ['a template expression', '{{ "<code>" }}', '{{ "<code>" }}', HANDLEBARS],
    ['a comment opener in a template expression', '{{ "<!--" }}', '{{ "<!--" }}', HANDLEBARS],
    [
      'an ERB expression',
      '<%= "<pre>" %>',
      '<%= "<pre>" %>',
      { ...NO_PARAGRAPHS, input: { template: 'erb' } }
    ],
    [
      'a closed comment',
      '<!-- <div class="old"><pre> -->',
      '<!-- <div class="old"><pre> -->',
      NO_PARAGRAPHS
    ],
    [
      'a closed comment with a bare >',
      '<!-- a > b <code> -->',
      '<!-- a > b <code> -->',
      NO_PARAGRAPHS
    ],
    [
      'a <notg> span',
      '<notg>тег <code></notg>',
      '<span class="_notg_start"></span>тег <code><span class="_notg_end"></span>',
      NO_PARAGRAPHS
    ]
  ];

  for (const [label, source, kept, options] of cases) {
    test(`a tag in ${label}`, () => {
      assert.equal(microtypo(`${source} Дальше - "текст".`, options), kept + TAIL);
    });
  }

  test('a tag in an XML comment', () => {
    const source = '<r>a <!-- x <kbd>b - c <kbd>d - e --> g - h</r>';

    assert.equal(
      microtypo(source, { input: 'xml' }),
      '<r>a <!-- x <kbd>b - c <kbd>d - e --> g\u{00A0}— h</r>'
    );
  });
});

// CommonMark reads raw HTML as a block only where a line opens with it; an unclosed opener anywhere
// else is visible text. Code is read before HTML, so a tag written inside it opens nothing.
describe('in markdown only an unclosed HTML block runs to the end of the text', () => {
  const PROSE = 'Корвин\u{00A0}— Козырь';
  const NEXT = '\n\nДалее "кавычки" - тире.';
  const NEXT_TYPESET = '\n\nДалее «кавычки»\u{00A0}— тире.';

  const typesetTail = [
    ['a tag in a code span', 'Тег `<pre>` - блочный.', 'Тег `<pre>`\u{00A0}— блочный.'],
    ['a tag in a fenced block', '```html\n<pre>\n```', '```html\n<pre>\n```'],
    ['a tag in an indented block', 'Текст.\n\n    <pre> код', 'Текст.\n\n    <pre> код'],
    [
      'a tag in a link destination',
      '[Рэбма](https://e.com/<code>)',
      '[Рэбма](https://e.com/<code>)'
    ],
    ['a tag in a reference definition', '[ref]: http://x.com/<pre>', '[ref]: http://x.com/<pre>'],
    ['a tag in a closed comment', '<!--\n<pre>\n-->', '<!--\n<pre>\n-->'],
    ['an unclosed inline tag', 'Нажми <kbd>Ctrl - C', 'Нажми <kbd>Ctrl\u{00A0}— C'],
    ['an unclosed inline comment', 'Стрелка <!-- тут - да.', 'Стрелка <!-- тут\u{00A0}— да.']
  ];

  for (const [label, source, typeset] of typesetTail) {
    test(`${label} leaves the rest typeset`, () => {
      assert.equal(microtypo(source + NEXT, { input: 'markdown' }), typeset + NEXT_TYPESET);
    });
  }

  test('an inline comment does not close past a blank line', () => {
    const source = 'Текст <!-- a - "b"\n\nДальше - "c".\n\n<!-- x --> и - "y"';

    assert.equal(
      microtypo(source, { input: 'markdown' }),
      'Текст <!-- a\u{00A0}— «b»\n\nДальше\u{00A0}— «c».\n\n<!-- x --> и\u{00A0}— «y»'
    );
  });

  test('a comment opening a line runs past blank lines to its close', () => {
    const source = `<!--\n\nа - "б"\n\n-->${NEXT}`;

    assert.equal(microtypo(source, { input: 'markdown' }), `<!--\n\nа - "б"\n\n-->${NEXT_TYPESET}`);
  });

  test('a tag in a code span leaves the front-matter body typeset', () => {
    const source = `---\ntitle: Тег\n---\nТег \`<pre>\` - блочный.${NEXT}`;

    assert.equal(
      microtypo(source, { input: 'frontmatter' }),
      `---\ntitle: Тег\n---\nТег \`<pre>\`\u{00A0}— блочный.${NEXT_TYPESET}`
    );
  });

  for (const opener of ['<pre>', '<script>', '<textarea>', '<!--', '   <!--']) {
    test(`an unclosed ${opener.trim()} opening a line keeps the rest verbatim`, () => {
      const tail = `${opener}\nЭрик - "Хаос"${NEXT}`;

      assert.equal(
        microtypo(`Корвин - Козырь\n\n${tail}`, { input: 'markdown' }),
        `${PROSE}\n\n${tail}`
      );
    });
  }
});

// CommonMark §4.6 reads HTML blocks line by line, before any inline construct: a line inside an open
// block opens nothing, a block of kind 1 ends at any of its four end tags, and only an opener that is
// markup counts.
describe('markdown HTML-block boundaries', () => {
  const TAIL = 'Дальше - "текст".';
  const TAIL_TYPESET = 'Дальше\u{00A0}— «текст».';
  const HEADERS = { yaml: '---\ntitle: x\n---\n', toml: '+++\ntitle = "x"\n+++\n' };
  const RAW_NAMES = ['pre', 'script', 'style', 'textarea'];

  // Each block before the tail ends, so the tail is prose, in Markdown and in a front-matter body.
  const typesetTail = (label, head, template = 'off') => {
    test(label, () => {
      assert.equal(
        microtypo(head + TAIL, { input: { format: 'markdown', template } }),
        head + TAIL_TYPESET
      );

      for (const [name, header] of Object.entries(HEADERS)) {
        assert.equal(
          microtypo(header + head + TAIL, { input: { format: 'frontmatter', template } }),
          header + head + TAIL_TYPESET,
          `${name} front matter`
        );
      }
    });
  };

  for (const [quote, opener] of [
    ['"', '<pre>'],
    ["'", '<script>'],
    ['"', '<style>'],
    ["'", '<textarea>'],
    ['"', '<!--']
  ]) {
    typesetTail(
      `${opener} in a multiline ${quote}-quoted attribute opens no block`,
      `<div title=${quote}\n${opener}\n${quote}>x</div>\n\n`
    );
  }

  typesetTail('a <pre> line inside an open <div> block opens no block', '<div>\n<pre>\n</div>\n\n');

  test('a comment opener in an attribute leaves the link text typeset', () => {
    assert.equal(
      microtypo(`<a title="<!--">Корвин - "принц"</a> --> ${TAIL}`, { input: 'markdown' }),
      `<a title="<!--">Корвин\u{00A0}— «принц»</a> --> ${TAIL_TYPESET}`
    );
  });

  typesetTail('an end tag in backticks inside the block still ends it', '<pre\nx\n`</pre>`\n\n');
  typesetTail('an end tag in double backticks still ends it', '<script>\nx\n``</script>``\n\n');
  typesetTail(
    'an opener inside a template expression opens no block',
    '{{ "\n<pre>" }}\n\n',
    'handlebars'
  );

  for (const open of RAW_NAMES) {
    for (const close of RAW_NAMES) {
      typesetTail(
        `<${open}> ends at </${close.toUpperCase()}>`,
        `<${open}\nx\n</${close.toUpperCase()}>\n\n`
      );
    }
  }

  const keptVerbatim = (label, head) => {
    test(label, () => {
      const source = `Корвин - Козырь\n\n${head}${TAIL}`;

      assert.equal(
        microtypo(source, { input: 'markdown' }),
        `Корвин\u{00A0}— Козырь\n\n${head}${TAIL}`
      );
    });
  };

  keptVerbatim('</prefix> does not end a <pre> block', '<pre>\nx\n</prefix>\n\n');
  keptVerbatim('a mixed-case opener ending its line runs to the end', '<PrE\nx\n\n');
  keptVerbatim('an opener between template tags is markup', '<pre>\n{{ x }}\n\n');

  test('changes, html and entities see the same boundaries', () => {
    const head = '<div title="\n<pre>\n">x</div>\n\n';
    const typo = new MicroTypo({ input: 'markdown' });
    const result = typo.process(head + TAIL, { changes: true });

    assert.equal(result.text, typo.process(head + TAIL));
    assert.ok(result.changes.length > 0);
    assert.ok(
      result.changes.every(([start]) => start >= head.length),
      JSON.stringify(result)
    );

    for (const options of [{ html: true, render: { paragraphs: false } }, { entities: true }]) {
      const md = { input: 'markdown', ...options };

      assert.equal(microtypo(head + TAIL, md), head + microtypo(TAIL, md));
    }
  });
});
