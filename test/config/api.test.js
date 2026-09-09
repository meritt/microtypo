import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineRuleGroup } from '../../src/define-rule.js';
import { MicroTypoConfigError } from '../../src/errors/index.js';
import { microtypo, MicroTypo, VERSION } from '../../src/index.js';
import { compileCacheSize } from '../../src/rules/etc.js';

test('empty string returns empty', () => {
  assert.equal(microtypo(''), '');
});

test('whitespace-only input trims to empty', () => {
  assert.equal(microtypo('   '), '');
});

test('newline-only input trims to empty', () => {
  assert.equal(microtypo('\n\n\n'), '');
});

test('VERSION is a non-empty string', () => {
  assert.equal(typeof VERSION, 'string');
  assert.ok(VERSION.length > 0);
});

test('microtypo() runs with no options', () => {
  assert.equal(typeof microtypo('Corwin'), 'string');
});

test('microtypo() tolerates null options', () => {
  assert.doesNotThrow(() => microtypo('Corwin', null));
});

test('group alias equals its explicit selectors', () => {
  const a = microtypo('Корвин у Лабиринта', { rules: { hanging: true } });
  const b = microtypo('Корвин у Лабиринта', {
    rules: { 'hanging.quote': true, 'hanging.bracket': true }
  });
  assert.equal(a, b);
});

test('group alias true equals "on"', () => {
  const a = microtypo('Амбер', { rules: { hanging: true } });
  const b = microtypo('Амбер', { rules: { hanging: 'on' } });
  assert.equal(a, b);
});

test('"off" string equals boolean false', () => {
  const a = microtypo('Корвин и Эрик', {
    rules: { 'punctuation.comma_before_conjunction': 'off' }
  });
  const b = microtypo('Корвин и Эрик', {
    rules: { 'punctuation.comma_before_conjunction': false }
  });
  assert.equal(a, b);
});

test('instance reuse handles different inputs', () => {
  const typo = new MicroTypo();
  const a = typo.process('Первый "Козырь"');
  const b = typo.process('Второй "Козырь"');
  assert.ok(a.includes('Первый'));
  assert.ok(b.includes('Второй'));
  assert.ok(a.includes('«'));
  assert.ok(b.includes('«'));
});

test('instance reuse keeps applied options', () => {
  const typo = new MicroTypo({ render: { paragraphs: false } });
  const a = typo.process('Corwin "Amber"');
  const b = typo.process('Random "Rebma"');
  assert.ok(!a.startsWith('<p>'));
  assert.ok(!b.startsWith('<p>'));
});

test('hanging=style emits inline style', () => {
  const typo = new MicroTypo({
    html: true,
    render: { hanging: 'style' },
    rules: { hanging: true }
  });

  const out = typo.process('путь «Амбер» тут');
  assert.ok(out.includes('style="margin'), `Got: ${out}`);
});

test('hanging=class emits class only', () => {
  const typo = new MicroTypo({
    html: true,
    render: { hanging: 'class' },
    rules: { hanging: true }
  });

  const out = typo.process('путь «Амбер» тут');
  assert.ok(out.includes('class="oa_'), `Got: ${out}`);
  assert.ok(!out.includes('style="margin'));
});

test('class prefix is prepended', () => {
  const typo = new MicroTypo({
    html: true,
    render: { hanging: 'class' },
    rules: { hanging: true }
  });

  typo.setPrefix('amber_');
  const out = typo.process('путь «Амбер» тут');
  assert.ok(out.includes('class="amber_oa_'), `Got: ${out}`);
});

test('addSafeTag protects custom tag content', () => {
  const typo = new MicroTypo({ render: { paragraphs: false }, rules: { 'hanging.*': false } });
  typo.addSafeTag('mywidget');
  const out = typo.process('<mywidget>"нетронуто" внутри</mywidget> снаружи "Козырь"');
  assert.ok(out.includes('"нетронуто"'), `Inside widget should be untouched: ${out}`);
  assert.ok(out.includes('«Козырь»'), `Outside should typeset: ${out}`);
});

