import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { MicroTypo, microtypo } from '../../src/index.js';

const files = [
  ['markdown', 'Корвин - принц\n\n```\nКод - текст\n```\nЭрик - король'],
  ['frontmatter', '---\ntitle: "Амбер - город"\n---\n\nКорвин - принц\nЭрик - король'],
  ['yaml', 'title: "Амбер - город"\nbody: |\n  Корвин - принц\n  Эрик - король'],
  ['toml', 'title = "Амбер - город"\nbody = """\nКорвин - принц\nЭрик - король\n"""'],
  ['json', '{\n  "title": "Амбер - город",\n  "body": "Корвин - принц"\n}'],
  ['xml', '<root>\n<p>Корвин - принц</p>\n<pre>Код - текст</pre>\n</root>']
];

const breaks = (text) => text.match(/\r\n?|\n/g) ?? [];

for (const [format, source] of files) {
  for (const ending of format === 'toml' ? ['\n', '\r\n'] : ['\n', '\r\n', '\r']) {
    for (const tail of ['', ending, ending.repeat(3)]) {
      test(`${format} keeps ${JSON.stringify(ending)} line endings and tail ${tail.length}`, () => {
        const input = source.replaceAll('\n', ending) + tail;
        const config = { html: false, input: { format } };
        const output = microtypo(input, config);

        assert.deepEqual(breaks(output), breaks(input));
        assert.ok(output.includes('Корвин\u{00A0}— принц'));
        assert.equal(microtypo(output, config), output);
      });
    }
  }
}

test('a bare CR is not a TOML line ending', () => {
  assert.throws(
    () => microtypo('a = "Корвин"\rb = "Эрик"', { input: { format: 'toml' } }),
    MicroTypoInputError
  );
});

test('mixed EOL survives around protected code and changed prose', () => {
  const input = 'Корвин - принц\r\n```\nКод - текст\r\n```\rЭрик - король\n';
  const config = { html: false, input: { format: 'markdown' } };

  assert.equal(
    microtypo(input, config),
    'Корвин\u{00A0}— принц\r\n```\nКод - текст\r\n```\rЭрик\u{00A0}— король\n'
  );
});

test('an intentionally removed date line break does not move the following mixed EOL', () => {
  const input = '5\r\nмая\nКорвин - принц\r\n';
  const config = { html: false, input: { format: 'markdown' } };

  assert.equal(microtypo(input, config), '5\u{00A0}мая\nКорвин\u{00A0}— принц\r\n');
});

test('internal blank line collapse remains active for file formats', () => {
  const input = 'Корвин\r\n\n\r\n\rЭрик\r\n';
  const config = { html: false, input: { format: 'markdown' } };

  assert.equal(microtypo(input, config), 'Корвин\r\n\nЭрик\r\n');
});

test('mixed endings inside a protected attribute remain byte-exact', () => {
  const input = '<span title="a\r\nb\rc\nd">Корвин - принц</span>\r\n';
  const expected = '<span title="a\r\nb\rc\nd">Корвин\u{00A0}— принц</span>\r\n';

  assert.equal(microtypo(input, { html: false, input: { format: 'markdown' } }), expected);
});

test('mixed endings inside protected code remain byte-exact', () => {
  const input = '<pre>Код\r\nсмешанный\nтекст\r</pre>\n';

  assert.equal(microtypo(input, { html: false, input: { format: 'markdown' } }), input);
});

test('explicit Markdown layout keeps physical line endings and EOF', () => {
  const config = {
    html: true,
    input: { format: 'markdown' },
    render: { paragraphs: true, breakline: true }
  };

  assert.equal(microtypo('Корвин\r\nЭрик\r\n', config), '<p>Корвин<br>\r\nЭрик</p>\r\n');
});

test('new line boundaries use the document style without moving surviving mixed ones', () => {
  const typo = new MicroTypo({ html: false, input: { format: 'markdown' } });
  typo.registerRuleGroup(
    {
      rules: [{ id: 'break', handler: (ctx) => ctx.text.replace('|', '\n') }]
    },
    { name: 'other' }
  );

  assert.equal(
    typo.process('Корвин\r\nЭрик|Блейз\nРэндом\r\n'),
    'Корвин\r\nЭрик\r\nБлейз\nРэндом\r\n'
  );
});

test('JSON escaped line endings retain the existing value normalization', () => {
  assert.equal(
    microtypo('{"body":"Корвин\\r\\nЭрик"}', { input: { format: 'json' } }),
    '{"body":"Корвин\\nЭрик"}'
  );
});

for (const format of ['text', 'html']) {
  test(`${format} remains a fragment and removes its final newline`, () => {
    assert.equal(
      microtypo('Корвин - принц\r\n', { html: false, input: { format } }),
      'Корвин\u{00A0}— принц'
    );
  });
}
