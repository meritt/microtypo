import assert from 'node:assert/strict';
import test from 'node:test';

import { MicroTypo } from '../../src/index.js';

function applyEdits(input, edits) {
  let cursor = 0;
  let result = '';
  for (const { start, end, text } of edits) {
    assert.ok(start >= cursor && end >= start && end <= input.length);
    assert.ok(!(start > 0 && input.codePointAt(start - 1) > 0xffff));
    assert.ok(!(end > 0 && input.codePointAt(end - 1) > 0xffff));
    result += input.slice(cursor, start) + text;
    cursor = end;
  }
  return result + input.slice(cursor);
}

test('XML quote-role reads preserve reference bytes and original UTF-16 edit offsets', () => {
  const typo = new MicroTypo({ input: 'xml', entities: true });
  for (const prefix of [
    '&#171;&#8222;а&#8220;&#187;',
    '&#xAB;&#x201E;а&#x201C;&#xBB;',
    '&#000171;&#0008222;а&#0008220;&#000187;'
  ]) {
    const input = `<doc>🙂${prefix} " слово"</doc>`;
    const expected = `<doc>🙂${prefix} &#171;слово&#187;</doc>`;
    const result = typo.process(input, { trace: true, edits: true });
    assert.equal(result.text, expected);
    assert.equal(applyEdits(input, result.edits), expected);
    const first = input.indexOf('"');
    const last = input.lastIndexOf('"');
    assert.deepEqual(result.trace.find(({ rule }) => rule === 'quote.open').ranges, [
      [first, first + 2]
    ]);
    assert.deepEqual(result.trace.find(({ rule }) => rule === 'quote.close').ranges, [
      [last - 1, last + 1]
    ]);
    assert.equal(typo.process(expected), expected);
  }
});

test('edits reconstruct output in input UTF-16 coordinates, including deletions and pairs', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    { rules: [{ id: 'emoji', pattern: /😀/gu, replacement: '😁' }] },
    { name: 'custom' }
  );
  const input = '  😀 x 😀  ';
  const result = typo.process(input, { edits: true, changes: true });
  assert.equal(result.text, '  😁 x 😁');
  assert.equal(applyEdits(input, result.edits), '  😁 x 😁');
  assert.deepEqual(typo.process('untouched', { edits: true }), { text: 'untouched', edits: [] });
  assert.equal(typo.process('  😀  ', { edits: false }), '  😁');
});

test('edits and changes remain independent across reused calls and validate requested options', () => {
  const typo = new MicroTypo();
  assert.equal(applyEdits('"Амбер"', typo.process('"Амбер"', { edits: true }).edits), '«Амбер»');
  assert.equal(typo.process('"Амбер"'), '«Амбер»');
  for (const edits of [null, 1, 'yes']) {
    assert.throws(() => typo.process('Амбер', { edits }), { code: 'ERR_MICROTYPO_CONFIG' });
  }
});

test('edits reconstruct file formats with BOM, mixed endings, escaped values and protected spans', () => {
  const cases = {
    text: '\uFEFF  😀 "Амбер"\r\n<code>"код"</code>  ',
    html: '\uFEFF<p>"Амбер" в <em>доме</em></p>\r\n',
    plain: '  <b>"Амбер"</b> 😀 ',
    markdown: '\uFEFF# "Амбер"\r\n\n`"код"` и "Тень"\n',
    mdx: 'export const x = "код";\n\n"Амбер" <X a={"код"} />\n',
    json: '\uFEFF{"x":"\\u0022Амбер\\u0022 😀", "y":"в доме"}\r\n',
    yaml: 'title: \'"Амбер"\'\r\ntext: в доме\n',
    toml: 'title = \'"Амбер"\'\r\n',
    xml: '\uFEFF<doc>"Амбер" &amp; "Тень"</doc>\r\n',
    frontmatter: '\uFEFF---\r\ntitle: \'"Амбер"\'\r\n---\r\n\nв *доме*\n'
  };
  for (const [input, text] of Object.entries(cases)) {
    const typo = new MicroTypo({ input, html: true, entities: true });
    const result = typo.process(text, { edits: true });
    assert.equal(applyEdits(text, result.edits), result.text, input);
    assert.equal(result.text, typo.process(text), input);
  }
});