test('addSafeBlock protects a custom delimiter', () => {
  const typo = new MicroTypo({ render: { paragraphs: false }, rules: { 'hanging.*': false } });

  typo.addSafeBlock({
    id: 'shortcode',
    open: '[code]',
    close: '[/code]',
    escape: true
  });

  const out = typo.process('путь [code]"сырое" - тут[/code] ещё "Амбер"');
  assert.ok(out.includes('"сырое" - тут'), `Got: ${out}`);
  assert.ok(out.includes('«Амбер»'), `Got: ${out}`);
});

test('defineRuleGroup returns the definition', () => {
  const def = defineRuleGroup({ title: 'Амбер', rules: [] });
  assert.equal(def.title, 'Амбер');
});

// The object belongs to the caller and stays theirs; registration takes its own snapshot, so the
// engine never reads the live one either way.
test('defineRuleGroup leaves the caller class map writable', () => {
  const classes = { nowrap: 'white-space:nowrap;' };
  const def = defineRuleGroup({ title: 'Дворкин', classes, rules: [] });

  assert.equal(Object.isFrozen(classes), false);
  assert.equal(Object.isFrozen(def), true);

  classes.nowrap = 'white-space:pre;';
  assert.equal(classes.nowrap, 'white-space:pre;');
});

// Appending silently puts the group last, which is a different pipeline and says nothing about it.
test('registerRuleGroup rejects a position it cannot honour', () => {
  const typo = new MicroTypo();
  const def = defineRuleGroup({ title: 'Мерлин', rules: [] });
  const before = typo.listRuleGroups().map((g) => g.name);

  for (const position of ['before:никого', 'after:никого', 'middle', 'befor:quote']) {
    assert.throws(
      () => typo.registerRuleGroup(def, { name: 'Мерлин', position }),
      MicroTypoConfigError,
      position
    );
  }

  assert.deepEqual(
    typo.listRuleGroups().map((g) => g.name),
    before,
    'instance changed anyway'
  );
  assert.equal(typo.getRuleGroup('Мерлин'), undefined);
});

test('registerRuleGroup honours a position it can', () => {
  const typo = new MicroTypo();
  const def = defineRuleGroup({ title: 'Мерлин', rules: [] });

  typo.registerRuleGroup(def, { name: 'Мерлин', position: 'before:quote' });

  const names = typo.listRuleGroups().map((g) => g.name);
  assert.equal(names.indexOf('мерлин'), names.indexOf('quote') - 1);
});

// Silently keeping the previous layout makes a misspelt call look like it was applied.
test('setLayout rejects a layout it does not have', () => {
  const typo = new MicroTypo();

  for (const layout of ['чепуха', undefined, null, 'STYLE']) {
    assert.throws(() => typo.setLayout(layout), MicroTypoConfigError, String(layout));
  }

  for (const layout of ['style', 'class', 'both']) {
    assert.equal(typo.setLayout(layout), typo);
  }
});

test('custom group registers after construction', () => {
  const typo = new MicroTypo();

  typo.registerRuleGroup(
    defineRuleGroup({
      title: 'Upper',
      rules: [{ id: 'shout', pattern: /shout/g, replacement: 'SHOUT' }]
    }),
    { name: 'Upper' }
  );

  const out = typo.process('Corwin shout Amber');
  assert.ok(out.includes('SHOUT'));
});

test('custom group runs before:quote', () => {
  const typo = new MicroTypo({ render: { paragraphs: false }, rules: { 'hanging.*': false } });

  typo.registerRuleGroup(
    defineRuleGroup({
      title: 'Pre',
      rules: [{ id: 'mark', pattern: /MARK/g, replacement: '"Амбер"' }]
    }),
    { name: 'Pre', position: 'before:quote' }
  );

  const out = typo.process('MARK');
  assert.ok(out.includes('«Амбер»'), `pre-group should have run before quote: ${out}`);
});

