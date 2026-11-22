import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoBudgetError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';
import { opaqueInline } from '../../src/input/markdown.js';
import { templateReader } from '../../src/input/template.js';
import { SafeBlocks } from '../../src/protect/blocks.js';

for (const [template, open, close] of [
  ['liquid', '{% raw %}', '{% endraw %}'],
  ['liquid', '{%- comment -%}', '{%- endcomment -%}'],
  ['jinja', '{%- raw -%}', '{%- endraw -%}'],
  ['nunjucks', '{% raw %}', '{% endraw %}'],
  ['handlebars', '{{{{raw}}}}', '{{{{/raw}}}}']
]) {
  test(`${template} preserves its raw or comment block body byte for byte`, () => {
    for (const format of ['text', 'html', 'plain', 'markdown', 'frontmatter', 'mdx']) {
      const typo = new MicroTypo({ input: { format, template } });
      const protectedPart = `${open}\r\n<pre>\n{{ broken " }}\nКорвин - "принц"\n\n:::note\n${close}`;
      assert.equal(
        typo.process(`${protectedPart}\n\nАмбер - город`),
        `${protectedPart}\n\nАмбер\u{00A0}— город`
      );
      assert.equal(
        typo.process(`${open}Корвин - "принц"${close}`),
        `${open}Корвин - "принц"${close}`
      );
    }
  });
}

test('ordinary template block bodies remain prose and template off stays opt-in', () => {
  const typo = new MicroTypo({ input: { template: 'liquid' } });
  assert.equal(
    typo.process('{% if x %}Корвин - принц{% endif %}'),
    '{% if x %}Корвин\u{00A0}— принц{% endif %}'
  );
  assert.equal(
    new MicroTypo().process('{% raw %}Корвин - принц{% endraw %}'),
    '{% raw %}Корвин\u{00A0}— принц{% endraw %}'
  );
});

test('an unclosed raw block protects its remaining body without leaking state to the next call', () => {
  for (const [template, open] of [
    ['liquid', '{% raw %}'],
    ['handlebars', '{{{{raw}}}}']
  ]) {
    const typo = new MicroTypo({ input: { template } });
    const source = `${open}Корвин - "принц"\n\n`;
    assert.equal(typo.process(source), source);
    assert.equal(typo.process('Амбер - город'), 'Амбер\u{00A0}— город');
  }
});

test('HTML paragraphs close before an unclosed template body and stay stable', () => {
  for (const [template, open] of [
    ['liquid', '{% comment %}'],
    ['liquid', '{% raw %}'],
    ['handlebars', '{{{{raw}}}}']
  ]) {
    const typo = new MicroTypo({ html: true, input: { template } });
    const source = `Начало\n\nКорвин ${open}хвост - "сырой"\n\nконец`;
    const expected = `<p>Начало</p>\n\n<p>Корвин</p> ${open}хвост - "сырой"\n\nконец`;
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  }
});

test('template-looking raw delimiters inside code do not own neighboring prose', () => {
  const typo = new MicroTypo({ input: { format: 'markdown', template: 'liquid' } });
  assert.equal(
    typo.process('`{% raw %}` Корвин - принц `{% endraw %}`'),
    '`{% raw %}` Корвин\u{00A0}— принц `{% endraw %}`'
  );
  assert.equal(
    typo.process('```\n{% raw %}\n```\n\nКорвин - принц\n\n{% endraw %}'),
    '```\n{% raw %}\n```\n\nКорвин\u{00A0}— принц\n\n{% endraw %}'
  );
});

test('a long ordinary template expression inside HTML code remains code', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    const source = `<code>{{ ${'x'.repeat(9000)} }}</code> Корвин - принц`;
    assert.equal(typo.process(source), source.replace('Корвин - принц', 'Корвин\u{00A0}— принц'));
  }
});

test('the earliest safe HTML element or template body owns its interior', () => {
  for (const format of ['text', 'html', 'markdown']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    typo.addSafeTag('sample');
    for (const tag of ['code', 'pre', 'script', 'sample']) {
      const source = `<${tag}>{% raw %}</${tag}> Корвин - принц {% endraw %}`;
      assert.equal(
        typo.process(source),
        `<${tag}>{% raw %}</${tag}> Корвин\u{00A0}— принц {% endraw %}`
      );
      const reverse = `{% raw %}<${tag}>Корвин - "принц"{% endraw %} Амбер - город </${tag}>`;
      assert.equal(
        typo.process(reverse),
        `{% raw %}<${tag}>Корвин - "принц"{% endraw %} Амбер\u{00A0}— город </${tag}>`
      );
    }
  }
});