test('trace counts adjacent changed matches and retains attribution across successive rules', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    {
      rules: [
        { id: 'first', pattern: /a/g, replacement: 'b' },
        { id: 'unchanged', pattern: /b/g, replacement: 'b' },
        { id: 'second', pattern: /bb/g, replacement: 'c' },
        { id: 'handler', handler: ({ text }) => text.replaceAll('c', 'd') }
      ]
    },
    { name: 'custom' }
  );
  assert.deepEqual(typo.process('aa aa', { trace: true }), {
    text: 'd d',
    trace: [
      {
        rule: 'custom.first',
        kind: 'regex',
        count: 4,
        ranges: [
          [0, 1],
          [1, 2],
          [3, 4],
          [4, 5]
        ]
      },
      {
        rule: 'custom.second',
        kind: 'regex',
        count: 2,
        ranges: [
          [0, 2],
          [3, 5]
        ]
      },
      {
        rule: 'custom.handler',
        kind: 'handler',
        count: 1,
        ranges: [
          [0, 2],
          [3, 5]
        ]
      }
    ]
  });
  assert.equal(typo.process('aa'), 'd');
  assert.deepEqual(typo.process('none', { trace: true }), { text: 'none', trace: [] });
});

test('a traced HTML document with a title typesets the title and traces the rest', () => {
  const typo = new MicroTypo({ input: { format: 'html', attributes: ['alt'] } });
  const input = '<img alt="в - г"><title>а - "б"</title>';
  const result = typo.process(input, { trace: true });

  assert.equal(result.text, '<img alt="в\u{00A0}— г"><title>а\u{00A0}— «б»</title>');
  assert.equal(result.text, typo.process(input));
  assert.deepEqual(
    result.trace.map(({ rule }) => rule),
    ['dash.em']
  );
});

test('trace maps repeated escaped JSON values to their own original spans', () => {
  const input = '\uFEFF{"a":"\\u0061\\u0061", "b":"aa"}';
  const typo = new MicroTypo({ input: 'json', presets: false });
  typo.registerRuleGroup(
    { rules: [{ id: 'a', pattern: /a/g, replacement: 'b' }] },
    { name: 'custom' }
  );
  const result = typo.process(input, { trace: true, edits: true, changes: true });
  assert.equal(result.text, '\uFEFF{"a":"bb", "b":"bb"}');
  assert.deepEqual(result.trace, [
    {
      rule: 'custom.a',
      kind: 'regex',
      count: 4,
      ranges: [
        [7, 13],
        [13, 19],
        [27, 28],
        [28, 29]
      ]
    }
  ]);
  assert.equal(applyEdits(input, result.edits), result.text);
});

test('trace counts a nowrap match once and observes binding through inline markup', () => {
  const typo = new MicroTypo({ html: true, render: { paragraphs: false } });
  const input = 'Он в <em>доме</em>. 10:00-12:00';
  const result = typo.process(input, { trace: true });
  assert.equal(
    result.text,
    'Он\u00A0в\u00A0<em>доме</em>. <span style="white-space:nowrap;">10:00–12:00</span>'
  );
  assert.equal(result.trace.find(({ rule }) => rule === 'nobr.nbsp_short_word').count, 1);
  assert.deepEqual(result.trace.find(({ rule }) => rule === 'nobr.nbsp_short_word').ranges, [
    [0, 13]
  ]);
  assert.equal(result.trace.find(({ rule }) => rule === 'other.en_time_range').count, 1);
});