test('listRuleGroups returns groups in order', () => {
  const typo = new MicroTypo();
  const names = typo.listRuleGroups().map((t) => t.name);

  assert.deepEqual(names, [
    'quote',
    'dash',
    'symbol',
    'punctuation',
    'number',
    'space',
    'abbr',
    'nobr',
    'date',
    'hanging',
    'other',
    'text'
  ]);
});

test('getRuleGroup accepts canonical and mixed case', () => {
  const typo = new MicroTypo();
  assert.ok(typo.getRuleGroup('quote'));
  assert.ok(typo.getRuleGroup('Quote'));
  assert.ok(typo.getRuleGroup('QUOTE'));
});

test('getRuleGroup returns a frozen descriptor', () => {
  const typo = new MicroTypo();
  const g = typo.getRuleGroup('quote');
  assert.equal(g.name, 'quote');
  assert.equal(typeof g.title, 'string');
  assert.equal(g.builtin, true);
  assert.ok(Array.isArray(g.rules));
  assert.ok(g.rules.length > 0);
  assert.ok(
    g.rules.every((r) => typeof r.id === 'string' && typeof r.defaultEnabled === 'boolean')
  );
  assert.ok(Object.isFrozen(g));
  assert.ok(Object.isFrozen(g.rules));
  assert.equal(g.compiledRules, undefined);
  assert.equal(g.enabledOverride, undefined);
  assert.equal(g.settings, undefined);
});

test('mutating a getRuleGroup descriptor does not change output', () => {
  const typo = new MicroTypo();
  const before = typo.process('"x" - y');
  const g = typo.getRuleGroup('quote');

  try {
    g.compiledRules = [];
  } catch {
    /* frozen is fine */
  }

  try {
    g.rules = [];
  } catch {
    /* frozen is fine */
  }

  assert.equal(typo.process('"x" - y'), before);
});

test('mutating a listRuleGroups descriptor does not change output', () => {
  const typo = new MicroTypo();
  const before = typo.process('"x" - y');
  const groups = typo.listRuleGroups();
  assert.ok(Object.isFrozen(groups));

  const quote = groups.find((g) => g.name === 'quote');
  assert.ok(quote, 'quote descriptor must be findable in the returned list');

  try {
    quote.rules[0].defaultEnabled = false;
  } catch {
    /* frozen is fine */
  }

  try {
    quote.builtin = false;
  } catch {
    /* frozen is fine */
  }

  assert.equal(typo.process('"x" - y'), before);
});

test('presets:false yields no rule groups', () => {
  const typo = new MicroTypo({ presets: false });
  assert.equal(typo.listRuleGroups().length, 0);
  assert.equal(typo.process('"Амбер" --- Арден'), '"Амбер" --- Арден');
});

test('mixed quote forms normalise consistently', () => {
  const a = microtypo('«Козырь»', { render: { paragraphs: false } });
  const b = microtypo('"Козырь"', { render: { paragraphs: false } });
  const c = microtypo('«Козырь»', { render: { paragraphs: false } });
  assert.equal(a, b);
  assert.equal(b, c);
});

test('emoji and surrogate pairs survive', () => {
  const out = microtypo('Corwin 🎉 Amber', { render: { paragraphs: false } });
  assert.ok(out.includes('🎉'), `Emoji lost: ${out}`);
});

test('CRLF line endings handled', () => {
  const out = microtypo('Корвин\r\n\r\nЭрик', { html: true });
  assert.ok(out.includes('<p>Корвин</p>'));
  assert.ok(out.includes('<p>Эрик</p>'));
});

test('plain HTML tags pass through unchanged', () => {
  const out = microtypo('<strong>Амбер</strong>', { render: { paragraphs: false } });
  assert.equal(out, '<strong>Амбер</strong>');
});

test('nested HTML content gets typeset', () => {
  const out = microtypo('<strong>"Козырь"</strong>', {
    render: { paragraphs: false }
  });

  assert.ok(out.includes('«Козырь»'), `Got: ${out}`);
});

