import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';
import { DEFAULT_GROUPS } from '../../src/rules/registry.js';

const NB = '\u{00A0}';
const OFF = Object.fromEntries(DEFAULT_GROUPS.map(([group]) => [group, false]));
const only = (id, extra = {}) => ({ ...extra, rules: { ...OFF, [id]: true } });
const wrap = (text) => `<span style="white-space:nowrap;">${text}</span>`;

test('a number after a currency sign takes its own unit in one pass', () => {
  for (const [source, expected] of [
    ['8р0 USD', `8${NB}₽${NB}0${NB}USD`],
    ['8р0 тыс. руб.', `8${NB}₽${NB}0${NB}тыс.${NB}руб.`],
    ['8р0 л. с.', `8${NB}₽${NB}0${NB}л.${NB}с.`]
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('a spaced range reads a minus written in place of a hyphen in one pass', () => {
  const config = { rules: { 'dash.em*': false } };
  for (const source of ['-1 - 1', `-1${NB}- 1`, '−1 - 1']) {
    assert.equal(microtypo(source, config), '−1–1');
  }
  assert.equal(microtypo('−1–1', config), '−1–1');
});

test('a magnitude binds to a separate quantity after a telephone', () => {
  const phone = `+7${NB}814${NB}780-82-56`;
  const config = { input: 'html' };
  for (const [source, expected] of [
    ['+7(814)7808256 млн', `${phone} млн`],
    ['+7(814)7808256 2 млн', `${phone} 2${NB}млн`],
    [`+7(814)7808256${NB}млн рублей`, `${phone}${NB}млн рублей`],
    [
      '<a href="tel:+78147808256">+7(814)7808256</a> млн',
      `<a href="tel:+78147808256">${phone}</a> млн`
    ]
  ]) {
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

test('a feet mark at the end of a Markdown link keeps its label visible to word binding', () => {
  const config = { input: 'markdown', html: true };
  for (const [source, expected] of [
    [
      "Сверьтесь с [отметкой 7'][план] перед подъёмом.\n\n[план]: /чертёж",
      `Сверьтесь с${NB}[отметкой 7′][план] перед подъёмом.\n\n[план]: /чертёж`
    ],
    [
      "Сверьтесь с [отметкой 7'](/plan#feet) перед подъёмом.",
      `Сверьтесь с${NB}[отметкой 7′](/plan#feet) перед подъёмом.`
    ],
    ["Сверьтесь с отметкой 7' перед подъёмом.", `Сверьтесь с${NB}отметкой 7′ перед подъёмом.`],
    [
      'Сверьтесь с [отметкой 7′](/plan) перед подъёмом.',
      `Сверьтесь с${NB}[отметкой 7′](/plan) перед подъёмом.`
    ],
    [
      "Сверьтесь с [отметкой'](/plan) перед подъёмом.",
      "Сверьтесь с [отметкой'](/plan) перед подъёмом."
    ]
  ]) {
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  const src = "Сверьтесь с [отметкой 7'](/plan) перед подъёмом.";
  for (const [rule, expected] of [
    ['number.prime', src],
    ['nobr.nbsp_short_word', 'Сверьтесь с [отметкой 7′](/plan) перед подъёмом.']
  ]) {
    const off = { ...config, rules: { [rule]: false } };
    assert.equal(microtypo(src, off), expected);
    assert.equal(microtypo(expected, off), expected);
  }
});

test('new wrappers keep the colon of an attached как то phrase visible to dash rules', () => {
  const config = { html: true, render: { paragraphs: false } };
  for (const [source, expected] of [
    ['и пр. как то:', '<span style="white-space:nowrap;">и пр. как то:</span>'],
    [
      'и пр.\u{00A0}историю\u{00A0}как то:',
      '<span style="white-space:nowrap;">и пр. историю как то:</span>'
    ],
    [
      '+7-999-123-45-67\u{00A0}и\u{00A0}как то:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 и как то:</span>'
    ],
    [
      '+7-999-123-45-67\u{00A0}историю\u{00A0}как то:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 историю как то:</span>'
    ],
    [
      '+7-999-123-45-67\u{00A0}как то:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 как то:</span>'
    ]
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('new wrappers retain the colon across the indefinite-pronoun grammar', () => {
  const config = { html: true, render: { paragraphs: false } };
  for (const [source, expected] of [
    ['и пр.\u{00A0}КАК ТО:', '<span style="white-space:nowrap;">и пр. КАК ТО:</span>'],
    ['и пр.\u{00A0}почему\u{00A0}то:', '<span style="white-space:nowrap;">и пр. почему то:</span>'],
    [
      'и пр.\u{00A0}WoRd\u{00A0}КАК\u{00A0}ТО:',
      '<span style="white-space:nowrap;">и пр. WoRd КАК ТО:</span>'
    ],
    [
      '+7-999-123-45-67\u{00A0}word\u{00A0}КАК\u{00A0}ТО:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 word КАК ТО:</span>'
    ],
    ['т. к.\u{00A0}что\u{00A0}либо:', '<span style="white-space:nowrap;">т. к. что либо:</span>'],
    [
      '+7-999-123-45-67\u{00A0}кто\u{00A0}нибудь:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 кто нибудь:</span>'
    ],
    [
      '+7-999-123-45-67\u{00A0}историю\u{00A0}Как\tто:',
      '<span style="white-space:nowrap;">+7-999-123-45-67 историю как то:</span>'
    ],
    [
      'и пр.\u{00A0}кем-\u{00A0}-либо:',
      '<span style="white-space:nowrap;">и пр. кем- -либо:</span>'
    ],
    [
      '<p>и пр.\u{00A0}<em>где\u{00A0}то:</em></p>',
      '<p><span style="white-space:nowrap;">и пр. <em>где то:</em></span></p>'
    ],
    [
      '+7-999-123-45-67 обычная проза:',
      '<span style="white-space:nowrap;">+7-999-123-45-67</span> обычная проза:'
    ]
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('optional wrappers start inside a block without nesting authored nowrap', () => {
  for (const [id, phrase, plain] of [
    ['abbr.nowrap_because', 'и пр.', `и${NB}пр.`],
    ['nobr.nowrap_phone_extended', '+7 (123) 456 78 90', `+7${NB}(123)${NB}456${NB}78${NB}90`]
  ]) {
    const config = only(id);
    assert.equal(microtypo(`<p>${phrase}</p>`, config), `<p>${plain}</p>`);
    assert.equal(microtypo(`<p>${plain}</p>`, config), `<p>${plain}</p>`);
    const wrapped = `<p><span style="white-space:nowrap;">${phrase}</span></p>`;
    const plainWrapped = `<p><span style="white-space:nowrap;">${plain}</span></p>`;
    assert.equal(microtypo(wrapped, config), plainWrapped);
    assert.equal(microtypo(plainWrapped, config), plainWrapped);
    const html = only(id, { html: true });
    assert.equal(microtypo(`<p>${phrase}</p>`, html), wrapped);
    assert.equal(microtypo(wrapped, html), wrapped);
  }
});

test('adjacent nowrap phrases share each source separator exactly once', () => {
  const source =
    '+7-999-123-45-67\u{00A0}как то:+7-999-123-45-67\u{00A0}почему\u{00A0}то:+7-999-123-45-67';
  for (const [extra, expected] of [
    [
      { html: true, render: { paragraphs: false } },
      '<span style="white-space:nowrap;">+7-999-123-45-67 как то:</span><span style="white-space:nowrap;">+7-999-123-45-67 почему то:</span><span style="white-space:nowrap;">+7-999-123-45-67</span>'
    ],
    [
      { input: 'plain' },
      '+7-999-123-45-67\u{00A0}как\u{00A0}то:+7-999-123-45-67\u{00A0}почему\u{00A0}то:+7-999-123-45-67'
    ]
  ]) {
    const config = { ...extra };
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  const config = { html: true, render: { paragraphs: false } };
  assert.equal(
    microtypo('и пр.\u{00A0}как то:+7-999-123-45-67; текст <code>:+7-999-123-45-67</code>', config),
    '<span style="white-space:nowrap;">и пр. как то:</span><span style="white-space:nowrap;">+7-999-123-45-67</span>; текст <code>:+7-999-123-45-67</code>'
  );
});

test('the added rules keep mathematical signs and incomplete currency words out of numeric binding', () => {
  const math = { html: true, render: { paragraphs: false } };
  const expected = '<sup><small>-1</small></sup>';
  assert.equal(microtypo('^-1', math), expected);
  assert.equal(microtypo(expected, math), expected);
  for (const [source, result] of [
    ['8 \u{00A0}уе', `8 ${NB}уе`],
    ['.11336 USD', '.11336 USD'],
    ['ч. 37479°C', `ч.${NB}37\u{202F}479${NB}°C`]
  ]) {
    const config = {};
    assert.equal(microtypo(source, config), result, source);
    assert.equal(microtypo(result, config), result, `repeat: ${source}`);
  }
});

test('the added rules exclude initials and partial grouped identifiers from numeric bindings', () => {
  for (const [source, expected] of [
    ['Лб\u{00A0}М.Т. 8', `Лб${NB}М.${NB}Т. 8`],
    ['ч. 76671х', 'ч. 76\u{202F}671х'],
    ['\u{E101}91332 А', '\u{E101}91\u{202F}332 А']
  ]) {
    const config = {};
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
  const config = { html: true, render: { paragraphs: false } };
  const expected = '<span style="white-space:nowrap;">Р. С. Но e</span>8 к';
  assert.equal(microtypo('Р.С. Но e8 к', config), expected);
  assert.equal(microtypo(expected, config), expected);
});

test('an arrow glued to a word stays glued when the word gains a wrapper', () => {
  const config = { html: true };
  const out = microtypo('<=>y X-Xв', config);
  assert.ok(out.includes('<=>'));
  assert.equal(microtypo(out, config), out);
});

test('the added rules settle paragraph endings and notation exposed by currency formatting', () => {
  for (const [source, expected, extra] of [
    ['Но указывать и вот так.\n', `Но${NB}указывать и${NB}вот${NB}так.`, {}],
    ['«чертил мм»?\n', `«чертил${NB}мм»?`, {}],
    [
      'Это мой дом. {% comment %}rest',
      `<p>Это мой${NB}дом.</p> {% comment %}rest`,
      { html: true, input: { template: 'liquid' } }
    ],
    ['1/8долл.', `⅛${NB}$.`, {}],
    ["№52793' месяцами", `№\u{202F}52793' месяцами`, {}]
  ]) {
    const config = { ...extra };
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('optional numeric glyph references survive punctuation on every pass', () => {
  for (const [id, source, expected] of [
    ['number.fraction_extended', '7/8.', '&#8542;.'],
    ['number.fraction_extended', '1/8, 1/3;', '&#8539;, &#8531;;'],
    ['number.prime', "5'.", '5&#8242;.'],
    ['symbol.arrows_extended', '=>.', '&#8658;.']
  ]) {
    const config = { entities: true, rules: { [id]: true } };
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
  const xml = { input: 'xml', entities: true };
  assert.equal(microtypo('<doc>7/8.</doc>', xml), '<doc>&#8542;.</doc>');
  assert.equal(microtypo('<doc>&#8542;.</doc>', xml), '<doc>&#8542;.</doc>');
});

test('the added rules do not read an XML reference terminator as a sentence separator', () => {
  const config = { input: 'xml', entities: true };
  const source = '<doc>встречаются всё же -9,402</doc>';
  const expected = '<doc>встречаются всё&#160;же&#160;-9,402</doc>';
  assert.equal(microtypo(source, config), expected);
  assert.equal(microtypo(expected, config), expected);
});

test('an extended phone wrapper does not turn its number into an organization name', () => {
  const config = { html: true, render: { paragraphs: false } };
  const expected = 'НИИ <span style="white-space:nowrap;">+7 (999) 123 45 67</span>';
  assert.equal(microtypo('НИИ +7 (999) 123 45 67', config), expected);
  assert.equal(microtypo(expected, config), expected);
});

test('the added rules settle newly visible abbreviations and never treats a phone tail as a count', () => {
  const config = {};
  for (const [source, expected] of [
    ['5760л. с. ред совет', `5760${NB}л.${NB}с. ред совет`],
    ['5млн руб. дохода', `5${NB}млн${NB}руб. дохода`],
    ['+7(999)1234567 Осада', `+7${NB}999${NB}123-45-67 Осада`],
    ['Хронику же было', `Хронику${NB}же${NB}было`],
    ['вам же мин.', `вам${NB}же${NB}мин.`],
    ['в т. ч. 04:21', `в${NB}т.${NB}ч.${NB}04:21`]
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('the added rules settle in one pass what other rules and wrappers expose', () => {
  const html = { html: true, render: { paragraphs: false } };
  for (const [source, expected, config] of [
    // A word bound to the number after it labels that number, not the one in front.
    ['в 4 табл. 2', `в${NB}4 табл.${NB}2`, {}],
    ['гл. 5 гл.7', `гл.${NB}5 гл.${NB}7`, {}],
    [
      '<doc>в 4 табл. 2</doc>',
      '<doc>в&#160;4 табл.&#160;2</doc>',
      { input: 'xml', entities: true }
    ],
    // So is a short word a date holds, in its wrapper or bound in front of it past markup.
    ['в 8 Д 05.05.29г.', `<p>в${NB}8 ${wrap('Д 05.05.29 г.')}</p>`, { html: true }],
    [
      'в 8 <b>Д</b> 05.05.29г.',
      `<p>в${NB}8 <b>Д</b>${NB}${wrap('05.05.29 г.')}</p>`,
      { html: true }
    ],
    // A bare `с` before a word read through tags is the preposition.
    ['5 с <b>половиной</b> часов', `5${NB}с${NB}<b>половиной</b> часов`, html],
    // A capital after the end tags of a number set in markup is its unit, not an initial.
    ['10<sup>2</sup> А. Далее', '10<sup>2</sup> А. Далее', html],
    // The end of the engine's wrapper reads as what it holds last.
    ['7 (274) 76-29-54АО д,', `${wrap('7 (274) 76-29-54')}АО д,`, html],
    ['ГК Мир', wrap(`ГК${NB}Мир`), { ...html, rules: { 'other.*': false } }],
    ['09.09.28г.1/3', `${wrap('09.09.28 г.')}1/3`, html],
    // A unit's period parts an organization form and spaced `т. к.` from the number.
    ['-4г.АО Мир', `−4${NB}г. АО${NB}Мир`, {}],
    [
      'ГОСТ 8-800-651-46-72 т.к.',
      'ГОСТ&nbsp;8&ndash;800-651-46-72&nbsp;т.&nbsp;к.',
      { entities: true, input: 'html' }
    ],
    // The word between two runs of hyphens belongs to both.
    ['ин --- ин---со', `ин${NB}— ин${NB}— со`, {}]
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('optional symbols read the boundaries of text nodes and lines', () => {
  for (const [id, source, expected, extra] of [
    ['symbol.arrows_extended', '<b>=></b>', '<b>&#8658;</b>', { entities: true }],
    ['symbol.arrows_extended', '<x>=></x>', '<x>&#8658;</x>', { entities: true, input: 'xml' }],
    ['symbol.arrows_extended', '<p><-></p>', '<p>↔</p>', {}],
    ['symbol.plus_minus_slash', '<p>+/-</p>', '<p>±</p>', {}],
    ['number.minus', '<p>-5</p>', '<p>−5</p>', {}],
    ['number.minus', 'Термометр\n-5', 'Термометр\n−5', {}]
  ]) {
    const config = only(id, extra);
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('the added rules cooperate with existing rules in one pass', () => {
  const config = {};
  const cases = [
    [
      '5 тыс. руб.; 1,5 млн рублей; 1 млн чел.',
      `5${NB}тыс.${NB}руб.; 1,5${NB}млн${NB}рублей; 1${NB}млн${NB}чел.`
    ],
    ['Проф. Иванов написал т. 2', `Проф.${NB}Иванов написал т.${NB}2`],
    ['Дж. Р. Р. Толкин и А. Пушкин', `Дж.${NB}Р.${NB}Р.${NB}Толкин и А.${NB}Пушкин`],
    ['12 человек, 2024 год', `12${NB}человек, 2024${NB}год`],
    ['XXI век; 5 в. до н. э.', `XXI${NB}век; 5${NB}в. до${NB}н.${NB}э.`],
    ['Корвин --- принц; точность +/-5; -5', `Корвин${NB}— принц; точность ±5; −5`],
    ['5\' 10"; 1/3 и 7/8', `5′ 10″; ⅓ и${NB}⅞`],
    ['Туда <-> обратно => вывод <=> равенство', 'Туда ↔ обратно ⇒ вывод ⇔ равенство'],
    ['+7 (999) 123 45 67; 8-800-555-35-35', `+7${NB}(999)${NB}123${NB}45${NB}67; 8-800-555-35-35`]
  ];
  for (const [source, expected] of cases) {
    const once = microtypo(source, config);
    assert.equal(once, expected, source);
    assert.equal(microtypo(once, config), expected, `repeat: ${source}`);
  }
});

test('new rules leave protected content and addresses intact', () => {
  const bait =
    "5 тыс. руб. 5 Вт проф. Иванов А. Пушкин 12 человек XXI век -5 1/3 5' <-> => <=> +/- Корвин---принц";
  for (const tag of ['code', 'pre', 'script', 'style', 'kbd', 'samp']) {
    const source = `<${tag}>${bait}</${tag}>`;
    assert.equal(microtypo(source), source);
  }
  const source = `\`${bait}\`\n\nКорвин --- принц`;
  assert.equal(microtypo(source, { input: 'markdown' }), `\`${bait}\`\n\nКорвин${NB}— принц`);
  for (const address of [
    'https://example.com/-5/1/3?q=a=>b',
    'a-5@example.com',
    'www.example.com/x---y'
  ]) {
    assert.equal(microtypo(address), address);
  }
});

test('minus does not acquire an operand boundary from a generated inline wrapper', () => {
  const config = { html: true, render: { paragraphs: false } };
  const expected = '<a href="https://example.com">example.com</a> -5';
  assert.equal(microtypo('https://example.com -5', config), expected);
  assert.equal(microtypo(expected, config), expected);
});

test('new binding rules read through inline tags without moving them', () => {
  const config = { html: true, render: { paragraphs: false } };
  for (const [source, expected] of [
    ['100 <em>USD</em>', `100${NB}<em>USD</em>`],
    ['проф. <b>Иванов</b>', `проф.${NB}<b>Иванов</b>`],
    ['<b>12</b> человек', `<b>12</b>${NB}человек`],
    [
      '<p>Это мой <em>дом</em>.</p><p>Новый дом.</p>',
      `<p>Это мой${NB}<em>дом</em>.</p><p>Новый${NB}дом.</p>`
    ],
    ['<b>т. к.</b>', `<b>т.${NB}к.</b>`]
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('new rules preserve Markdown fences, YAML framing and structured values', () => {
  for (const config of [{ input: 'markdown' }, { input: 'frontmatter' }]) {
    const source = '---\ntitle: "Амбер"\n---\n\n```js\nconst x = a => -5;\n```\n\nКорвин --- принц';
    assert.equal(
      microtypo(source, { ...config }),
      source.replace('Корвин --- принц', `Корвин${NB}— принц`)
    );
  }
  for (const [input, source, expected] of [
    ['json', '{"text":"100 USD и 1/3"}', `{"text":"100${NB}USD и${NB}⅓"}`],
    ['yaml', 'text: "100 USD"', `text: "100${NB}USD"`],
    ['toml', 'text = "100 USD"', `text = "100${NB}USD"`],
    ['xml', '<doc>100 USD и 1/3</doc>', `<doc>100${NB}USD и${NB}⅓</doc>`]
  ]) {
    const config = { input };
    assert.equal(microtypo(source, config), expected, input);
    assert.equal(microtypo(expected, config), expected, `repeat: ${input}`);
  }
});

function examples(id, pairs, unchanged) {
  test(id, () => {
    const config = only(id);
    for (const [source, expected] of pairs) {
      assert.equal(microtypo(source, config), expected, source);
      assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
    }
    for (const source of unchanged) {
      assert.equal(microtypo(source, config), source, source);
    }
  });
}

test('an added rule is on by default and switches off by its id or a mask', () => {
  assert.equal(microtypo('100 USD'), `100${NB}USD`);
  assert.equal(microtypo('100 USD', { rules: { 'abbr.nbsp_currency_code': false } }), '100 USD');
  assert.equal(microtypo('100 USD', { rules: { 'abbr.nbsp_*': false } }), '100 USD');
  assert.equal(
    microtypo('100 USD', { rules: { 'abbr.nbsp_*': false, 'abbr.nbsp_currency_code': true } }),
    `100${NB}USD`
  );
});

examples(
  'dash.em_triple_hyphen',
  [
    ['Корвин --- принц', `Корвин${NB}— принц`],
    ['Корвин---принц', `Корвин${NB}— принц`],
    ['Отец --- сын --- внук', `Отец${NB}— сын${NB}— внук`]
  ],
  [
    '---',
    'Текст\n---\nТекст',
    'x---y',
    'имя_---код',
    'Корвин ---- принц',
    '12---19',
    '---\ntitle: текст\n---'
  ]
);

examples(
  'symbol.plus_minus_slash',
  [
    ['+/-5', '±5'],
    ['Точность +/- 5', 'Точность ± 5'],
    ['(+/-)', '(±)']
  ],
  ['x+/-y', 'path+/-part', '++/-', '+/--', '+ / -']
);

examples(
  'symbol.arrows_extended',
  [
    ['Туда <-> обратно => вывод <=> равенство', 'Туда ↔ обратно ⇒ вывод ⇔ равенство'],
    ['(<->)', '(↔)']
  ],
  ['a=>b', '<-->', '==>', '<==>', 'x<->y', '=>=', 'a<=b']
);

test('extended arrows encode only their replacements', () => {
  const config = only('symbol.arrows_extended', { entities: true });
  assert.equal(microtypo('<-> => <=>', config), '&#8596; &#8658; &#8660;');
  assert.equal(microtypo('&#8596; &#8658; &#8660;', config), '&#8596; &#8658; &#8660;');
  assert.equal(
    microtypo('↔ ⇒ ⇔', { entities: true, rules: { 'symbol.arrows_extended': false } }),
    '↔ ⇒ ⇔'
  );
});

examples(
  'number.prime',
  [
    ["5' 10″", '5′ 10″'],
    ["(5')", '(5′)'],
    ["12,5'", '12,5′']
  ],
  ["x5'", "'5'", "5'слово", "5''", "12/5'", "v1.5'", "5'10", "+7 253 880-90-66'"]
);

test('single primes encode only when created by the optional rule', () => {
  const config = only('number.prime', { entities: true });
  assert.equal(microtypo("5'", config), '5&#8242;');
  assert.equal(microtypo('5&#8242;', config), '5&#8242;');
  assert.equal(microtypo('5′', { entities: true, rules: { 'number.prime': false } }), '5′');
});

examples(
  'number.fraction_extended',
  [
    ['1/3 2/3 1/8 3/8 5/8 7/8', '⅓ ⅔ ⅛ ⅜ ⅝ ⅞'],
    ['(1/3), 2/3.', '(⅓), ⅔.']
  ],
  ['11/3', '1/30', '1/3/2024', 'x1/3', '1/3x', '1/3″', '1/3"', '1 / 3']
);

test('optional fractions encode their own glyphs without changing default authored glyphs', () => {
  const config = only('number.fraction_extended', { entities: true });
  const expected = '&#8531; &#8532; &#8539; &#8540; &#8541; &#8542;';
  assert.equal(microtypo('1/3 2/3 1/8 3/8 5/8 7/8', config), expected);
  assert.equal(microtypo(expected, config), expected);
  assert.equal(
    microtypo('⅓', {
      entities: true,
      rules: { 'number.fraction_extended': false, 'number.minus': false }
    }),
    '⅓'
  );
});

examples(
  'number.minus',
  [
    ['-5', '−5'],
    ['(-1,5)', '(−1,5)'],
    ['Температура -5 градусов', 'Температура −5 градусов'],
    ['Значения: -5; -10.', 'Значения: −5; −10.']
  ],
  ['1-5', '10 - 5', '10-5', 'x-5', 'x -5', '12 -5', 'id_-5', '--5', '-5-10', '-5…10', 'a = -5']
);

test('minus reads generated and authored canonical fractions', () => {
  const config = {};
  for (const [source, expected] of [
    ['-1/3; (-2/3); -1/8; -3/8; -5/8; -7/8', '−⅓; (−⅔); −⅛; −⅜; −⅝; −⅞'],
    ['-1/2; -1/4; -3/4', '−½; −¼; −¾'],
    ['-⅓; (-⅔); -½; -¼; -¾; -1½', '−⅓; (−⅔); −½; −¼; −¾; −1½'],
    ['10 - 1/3; 1-1/3; x-⅓; id_-⅛; -⅓-⅔', '10–⅓; 1-⅓; x-⅓; id_-⅛; -⅓-⅔']
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
  const minus = only('number.minus');
  assert.equal(microtypo('-⅓; -½', minus), '−⅓; −½');
  const fractions = { rules: { ...OFF, 'number.minus': true, 'number.fraction_extended': true } };
  assert.equal(microtypo('10 - 1/3; 1-1/3', fractions), '10 - ⅓; 1-⅓');
});

test('negative fractions compose with entities, plain output and protected markup', () => {
  for (const [source, expected, extra] of [
    ['-&#8531;; -&frac12;', '&minus;&#8531;; &minus;&frac12;', { entities: true }],
    ['-&#x2154;', '−⅔', { entities: false }],
    ['-1/3', '−⅓', { entities: true, input: 'plain' }],
    [
      '<p><em>-1/3</em></p><code>-1/3</code>',
      '<p><em>−⅓</em></p><code>-1/3</code>',
      { html: true, render: { paragraphs: false } }
    ],
    [
      '<sup>-⅓</sup><sub>-½</sub><small>-⅛</small>',
      '<sup>-⅓</sup><sub>-½</sub><small>-⅛</small>',
      { html: true, render: { paragraphs: false } }
    ]
  ]) {
    const config = { ...extra };
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
});

test('minus selects canonical fraction references without enabling fraction substitution', () => {
  for (const [source, expected, extra] of [
    ['-⅓; -&#8531;; -&#x2153;; -1/3', '−⅓; −⅓; −⅓; −1/3', {}],
    ['-&#8531;; -&#x2153;; -1/3', '&minus;&#8531;; &minus;&#8531;; &minus;1/3', { entities: true }],
    [
      '<p>-&#8531;</p><code>-&#x2153;</code>',
      '<p>−⅓</p><code>-&#x2153;</code>',
      { input: 'html', html: true, render: { paragraphs: false } }
    ],
    ['<p>-&#x2153;</p>', '<p>&#8722;&#8531;</p>', { input: 'xml', entities: true }],
    ['<p>-&#8531;</p>', '<p>−⅓</p>', { input: 'xml', entities: false }]
  ]) {
    const config = { ...extra, rules: { 'number.fraction_extended': false } };
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, `repeat: ${source}`);
  }
  assert.equal(
    microtypo('-&#8531;; -1/3', { rules: { 'number.fraction_extended': false } }),
    '−⅓; −1/3'
  );
  assert.equal(
    microtypo('-&#8531; -⅓', {
      rules: { 'number.minus': false, 'number.fraction_extended': false }
    }),
    '-&#8531; -⅓'
  );
});

examples(
  'date.nbsp_century',
  [
    ['XXI век, XX в.', `XXI${NB}век, XX${NB}в.`],
    ['5 в. до н. э.', `5${NB}в. до н. э.`],
    ['В XXI веке, в 5 веке', `В XXI${NB}веке, в 5${NB}веке`]
  ],
  ['XXI\nвек', 'xxi век', '5 вековой', '5в.', 'MIX век', 'id5 в.', '2024 век']
);

examples(
  'nobr.nowrap_phone_extended',
  [
    ['+7 (999) 123 45 67', `+7${NB}(999)${NB}123${NB}45${NB}67`],
    ['8-800-555-35-35', '8-800-555-35-35'],
    ['+7-999-123-45-67', '+7-999-123-45-67']
  ],
  [
    '+7 (999) 12 45 67',
    '+7-999-123-45-678',
    '18-800-555-35-35',
    'id8-800-555-35-35',
    '8-800-555-35-35x',
    '+7\n(999) 123 45 67'
  ]
);

test('extended phones wrap complete authored numbers in HTML', () => {
  for (const source of ['+7 (999) 123 45 67', '8-800-555-35-35', '+7-999-123-45-67']) {
    const config = only('nobr.nowrap_phone_extended', { html: true });
    const expected = `<span style="white-space:nowrap;">${source}</span>`;
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

examples(
  'nobr.nbsp_last_word',
  [
    ['Это мой дом.', `Это мой${NB}дом.`],
    ['Большой серый кот!\n\nНовый тихий дом', `Большой серый${NB}кот!\n\nНовый тихий${NB}дом`],
    ['Тихий лес — сон', `Тихий лес — сон`],
    ['Здесь красивый лес»', `Здесь красивый${NB}лес»`]
  ],
  [
    'Одинокое',
    'Тихий длинный хвостик',
    '12 лет',
    'Тихий лес\nдальше',
    'Тихий лес код_1',
    'Тихий лес a'
  ]
);

test('binds a short last word after a normalized month range in an authored paragraph', () => {
  const config = { input: 'html', html: true };
  for (const [source, expected] of [
    [
      '<p>В марте дежурит Анна, а в апреле-мае я.</p>',
      `<p>В${NB}марте дежурит Анна, а${NB}в${NB}апреле–мае${NB}я.</p>`
    ],
    ['<p class="date"><em>март-май</em> ты?</p>', `<p class="date"><em>март–май</em>${NB}ты?</p>`],
    ['<p>январём-февралём мы</p>', `<p>январём–февралём${NB}мы</p>`],
    ['<p>апреле–мае я.</p>', `<p>апреле–мае${NB}я.</p>`],
    ['<p>дежурим мы.</p>', `<p>дежурим${NB}мы.</p>`],
    ['<p>тёмно-синий фон.</p>', '<p>тёмно-синий фон.</p>'],
    ['<p><code>март-май я</code></p>', '<p><code>март-май я</code></p>'],
    ['<p>март-май</p><p>я</p>', '<p>март–май</p><p>я</p>']
  ]) {
    assert.equal(microtypo(source, config), expected, source);
    assert.equal(microtypo(expected, config), expected, source);
  }
});

test('month ranges and the paragraph-final binding can be disabled independently', () => {
  const source = '<p>апреле-мае я.</p>';
  for (const [disabled, expected] of [
    ['date.month_range', source],
    ['nobr.nbsp_last_word', '<p>апреле–мае я.</p>']
  ]) {
    const config = { input: 'html', html: true, rules: { [disabled]: false } };
    assert.equal(microtypo(source, config), expected);
    assert.equal(microtypo(expected, config), expected);
  }
});

examples(
  'nobr.nbsp_after_number',
  [
    ['12 человек и 2024 год', `12${NB}человек и 2024${NB}год`],
    ['(1,5 километра)', `(1,5${NB}километра)`],
    ['12 человек 7 книг', `12${NB}человек 7${NB}книг`],
    ['½ стакана, 2½ мили, ⅜ дюйма', `½${NB}стакана, 2½${NB}мили, ⅜${NB}дюйма`]
  ],
  [
    'id12 человек',
    '12 people',
    '12 человек2',
    '12 человек_код',
    '12\nчеловек',
    '12человек',
    '1/12 человек'
  ]
);

examples(
  'nobr.nbsp_single_initial',
  [
    ['А. Пушкин', `А.${NB}Пушкин`],
    ['Дж. Р. Р. Толкин', `Дж.${NB}Р.${NB}Р.${NB}Толкин`],
    ['(А. Пушкин), Б. Окуджава', `(А.${NB}Пушкин), Б.${NB}Окуджава`]
  ],
  ['А. пушкин', 'А.\nПушкин', 'ABC. Пушкин', 'Арх. Пушкин', 'А.Пушкин', 'ВА. Пушкин']
);

examples(
  'abbr.nbsp_organization_extended',
  [
    [
      'ПАО Банк АО Завод НКО Фонд ИП Иванов',
      `ПАО${NB}Банк АО${NB}Завод НКО${NB}Фонд ИП${NB}Иванов`
    ],
    [
      'ФГУП Почта МУП Вода ГК Мир НПО Космос АНО Тень',
      `ФГУП${NB}Почта МУП${NB}Вода ГК${NB}Мир НПО${NB}Космос АНО${NB}Тень`
    ],
    ['(АО «Амбер»)', `(АО${NB}«Амбер»)`]
  ],
  ['ПАО\nБанк', 'пао Банк', 'АО 123', 'САО Банк', 'АО_Банк']
);

examples(
  'abbr.nowrap_because',
  [
    ['т. к. т. н. т. о. и др. и пр.', `т.${NB}к. т.${NB}н. т.${NB}о. и${NB}др. и${NB}пр.`],
    ['(Т. к.)', `(Т.${NB}к.)`],
    ['т.к. т.н. т.о.', `т.${NB}к. т.${NB}н. т.${NB}о.`]
  ],
  ['т. к.р.', 'т. книга', 'т.\nк.', 'ноти др.', 'т.код']
);

examples(
  'abbr.nbsp_part',
  [
    [
      'т. 1 ч. 2 табл. 3 разд. 4 пп. 5 стст. 6',
      `т.${NB}1 ч.${NB}2 табл.${NB}3 разд.${NB}4 пп.${NB}5 стст.${NB}6`
    ],
    ['(Табл. 12)', `(Табл.${NB}12)`]
  ],
  ['т. е.', 'часть 2', 'табл.\n3', 'табл. 3D', 'табл.3', 'метабл. 3']
);

examples(
  'abbr.nbsp_title',
  [
    [
      'проф. Иванов, акад. Петров, доц. Сидоров',
      `проф.${NB}Иванов, акад.${NB}Петров, доц.${NB}Сидоров`
    ],
    ['д-р Живаго, тов. Корвин, св. Пётр', `д-р${NB}Живаго, тов.${NB}Корвин, св.${NB}Пётр`],
    ['(Проф. Иванов)', `(Проф.${NB}Иванов)`]
  ],
  ['проф. кафедры', 'св. мощи', 'непроф. Иванов', 'проф.\nИванов', 'проф.Иванов']
);

examples(
  'abbr.nbsp_currency_code',
  [
    ['100 USD 200 EUR 300 RUB', `100${NB}USD 200${NB}EUR 300${NB}RUB`],
    ['(1,5 USD)', `(1,5${NB}USD)`]
  ],
  ['100 usd', '100 USDT', 'x100 USD', '100USD', '100\nEUR', '+7 788 769-09-29 EUR']
);

examples(
  'abbr.nbsp_si_unit',
  [
    ['5 Вт 2 кВт 3 кВт·ч 4 А 6 га 7 ‰', `5${NB}Вт 2${NB}кВт 3${NB}кВт·ч 4${NB}А 6${NB}га 7${NB}‰`],
    ['2 кв. м 3 куб. м 100 л. с.', `2${NB}кв.${NB}м 3${NB}куб.${NB}м 100${NB}л.${NB}с.`],
    ['1,5 кВт', `1,5${NB}кВт`]
  ],
  ['x5 Вт', '5 вТ', '5 Втч', '5 АБ', '5 гектаров', '5\nкВт', '5кВт', '+7 789 111-82-44 А']
);

examples(
  'abbr.nbsp_count_unit',
  [
    ['12 шт. 3 экз. 4 чел.', `12${NB}шт. 3${NB}экз. 4${NB}чел.`],
    [
      '5 сек 2 с 6 мес. 7 нед. 8 дн. 9 коп.',
      `5${NB}сек 2${NB}с 6${NB}мес. 7${NB}нед. 8${NB}дн. 9${NB}коп.`
    ],
    ['1,5 сек', `1,5${NB}сек`]
  ],
  ['x5 шт.', '5 секция', '5 секунд', '5\nшт.', '12шт.', '5 ШТ.', '+7 789 111-82-44 шт.']
);

examples(
  'abbr.nbsp_magnitude_spaced',
  [
    ['5 тыс. руб.', `5${NB}тыс.${NB}руб.`],
    ['1,5 млн рублей', `1,5${NB}млн${NB}рублей`],
    ['1 млн чел.', `1${NB}млн${NB}чел.`],
    ['(2 млрд долларов)', `(2${NB}млрд${NB}долларов)`],
    ['5 тыс. деревьев', `5${NB}тыс. деревьев`],
    ['5 млн рубероид', `5${NB}млн рубероид`]
  ],
  [
    'x5 млн рублей',
    '5 тысяч рублей',
    '5\nмлн рублей',
    '5 млнрублей',
    '+7 814 780-82-56 млн',
    `+7 814 780-82-56${NB}млн рублей`
  ]
);
