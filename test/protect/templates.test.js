import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';
import { templateScanner } from '../../src/input/template.js';

const NBSP = '\u{00A0}';

test('handlebars vaults {{ }}, typesets the surrounding text', () => {
  const out = microtypo('Корвин {{ user.name }} "брат"', { input: { template: 'handlebars' } });
  assert.match(out, /\{\{ user\.name \}\}/);
  assert.match(out, /«брат»/);
});

test('liquid vaults {% %} spans, no dash inside', () => {
  const out = microtypo('{% if a - b %}Тень{% endif %} "x"', { input: { template: 'liquid' } });
  assert.match(out, /\{% if a - b %\}/);
  assert.match(out, /\{% endif %\}/);
  assert.doesNotMatch(out, /—/);
  assert.match(out, /«x»/);
});

test('erb vaults <% %> spans', () => {
  const out = microtypo('<%= x - y %> "z"', { input: { template: 'erb' } });
  assert.match(out, /<%= x - y %>/);
  assert.match(out, /«z»/);
});

test('handlebars matches triple {{{ }}} before double, so it is not half-consumed', () => {
  const out = microtypo('{{{ raw - val }}} "q"', { input: { template: 'handlebars' } });
  assert.match(out, /\{\{\{ raw - val \}\}\}/);
  assert.match(out, /«q»/);
});