test('glob then specific overrides apply in order', () => {
  const typo = new MicroTypo({
    rules: {
      'punctuation.*': false,
      'punctuation.ellipsis': true,
      'punctuation.period_at_end': true,
      'text.paragraphs': false
    }
  });

  const out = typo.process('Корвин...');
  assert.equal(out, 'Корвин…');
});

test('prototype-lookalike selectors are rejected', () => {
  // `toString` is a prototype member rather than a real quote rule id: a config error, not a silent
  // no-op.
  assert.throws(
    () => microtypo('Corwin', { rules: { 'quote.toString': 'on' } }),
    MicroTypoConfigError
  );
  assert.throws(
    () => microtypo('Corwin', { rules: { 'hasOwnProperty.x': 'on' } }),
    MicroTypoConfigError
  );
});

test('process() is idempotent on typeset text', () => {
  const once = microtypo('"Корвин" — Эрик');
  const twice = microtypo(once);
  assert.equal(twice, once, `Idempotency broken:\n  once:  ${once}\n  twice: ${twice}`);
});

test('instances stay independent', () => {
  const a = new MicroTypo({ html: true, render: { paragraphs: false } });
  const b = new MicroTypo({ html: true, render: { paragraphs: true } });
  const text = '"Амбер"';
  const oa = a.process(text);
  const ob = b.process(text);
  assert.ok(!oa.startsWith('<p>'));
  assert.ok(ob.startsWith('<p>'));
});

test('nowrap compile cache stays bounded', () => {
  // The cache keys on the structural open and close shape rather than on the id-bearing sample, or
  // it grows one entry per distinct id.
  const typo = new MicroTypo({ html: true });
  let callCount = 0;

  typo.registerRuleGroup(
    {
      title: 'Shift',
      rules: [
        {
          id: 'shift',
          handler: (ctx) => {
            const extra = callCount % 20;

            for (let k = 0; k < extra; k++) {
              ctx.tag(`x${k}`, 'span', { style: `--s:${k}` });
            }

            callCount++;
          }
        }
      ]
    },
    { name: 'Shift', position: 'before:other' }
  );

  for (let i = 0; i < 500; i++) {
    typo.process('<span class="nowrap">1 2</span>');
  }

  assert.ok(compileCacheSize() <= 8, `cache grew to ${compileCacheSize()}`);
});

const baseCfg = { html: false, entities: false };

test("input:{format:'markdown'} matches input:'markdown'", () => {
  const input = 'Корвин\n```\nlet x = a -- b\n```\nЭрик';

  const viaObject = new MicroTypo({ ...baseCfg, input: { format: 'markdown' } }).process(input);
  const viaString = new MicroTypo({ ...baseCfg, input: 'markdown' }).process(input);

  assert.match(viaObject, /a -- b/);
  assert.equal(viaObject, viaString);
});

test("input:'markdown' shorthand works", () => {
  const typo = new MicroTypo({ ...baseCfg, input: 'markdown' });
  const out = typo.process('Мерлин задал `--no-verify` флаг');
  assert.match(out, /`--no-verify`/);
});

test('input:{format:"json"} typesets string values', () => {
  const out = new MicroTypo({ ...baseCfg, input: { format: 'json' } }).process(
    '{"title":"Корвин - Эрик"}'
  );

  assert.equal(JSON.parse(out).title, 'Корвин\u{00A0}— Эрик');
});

test('input:{format:"yaml"} typesets quoted values', () => {
  const out = new MicroTypo({ ...baseCfg, input: { format: 'yaml' } }).process(
    'title: "Корвин - Эрик"'
  );

  assert.equal(out, 'title: "Корвин\u{00A0}— Эрик"');
});

test('input:{format:"frontmatter"} typesets header and body', () => {
  const out = new MicroTypo({ ...baseCfg, input: { format: 'frontmatter' } }).process(
    '---\ntitle: "Корвин - Эрик"\n---\nАмбер - Тень'
  );

  assert.equal(out, '---\ntitle: "Корвин\u{00A0}— Эрик"\n---\nАмбер\u{00A0}— Тень');
});