test('trace reports no fictional rule for normalization and validates flags without leaking state', () => {
  const typo = new MicroTypo({ presets: false });
  assert.deepEqual(typo.process('a\r\nb  ', { trace: true }), { text: 'a\nb', trace: [] });
  assert.throws(() => typo.process('a', { trace: 'yes' }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.equal(typo.process('a'), 'a');
});

test('trace preserves source boundaries through frontmatter, protection, attributes and PUA escaping', () => {
  const cases = [
    {
      input: 'frontmatter',
      text: '\uFEFF---\r\ntitle: aa\r\n---\r\n\naa\n',
      ranges: [
        [13, 14],
        [14, 15],
        [23, 24],
        [24, 25]
      ]
    },
    {
      input: { format: 'html', attributes: ['title'] },
      text: '<b title="aa">aa</b><code>aa</code>',
      ranges: [
        [10, 11],
        [11, 12],
        [14, 15],
        [15, 16]
      ]
    },
    {
      input: 'markdown',
      text: '\uFEFF`aa`\r\n\uE000 aa\n',
      ranges: [
        [9, 10],
        [10, 11]
      ]
    },
    {
      input: 'yaml',
      text: 'x: aa\r\ny: aa\n',
      ranges: [
        [3, 4],
        [4, 5],
        [10, 11],
        [11, 12]
      ]
    },
    {
      input: 'toml',
      text: "x = 'aa'\r\ny = 'aa'\n",
      ranges: [
        [5, 6],
        [6, 7],
        [15, 16],
        [16, 17]
      ]
    },
    {
      input: 'xml',
      text: '<x>aa</x>\r\n',
      ranges: [
        [3, 4],
        [4, 5]
      ]
    }
  ];
  for (const { input, text, ranges } of cases) {
    const typo = new MicroTypo({ presets: false, input });
    typo.registerRuleGroup(
      { rules: [{ id: 'a', pattern: /a/g, replacement: 'b' }] },
      { name: 'custom' }
    );
    const result = typo.process(text, { trace: true, edits: true });
    assert.deepEqual(
      result.trace,
      [{ rule: 'custom.a', kind: 'regex', count: ranges.length, ranges }],
      JSON.stringify(input)
    );
    assert.equal(applyEdits(text, result.edits), result.text);
    assert.equal(result.text, typo.process(text));
  }
});

test('trace preserves native replacement semantics for captures, named groups and literal dollars', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'capture',
          pattern: /(?<first>a)(b)?/g,
          replacement: "$$ $& $1 $2 $01 $12 $99 $0 $<first> $<missing> $` $'"
        }
      ]
    },
    { name: 'custom' }
  );
  const plain = typo.process('a z ab');
  assert.equal(typo.process('a z ab', { trace: true }).text, plain);
});

test('trace keeps individual match provenance when later rules replace their generated characters', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    {
      rules: [
        { id: 'first', pattern: /a/g, replacement: 'b' },
        { id: 'second', pattern: /b/g, replacement: 'c' }
      ]
    },
    { name: 'custom' }
  );
  const result = typo.process('aa', { trace: true });
  assert.equal(result.text, 'cc');
  assert.deepEqual(result.trace[1].ranges, [
    [0, 1],
    [1, 2]
  ]);
});

test('trace JSON ranges never split a literal surrogate pair even for a non-Unicode custom regex', () => {
  const typo = new MicroTypo({ presets: false, input: 'json' });
  typo.registerRuleGroup(
    { rules: [{ id: 'low', pattern: /\uDE00/g, replacement: 'x' }] },
    { name: 'custom' }
  );
  const result = typo.process('{"x":"😀"}', { trace: true, edits: true });
  assert.deepEqual(result.trace[0].ranges, [[6, 8]]);
  assert.equal(applyEdits('{"x":"😀"}', result.edits), result.text);
});