test('a raw opener in an HTML comment owns nothing past the comment', () => {
  const typo = new MicroTypo({ input: { template: 'liquid' } });
  const source = '<!-- {% raw %}\n\ncomment --> Корвин - принц {% endraw %}';
  assert.equal(
    typo.process(source),
    '<!-- {% raw %}\n\ncomment --> Корвин\u{00A0}— принц {% endraw %}'
  );
});

for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
  test(`${format} keeps template openers inside a closed HTML comment opaque`, () => {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    assert.equal(typo.process('<!--{%-->{%%}'), '<!--{%-->{%%}');
    assert.equal(
      typo.process('<!--{%-->{%%} Корвин - принц'),
      '<!--{%-->{%%} Корвин\u{00A0}— принц'
    );
  });
}

test('opaque declarations and foreign CDATA own no template header', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    for (const held of ['<?{%?>', '<!DOCTYPE {%>', '<svg><![CDATA[{%]]></svg>']) {
      assert.equal(typo.process(`${held} Корвин - принц %}`), `${held} Корвин\u{00A0}— принц %}`);
    }
  }
});

test('an independent MDX tag endpoint bounds expression atoms and its self-closing slash', () => {
  const typo = new MicroTypo({ input: { format: 'mdx', template: 'jinja' } });
  const source = '<svg data="{#"/><script/>Корвин - "принц"</script>#} Амбер - город';
  const expected = '<svg data="{#"/><script/>Корвин - "принц"</script>#} Амбер\u{00A0}— город';
  assert.equal(typo.process(source), expected);
  assert.equal(typo.process(expected), expected);
});

test('opaque owner endpoints win over template delimiters inside, after or across them', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
    for (const [template, open, close] of [
      ['liquid', '{%', '%}'],
      ['liquid', '{{', '}}'],
      ['jinja', '{#', '#}'],
      ['handlebars', '{{!', '}}'],
      ['erb', '<%#', '%>']
    ]) {
      const typo = new MicroTypo({ input: { format, template } });
      for (const [head, tail] of [
        [`<!--${open} x ${close}-->`, ''],
        [`<!--${open}-->`, close],
        [`<!--${open}-->`, `${open}${close}`],
        [`<!--${open}-->`, ''],
        [`<?${open}?>`, close],
        [`<!D ${open}>`, close],
        [`<svg><![CDATA[${open}]]></svg>`, close]
      ]) {
        const source = `${head} Корвин - принц ${tail}`.trimEnd();
        const expected = `${head} Корвин\u{00A0}— принц ${tail}`.trimEnd();
        assert.equal(typo.process(source), expected, `${format}/${template}: ${source}`);
        assert.equal(typo.process(expected), expected, `second pass: ${source}`);
      }
    }
  }
});

test('a long template-looking expression in an opaque comment cannot exhaust its scan bound', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    for (const held of [
      `<!--{% ${'x'.repeat(9000)}-->`,
      `<?{% ${'x'.repeat(9000)}?>`,
      `<svg><![CDATA[{% ${'x'.repeat(9000)}]]></svg>`
    ]) {
      const source = `${held} Корвин - принц %}`;
      const expected = `${held} Корвин\u{00A0}— принц %}`;
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('a template body that opens first owns apparent HTML comments and declarations', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
    for (const [template, open, close] of [
      ['liquid', '{% raw %}', '{% endraw %}'],
      ['liquid', '{% comment %}', '{% endcomment %}'],
      ['handlebars', '{{{{raw}}}}', '{{{{/raw}}}}']
    ]) {
      const typo = new MicroTypo({ input: { format, template } });
      for (const syntax of ['<!--{%-->', '<?{%?>', '<![CDATA[{%]]>']) {
        const source = `${open}${syntax} Корвин - "принц"${close} Амбер - город`;
        const expected = `${open}${syntax} Корвин - "принц"${close} Амбер\u{00A0}— город`;
        assert.equal(typo.process(source), expected);
        assert.equal(typo.process(expected), expected);
      }
      assert.equal(typo.process('Корвин - принц'), 'Корвин\u{00A0}— принц');
    }
  }
});

test('unclosed HTML comments retain their document and Markdown meanings', () => {
  const source = 'Пролог <!--\n\nКорвин - принц';
  for (const format of ['text', 'html']) {
    assert.equal(new MicroTypo({ input: { format, template: 'liquid' } }).process(source), source);
  }
  for (const format of ['markdown', 'frontmatter', 'mdx']) {
    assert.equal(
      new MicroTypo({ input: { format, template: 'liquid' } }).process(source),
      'Пролог <!--\n\nКорвин\u{00A0}— принц'
    );
  }
});

