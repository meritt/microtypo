import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo, microtypo } from '../../src/index.js';

const config = (placeholders) => ({ html: false, input: { placeholders } });

test('ICU arguments and plural syntax remain unchanged while branch prose is typeset', () => {
  const source = '{name}: {n, plural, one {# день - "текст"} other {# дней - "тексты"}}';
  const expected =
    '{name}: {n, plural, one {# день\u{00A0}— «текст»} other {# дней\u{00A0}— «тексты»}}';
  assert.equal(microtypo(source, config('icu')), expected);
});

test('nested select/plural, offset and exact selectors keep their grammar', () => {
  const source =
    '{kind, select, a {{n, plural, offset:1 =0 {Ничего - нет} one {# день - "текст"} other {# дней}}} other {Текст - другой}}';
  const expected =
    '{kind, select, a {{n, plural, offset:1 =0 {Ничего\u{00A0}— нет} one {# день\u{00A0}— «текст»} other {# дней}}} other {Текст\u{00A0}— другой}}';
  assert.equal(microtypo(source, config('icu')), expected);
});

test('ICU style arguments and quoted syntax stay byte-exact', () => {
  const source =
    "{amount, number, ::currency/USD} '{name}' {n, plural, one {'#' день} other {# дней}}";
  assert.equal(microtypo(source, config('icu')), source);
});

test('ICU quoted braces after a plural number sign do not end the branch', () => {
  const source = "{n, plural, one {'#{' день - текст} other {'#}' дней - тексты}}";
  const expected = "{n, plural, one {'#{' день\u{00A0}— текст} other {'#}' дней\u{00A0}— тексты}}";
  assert.equal(microtypo(source, config('icu')), expected);
});

// `''` is how a message writes an apostrophe: text to typeset, never syntax that hides what follows.
test('an ICU doubled apostrophe is an apostrophe of the message', () => {
  for (const placeholders of ['icu', 'all']) {
    assert.equal(microtypo("O''Really, {name}!", config(placeholders)), 'O’Really, {name}!');
    assert.equal(microtypo("It''s {n} - текст", config(placeholders)), 'It’s {n}\u{00A0}— текст');
  }
});

// A placeholder is a word to the quotes, so a quote right after it closes before any closing bracket.
test('a quote after a placeholder closes before a closing bracket', () => {
  for (const [source, expected] of [
    ['Пишет "%@"]', 'Пишет «%@»]'],
    ['Пишет "%1$s"}', 'Пишет «%1$s»}'],
    ['Пишет "{name}"]', 'Пишет «{name}»]'],
    ['Пишет "{name}")', 'Пишет «{name}»)']
  ]) {
    assert.equal(microtypo(source), expected);
    assert.equal(microtypo(expected), expected);
  }
});

test('ICU ordinary apostrophes do not hide following arguments', () => {
  const source = "L'homme {name} - текст";
  assert.equal(microtypo(source, config('icu')), 'L’homme {name}\u{00A0}— текст');
});

test('unfinished placeholder candidates leave prose available to typography', () => {
  for (const [mode, prefix] of [
    ['icu', '{name'],
    ['printf', '%1$'],
    ['interpolation', '${var']
  ]) {
    assert.equal(
      microtypo(`${prefix} текст - другой`, config(mode)),
      `${prefix} текст\u{00A0}— другой`
    );
  }
});

for (const placeholder of ['%s', '%1$s', '%@', '%d', '%05d', '%2$.*3$f', '%%']) {
  test(`printf keeps ${placeholder} and formats adjacent prose`, () => {
    assert.equal(
      microtypo(`${placeholder} - "текст"`, config('printf')),
      `${placeholder}\u{00A0}— «текст»`
    );
  });
}

for (const [format, wrap] of [
  ['text', (text) => text],
  ['json', (text) => JSON.stringify({ value: text })],
  ['yaml', (text) => `value: ${text}`],
  ['toml', (text) => `value = "${text}"`]
]) {
  test(`${format} keeps a printf argument after an ordinary percent sign`, () => {
    const source = wrap('7%  %2$.*3$f - текст');
    const expected = wrap('7% %2$.*3$f\u{00A0}— текст');
    const options = { html: false, input: { format, placeholders: 'printf' } };
    assert.equal(microtypo(source, options), expected);
    assert.equal(microtypo(expected, options), expected);
  });
}