test('trace supports many changed matches without overflowing a call argument list', () => {
  const typo = new MicroTypo({ presets: false, maxInputLength: 150_000 });
  typo.registerRuleGroup(
    { rules: [{ id: 'a', pattern: /a/g, replacement: 'b' }] },
    { name: 'custom' }
  );
  const result = typo.process('a'.repeat(150_000), { trace: true });
  assert.equal(result.text, 'b'.repeat(150_000));
  assert.equal(result.trace[0].count, 150_000);
  assert.deepEqual(result.trace[0].ranges[0], [0, 1]);
  assert.deepEqual(result.trace[0].ranges.at(-1), [149_999, 150_000]);
});

test('trace drops rejected inline trials and counts a shared nowrap handler as one changing call', () => {
  // `nbsp_after_number` would bind the number and be the one accepted trial left in the trace.
  const typo = new MicroTypo({
    html: true,
    render: { paragraphs: false },
    rules: { 'nobr.nbsp_after_number': false }
  });
  const rejected = typo.process('5 <i>руб.</i>', { trace: true });
  assert.equal(rejected.text, '5 <i>руб.</i>');
  assert.deepEqual(rejected.trace, []);
  const phones = new MicroTypo({
    html: true,
    render: { paragraphs: false },
    rules: { 'nobr.nowrap_phone_extended': true }
  });
  const result = phones.process('+7-999-123-45-67; +7-999-123-45-67', { trace: true });
  assert.equal(
    result.text,
    '<span style="white-space:nowrap;">+7-999-123-45-67</span>; <span style="white-space:nowrap;">+7-999-123-45-67</span>'
  );
  const event = result.trace.find(({ rule }) => rule === 'nobr.nowrap_phone_extended');
  assert.equal(event.kind, 'handler');
  assert.equal(event.count, 1);
  assert.ok(event.ranges.length > 1);
});

test('trace discards a guarded structured replacement without discarding earlier accepted values', () => {
  const typo = new MicroTypo({ input: 'yaml', presets: false });
  typo.registerRuleGroup(
    { rules: [{ id: 'replace', pattern: [/a/g, /c/g], replacement: ['b', "'"] }] },
    { name: 'custom' }
  );
  const result = typo.process("first: a\nsecond: 'c'\n", { trace: true });
  assert.equal(result.text, "first: b\nsecond: 'c'\n");
  assert.deepEqual(result.trace, [
    { rule: 'custom.replace', kind: 'regex', count: 1, ranges: [[7, 8]] }
  ]);
});

test('trace keeps native coercion and callback errors for existing RegExp rules', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    { rules: [{ id: 'number', pattern: /a/g, replacement: 4 }] },
    { name: 'custom' }
  );
  assert.deepEqual(typo.process('aa', { trace: true }), {
    text: '44',
    trace: [
      {
        rule: 'custom.number',
        kind: 'regex',
        count: 2,
        ranges: [
          [0, 1],
          [1, 2]
        ]
      }
    ]
  });
  typo.registerRuleGroup(
    { rules: [{ id: 'symbol', pattern: /a/g, replacement: () => Symbol('a') }] },
    { name: 'custom' }
  );
  assert.throws(() => typo.process('a'), TypeError);
  assert.throws(() => typo.process('a', { trace: true }), TypeError);
  assert.equal(typo.process('b'), 'b');
});

test('trace counts each changing handler iteration in original input coordinates', () => {
  const typo = new MicroTypo({ presets: false });
  let calls = 0;
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'cycle',
          cycled: true,
          handler: ({ text }) => {
            calls++;
            return text.replace(/^[ab]/u, '');
          }
        }
      ]
    },
    { name: 'custom' }
  );
  for (const input of ['aax', 'abx']) {
    calls = 0;
    const result = typo.process(input, { trace: true, edits: true });
    assert.equal(calls, 3);
    assert.equal(result.text, 'x');
    assert.equal(applyEdits(input, result.edits), 'x');
    assert.equal(result.trace[0].rule, 'custom.cycle');
    assert.equal(result.trace[0].kind, 'handler');
    assert.equal(result.trace[0].count, 2);
    if (input === 'abx') {
      assert.deepEqual(result.trace[0].ranges, [
        [0, 1],
        [1, 2]
      ]);
    }
  }
});