test('a raw opener inside an XML construct or preserved subtree owns no later prose', () => {
  const typo = new MicroTypo({ input: { format: 'xml', template: 'liquid' } });
  for (const held of [
    '<![CDATA[{% raw %}]]>',
    '<?instruction {% raw %}?>',
    '<x xml:space="preserve">{% raw %}</x>'
  ]) {
    const source = `<root>${held} Корвин - принц {% endraw %}</root>`;
    assert.equal(typo.process(source), `<root>${held} Корвин\u{00A0}— принц {% endraw %}</root>`);
  }
});

for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx']) {
  test(`${format} resumes lexical ownership after a template body`, () => {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    typo.addSafeTag('sample');
    for (const source of [
      '<?php echo "{% raw %}"; ?> Корвин - принц {% endraw %}',
      '<span title="{% raw %}">Корвин - принц</span> {% endraw %}',
      '<span title="<code>{% raw %}</code>">Корвин - принц</span> {% endraw %}',
      '{% raw %}<span title="{% endraw %}<code>{% raw %}</code> Корвин - принц {% endraw %}',
      '{% raw %}<?php echo "{% endraw %}<sample>{% raw %}</sample> Корвин - принц {% endraw %}',
      '{% raw %}<!-- " < {% endraw %}<!-- {% raw %} --> Корвин - принц {% endraw %}',
      '{% raw %}<svg>{% endraw %}<script/>{% raw %}</script> Корвин - принц {% endraw %}',
      '<code>{% raw %}</code> Корвин - принц {% endraw %}',
      '<sample>{% raw %}</sample> Корвин - принц {% endraw %}',
      '{% assign x = "<code>" %} Корвин - принц <code>{% raw %}</code> {% endraw %}'
    ]) {
      const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
      assert.equal(typo.process(source), expected, source);
      assert.equal(typo.process(expected), expected, `second pass: ${source}`);
    }
    assert.equal(typo.process('Корвин - принц'), 'Корвин\u{00A0}— принц');
  });
}

test('unfinished fragment tags yield to raw bodies while an HTML document keeps its tail', () => {
  const body = '{% raw %}Код - "сырой"{% endraw %}';
  const source = `<span title="${body} Корвин - принц`;
  for (const format of ['markdown', 'frontmatter']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    const output = typo.process(source);
    assert.ok(output.includes(body));
    assert.ok(output.endsWith('Корвин\u{00A0}— принц'));
  }
  for (const format of ['text', 'html', 'plain']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    const output = typo.process(source);
    assert.ok(output.includes(body));
    if (format === 'plain') {
      assert.ok(output.endsWith('Корвин\u{00A0}— принц'));
    } else {
      assert.equal(output, source);
    }
  }
});

test('resuming markup ownership applies to each raw-template syntax', () => {
  for (const [template, open, close] of [
    ['liquid', '{%- comment -%}', '{%- endcomment -%}'],
    ['jinja', '{% raw %}', '{% endraw %}'],
    ['nunjucks', '{%- raw -%}', '{%- endraw -%}'],
    ['handlebars', '{{{{raw}}}}', '{{{{/raw}}}}']
  ]) {
    for (const format of ['text', 'html', 'markdown', 'mdx']) {
      const typo = new MicroTypo({ input: { format, template } });
      for (const source of [
        `<?php echo "${open}"; ?> Корвин - принц ${close}`,
        `<span title="${open}">Корвин - принц</span> ${close}`,
        `${open}<span title="${close}<code>${open}</code> Корвин - принц ${close}`
      ]) {
        const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
        assert.equal(typo.process(source), expected);
        assert.equal(typo.process(expected), expected);
      }
    }
  }
});