test('a percent sign before a space is prose, not a printf flag', () => {
  for (const placeholders of ['printf', 'all']) {
    for (const source of ['7%  XIV ря', '7% XIV ря']) {
      assert.equal(microtypo(source, config(placeholders)), '7% XIV ря');
    }
  }
});

test('literal percent pairs remain protected next to numbered printf arguments', () => {
  const source = '%%%2$.*3$f - текст';
  const expected = '%%%2$.*3$f\u{00A0}— текст';
  assert.equal(microtypo(source, config('printf')), expected);
  assert.equal(microtypo(expected, config('printf')), expected);
});

test('interpolation keeps its variable and all mode combines the syntaxes', () => {
  assert.equal(microtypo(`\${var} - "текст"`, config('interpolation')), `\${var}\u{00A0}— «текст»`);
  const source = `\${var} {name} %1$s - "текст"`;
  assert.equal(microtypo(source, config('all')), `\${var} {name} %1$s\u{00A0}— «текст»`);
});

test('localization protection is on by default and off by its option', () => {
  assert.equal(microtypo(`\${a - b} - текст`), `\${a - b}\u{00A0}— текст`);
  assert.equal(microtypo(`\${a - b} - текст`, config('off')), `\${a\u{00A0}— b}\u{00A0}— текст`);
});

test('unknown localization mode is a typed config error', () => {
  for (const placeholders of [true, [], 'ICU', 'unknown']) {
    assert.throws(() => microtypo('Текст', config(placeholders)), MicroTypoConfigError);
  }
});

test('a configured localization mode survives option updates and cannot switch after construction', () => {
  const typo = new MicroTypo(config('printf'));
  typo.applyOptions({ rules: { 'symbol.arrows': false } });
  assert.equal(typo.process('%1$s - текст'), '%1$s\u{00A0}— текст');
  assert.throws(() => typo.applyOptions({ input: { placeholders: 'icu' } }), MicroTypoConfigError);
  assert.equal(typo.process('%1$s - текст'), '%1$s\u{00A0}— текст');
});

for (const [format, wrap] of [
  ['json', (text) => JSON.stringify({ value: text })],
  ['yaml', (text) => `value: "${text}"`],
  ['toml', (text) => `value = "${text}"`]
]) {
  test(`${format} protects localization inside eligible values`, () => {
    const value = '{n, plural, one {# день - текст} other {# дней - тексты}}';
    const typed = '{n, plural, one {# день\u{00A0}— текст} other {# дней\u{00A0}— тексты}}';
    assert.equal(microtypo(wrap(value), { input: { format, placeholders: 'all' } }), wrap(typed));
  });
}

test('ICU-looking syntax inside Markdown code remains protected as code', () => {
  const source = '`{n, plural, one {Код - текст} other {Код - тексты}}`';
  assert.equal(microtypo(source, { input: { format: 'markdown', placeholders: 'all' } }), source);
});

test('XML numeric references remain whole beside ICU plural counts', () => {
  const options = {
    input: { format: 'xml', placeholders: 'all' },
    entities: true,
    rules: { 'quote.close': false }
  };
  const before = '<doc><note>Редактор оставил «название " город</note><p>{n, plural, ';
  const after = '<doc><note>Редактор оставил &#171;название " город</note><p>{n, plural, ';
  for (const [branches, expected] of [
    ['one {# "день"} other {# "дня"}', 'one {# &#171;день"} other {# &#171;дня"}'],
    [
      'one {# &#x00AB;день" и #} other {# &#0171;дня"}',
      'one {# &#x00AB;день" и #} other {# &#0171;дня"}'
    ]
  ]) {
    const output = `${after + expected}}</p></doc>`;
    assert.equal(microtypo(`${before + branches}}</p></doc>`, options), output);
    assert.equal(microtypo(output, options), output);
  }
});