test('trace retains accepted net-zero regex steps and handler cycles with no final edits', () => {
  const regex = new MicroTypo({ presets: false });
  regex.registerRuleGroup(
    { rules: [{ id: 'roundtrip', pattern: [/a/g, /b/g], replacement: ['b', 'a'] }] },
    { name: 'custom' }
  );
  assert.deepEqual(regex.process('a', { trace: true, edits: true }), {
    text: 'a',
    edits: [],
    trace: [
      {
        rule: 'custom.roundtrip',
        kind: 'regex',
        count: 2,
        ranges: [
          [0, 1],
          [0, 1]
        ]
      }
    ]
  });
  const handler = new MicroTypo({ presets: false });
  let limit;
  let calls = 0;
  handler.registerRuleGroup(
    {
      rules: [
        {
          id: 'roundtrip',
          cycled: true,
          handler: ({ text }) => {
            calls++;
            return text === 'a' ? 'b' : 'a';
          }
        }
      ]
    },
    { name: 'custom' }
  );
  handler.onCycleLimit = (id, count) => {
    limit = [id, count];
  };
  const result = handler.process('a', { trace: true, edits: true });
  assert.equal(calls, 100);
  assert.deepEqual(limit, ['roundtrip', 100]);
  assert.deepEqual(result, {
    text: 'a',
    edits: [],
    trace: [
      {
        rule: 'custom.roundtrip',
        kind: 'handler',
        count: 100,
        ranges: Array.from({ length: 100 }, () => [0, 1])
      }
    ]
  });
});

test('trace scalar rollback preserves earlier entries and accepts later values after both guards', () => {
  for (const [input, text, expected] of [
    [
      'yaml',
      "first: a\nsecond: 'c'\nthird: e\nlast: a\n",
      "first: b\nsecond: 'c'\nthird: e\nlast: b\n"
    ],
    ['toml', "first = 'a'\nsecond = 'c'\nlast = 'a'\n", "first = 'b'\nsecond = 'c'\nlast = 'b'\n"]
  ]) {
    const typo = new MicroTypo({ input, presets: false });
    typo.registerRuleGroup(
      {
        rules: [
          { id: 'replace', pattern: /[ac]/g, replacement: (m) => (m[0] === 'a' ? 'b' : 'd') },
          { id: 'guard', pattern: [/d/g, /e/g], replacement: ["'", 'x: y'] }
        ]
      },
      { name: 'custom' }
    );
    const result = typo.process(text, { trace: true, edits: true });
    assert.equal(result.text, expected);
    const ranges = [...text.matchAll(/a(?=['\n])/g)].map((m) => [m.index, m.index + 1]);
    assert.deepEqual(result.trace, [{ rule: 'custom.replace', kind: 'regex', count: 2, ranges }]);
    assert.equal(applyEdits(text, result.edits), expected);
  }
});

test('trace maps repeated selected attributes after protected prefixes, BOM, pairs and entities', () => {
  const fragment = '<b title="😀a &quot; a" alt=\'a\'>x</b>';
  const text = `\uFEFF<code>a😀</code>https://example.com ${fragment}${fragment}`;
  const typo = new MicroTypo({
    presets: false,
    input: { format: 'html', attributes: ['title', 'alt'] }
  });
  typo.registerRuleGroup(
    { rules: [{ id: 'a', pattern: /a/g, replacement: '"b' }] },
    { name: 'custom' }
  );
  const expectedFragment = '<b title="😀&#34;b &quot; &#34;b" alt=\'"b\'>x</b>';
  const expected = text.replaceAll(fragment, expectedFragment);
  const ranges = [];
  for (const match of text.matchAll(/😀a|; a|='a'/gu)) {
    const at = match.index + 2;
    ranges.push([at, at + 1]);
  }
  const result = typo.process(text, { trace: true, edits: true });
  assert.equal(result.text, expected);
  assert.deepEqual(result.trace, [{ rule: 'custom.a', kind: 'regex', count: 6, ranges }]);
  assert.equal(applyEdits(text, result.edits), expected);
  assert.equal(typo.process(text), expected);
});

test('trace keeps repeated attribute and body origins outside an identical protected block', () => {
  const input = '<code>a</code><b title="a">a</b><b title="a">a</b>';
  const typo = new MicroTypo({ presets: false, input: { format: 'html', attributes: ['title'] } });
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'roundtrip',
          pattern: [/a/g, /b/g],
          replacement: ['b', 'a']
        }
      ]
    },
    { name: 'custom' }
  );
  const expected = {
    text: input,
    edits: [],
    trace: [
      {
        rule: 'custom.roundtrip',
        kind: 'regex',
        count: 8,
        ranges: [
          [24, 25],
          [24, 25],
          [42, 43],
          [42, 43],
          [27, 28],
          [45, 46],
          [27, 28],
          [45, 46]
        ]
      }
    ]
  };
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.deepEqual(typo.process(input, { trace: true, edits: true }), expected);
  }
});