test('block scanners resume behind the same winning attribute or raw body', () => {
  for (const format of ['markdown', 'frontmatter', 'mdx']) {
    const typo = new MicroTypo({ input: { format, template: 'liquid' } });
    for (const head of [
      '<?php echo "{% raw %}"; ?>',
      '<span title="{% raw %}"></span>',
      '{% raw %}<span title="{% endraw %}'
    ]) {
      const source = `${head}\n\n<pre>\n\`\`\`\nКод - "сырой"\n</pre>\n\nКорвин - принц\n\n{% endraw %}`;
      const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('lexical ownership checks the private budget during long body and tag reads', () => {
  const blocks = new SafeBlocks();
  blocks.addTag('code');
  blocks.addTag('script', { nests: false });
  const scan = opaqueInline(null, templateReader('liquid'), [
    (text, budget) => blocks.elementReader(text, budget)
  ]);
  for (const source of [
    `${'<code><svg>'.repeat(1000)}<span title="</code>"> {% raw %}x{% endraw %}`,
    `<span ${'x'.repeat(100_000)}="{% raw %}">конец{% endraw %}`,
    `<script>${'</other>'.repeat(1000)}</script>{% raw %}x{% endraw %}`
  ]) {
    let steps = 0;
    assert.throws(
      () =>
        scan(source, () => {
          if (++steps === 6) {
            throw new MicroTypoBudgetError('ownership deadline');
          }
        }),
      MicroTypoBudgetError
    );
  }
});

test('tag endpoints keep ordinary expression atoms whole without expanding a raw body', () => {
  for (const format of ['text', 'html', 'markdown', 'frontmatter', 'mdx', 'json']) {
    const typo = new MicroTypo({ input: { format, template: 'nunjucks' } });
    for (const body of [
      'y <<землях {% if a - b > 0 %}',
      '<span data={% if a - b > 0 %}>Корвин - принц</span>',
      '<span title="{{ "a > b" }}">Корвин - принц</span>',
      '<?php echo "{{ a > b }}"; ?> Корвин - принц',
      '<svg data={{ ">" }}/><code>{% raw %}</code> Корвин - принц {% endraw %}',
      `<svg data={{ 'a="' }} /><script/>{% raw %}</script> Корвин - принц {% endraw %}`
    ]) {
      const source = format === 'json' ? JSON.stringify({ text: body }) : body;
      const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
      assert.equal(typo.process(source), expected, `${format}: ${source}`);
      assert.equal(typo.process(expected), expected);
    }
  }
});

test('tag syntax keeps long template comments atomic', () => {
  for (const format of ['text', 'html', 'markdown', 'mdx', 'json']) {
    const typo = new MicroTypo({ input: { format, template: 'handlebars' } });
    const body = `<span data={{!-- ${'x'.repeat(9000)} > "quoted" --}}>Корвин - принц</span>`;
    const source = format === 'json' ? JSON.stringify({ text: body }) : body;
    const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  }
});

test('a literal body lookahead cannot reuse an ending for a different atomic tag boundary', () => {
  const typo = new MicroTypo({ input: { format: 'markdown', template: 'liquid' } });
  const source = `До <code><code data={{ "> <span title='" }}> {% raw %}</code> Корвин - принц {% endraw %}<i title="</code>">`;
  const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
  assert.equal(typo.process(source), expected);
  assert.equal(typo.process(expected), expected);
});

test('ordinary Markdown tag ownership ends before another paragraph of code', () => {
  const code = '`  уложения  меж\tсверху`';
  for (const format of ['markdown', 'frontmatter']) {
    for (const template of ['off', 'liquid']) {
      for (const html of [false, true]) {
        const typo = new MicroTypo({
          html,
          input: { format, template },
          render: { paragraphs: html, breakline: html }
        });
        for (const head of [
          'x <span data=',
          'x <<x,',
          'x <span title="',
          'x <code data=',
          'x <pre data='
        ]) {
          const source = `${head}\n\n${code}\n\n> Корвин - принц`;
          const output = typo.process(source);
          assert.ok(output.includes(code), `${format}/${template}/${html}: ${source}`);
          assert.ok(output.includes('Корвин\u{00A0}— принц'));
        }
        const unquoted = '`  уложения  > меж\tсверху`';
        const output = typo.process(`x <span data=${unquoted}> Корвин - принц`);
        assert.ok(output.includes(unquoted));
        assert.ok(output.includes('Корвин\u{00A0}— принц'));
      }
    }
  }
});

test('ordinary multiline attributes and HTML document ownership keep their bytes', () => {
  const code = '`  уложения  меж\tсверху`';
  for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
    // A textual attribute is typeset by default; this test reads the bytes of one left as written.
    const typo = new MicroTypo({ input: { format, template: 'liquid', attributes: [] } });
    for (const source of [
      `Пролог <span title="первая\n${code}">Корвин - принц</span>`,
      `<pre title="первая\n\n${code}">Сырой - "код"</pre> Корвин - принц`
    ]) {
      assert.equal(typo.process(source), source.replace('Корвин - принц', 'Корвин\u{00A0}— принц'));
    }
  }
});
