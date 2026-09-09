import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canonicalGroupName, isOff, isOn, normaliseOptions } from '../../src/core/options.js';
import { MicroTypoConfigError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NNBSP = '\u{202F}';

// Strip paragraph wrapping so each assertion isolates its rule.
const NOP = { html: true, render: { paragraphs: false } };

function findOverrides(intent, group, selector) {
  return intent.overrides.filter((o) => o.group === group && o.selector === selector);
}

describe('empty / null input', () => {
  test('null input → empty intent', () => {
    const out = normaliseOptions(null);
    assert.deepEqual(out.engineSettings, {});
    assert.deepEqual(out.overrides, []);
    assert.deepEqual(out.settings, []);
  });

  test('undefined input → empty intent', () => {
    const out = normaliseOptions(undefined);
    assert.deepEqual(out, { engineSettings: {}, overrides: [], settings: [] });
  });

  test('empty object → empty intent', () => {
    const out = normaliseOptions({});
    assert.deepEqual(out, { engineSettings: {}, overrides: [], settings: [] });
  });

  test('non-object input → empty intent', () => {
    assert.deepEqual(normaliseOptions(42), {
      engineSettings: {},
      overrides: [],
      settings: []
    });

    assert.deepEqual(normaliseOptions('string'), {
      engineSettings: {},
      overrides: [],
      settings: []
    });

    assert.deepEqual(normaliseOptions(true), {
      engineSettings: {},
      overrides: [],
      settings: []
    });
  });
});

describe('engine-level keys', () => {
  test('engine: entities passed through', () => {
    const out = normaliseOptions({ entities: true });
    assert.equal(out.engineSettings.entities, true);
  });

  test('engine: maxInputLength passed through', () => {
    const out = normaliseOptions({ maxInputLength: 50_000 });
    assert.equal(out.engineSettings.maxInputLength, 50_000);
  });

  test('engine: maxProcessingMs passed through', () => {
    const out = normaliseOptions({ maxProcessingMs: 500 });
    assert.equal(out.engineSettings.maxProcessingMs, 500);
  });

  test('engine: presets:false does not appear in intent', () => {
    const out = normaliseOptions({ presets: false });
    assert.equal(out.engineSettings.presets, undefined);
  });

  test('boolean html:false routes to the engine axis, not a rule override', () => {
    const out = normaliseOptions({ html: false });

    assert.equal(out.engineSettings.html, false);
    assert.deepEqual(findOverrides(out, 'text', '*'), []);
  });
});

describe('rules: group alias (bare key toggles the whole group)', () => {
  test('rules: quote:false disables every quote rule', () => {
    const out = normaliseOptions({ rules: { quote: false } });

    assert.deepEqual(findOverrides(out, 'quote', '*'), [
      { group: 'quote', selector: '*', value: false }
    ]);
  });

  test('rules: dash:false disables every dash rule', () => {
    const out = normaliseOptions({ rules: { dash: false } });

    assert.deepEqual(findOverrides(out, 'dash', '*'), [
      { group: 'dash', selector: '*', value: false }
    ]);
  });

  test('rules: mixed-case group alias lowercased', () => {
    const out = normaliseOptions({ rules: { Quote: false } });
    assert.deepEqual(findOverrides(out, 'quote', '*'), [
      { group: 'quote', selector: '*', value: false }
    ]);
  });

  test('rules: unknown bare key yields no override', () => {
    const out = normaliseOptions({ rules: { bogus: false } });
    assert.deepEqual(out.overrides, []);
  });
});

describe('rules: semantic bundles', () => {
  test('nbsp bundle expands to nobr/space/abbr/number nbsp_* wildcards', () => {
    const out = normaliseOptions({ rules: { nbsp: false } });

    assert.deepEqual(out.overrides, [
      { group: 'nobr', selector: 'nbsp_*', value: false },
      { group: 'space', selector: 'nbsp_*', value: false },
      { group: 'abbr', selector: 'nbsp_*', value: false },
      { group: 'number', selector: 'nbsp_*', value: false }
    ]);
  });

  test('emdash bundle expands to exactly dash.em + dash.em_*, never dash.em*', () => {
    const out = normaliseOptions({ rules: { emdash: false } });

    assert.deepEqual(out.overrides, [
      { group: 'dash', selector: 'em', value: false },
      { group: 'dash', selector: 'em_*', value: false }
    ]);
  });

  test('endash bundle expands to dash.en_range + number.en_range', () => {
    const out = normaliseOptions({ rules: { endash: false } });

    assert.deepEqual(out.overrides, [
      { group: 'dash', selector: 'en_range', value: false },
      { group: 'number', selector: 'en_range', value: false }
    ]);
  });

  test('triads bundle expands to number.thin_space_triads + other.split_triads', () => {
    const out = normaliseOptions({ rules: { triads: false } });

    assert.deepEqual(out.overrides, [
      { group: 'number', selector: 'thin_space_triads', value: false },
      { group: 'other', selector: 'split_triads', value: false }
    ]);
  });

  test('units bundle expands to every abbr unit rule', () => {
    const out = normaliseOptions({ rules: { units: false } });

    assert.deepEqual(
      out.overrides.map((o) => o.selector),
      [
        'nbsp_unit',
        'nbsp_weight_unit',
        'nbsp_volume_unit',
        'nbsp_time_unit',
        'nbsp_data_unit',
        'nbsp_frequency_unit',
        'nbsp_css_unit',
        'nbsp_volt'
      ]
    );
    assert.ok(out.overrides.every((o) => o.group === 'abbr' && o.value === false));
  });

  test('currency bundle expands to abbr.currency + nbsp_money_magnitude + nbsp_currency_prefix', () => {
    const out = normaliseOptions({ rules: { currency: true } });

    assert.deepEqual(out.overrides, [
      { group: 'abbr', selector: 'currency', value: true },
      { group: 'abbr', selector: 'nbsp_money_magnitude', value: true },
      { group: 'abbr', selector: 'nbsp_currency_prefix', value: true }
    ]);
  });
});

describe('rules: precise group.selector / wildcard', () => {
  test('rules:{}: direct rule toggle', () => {
    const out = normaliseOptions({ rules: { 'quote.open': false } });

    assert.deepEqual(findOverrides(out, 'quote', 'open'), [
      { group: 'quote', selector: 'open', value: false }
    ]);
  });

  test('rules:{}: wildcard selector', () => {
    const out = normaliseOptions({ rules: { 'punctuation.*': false } });

    assert.deepEqual(findOverrides(out, 'punctuation', '*'), [
      { group: 'punctuation', selector: '*', value: false }
    ]);
  });

  test('rules:{}: order is insertion-preserved (wildcard first, override last)', () => {
    const out = normaliseOptions({
      rules: {
        'punctuation.*': false,
        'punctuation.ellipsis': true
      }
    });

    assert.deepEqual(out.overrides, [
      { group: 'punctuation', selector: '*', value: false },
      { group: 'punctuation', selector: 'ellipsis', value: true }
    ]);
  });

  test('rules:{}: mixed-case group name lowercased', () => {
    const out = normaliseOptions({ rules: { 'Quote.open': false } });
    assert.equal(out.overrides[0].group, 'quote');
  });

  test('rules:{}: on/off strings normalised to bool', () => {
    const out = normaliseOptions({ rules: { 'punctuation.comma_before_conjunction': 'on' } });
    assert.equal(out.overrides[0].value, true);
  });

  test('rules: hanging.quote / hanging.bracket enable via precise selector', () => {
    const out = normaliseOptions({
      rules: { 'hanging.quote': true, 'hanging.bracket': true }
    });

    assert.deepEqual(findOverrides(out, 'hanging', 'quote'), [
      { group: 'hanging', selector: 'quote', value: true }
    ]);
    assert.deepEqual(findOverrides(out, 'hanging', 'bracket'), [
      { group: 'hanging', selector: 'bracket', value: true }
    ]);
  });
});

describe('render tier', () => {
  test('render: non-object input is a no-op', () => {
    assert.deepEqual(normaliseOptions({ render: false }), {
      engineSettings: {},
      overrides: [],
      settings: []
    });
  });

  test('render.paragraphs:false disables only paragraphs', () => {
    const out = normaliseOptions({ render: { paragraphs: false } });

    assert.deepEqual(findOverrides(out, 'text', 'paragraphs'), [
      { group: 'text', selector: 'paragraphs', value: false }
    ]);
    assert.equal(findOverrides(out, 'text', '*').length, 0);
  });

  test('render.paragraphs:true forces paragraphs on', () => {
    const out = normaliseOptions({ render: { paragraphs: true } });

    assert.deepEqual(findOverrides(out, 'text', 'paragraphs'), [
      { group: 'text', selector: 'paragraphs', value: true }
    ]);
  });

  test('render.autolink:false disables both autolink and email', () => {
    const out = normaliseOptions({ render: { autolink: false } });

    assert.deepEqual(findOverrides(out, 'text', 'autolink'), [
      { group: 'text', selector: 'autolink', value: false }
    ]);
    assert.deepEqual(findOverrides(out, 'text', 'email'), [
      { group: 'text', selector: 'email', value: false }
    ]);
  });

  test('render.autolink:true forces both autolink and email on', () => {
    const out = normaliseOptions({ render: { autolink: true } });

    assert.equal(findOverrides(out, 'text', 'autolink')[0].value, true);
    assert.equal(findOverrides(out, 'text', 'email')[0].value, true);
  });

  test('render.breakline:false disables breakline', () => {
    const out = normaliseOptions({ render: { breakline: false } });

    assert.deepEqual(findOverrides(out, 'text', 'breakline'), [
      { group: 'text', selector: 'breakline', value: false }
    ]);
  });

  test('render.hanging sets engine layout only — does not enable hanging rules', () => {
    const out = normaliseOptions({ render: { hanging: 'class' } });

    assert.equal(out.engineSettings.layout, 'class');
    assert.equal(findOverrides(out, 'hanging', 'quote').length, 0);
    assert.equal(findOverrides(out, 'hanging', 'bracket').length, 0);

    assert.equal(normaliseOptions({ render: { hanging: 'both' } }).engineSettings.layout, 'both');
  });

  test("render.nowrap:'span' sets engineSettings.nowrap to 'span'", () => {
    assert.equal(normaliseOptions({ render: { nowrap: 'span' } }).engineSettings.nowrap, 'span');
  });

  test("render.nowrap:'nobr' sets engineSettings.nowrap to 'nobr'", () => {
    assert.equal(normaliseOptions({ render: { nowrap: 'nobr' } }).engineSettings.nowrap, 'nobr');
  });

  test('render.prefix passes the string through to engineSettings.prefix', () => {
    assert.equal(
      normaliseOptions({ render: { prefix: 'amber_' } }).engineSettings.prefix,
      'amber_'
    );
  });

  test('render.prefix:false passes through unchanged (engine setPrefix handles it)', () => {
    assert.equal(normaliseOptions({ render: { prefix: false } }).engineSettings.prefix, false);
  });
});

test('mixed: rules + render + engine all coexist', () => {
  const out = normaliseOptions({
    entities: true,
    rules: { 'punctuation.comma_before_conjunction': true, quote: false },
    render: { paragraphs: false }
  });

  assert.equal(out.engineSettings.entities, true);
  assert.equal(findOverrides(out, 'punctuation', 'comma_before_conjunction').length, 1);
  assert.equal(findOverrides(out, 'quote', '*').length, 1);
  assert.equal(findOverrides(out, 'text', 'paragraphs').length, 1);
});

describe('canonicalGroupName helper', () => {
  test('canonicalGroupName: lowercases any spelling, alias table is gone', () => {
    assert.equal(canonicalGroupName('quote'), 'quote');
    assert.equal(canonicalGroupName('Quote'), 'quote');
    assert.equal(canonicalGroupName('QUOTE'), 'quote');
    assert.equal(canonicalGroupName('punctuation'), 'punctuation');
    assert.equal(canonicalGroupName('hanging'), 'hanging');
  });

  test('canonicalGroupName: empty/falsy returns input', () => {
    assert.equal(canonicalGroupName(''), '');
    assert.equal(canonicalGroupName(null), null);
    assert.equal(canonicalGroupName(undefined), undefined);
  });
});

describe('isOn / isOff', () => {
  test('isOn: truthy variants', () => {
    for (const v of [true, 1, 'on', 'On', '1', 'true', 'TRUE']) {
      assert.equal(isOn(v), true, `isOn(${JSON.stringify(v)})`);
    }
  });

  test('isOn: falsy variants', () => {
    for (const v of [false, 0, 'off', '0', 'false', '', null, undefined, 2, 'maybe']) {
      assert.equal(isOn(v), false, `isOn(${JSON.stringify(v)})`);
    }
  });

  test('isOff: falsy variants', () => {
    for (const v of [false, 0, 'off', '0', 'false', '', null, undefined]) {
      assert.equal(isOff(v), true, `isOff(${JSON.stringify(v)})`);
    }
  });

  test('isOff: truthy variants', () => {
    for (const v of [true, 1, 'on', '1', 'true', 'maybe', 42]) {
      assert.equal(isOff(v), false, `isOff(${JSON.stringify(v)})`);
    }
  });
});

describe('bundle aliases (end-to-end)', () => {
  test('units bundle:false leaves plain space', () => {
    const out = microtypo('Грейсвандир весит 5 кг', { ...NOP, rules: { units: false } });
    assert.ok(out.includes('5 кг'));
    assert.ok(!out.includes(`5${NBSP}кг`));
  });

  test('currency bundle:false leaves руб untouched', () => {
    const out = microtypo('Рэндом заплатил 5 руб', { ...NOP, rules: { currency: false } });
    assert.ok(out.includes('руб'));
    assert.ok(!out.includes('₽'));
  });

  test('endash bundle:false leaves glued hyphen range untouched', () => {
    const out = microtypo('отряд 100-500 всадников', { ...NOP, rules: { endash: false } });
    assert.ok(out.includes('100-500'));
    assert.ok(!out.includes('100–500'));
  });

  test('endash bundle:false leaves spaced range without en-dash', () => {
    const out = microtypo('отряд 12 - 19 всадников', { ...NOP, rules: { endash: false } });
    assert.ok(!out.includes('12–19'));
  });

  test('nbsp bundle:false leaves plain spaces', () => {
    const out = microtypo('я в Амбере', { ...NOP, rules: { nbsp: false } });
    assert.ok(out.includes('я в Амбере'));
  });

  test('triads bundle:false leaves plain space between triads', () => {
    const out = microtypo('в Амбере 12 345 воинов', { ...NOP, rules: { triads: false } });
    assert.ok(out.includes('12 345'));
    assert.ok(!out.includes(`12${NNBSP}345`));
  });

  test('emdash bundle:false skips spaced hyphen but keeps particle and preposition', () => {
    const out = microtypo('Корвин - король. дай ка из за Колвира.', {
      ...NOP,
      rules: { emdash: false }
    });

    assert.ok(!out.includes('—'), `em-dash should not fire: ${out}`);
    assert.ok(out.includes('дай-ка'), `emphatic_particle should still fire: ${out}`);
    assert.ok(out.includes('из-за'), `compound_preposition should still fire: ${out}`);
  });
});

describe('render plumbing (end-to-end)', () => {
  test('render.breakline default converts newline to <br>', () => {
    assert.ok(microtypo('Корвин\nЭрик', NOP).includes('<br'));
  });
  test('render.breakline:false leaves newline unconverted', () => {
    const out = microtypo('Корвин\nЭрик', { ...NOP, render: { breakline: false } });
    assert.ok(!out.includes('<br'));
  });

  test('render.autolink default wraps bare URL in <a href>', () => {
    const out = microtypo('Корвин зашёл на http://example.com сегодня', NOP);
    assert.ok(out.includes('href="http://example.com"'));
  });
  test('render.autolink:false leaves URL as plain text', () => {
    const out = microtypo('Корвин зашёл на http://example.com сегодня', {
      ...NOP,
      render: { autolink: false }
    });
    assert.ok(out.includes('http://example.com'));
    assert.ok(!out.includes('<a '));
  });

  test('render.nowrap default emits <span>, not <nobr>', () => {
    const out = microtypo('т.е. далее', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">'));
    assert.ok(!out.includes('<nobr>'));
  });
  test('render.nowrap:"nobr" opts into the legacy <nobr> element', () => {
    const out = microtypo('т.е. далее', { ...NOP, render: { nowrap: 'nobr' } });
    assert.ok(out.includes('<nobr>'));
    assert.ok(!out.includes('white-space:nowrap'));
  });
});

// The format is a constructor-only decision, so the default lives there and never reaches the intent
// layer, where it would let `applyOptions({ input })` flip an engine that stays what it was built as.
const wrapped = (config) =>
  new MicroTypo({ html: true, ...config }).process('Корвин - принц\n\nРэндом - брат');

describe('block rendering is off for Markdown source', () => {
  test('markdown and frontmatter emit no <p> or <br>', () => {
    for (const format of ['markdown', 'frontmatter']) {
      const out = wrapped({ input: format });

      assert.ok(!out.includes('<p>'), `${format}: ${out}`);
      assert.ok(!out.includes('<br>'), `${format}: ${out}`);
    }
  });

  test('text and html still wrap', () => {
    for (const format of ['text', 'html']) {
      assert.ok(wrapped({ input: format }).includes('<p>'), format);
    }
  });

  test('an explicit render or rules entry turns it back on', () => {
    assert.ok(wrapped({ input: 'markdown', render: { paragraphs: true } }).includes('<p>'));
    assert.ok(wrapped({ input: 'markdown', rules: { 'text.paragraphs': true } }).includes('<p>'));
  });

  test('normaliseOptions stays free of format defaults', () => {
    assert.deepEqual(normaliseOptions({ input: { format: 'markdown' } }).overrides, []);
  });

  // The format is settled when the instance is built, and a field that cannot take effect is refused
  // rather than dropped: accepted and ignored, it would leave JSON read as prose.
  test('applyOptions refuses a format the instance cannot take', () => {
    const typo = new MicroTypo({ html: true });
    const before = typo.process('Корвин - принц');

    assert.throws(() => typo.applyOptions({ input: { format: 'markdown' } }), MicroTypoConfigError);
    assert.throws(() => typo.applyOptions({ input: 'json' }), MicroTypoConfigError);
    assert.throws(() => typo.applyOptions({ presets: false }), MicroTypoConfigError);
    assert.equal(typo.process('Корвин - принц'), before);
    assert.ok(before.includes('<p>'), before);
  });

  // An absent `input` is filled in by validation as `text`, so comparing that against the real format
  // reads every partial update as a request to become a plain-text engine.
  test('applyOptions accepts an update that names no input at all', () => {
    const typo = new MicroTypo({ input: { format: 'json', exclude: ['slug'] } });

    typo.applyOptions({ entities: false });
    typo.applyOptions({});

    assert.equal(
      typo.process('{"title":"Корвин - принц","slug":"korvin - amber"}'),
      `{"title":"Корвин${NBSP}— принц","slug":"korvin - amber"}`
    );
  });

  test('applyOptions accepts the input the instance already has', () => {
    const typo = new MicroTypo({ input: { format: 'json', exclude: ['slug'] } });

    typo.applyOptions({ input: { format: 'json', exclude: ['slug'] }, html: true });

    assert.equal(
      typo.process('{"title":"Корвин - принц","slug":"korvin - amber"}'),
      `{"title":"Корвин${NBSP}— принц","slug":"korvin - amber"}`
    );
  });
});

describe('presets on/off', () => {
  // © is its own canonical form: with every rule off the entity still decodes to the glyph rather
  // than to the `(c)` shorthand, which no rule would then be there to undo.
  test('presets off decodes &copy; to the glyph itself', () => {
    assert.equal(microtypo('&copy; Амбер', { ...NOP, presets: false }), '© Амбер');
  });

  test('presets on binds the glyph to the word after it', () => {
    assert.equal(microtypo('&copy; Амбер', NOP), `©${NBSP}Амбер`);
  });

  // All three spellings of the same character must land in the same place.
  test('glyph, shorthand and entity agree', () => {
    const expected = `Право ©${NBSP}Дворкина`;

    assert.equal(microtypo('Право © Дворкина', NOP), expected);
    assert.equal(microtypo('Право (c) Дворкина', NOP), expected);
    assert.equal(microtypo('Право &copy; Дворкина', NOP), expected);
  });
});