test('trace maps protected URL atoms completely and stays stable across real random nonces', () => {
  const input = 'Он www.example.com/t?n=100000 передал.';
  const typo = new MicroTypo({ html: true });
  let first;
  for (let repeat = 0; repeat < 32; repeat++) {
    const result = typo.process(input, { trace: true, edits: true });
    assert.deepEqual(result.trace.find(({ rule }) => rule === 'nobr.nbsp_short_word').ranges, [
      [0, 29]
    ]);
    assert.deepEqual(result.trace.find(({ rule }) => rule === 'text.autolink').ranges, [[0, 29]]);
    assert.equal(applyEdits(input, result.edits), result.text);
    first ??= result;
    assert.deepEqual(result, first);
  }
});

test('trace distinguishes repeated visible text from code, URL, email and UUID atoms', () => {
  const parts = [
    'a ',
    '<code>a</code> ',
    'a ',
    'https://example.com/a ',
    'a ',
    'a@example.com ',
    'a ',
    '32974928-ab93-4994-a647-870195232043 ',
    'a'
  ];
  const input = `\uFEFF😀${parts.join('')}`;
  const ranges = [];
  let at = 3;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      ranges.push([at, at + 1]);
    }
    at += parts[i].length;
  }
  const typo = new MicroTypo({ presets: false, input: 'html' });
  typo.registerRuleGroup(
    { rules: [{ id: 'a', pattern: /a/g, replacement: 'b' }] },
    { name: 'custom' }
  );
  const result = typo.process(input, { trace: true, edits: true });
  assert.deepEqual(result.trace, [{ rule: 'custom.a', kind: 'regex', count: 5, ranges }]);
  assert.equal(
    result.text,
    `\uFEFF😀${parts.map((part, i) => (i % 2 === 0 ? part.replace('a', 'b') : part)).join('')}`
  );
  assert.equal(applyEdits(input, result.edits), result.text);
});

test('trace maps lifted words to their own text after an identical protected phrase', () => {
  for (const [input, ranges] of [
    [
      '<code>он дом</code> он <em>дом</em> он <em>дом</em>',
      [
        [19, 30],
        [35, 46]
      ]
    ],
    [
      '<code>в доме</code> в <em>доме</em> в <em>доме</em>',
      [
        [19, 30],
        [35, 46]
      ]
    ]
  ]) {
    const typo = new MicroTypo({ html: true, render: { paragraphs: false } });
    const result = typo.process(input, { trace: true, edits: true });
    assert.deepEqual(
      result.trace.find(({ rule }) => rule === 'nobr.nbsp_short_word').ranges,
      ranges
    );
    assert.equal(applyEdits(input, result.edits), result.text);
    assert.equal(result.text, typo.process(input));
  }
});

