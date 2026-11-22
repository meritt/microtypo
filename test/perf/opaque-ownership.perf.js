import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

for (const [name, prefix, unit, suffix, format = 'html'] of [
  [
    'foreign code tails',
    '',
    '<code><svg>',
    '<span title="</code>"> Корвин - принц {% raw %}x{% endraw %}'
  ],
  ['foreign custom tails', '<svg>', '<sample>{% raw %}<g>{% endraw %}', '<span title="</sample>">'],
  [
    'HTML integration tails',
    '<svg><foreignObject>',
    '<sample>{% raw %}<g>{% endraw %}',
    '<script></sample></script>'
  ],
  [
    'raw then code',
    '',
    '{% raw %}<span title="{% endraw %}<code>{% raw %}</code> Корвин - принц {% endraw %}',
    ''
  ],
  ['quoted declarations', '', '<?php echo "{% raw %}"; ?> Корвин - принц {% endraw %}', ''],
  [
    'MDX block ownership',
    '',
    '<span title="{% raw %}"></span>\n\n<pre>\n```\nКод - "сырой"\n</pre>\n\nКорвин - принц\n\n{% endraw %}\n\n',
    '',
    'mdx'
  ],
  ['ordinary template atoms', '', '<span data={% if a - b > 0 %}>Корвин - принц</span>', ''],
  [
    'quoted template atoms',
    '',
    '<span title="{{ "a > b" }}">Корвин - принц</span>\n\n',
    '',
    'markdown'
  ],
  [
    'self-closing expression atoms',
    '',
    `<svg data={{ 'a="' }} /><script/>{% raw %}</script> Корвин - принц {% endraw %}`,
    ''
  ],
  [
    'literal and atomic opener memoization',
    '',
    `До <code><code data={{ "> <span title='" }}> {% raw %}</code> Корвин - принц {% endraw %}<i title="</code>">`,
    '',
    'markdown'
  ],
  [
    'Markdown paragraph ownership',
    '',
    'x <span data=\n\n`  уложения  меж\tсверху`\n\n> Корвин - принц\n\n',
    '',
    'markdown'
  ],
  [
    'Markdown failed protected opener ownership',
    '',
    'x <code data=\n\n`  уложения  меж\tсверху`\n\n> Корвин - принц\n\n',
    '',
    'markdown'
  ]
]) {
  test(`${name} keeps output and grows linearly`, (t) => {
    const typo = new MicroTypo({
      input: { format, template: 'liquid' },
      maxInputLength: 1_000_000,
      maxProcessingMs: 0
    });
    typo.addSafeTag('sample');
    const times = [256, 512, 1024].map((n) => {
      const source = prefix + unit.repeat(n) + suffix;
      const custom = name.includes('custom') || name.includes('integration');
      let best = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const start = performance.now();
        const expected =
          custom || name === 'foreign code tails'
            ? source
            : source.replaceAll('Корвин - принц', 'Корвин\u{00A0}— принц');
        assert.equal(typo.process(source), expected);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    });
    t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
    assert.ok(times[2] < times[0] * 8 + 10);
  });
}

test('unfinished quoted template candidates retain their bound with linear growth', (t) => {
  const typo = new MicroTypo({
    input: { format: 'html', template: 'liquid' },
    maxInputLength: 1_000_000,
    maxProcessingMs: 0
  });
  const times = [4001, 8001, 16001].map((n) => {
    const source = `${'{{ "'.repeat(n)} }}`;
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      assert.throws(
        () => typo.process(source),
        (error) =>
          error.code === 'ERR_MICROTYPO_INPUT' && error.details.reason === 'template-overlimit'
      );
      best = Math.min(best, performance.now() - start);
    }
    return best;
  });
  t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
  assert.ok(times[2] < times[0] * 8 + 10);
});

for (const format of ['html', 'markdown', 'mdx']) {
  for (const [name, unit, expected] of [
    ['comment boundary', '<!--{%-->{%%} Корвин - принц ', '<!--{%-->{%%} Корвин\u{00A0}— принц '],
    ['declaration boundary', '<?{%?> Корвин - принц %} ', '<?{%?> Корвин\u{00A0}— принц %} '],
    [
      'foreign CDATA boundary',
      '<svg><![CDATA[{%]]></svg> Корвин - принц %} ',
      '<svg><![CDATA[{%]]></svg> Корвин\u{00A0}— принц %} '
    ]
  ]) {
    test(`${format} ${name} preserves every byte with linear growth`, (t) => {
      const typo = new MicroTypo({
        input: { format, template: 'liquid' },
        maxInputLength: 1_000_000,
        maxProcessingMs: 0
      });
      const times = [256, 512, 1024].map((n) => {
        const source = unit.repeat(n).trimEnd();
        const output = expected.repeat(n).trimEnd();
        let best = Infinity;
        for (let run = 0; run < 3; run += 1) {
          const start = performance.now();
          assert.equal(typo.process(source), output);
          best = Math.min(best, performance.now() - start);
        }
        return best;
      });
      t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
      assert.ok(times[2] < times[0] * 8 + 10);
    });
  }
}

test('independent MDX endpoints preserve self-closing foreign tags with linear growth', (t) => {
  const typo = new MicroTypo({
    input: { format: 'mdx', template: 'jinja' },
    maxInputLength: 1_000_000,
    maxProcessingMs: 0
  });
  const unit = '<svg data="{#"/><script/>Корвин - "принц"</script>#} Амбер - город ';
  const expected = '<svg data="{#"/><script/>Корвин - "принц"</script>#} Амбер\u{00A0}— город ';
  const times = [256, 512, 1024].map((n) => {
    const source = unit.repeat(n).trimEnd();
    const output = expected.repeat(n).trimEnd();
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      assert.equal(typo.process(source), output);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  });
  t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
  assert.ok(times[2] < times[0] * 8 + 10);
});
