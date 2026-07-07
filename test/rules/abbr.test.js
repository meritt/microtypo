import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NBSP = '\u{00A0}';

// Strip <p> wrapping so assertions check each rule's own effect.
const NOP = { html: true, render: { paragraphs: false } };

describe('abbr.nbsp_organization', () => {
  test('binds ООО to name with nbsp', () => {
    assert.ok(microtypo('ООО Грейсвандир', NOP).includes(`ООО${NBSP}Грейсвандир`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('ООО Грейсвандир', {
      ...NOP,
      rules: { 'abbr.nbsp_organization': false }
    });
    assert.ok(out.includes('ООО Грейсвандир'));
    assert.ok(!out.includes(`ООО${NBSP}Грейсвандир`));
  });
});

describe('abbr.nbsp_location', () => {
  test('binds г. to place with nbsp', () => {
    assert.ok(microtypo('дорога в г. Амбер', NOP).includes(`г.${NBSP}Амбер`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('дорога в г. Амбер', { ...NOP, rules: { 'abbr.nbsp_location': false } });
    assert.ok(out.includes('г. Амбер'));
    assert.ok(!out.includes(`г.${NBSP}Амбер`));
  });
});

describe('abbr.nowrap_ie', () => {
  test('wraps т.е. as nowrap т. е.', () => {
    const out = microtypo('т.е. в Тень', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">'));
    assert.ok(out.includes('т. е.'));
  });

  test('leaves т.е. untouched when off', () => {
    const out = microtypo('т.е. в Тень', { ...NOP, rules: { 'abbr.nowrap_ie': false } });
    assert.ok(out.includes('т.е.'));
    assert.ok(!out.includes('white-space:nowrap'));
  });
});

describe('abbr.nowrap_gost', () => {
  test('wraps ГОСТ + number as nowrap', () => {
    const out = microtypo('Клинок ГОСТ 8.417 выкован', NOP);
    assert.ok(out.includes('<span style="white-space:nowrap;">ГОСТ 8.417'));
  });

  test('leaves ГОСТ unwrapped when off', () => {
    const out = microtypo('Клинок ГОСТ 8.417 выкован', {
      ...NOP,
      rules: { 'abbr.nowrap_gost': false }
    });
    assert.ok(out.includes('ГОСТ 8.417'));
    assert.ok(!out.includes('white-space:nowrap'));
  });
});

describe('abbr.nbsp_dpi', () => {
  test('binds number to dpi with nbsp', () => {
    assert.ok(microtypo('Козырь 300 dpi чёткий', NOP).includes(`300${NBSP}dpi`));
  });

  test('leaves plain space when off', () => {
    const out = microtypo('Козырь 300 dpi чёткий', { ...NOP, rules: { 'abbr.nbsp_dpi': false } });
    assert.ok(out.includes('300 dpi'));
    assert.ok(!out.includes(`300${NBSP}dpi`));
  });
});

describe('abbr.nbsp_dpi — spaced form (NBSP-1)', () => {
  test('300 dpi binds with nbsp', () => {
    assert.ok(microtypo('300 dpi', NOP).includes(`300${NBSP}dpi`));
  });

  test('300dpi (glued) binds with nbsp', () => {
    assert.ok(microtypo('300dpi', NOP).includes(`300${NBSP}dpi`));
  });
});

describe('abbr.nbsp_unit — number binds to unit, unit stays breakable from noun (NBSP-2)', () => {
  test('unit binds to number only, not to the following noun', () => {
    const out = microtypo('5 кг серебра', NOP);
    assert.match(out, new RegExp(`5${NBSP}кг`), `number↔unit NBSP missing: ${out}`);
    assert.match(out, /кг серебра/, `unit↔noun must be a plain space: ${out}`);
  });

  test('unit followed by punctuation keeps only the number binding', () => {
    assert.ok(microtypo('всего 5 кг.', NOP).includes(`5${NBSP}кг.`));
  });
});

describe('abbr.nbsp_unit — serial units (XTEST-META)', () => {
  test('binds both parts of a compound weight', () => {
    const out = microtypo('Слиток из Амбера весит 5 кг 300 г', NOP);
    assert.ok(out.includes(`5${NBSP}кг`), `first unbound: ${out}`);
    assert.ok(out.includes(`300${NBSP}г`), `second unbound: ${out}`);
  });

  test('binds both parts of a compound length', () => {
    const out = microtypo('Коридор Амбера шириной 2 м 40 см', NOP);
    assert.ok(out.includes(`2${NBSP}м`), `first unbound: ${out}`);
    assert.ok(out.includes(`40${NBSP}см`), `second unbound: ${out}`);
  });
});

describe('abbr.nbsp_unit — binds unit after a dash-separated range (R5)', () => {
  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo('Тропа через Тени растянулась на 15000—20000 м');
    assert.ok(out.includes(`20\u{202F}000${NBSP}м`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo('Тропа через Тени растянулась на 15000—20000 м');
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_weight_unit — binds unit after a dash-separated range (R5 sibling)', () => {
  const text = 'Слиток из сердца Хаоса весит 15000—20000 кг.';

  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo(text);
    assert.ok(out.includes(`20\u{202F}000${NBSP}кг`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo(text);
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_data_unit — binds unit after a dash-separated range (R5 sibling)', () => {
  const text = 'Архив Дворкина хранит 15000—20000 ГБ хроник Отражений.';

  test('binds unit to a number even when the space appears only after triad split', () => {
    const out = microtypo(text);
    assert.ok(out.includes(`20\u{202F}000${NBSP}ГБ`), `unit unbound on first pass: ${out}`);
  });

  test('stays stable when processed a second time (idempotent)', () => {
    const once = microtypo(text);
    const twice = microtypo(once);
    assert.equal(twice, once);
  });
});

describe('abbr.nbsp_fraction_unit — fraction glyph binds to unit (number.fraction runs first)', () => {
  test('3/4 кг binds the fraction glyph to the unit with nbsp', () => {
    const out = microtypo('3/4 кг золота Амбера', NOP);
    assert.ok(out.includes(`¾${NBSP}кг`), `fraction↔unit NBSP missing: ${out}`);
  });

  test('¾ мгновение is not mistaken for the мг unit (word boundary guard)', () => {
    const out = microtypo('¾ мгновение спустя Корвин пересёк Тень', NOP);
    assert.ok(out.includes('¾ мгновение'), `guard failed, unit false-matched: ${out}`);
    assert.ok(!out.includes(`¾${NBSP}мг`), `unit incorrectly bound inside word: ${out}`);
  });
});
