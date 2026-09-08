import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defineRuleGroup } from '../../src/define-rule.js';
import { MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo, microtypo } from '../../src/index.js';
import { validateConfig } from '../../src/schemas/config.js';

test('empty config validates and defaults input to text', () => {
  assert.deepEqual(validateConfig({}), { input: { format: 'text', template: 'off' } });
});

test('valid entities passes', () => {
  assert.equal(validateConfig({ entities: false }).entities, false);
  assert.equal(validateConfig({ entities: true }).entities, true);
  assert.equal(validateConfig({ entities: 'on' }).entities, 'on');
});

test('invalid entities throws', () => {
  assert.throws(() => validateConfig({ entities: 'gibberish' }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('output is now an unknown key and throws', () => {
  assert.throws(() => validateConfig({ output: 'entities' }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('maxInputLength must be a non-negative integer', () => {
  assert.throws(() => validateConfig({ maxInputLength: -1 }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ maxInputLength: 1.5 }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.equal(validateConfig({ maxInputLength: 0 }).maxInputLength, 0);
  assert.equal(validateConfig({ maxInputLength: 1_000_000 }).maxInputLength, 1_000_000);
});

test('maxProcessingMs must be a non-negative number', () => {
  assert.equal(validateConfig({ maxProcessingMs: 0 }).maxProcessingMs, 0);
  assert.equal(validateConfig({ maxProcessingMs: 5000 }).maxProcessingMs, 5000);
  assert.throws(() => validateConfig({ maxProcessingMs: -1 }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test("input accepts 'text'|'html'|'markdown'|'json'|'yaml'|'toml'|'frontmatter', rejects other values", () => {
  assert.deepEqual(validateConfig({ input: 'text' }).input, { format: 'text', template: 'off' });
  assert.deepEqual(validateConfig({ input: 'html' }).input, { format: 'html', template: 'off' });
  assert.deepEqual(validateConfig({ input: 'markdown' }).input, {
    format: 'markdown',
    template: 'off'
  });
  assert.deepEqual(validateConfig({ input: 'json' }).input, { format: 'json', template: 'off' });
  assert.deepEqual(validateConfig({ input: 'yaml' }).input, { format: 'yaml', template: 'off' });
  assert.deepEqual(validateConfig({ input: 'toml' }).input, { format: 'toml', template: 'off' });
  assert.deepEqual(validateConfig({ input: 'frontmatter' }).input, {
    format: 'frontmatter',
    template: 'off'
  });
  assert.throws(() => validateConfig({ input: 'bogus' }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ input: true }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('input accepts the object form { format?, fields?, exclude?, template? }', () => {
  assert.deepEqual(validateConfig({ input: {} }).input, { format: 'text', template: 'off' });
  assert.deepEqual(validateConfig({ input: { format: 'markdown' } }).input, {
    format: 'markdown',
    template: 'off'
  });
  assert.deepEqual(validateConfig({ input: { template: 'liquid' } }).input, {
    format: 'text',
    template: 'liquid'
  });
  assert.deepEqual(validateConfig({ input: { fields: ['a.b'], exclude: ['meta.id'] } }).input, {
    format: 'text',
    template: 'off',
    fields: ['a.b'],
    exclude: ['meta.id']
  });
  assert.deepEqual(validateConfig({ input: { format: 'json' } }).input, {
    format: 'json',
    template: 'off'
  });
  assert.deepEqual(validateConfig({ input: { format: 'yaml' } }).input, {
    format: 'yaml',
    template: 'off'
  });
});

test('input object accepts frontmatter, rejects unknown format/keys and bad template values', () => {
  assert.deepEqual(validateConfig({ input: { format: 'frontmatter' } }).input, {
    format: 'frontmatter',
    template: 'off'
  });
  assert.throws(() => validateConfig({ input: { format: 'bogus' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ input: { bogus: true } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ input: { template: 'jsp' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ input: { fields: 'a.b' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ input: { exclude: [1, 2] } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ input: null }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('the old markdown flag is now an unknown top-level key', () => {
  assert.throws(() => validateConfig({ markdown: true }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ markdown: false }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('html accepts a boolean, rejects an object', () => {
  assert.equal(validateConfig({ html: true }).html, true);
  assert.equal(validateConfig({ html: false }).html, false);
  assert.throws(() => validateConfig({ html: { paragraphs: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('render must be an object', () => {
  assert.throws(() => validateConfig({ render: 'nobr' }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ render: null }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('render rejects unknown keys', () => {
  assert.throws(() => validateConfig({ render: { bogus: true } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('render.nowrap accepts "nobr"/"span", rejects other values', () => {
  assert.deepEqual(validateConfig({ render: { nowrap: 'nobr' } }).render, { nowrap: 'nobr' });
  assert.deepEqual(validateConfig({ render: { nowrap: 'span' } }).render, { nowrap: 'span' });
  assert.throws(() => validateConfig({ render: { nowrap: 'div' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('render.hanging accepts style/class/both, rejects other values', () => {
  for (const value of ['style', 'class', 'both']) {
    assert.deepEqual(validateConfig({ render: { hanging: value } }).render, { hanging: value });
  }
  assert.throws(() => validateConfig({ render: { hanging: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('render.paragraphs/autolink/breakline accept boolean-ish, reject other values', () => {
  assert.deepEqual(validateConfig({ render: { paragraphs: false } }).render, {
    paragraphs: false
  });
  assert.deepEqual(validateConfig({ render: { autolink: 'off' } }).render, { autolink: 'off' });
  assert.throws(() => validateConfig({ render: { breakline: 'gibberish' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('render.prefix accepts false or a string, rejects other values', () => {
  assert.deepEqual(validateConfig({ render: { prefix: false } }).render, { prefix: false });
  assert.deepEqual(validateConfig({ render: { prefix: 'amber_' } }).render, { prefix: 'amber_' });
  assert.throws(() => validateConfig({ render: { prefix: true } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('rules keys pass through untouched', () => {
  const result = validateConfig({
    rules: { 'punctuation.*': false, quote: false, emdash: true, endash: true, nbsp: false }
  });

  assert.deepEqual(result.rules, {
    'punctuation.*': false,
    quote: false,
    emdash: true,
    endash: true,
    nbsp: false
  });
});

test('old object-preset top-level keys are rejected (quotes/dashes/spaces/etc. removed)', () => {
  assert.throws(() => validateConfig({ quotes: { style: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ dashes: { em: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ spaces: { nbsp: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('old top-level dotted-rule keys are rejected (dotted keys are only valid inside rules)', () => {
  assert.throws(() => validateConfig({ 'dash.em': false }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ 'hanging.all': 'on' }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('rules accepts bundle names and group aliases, rejects unknown ones', () => {
  assert.doesNotThrow(() => validateConfig({ rules: { units: false, currency: true } }));
  assert.doesNotThrow(() => validateConfig({ rules: { hanging: false, text: false } }));
  assert.throws(() => validateConfig({ rules: { bogus: false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ rules: { 'quote.foo': false, extra: true } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('non-object input is treated as empty config', () => {
  assert.deepEqual(validateConfig(undefined), { input: { format: 'text', template: 'off' } });
  assert.deepEqual(validateConfig(null), { input: { format: 'text', template: 'off' } });
});

test('non-object, non-array top-level config throws', () => {
  for (const bad of ['html', 42, true, []]) {
    assert.throws(() => validateConfig(bad), { code: 'ERR_MICROTYPO_CONFIG' });
  }
});

test('maxProcessingMs rejects Infinity/NaN, 0 still disables the budget', () => {
  assert.throws(() => validateConfig({ maxProcessingMs: Infinity }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ maxProcessingMs: -Infinity }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ maxProcessingMs: Number.NaN }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.equal(validateConfig({ maxProcessingMs: 0 }).maxProcessingMs, 0);
});

test('presets must be a strict boolean', () => {
  assert.equal(validateConfig({ presets: false }).presets, false);
  assert.equal(validateConfig({ presets: true }).presets, true);
  assert.throws(() => validateConfig({ presets: 'false' }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ presets: 0 }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('rules values must be boolean-ish', () => {
  assert.throws(() => validateConfig({ rules: { quote: 'bogus' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.throws(() => validateConfig({ rules: { quote: {} } }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ rules: { quote: [] } }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.doesNotThrow(() => validateConfig({ rules: { quote: 'on' } }));
});

test('a dotted selector must match a real rule id, wildcards still allowed', () => {
  assert.throws(() => validateConfig({ rules: { 'quote.typo': false } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
  assert.doesNotThrow(() => validateConfig({ rules: { 'quote.*': false } }));
  assert.doesNotThrow(() => validateConfig({ rules: { 'abbr.nbsp_*': false } }));
  assert.doesNotThrow(() => validateConfig({ rules: { 'dash.em*': false } }));
  assert.doesNotThrow(() => validateConfig({ rules: { 'quote.open': false } }));
  assert.doesNotThrow(() => validateConfig({ rules: { 'quote.nested': false } }));
  assert.doesNotThrow(() => validateConfig({ rules: { 'quote.inch': false } }));
  assert.doesNotThrow(() =>
    validateConfig({ rules: { quote: false, emdash: true, units: false } })
  );
});

test('every built-in group.rule id still validates', async () => {
  const { DEFAULT_GROUPS } = await import('../../src/rules/registry.js');
  for (const [group, def] of DEFAULT_GROUPS) {
    for (const rule of def.rules) {
      assert.doesNotThrow(
        () => validateConfig({ rules: { [`${group}.${rule.id}`]: false } }),
        `${group}.${rule.id} should validate`
      );
    }
  }
});

test('empty-array render/rules are rejected (arrays are objects too)', () => {
  assert.throws(() => validateConfig({ render: [] }), { code: 'ERR_MICROTYPO_CONFIG' });
  assert.throws(() => validateConfig({ rules: [] }), { code: 'ERR_MICROTYPO_CONFIG' });
});

test('input.fields/exclude are snapshotted from the caller array', () => {
  const fields = ['title'];
  const result = validateConfig({ input: { format: 'json', fields } });
  fields.push('slug');
  assert.deepEqual(result.input.fields, ['title']);
  assert.throws(() => result.input.fields.push('x'), TypeError);
});

test('applyOptions rejects every value the constructor rejects', () => {
  const bad = [
    { entities: 'gibberish' },
    { maxProcessingMs: Infinity },
    { maxInputLength: 5_000_001 },
    { presets: 'false' },
    { rules: { quote: 'bogus' } },
    { rules: { 'quote.typo': false } },
    { render: [] },
    { rules: [] }
  ];

  for (const cfg of bad) {
    assert.throws(() => new MicroTypo(cfg), { code: 'ERR_MICROTYPO_CONFIG' }, JSON.stringify(cfg));
    assert.throws(
      () => new MicroTypo().applyOptions(cfg),
      { code: 'ERR_MICROTYPO_CONFIG' },
      JSON.stringify(cfg)
    );
  }
});

test('applyOptions accepts valid incremental config after construction', () => {
  const typo = new MicroTypo();
  assert.doesNotThrow(() => typo.applyOptions({ render: { nowrap: 'span' } }));
  assert.doesNotThrow(() => typo.applyOptions({ rules: { 'other.nbsp_in_nowrap': true } }));
});

test('end-to-end call rejects an unknown top-level key', () => {
  assert.throws(() => microtypo('"Корвин"', { qutoes: false }), MicroTypoConfigError);
});

test('end-to-end call rejects an unknown rules group', () => {
  assert.throws(
    () => microtypo('x', { rules: { 'Nonexistent.foo': false } }),
    MicroTypoConfigError
  );
});

test('end-to-end call accepts a valid rules config', () => {
  assert.doesNotThrow(() => microtypo('"Корвин"', { rules: { quote: false } }));
});

test('end-to-end call rejects a top-level dotted key', () => {
  assert.throws(() => microtypo('x', { 'hanging.all': 'on' }), MicroTypoConfigError);
});

test('end-to-end call rejects the old object-preset surface', () => {
  assert.throws(() => microtypo('x', { quotes: { style: false } }), MicroTypoConfigError);
});

test('end-to-end call rejects the old top-level dotted-rule surface', () => {
  assert.throws(() => microtypo('x', { 'dash.em': false }), MicroTypoConfigError);
});

test('registerRuleGroup: rules must be an array', () => {
  const typo = new MicroTypo();
  assert.throws(
    () => typo.registerRuleGroup(defineRuleGroup({ title: 'X', rules: {} }), { name: 'X' }),
    { name: 'TypeError', message: "Rule group 'x': rules must be an array" }
  );
});

test('registerRuleGroup: a rule without an id throws', () => {
  const typo = new MicroTypo();
  assert.throws(
    () =>
      typo.registerRuleGroup(
        defineRuleGroup({ title: 'X', rules: [{ pattern: /a/g, replacement: 'b' }] }),
        { name: 'X' }
      ),
    { name: 'TypeError', message: "Rule group 'x': rule.id must be a non-empty string" }
  );
});

test('registerRuleGroup: handler is exclusive with pattern/replacement', () => {
  const typo = new MicroTypo();
  assert.throws(
    () =>
      typo.registerRuleGroup(
        defineRuleGroup({ title: 'X', rules: [{ id: 'r1', handler: () => {}, pattern: /a/g }] }),
        { name: 'X' }
      ),
    { name: 'TypeError', message: "Rule 'x.r1': handler is exclusive — drop pattern/replacement" }
  );
});

test('registerRuleGroup: pattern must be a RegExp', () => {
  const typo = new MicroTypo();
  assert.throws(
    () =>
      typo.registerRuleGroup(
        defineRuleGroup({ title: 'X', rules: [{ id: 'r1', pattern: 'a', replacement: 'b' }] }),
        { name: 'X' }
      ),
    { name: 'TypeError', message: "Rule 'x.r1': pattern must be RegExp (got string)" }
  );
});

test('replacement array shorter than pattern array throws', () => {
  const typo = new MicroTypo();
  assert.throws(
    () =>
      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'X',
          rules: [{ id: 'r1', pattern: [/a/g, /b/g], replacement: ['X'] }]
        }),
        { name: 'X' }
      ),
    {
      name: 'TypeError',
      message: "Rule 'x.r1': replacement array length (1) must match pattern array length (2)"
    }
  );
});

test('replacement array longer than pattern array throws', () => {
  const typo = new MicroTypo();
  assert.throws(
    () =>
      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'X',
          rules: [{ id: 'r1', pattern: [/a/g], replacement: ['X', 'Y'] }]
        }),
        { name: 'X' }
      ),
    {
      name: 'TypeError',
      message: "Rule 'x.r1': replacement array length (2) must match pattern array length (1)"
    }
  );
});

test('equal-length pattern/replacement arrays register and run', () => {
  const typo = new MicroTypo();
  typo.registerRuleGroup(
    defineRuleGroup({
      title: 'X',
      rules: [{ id: 'r1', pattern: [/a/g, /b/g], replacement: ['1', '2'] }]
    }),
    { name: 'X' }
  );
  assert.equal(typo.process('a b'), '1 2');
});

test('reassigning a scalar replacement after registration does not change output', () => {
  const def = { title: 'm', rules: [{ id: 'x', pattern: /a/g, replacement: 'A' }] };
  const typo = new MicroTypo();
  typo.registerRuleGroup(def, { name: 'm' });
  const before = typo.process('a');
  def.rules[0].replacement = 'Z';
  assert.equal(typo.process('a'), before);
});

test('mutating a replacement array element does not change output', () => {
  const def = {
    title: 'm',
    rules: [{ id: 'x', pattern: [/a/g, /b/g], replacement: ['A', 'B'] }]
  };
  const typo = new MicroTypo();
  typo.registerRuleGroup(def, { name: 'm' });
  const before = typo.process('a b');
  def.rules[0].replacement[0] = 'Z';
  assert.equal(typo.process('a b'), before);
  assert.equal(before, 'A B');
});

test('mutating group-level classes after registration does not change output', () => {
  const def = {
    title: 'm',
    classes: { nowrap: 'orig' },
    rules: [{ id: 'x', handler: (ctx) => `${ctx.text}:${ctx.group.raw.classes.nowrap}` }]
  };
  const typo = new MicroTypo();
  typo.registerRuleGroup(def, { name: 'm' });
  const before = typo.process('a');
  def.classes.nowrap = 'MUTATED';
  assert.equal(typo.process('a'), before);
  assert.equal(before, 'a:orig');
});

test('swapping rule.handler after registration does not change output', () => {
  const def = { title: 'm', rules: [{ id: 'x', handler: (ctx) => `${ctx.text}:Амбер` }] };
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(def, { name: 'm' });
  const before = typo.process('Корвин');
  def.rules[0].handler = (ctx) => `${ctx.text}:Хаос`;
  assert.equal(before, 'Корвин:Амбер');
  assert.equal(typo.process('Корвин'), before);
});

test('mutating a caller-owned pattern after registration does not change output', () => {
  class Live extends RegExp {}
  const def = {
    title: 'm',
    rules: [{ id: 'x', pattern: new Live('Корвин', 'g'), replacement: 'Оберон' }]
  };
  const typo = new MicroTypo({ presets: false });
  typo.registerRuleGroup(def, { name: 'm' });
  const before = typo.process('Корвин');
  Live.prototype[Symbol.replace] = () => 'Хаос';

  try {
    assert.equal(before, 'Оберон');
    assert.equal(typo.process('Корвин'), before);
  } finally {
    delete Live.prototype[Symbol.replace];
  }
});

test('adding preParse after registration is never invoked', () => {
  const def = { title: 'm', rules: [{ id: 'x', pattern: /a/g, replacement: 'A' }] };
  const typo = new MicroTypo();
  typo.registerRuleGroup(def, { name: 'm' });
  let called = false;
  def.preParse = () => {
    called = true;
  };
  typo.process('a');
  assert.equal(called, false);
});

test('non-cloneable classes throw a typed TypeError', () => {
  const def = {
    title: 'm',
    classes: { x: () => {} },
    rules: [{ id: 'x', pattern: /a/g, replacement: 'A' }]
  };
  const typo = new MicroTypo();
  assert.throws(() => typo.registerRuleGroup(def, { name: 'm' }), TypeError);
});