test('jinja vaults {# #} comments alongside {{ }}', () => {
  const out = microtypo('{# comment - x #}{{ y }} "z"', { input: { template: 'jinja' } });
  assert.match(out, /\{# comment - x #\}/);
  assert.match(out, /\{\{ y \}\}/);
  assert.match(out, /«z»/);
});

test('markdown and handlebars compose: the fence and the template both survive', () => {
  const out = microtypo('```code```\n{{ x - y }} "w"', {
    input: { format: 'markdown', template: 'handlebars' }
  });
  assert.match(out, /```code```/);
  assert.match(out, /\{\{ x - y \}\}/);
  assert.match(out, /«w»/);
});

test('without a template the {{ }} interior is typeset (protection is opt-in)', () => {
  const out = microtypo('{{ a - b }}');
  assert.match(out, /—/);
});

test('templateScanner matches {{{ before {{ at the same position', () => {
  const scan = templateScanner('handlebars');
  const src = '{{{ a }}} {{ b }}';
  // '{{{ a }}}' wins at 0 as a triple, not a double '{{' with a stray '{' left over.
  assert.deepEqual(scan(src), [
    [0, 9],
    [10, 17]
  ]);
});

test('templateScanner returns null for an unknown engine', () => {
  assert.equal(templateScanner('nope'), null);
});

test('delimiter inside a quoted expression string does not close early (handlebars)', () => {
  const out = microtypo('{{ "a }} b - c" }}', {
    input: { template: 'handlebars' },
    render: { paragraphs: false }
  });
  assert.equal(out, '{{ "a }} b - c" }}');
});

test('delimiter inside a quoted expression string does not close early (jinja)', () => {
  const out = microtypo('{% set x="a %} b - c" %}', {
    input: { template: 'jinja' },
    render: { paragraphs: false }
  });
  assert.equal(out, '{% set x="a %} b - c" %}');
});

test('single-quoted expression strings are honored', () => {
  const out = microtypo("{{ 'a }} b - c' }}", {
    input: { template: 'handlebars' },
    render: { paragraphs: false }
  });
  assert.equal(out, "{{ 'a }} b - c' }}");
});

test('a backslash-escaped quote does not end the expression string early', () => {
  const out = microtypo('{{ "a \\" }} b - c" }}', {
    input: { template: 'handlebars' },
    render: { paragraphs: false }
  });
  assert.equal(out, '{{ "a \\" }} b - c" }}');
});

const run = (src, template) =>
  microtypo(src, { input: { template }, render: { paragraphs: false } });

describe('a quote inside a template comment does not open a string', () => {
  test('handlebars: a dashed comment longer than the scan bound still closes at --}}', () => {
    const body = '<li class="item">{{title}} - {{price}}</li>\n'.repeat(200);
    const src = `{{!--\n${body}--}}\n<p>Цена "по запросу" - звоните</p>`;

    assert.equal(
      microtypo(src, { input: { format: 'html', template: 'handlebars' } }),
      `{{!--\n${body}--}}\n<p>Цена «по${NBSP}запросу»${NBSP}— звоните</p>`
    );
  });

  test('erb: a Ruby # comment runs to the end of the line', () => {
    const src = '<% x = 1 # don\'t change\n y = "hello" %>';

    assert.equal(microtypo(src, { input: { format: 'html', template: 'erb' } }), src);
  });

  test('erb: a Ruby # comment still ends at %>', () => {
    assert.equal(
      run('<% x = 1 # it\'s "a %> "b" - c', 'erb'),
      `<% x = 1 # it's "a %> «b»${NBSP}— c`
    );
  });

  test('erb: a <%# %> comment tag spans lines and ignores both quotes', () => {
    const src = '<%# Don\'t change "hello\n - world %> "z"';

    assert.equal(run(src, 'erb'), '<%# Don\'t change "hello\n - world %> «z»');
  });

  test('erb: # inside a string is not a comment, so the string still hides %>', () => {
    const src = '<% s = "#{a} %> b - c" %>';

    assert.equal(run(src, 'erb'), src);
  });

  for (const template of ['jinja', 'twig', 'nunjucks']) {
    test(`${template}: {# #} ends at #} regardless of quotes`, () => {
      const src = '{# Don\'t change "hello" - world #}';

      assert.equal(microtypo(src, { input: { template } }), src);
      assert.equal(
        run('{#- it\'s\n "a - b -#} "z" {{ "c #} d" }}', template),
        '{#- it\'s\n "a - b -#} «z» {{ "c #} d" }}'
      );
    });
  }

  test('handlebars: {{! }} ends at the first }}', () => {
    assert.equal(run('{{! don\'t "x" - y }} "z"', 'handlebars'), '{{! don\'t "x" - y }} «z»');
    assert.equal(run('{{~! it\'s ~}} "z"', 'handlebars'), "{{~! it's ~}} «z»");
  });

  test('handlebars: {{!-- --}} ends at --}}, past quotes and inner }}', () => {
    const src = '{{!-- it\'s {{x}} "y\n - z --}} "w"';

    assert.equal(run(src, 'handlebars'), '{{!-- it\'s {{x}} "y\n - z --}} «w»');
    assert.equal(run('{{~!-- don\'t - a --~}} "w"', 'handlebars'), "{{~!-- don't - a --~}} «w»");
    assert.equal(run('{{!--}} "w"', 'handlebars'), '{{!--}} «w»');
  });

  test('handlebars: a {{!-- with no --}} anywhere is still vaulted to the first }}', () => {
    assert.equal(run('{{!-- a - b }} "w"', 'handlebars'), '{{!-- a - b }} «w»');
  });

  test('mustache: {{! }} ends at the first }}', () => {
    assert.equal(run('{{! don\'t "x" - y }} "z"', 'mustache'), '{{! don\'t "x" - y }} «z»');
  });

  test('liquid: an inline # comment ignores quotes', () => {
    assert.equal(
      run('{%- # don\'t change "x" - y -%} "z"', 'liquid'),
      '{%- # don\'t change "x" - y -%} «z»'
    );

    const block = '{% liquid\n  # it\'s\n  assign x = "a %} b - c"\n%}';

    assert.equal(run(`${block} "z"`, 'liquid'), `${block} «z»`);
  });

  test('liquid: # inside a string is not a comment, so the string still hides %}', () => {
    const src = '{% assign t = "#" | append: "a %} b - c" %}';

    assert.equal(run(src, 'liquid'), src);
  });
});

test('an unclosed opening delimiter is left as literal text, typeset normally', () => {
  const out = microtypo('{{ a - b', {
    input: { template: 'handlebars' },
    render: { paragraphs: false }
  });
  assert.equal(out, `{{ a${NBSP}— b`);
});

describe('input.template composes with every input.format', () => {
  test('markdown: template preserved, surrounding dash typeset', () => {
    const src = 'Корвин {{u}}, брат - принц';
    const out = microtypo(src, { input: { format: 'markdown', template: 'handlebars' } });

    assert.equal(out, `Корвин {{u}}, брат${NBSP}— принц`);
  });

  test('markdown: quotes convert to angle quotes alongside a template span', () => {
    const src = '{{u}} "в Тенях"';
    const out = microtypo(src, { input: { format: 'markdown', template: 'handlebars' } });

    assert.equal(out, `{{u}} «в${NBSP}Тенях»`);
  });

  test('xml: template and tags verbatim, quoted text gets angle quotes', () => {
    const src = '<x>принц {{u}} "в Тенях"</x>';
    const out = microtypo(src, { input: { format: 'xml', template: 'handlebars' } });

    assert.equal(out, `<x>принц {{u}} «в${NBSP}Тенях»</x>`);
  });

  test('json: template preserved, dash converted, key untouched, output re-parses', () => {
    const src = '{"g":"{{u}} Корвин - Эрик"}';
    const out = microtypo(src, { input: { format: 'json', template: 'handlebars' } });

    assert.equal(out, `{"g":"{{u}} Корвин${NBSP}— Эрик"}`);
    assert.ok(out.includes('"g"'), 'key must stay byte-identical');
    assert.deepEqual(JSON.parse(out), { g: `{{u}} Корвин${NBSP}— Эрик` });
  });

  test('yaml: quoted value composes, a bare scalar with a template is skipped', () => {
    const quoted = microtypo('g: "{{u}} Корвин - Эрик"', {
      input: { format: 'yaml', template: 'handlebars' }
    });

    assert.equal(quoted, `g: "{{u}} Корвин${NBSP}— Эрик"`);

    // Bare YAML scalars are never typeset, template inside or not.
    const bare = 'g: {{u}} Корвин - Эрик';
    const bareOut = microtypo(bare, { input: { format: 'yaml', template: 'handlebars' } });

    assert.equal(bareOut, bare);
  });

  test('toml: template preserved, dash converted', () => {
    const src = 'g = "{{u}} Корвин - Эрик"';
    const out = microtypo(src, { input: { format: 'toml', template: 'handlebars' } });

    assert.equal(out, `g = "{{u}} Корвин${NBSP}— Эрик"`);
  });

  test('frontmatter: header and body typeset around templates, delimiters verbatim', () => {
    const src = '---\ng: "песнь {{u}} - x"\n---\nтело {{v}}, принц - Амбера';
    const out = microtypo(src, { input: { format: 'frontmatter', template: 'handlebars' } });

    assert.equal(out, `---\ng: "песнь {{u}}${NBSP}— x"\n---\nтело {{v}}, принц${NBSP}— Амбера`);
  });

  test('liquid {% %} in a markdown body: tag verbatim, surrounding text typeset', () => {
    const src = '{% if a %}принц - Амбера{% endif %}';
    const out = microtypo(src, { input: { format: 'markdown', template: 'liquid' } });

    assert.equal(out, `{% if a %}принц${NBSP}— Амбера{% endif %}`);
  });

  test('erb <% %> in a json value: tag verbatim, dash converted, output re-parses', () => {
    const src = '{"g":"<%= x %> принц - Амбера"}';
    const out = microtypo(src, { input: { format: 'json', template: 'erb' } });

    assert.equal(out, `{"g":"<%= x %> принц${NBSP}— Амбера"}`);
    assert.deepEqual(JSON.parse(out), { g: `<%= x %> принц${NBSP}— Амбера` });
  });

  test('a template interior is never typeset across every format', () => {
    assert.doesNotMatch(
      microtypo('{{ a - b }}', { input: { format: 'markdown', template: 'handlebars' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('<x>{{ a - b }}</x>', { input: { format: 'xml', template: 'handlebars' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('{"g":"{{ a - b }}"}', { input: { format: 'json', template: 'handlebars' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('g: "{{ a - b }}"', { input: { format: 'yaml', template: 'handlebars' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('g = "{{ a - b }}"', { input: { format: 'toml', template: 'handlebars' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('{% a - b %}', { input: { format: 'markdown', template: 'liquid' } }),
      /—/
    );
    assert.doesNotMatch(
      microtypo('{"g":"<%= a - b %>"}', { input: { format: 'json', template: 'erb' } }),
      /—/
    );
  });

  test('a protected expression ends content, so the dash after it converts', () => {
    const withTemplate = microtypo('{{x}} - y', { input: { template: 'handlebars' } });
    // plainControl (no template) shows the conversion comes from the dash rule, not from span over-reach.
    const plainControl = microtypo('a}} - b');

    assert.equal(withTemplate, `{{x}}${NBSP}— y`);
    assert.equal(plainControl, `a}}${NBSP}— b`);
  });
});

test('over-limit template expression fails closed, never typographed', () => {
  const src = `{{helper "${'x'.repeat(9000)} Корвин - Эрик"}}`;
  assert.throws(
    () => microtypo(src, { input: { template: 'handlebars' }, render: { paragraphs: false } }),
    (e) => e.code === 'ERR_MICROTYPO_INPUT' && e.details?.reason === 'template-overlimit'
  );
});

test('a long unclosed {{ with no }} anywhere stays literal', () => {
  const scan = templateScanner('handlebars');
  const src = `{{${'Амбер'.repeat(2000)}`; // >8192, no }}
  assert.deepEqual(scan(src), []);
});

test('a {{ whose }} lies past the scan bound throws', () => {
  const scan = templateScanner('handlebars');
  const src = `{{${'Амбер'.repeat(2000)}}}`;
  assert.throws(
    () => scan(src),
    (e) => e.details?.reason === 'template-overlimit'
  );
});

test('template mode: a long unclosed {{ passes through literal, not thrown', () => {
  const out = microtypo(`{{${'Амбер'.repeat(2000)}`, { input: { template: 'handlebars' } });
  assert.ok(out.startsWith('{{Амбер'), `expected literal passthrough: ${out.slice(0, 12)}`);
});