test('trace preserves body origins when earlier selected attributes expand and serialize quotes', () => {
  const input = '<code>a</code><b title="a" alt="a">a</b><b title="a">a</b>';
  const typo = new MicroTypo({
    presets: false,
    input: { format: 'html', attributes: ['title', 'alt'] }
  });
  typo.registerRuleGroup(
    {
      rules: [
        { id: 'first', pattern: /a/g, replacement: '"bb' },
        { id: 'second', pattern: /b/g, replacement: 'c' }
      ]
    },
    { name: 'custom' }
  );
  const attr = [...input.matchAll(/(?:title|alt)="a"/g)].map((m) => [
    m.index + m[0].length - 2,
    m.index + m[0].length - 1
  ]);
  const body = [...input.matchAll(/">a</g)].map((m) => [m.index + 2, m.index + 3]);
  const result = typo.process(input, { trace: true, edits: true });
  const ranges = [...attr, ...body];
  assert.deepEqual(result.trace[0], { rule: 'custom.first', kind: 'regex', count: 5, ranges });
  assert.deepEqual(result.trace[1], {
    rule: 'custom.second',
    kind: 'regex',
    count: 10,
    ranges: ranges.flatMap((range) => [range, range])
  });
  assert.equal(applyEdits(input, result.edits), result.text);
  assert.equal(result.text, typo.process(input));
});

test('trace reads lifted visible words rather than equal words in author attributes', () => {
  for (const [input, rule, ranges] of [
    ['<b title="в дом">в</b> дом', 'nobr.nbsp_short_word', [[17, 26]]],
    ['<b title="a">в</b> <i title="дом">дом</i>', 'nobr.nbsp_short_word', [[13, 37]]],
    ['<b title="10 кг">10</b> кг', 'abbr.nbsp_weight_unit', [[17, 26]]]
  ]) {
    // The attributes stay as written, so an equal word there can only be mistaken for the visible one.
    const typo = new MicroTypo({ input: { format: 'html', attributes: [] }, html: false });
    const result = typo.process(input, { trace: true, edits: true });
    assert.deepEqual(result.trace.find((entry) => entry.rule === rule).ranges, ranges);
    assert.equal(applyEdits(input, result.edits), result.text);
    assert.equal(result.text, typo.process(input));
  }
});

test('prospective spacing credits only the reader that changes each mark', () => {
  for (const [period, punctuation, expected, rules] of [
    [
      true,
      true,
      'Е. Опять: нет. что',
      ['space.space_after_punctuation', 'space.space_after_period']
    ],
    [true, false, 'Е. Опять:нет.что', ['space.space_after_period']],
    [false, true, 'Е.Опять:нет.что', []],
    [false, false, 'Е.Опять:нет.что', []]
  ]) {
    // `Е.` before a capital also reads as an initial; that binding is not the spacing under test.
    const typo = new MicroTypo({
      rules: {
        'space.space_after_period': period,
        'space.space_after_punctuation': punctuation,
        'nobr.nbsp_single_initial': false
      }
    });
    const input = 'Е.Опять:нет.что';
    const result = typo.process(input, { trace: true, edits: true });
    assert.equal(result.text, expected);
    assert.equal(applyEdits(input, result.edits), expected);
    assert.deepEqual(
      result.trace.map(({ rule }) => rule),
      rules
    );
    for (const trace of result.trace) {
      assert.ok(trace.count > 0);
      assert.ok(
        trace.ranges.every(([start, end]) => start >= 0 && start <= end && end <= input.length)
      );
    }
  }
});

// A range is the rule's match in the input. A protected address inside the match is covered whole,
// and so is what an earlier rule rewrote, wherever the match touches it: the dash rule takes the
// address in front of the dash with it, and the binding of the short word in front of the address
// then reaches the end of what the dash rule rewrote.
test('trace covers a protected address and the dash an earlier rule set behind it', () => {
  const nbsp = '\u{00A0}';

  for (const [input, text, dash, word, edits] of [
    [
      'a www.a -',
      `a${nbsp}www.a${nbsp}—`,
      [2, 9],
      [0, 9],
      [
        [1, 2, nbsp],
        [7, 9, `${nbsp}—`]
      ]
    ],
    [
      'a www.a - b',
      `a${nbsp}www.a${nbsp}— b`,
      [2, 10],
      [0, 10],
      [
        [1, 2, nbsp],
        [7, 9, `${nbsp}—`]
      ]
    ],
    [
      'а www.a.ru - б',
      `а${nbsp}www.a.ru${nbsp}— б`,
      [2, 13],
      [0, 13],
      [
        [1, 2, nbsp],
        [10, 12, `${nbsp}—`]
      ]
    ],
    [
      'а a@b.ru - б',
      `а${nbsp}a@b.ru${nbsp}— б`,
      [2, 11],
      [0, 11],
      [
        [1, 2, nbsp],
        [8, 10, `${nbsp}—`]
      ]
    ],
    ['www.a.ru - б', `www.a.ru${nbsp}— б`, [0, 11], null, [[8, 10, `${nbsp}—`]]],
    ['а - www.a.ru', `а${nbsp}— www.a.ru`, [0, 4], null, [[1, 3, `${nbsp}—`]]]
  ]) {
    const result = new MicroTypo().process(input, { trace: true, edits: true });

    assert.deepEqual(
      result,
      {
        text,
        trace: [
          { rule: 'dash.em', kind: 'regex', count: 1, ranges: [dash] },
          ...(word === null
            ? []
            : [{ rule: 'nobr.nbsp_short_word', kind: 'regex', count: 1, ranges: [word] }])
        ],
        edits: edits.map(([start, end, replacement]) => ({ start, end, text: replacement }))
      },
      input
    );
    assert.equal(applyEdits(input, result.edits), text, input);
  }
});

test('trace of a link written over a protected address reaches what the rules before it rewrote', () => {
  const input = 'a www.a -';
  const result = new MicroTypo({ html: true }).process(input, { trace: true, edits: true });

  assert.equal(result.text, '<p>a\u{00A0}<a href="http://www.a">www.a</a>\u{00A0}—</p>');
  assert.equal(applyEdits(input, result.edits), result.text);
  assert.deepEqual(result.trace, [
    { rule: 'dash.em', kind: 'regex', count: 1, ranges: [[2, 9]] },
    { rule: 'nobr.nbsp_short_word', kind: 'regex', count: 1, ranges: [[0, 9]] },
    { rule: 'text.autolink', kind: 'regex', count: 1, ranges: [[0, 9]] },
    {
      rule: 'text.paragraphs',
      kind: 'handler',
      count: 1,
      ranges: [
        [0, 0],
        [9, 9]
      ]
    }
  ]);
});

test('trace of a day range in an author paragraph keeps every range inside the paragraph', () => {
  const input = '<p>С 4-26 ноября было</p>';
  const typo = new MicroTypo({
    html: true,
    input: 'html',
    rules: { 'date.*': true }
  });
  const result = typo.process(input, { trace: true, edits: true });

  assert.equal(result.text, '<p><span style="white-space:nowrap;">С 4—26 ноября было</span></p>');
  assert.equal(applyEdits(input, result.edits), result.text);
  // The day range itself is `4-26`, and every later rule that binds or wraps it covers it whole.
  assert.deepEqual(result.trace[0], {
    rule: 'number.en_range',
    kind: 'regex',
    count: 1,
    ranges: [[5, 9]]
  });
  assert.ok(result.trace.some(({ rule }) => rule === 'date.nowrap_day_range'));

  for (const { rule, count, ranges } of result.trace) {
    assert.ok(count > 0, rule);

    for (const [start, end] of ranges) {
      assert.ok(start >= 0 && start <= end && end <= 21, `${rule} ${start}–${end}`);
      assert.ok(end <= 5 || start >= 9 || (start <= 5 && end >= 9), `${rule} ${start}–${end}`);
    }
  }
});
