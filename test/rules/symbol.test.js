import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };

describe('symbol glyphs fire', () => {
  test('(c) becomes ©', () => {
    assert.ok(microtypo('(c) 2024 Амбер', NOP).includes('©'));
  });

  test('(r) becomes ®', () => {
    assert.ok(microtypo('Грейсвандир(r) наш', NOP).includes('®'));
  });

  test('(tm) becomes ™', () => {
    assert.ok(microtypo('Козырь(tm) тут', NOP).includes('™'));
  });

  test('<- becomes a left arrow', () => {
    assert.ok(microtypo('Тень <- Амбер', NOP).includes('←'));
  });
});

describe('symbol.copyright — glued to a following letter or digit (REAL-2)', () => {
  test('converts (c) glued to a following letter or digit', () => {
    assert.equal(microtypo('(c)Амбер', NOP), '©Амбер');
    assert.equal(microtypo('(с)Оберон', NOP), '©Оберон'); // Cyrillic с
    assert.equal(microtypo('(c)9', NOP), '©9'); // glued to a digit
  });
});

describe('symbol.copyright — protected block spacing (EF1)', () => {
  test('keeps regular spaces around a protected block', () => {
    assert.equal(
      microtypo('Козырь (c) <pre>(c)</pre> (c) (c)', NOP),
      'Козырь © <pre>(c)</pre> © ©'
    );
  });
});

describe('copyright toggle', () => {
  test('default converts (c) to ©', () => {
    assert.ok(microtypo('(c) 2026', NOP).includes('©'));
  });

  test('off leaves (c) untouched', () => {
    const out = microtypo('(c) 2026', { ...NOP, rules: { 'symbol.copyright': false } });
    assert.ok(out.includes('(c)'));
  });
});

describe('symbol.trademark — leading space preserved (G5)', () => {
  test('(tm) keeps the space before it', () => {
    assert.equal(microtypo('Амбер (tm) тут'), 'Амбер ™ тут');
  });

  test('(r) and (tm) in series each keep their space', () => {
    assert.equal(microtypo('Козырь (r) и (tm)'), 'Козырь ® и ™');
  });
});

describe('trademark toggle', () => {
  test('default converts (tm) to ™', () => {
    assert.ok(microtypo('Grayswandir(tm) ready', NOP).includes('™'));
  });

  test('off leaves (tm) untouched', () => {
    const out = microtypo('Grayswandir(tm) ready', {
      ...NOP,
      rules: { 'symbol.trademark': false }
    });
    assert.ok(out.includes('(tm)'));
    assert.ok(!out.includes('™'));
  });
});

describe('registered toggle', () => {
  test('default converts (r) to ®', () => {
    assert.ok(microtypo('Козырь(r) готов', NOP).includes('®'));
  });

  test('off leaves (r) untouched', () => {
    const out = microtypo('Козырь(r) готов', { ...NOP, rules: { 'symbol.registered': false } });
    assert.ok(out.includes('(r)'));
    assert.ok(!out.includes('®'));
  });
});

describe('arrows toggle', () => {
  test('default converts -> to →', () => {
    assert.ok(microtypo('Амбер -> Тень', NOP).includes('→'));
  });

  test('off leaves -> untouched', () => {
    const out = microtypo('Амбер -> Тень', { ...NOP, rules: { 'symbol.arrows': false } });
    assert.ok(out.includes('->'));
    assert.ok(!out.includes('→'));
  });
});

describe('apostrophe toggle', () => {
  test('default converts straight apostrophe to ’', () => {
    assert.ok(microtypo("Corwin's crown", NOP).includes('’'));
  });

  test('off leaves straight apostrophe untouched', () => {
    const out = microtypo("Corwin's crown", { ...NOP, rules: { 'symbol.apostrophe': false } });
    assert.ok(out.includes("'"));
    assert.ok(!out.includes('’'));
  });
});

describe('symbol.apostrophe — double apostrophe (GAP-A2)', () => {
  test("O''Really becomes O\u{2019}Really", () => {
    assert.equal(microtypo("O''Really", NOP), `O\u{2019}Really`);
  });

  test('single apostrophe still converts', () => {
    assert.equal(microtypo("O'Really", NOP), `O\u{2019}Really`);
  });
});

describe('symbol.registered — adjacency (XTEST-META)', () => {
  test('converts both marks in an adjacent pair', () => {
    const out = microtypo('Печати (r)(r) на Козырях', NOP);
    assert.ok(!out.includes('(r)'), `residual mark: ${out}`);
    assert.equal(out.match(/®/g)?.length, 2, `both marks: ${out}`);
  });
});

describe('symbol.arrows — <-- half-mangle guard (XTEST-2)', () => {
  test('arrows: <-- is not half-converted to ←-', () => {
    assert.ok(!microtypo('Корвин <-- Эрик', NOP).includes('←'), 'must not arrow-ify <--');
    assert.ok(microtypo('Корвин <- Эрик', NOP).includes('←'), 'real <- still converts');
  });
});

describe('fahrenheit toggle', () => {
  test('default converts 100F to 100 °F', () => {
    assert.ok(microtypo('100F в Тени', NOP).includes('°'));
  });

  test('off leaves 100F untouched', () => {
    const out = microtypo('100F в Тени', { ...NOP, rules: { 'symbol.fahrenheit': false } });
    assert.ok(out.includes('100F'));
    assert.ok(!out.includes('°'));
  });
});
