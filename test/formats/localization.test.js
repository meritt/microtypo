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

test('localization protection is opt-in', () => {
  const source = '{n, plural, one {# день - "текст"} other {# дней}}';
  assert.equal(microtypo(source), microtypo(source, config('off')));
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
