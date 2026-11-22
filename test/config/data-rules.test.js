import assert from 'node:assert/strict';
import test from 'node:test';

import { MicroTypo } from '../../src/index.js';

test('JSON data rules execute captures and flags with the same protection as registered rules', () => {
  const config = {
    presets: false,
    ruleGroups: [
      {
        name: 'terms',
        rules: [{ id: 'amber', pattern: { source: '(amber)', flags: 'gi' }, replacement: '[$1]' }]
      }
    ]
  };
  const serialized = JSON.stringify(config);
  const typo = new MicroTypo(JSON.parse(serialized));
  assert.equal(
    typo.process('AMBER amber <code>amber</code>'),
    '[AMBER] [amber] <code>amber</code>'
  );
  config.ruleGroups[0].rules[0].replacement = 'changed';
  assert.equal(typo.process('amber'), '[amber]');
});

test('data patterns work through public group registration alongside function rules', () => {
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(
    {
      rules: [
        { id: 'data', pattern: { source: 'A', flags: '' }, replacement: 'B' },
        { id: 'function', handler: ({ text }) => text.replaceAll('B', 'C') }
      ]
    },
    { name: 'terms' }
  );
  assert.equal(typo.process('A A'), 'C C');
});

test('invalid data rules fail with typed config errors before executing input', () => {
  const invalid = [
    { source: '(', flags: 'g' },
    { source: 'x', flags: 'gg' },
    { source: 1, flags: 'g' },
    { source: 'x', flags: 1 },
    { source: 'x', flags: '', extra: true }
  ];
  for (const pattern of invalid) {
    assert.throws(
      () =>
        new MicroTypo({
          ruleGroups: [{ name: 'terms', rules: [{ id: 'x', pattern, replacement: 'y' }] }]
        }),
      { code: 'ERR_MICROTYPO_CONFIG' }
    );
    assert.throws(
      () =>
        new MicroTypo().registerRuleGroup(
          { rules: [{ id: 'x', pattern, replacement: 'y' }] },
          { name: 'terms' }
        ),
      { code: 'ERR_MICROTYPO_CONFIG' }
    );
  }
  for (const ruleGroups of [
    true,
    {},
    [null],
    [{ name: '', rules: [] }],
    [
      {
        name: 'x',
        rules: [{ id: 'x', pattern: { source: 'x', flags: '' }, replacement: () => 'y' }]
      }
    ]
  ]) {
    assert.throws(() => new MicroTypo({ ruleGroups }), { code: 'ERR_MICROTYPO_CONFIG' });
  }
});

test('custom data rules obey group and wildcard selectors in constructor and later options', () => {
  const ruleGroups = [
    {
      name: 'terms',
      rules: [{ id: 'amber', pattern: { source: 'Amber', flags: 'g' }, replacement: 'Амбер' }]
    }
  ];
  for (const rules of [{ terms: false }, { 'terms.amber': false }, { 'terms.am*': false }]) {
    assert.equal(new MicroTypo({ presets: false, ruleGroups, rules }).process('Amber'), 'Amber');
  }
  const typo = new MicroTypo({ presets: false, ruleGroups });
  typo.applyOptions({ rules: { 'terms.amber': false } });
  assert.equal(typo.process('Amber'), 'Amber');
  typo.applyOptions({ rules: { terms: true } });
  assert.equal(typo.process('Amber'), 'Амбер');
  assert.throws(() => typo.applyOptions({ rules: { 'terms.missing': false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('registered data patterns require string replacements and failed registration preserves the engine', () => {
  const typo = new MicroTypo({ presets: false });
  for (const replacement of [() => 'b', 4, null]) {
    assert.throws(
      () =>
        typo.registerRuleGroup(
          { rules: [{ id: 'a', pattern: { source: 'a', flags: 'g' }, replacement }] },
          { name: 'custom' }
        ),
      { code: 'ERR_MICROTYPO_CONFIG' }
    );
    assert.equal(typo.process('a'), 'a');
  }
});
