import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoConfigError } from '../../src/errors/index.js';
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

  test('in XML a form feed is not white space, so it does not close the tag', () => {
    const source = '<r><code>Корвин - принц</code\f></r>';

    assert.ok(microtypo(source, { input: 'xml', ...NO_BREAKS }).includes('Корвин\u{00A0}— принц'));
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
    const source = '<r><amber-safe>Корвин - принц</amber-safe\f></r>';

    assert.ok(typo.process(source).includes('Корвин\u{00A0}— принц'));
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