test('input:{template:"liquid"} is accepted', () => {
  assert.doesNotThrow(() => new MicroTypo({ ...baseCfg, input: { template: 'liquid' } }));
});

test('input:{fields} is accepted', () => {
  assert.doesNotThrow(() => new MicroTypo({ ...baseCfg, input: { fields: ['a.b'] } }));
});

test('a bad input.template value throws', () => {
  assert.throws(() => new MicroTypo({ ...baseCfg, input: { template: 'jsp' } }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

describe('safe blocks and tags', () => {
  const opts = { html: true, render: { paragraphs: false } };

  test('addSafeBlock: unsafeRegex=true treats open/close as regex', () => {
    const typo = new MicroTypo(opts);

    typo.addSafeBlock({
      id: 're',
      open: '\\[skip\\d+\\]',
      close: '\\[/skip\\d+\\]',
      unsafeRegex: true
    });

    const out = typo.process('Корвин [skip1]"сырое"[/skip1] Эрик');
    assert.ok(out.includes('[skip1]"сырое"[/skip1]'), `Got: ${out}`);
  });

  // toNonCapturing reads the caller's source without parsing it, so a truncated construct reaches
  // `new RegExp` verbatim. Config errors leave through the typed hierarchy, never as a bare
  // SyntaxError from a constructor the caller never called.
  test('addSafeBlock: a delimiter that will not compile is a config error', () => {
    const typo = new MicroTypo(opts);

    assert.throws(
      () => typo.addSafeBlock({ id: 'broken', open: '(?<', close: ']]', unsafeRegex: true }),
      (error) =>
        error instanceof MicroTypoConfigError &&
        error.code === 'ERR_MICROTYPO_CONFIG' &&
        error.cause instanceof SyntaxError
    );
  });

  test('addSafeBlock: default escapes regex meta', () => {
    const typo = new MicroTypo(opts);
    typo.addSafeBlock({ id: 'lit', open: '[skip]', close: '[/skip]' });
    const out = typo.process('Корвин [skip]"сырое"[/skip] Эрик');
    assert.ok(out.includes('[skip]"сырое"[/skip]'), `Got: ${out}`);
  });

  test('addSafeBlock literal delimiters pass through verbatim', () => {
    const typo = new MicroTypo({ presets: false });
    typo.addSafeBlock({ id: 'lit', open: '[skip]', close: '[/skip]' });
    assert.equal(
      typo.process('Корвин [skip]"сырое"[/skip] Эрик'),
      'Корвин [skip]"сырое"[/skip] Эрик'
    );
  });

  test('addSafeTag: invalid tag does not brick instance', () => {
    const typo = new MicroTypo();
    assert.throws(() => typo.addSafeTag('Corwin of Amber'), TypeError);
    assert.doesNotThrow(() => typo.process('Корвин'));
    assert.doesNotThrow(() => typo.process('Эрик'));
  });

  test('addSafeTag: rejected tags preserve clean state', () => {
    const typo = new MicroTypo();

    for (let i = 0; i < 10; i++) {
      try {
        typo.addSafeTag(`amber${i} tag`);
      } catch {}
    }

    assert.doesNotThrow(() => typo.process('путь «Амбер»'));
  });

  test('addSafeTag rejects regex-meta tag names', () => {
    const typo = new MicroTypo();
    assert.throws(() => typo.addSafeTag('амбер.*'), TypeError);
    assert.throws(() => typo.addSafeTag(''), TypeError);
    assert.throws(() => typo.addSafeTag('a href=amber:corwin'), TypeError);
    assert.throws(() => typo.addSafeTag(123), TypeError);
  });

  test('addSafeTag accepts valid tag name', () => {
    const typo = new MicroTypo();
    assert.doesNotThrow(() => typo.addSafeTag('trump-card'));
  });
});
