import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const NOP = { html: true, render: { paragraphs: false } };
const P = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

function entity(text) {
  return new MicroTypo({ ...P, entities: true }).process(text);
}

describe('emphatic particles attach with a hyphen', () => {
  test('ка joins the stem', () => {
    assert.equal(microtypo('принеси ка', P), 'принеси-ка');
    assert.equal(microtypo('Ступай ка', P), 'Ступай-ка');
  });

  test('кась joins the stem', () => {
    assert.equal(microtypo('Гляди кась', P), 'Гляди-кась');
  });

  test('де joins the stem', () => {
    assert.equal(microtypo('молвил де', P), 'молвил-де');
  });

  test('already hyphenated stays', () => {
    assert.equal(microtypo('принеси-ка', P), 'принеси-ка');
  });

  test('bare то keeps no hyphen', () => {
    // `то` binds with an NBSP short-word rule, never a hyphen.
    assert.ok(!microtypo('то был Эрик', P).includes('-'));
  });
});

describe('en-dash for number ranges', () => {
  test('range gains an ndash entity', () => {
    assert.ok(entity('войско 100-500').includes('100&ndash;500'));
  });

  test('range gains an en-dash glyph', () => {
    assert.ok(microtypo('войско 100-500', P).includes('100–500'));
  });

  test('short range converts', () => {
    assert.ok(microtypo('от 5-10 клинков', P).includes('5–10'));
  });

  test('day range converts', () => {
    assert.ok(microtypo('за 12-19 дней', P).includes('12–19'));
  });

  test('ISO date is preserved', () => {
    const out = microtypo('Хроника 2024-01-01.', P);
    assert.ok(out.includes('2024-01-01'), out);
    assert.ok(!out.includes('–'), out);
  });

  test('phone number is preserved', () => {
    const out = microtypo('зов 8-800-555-35-35', P);
    assert.ok(out.includes('8-800-555-35-35'), out);
    assert.ok(!out.includes('–'), out);
  });

  test('year range becomes an en-dash', () => {
    assert.ok(microtypo('с 1999-2003 г.', P).includes('1999–2003'));
  });

  test('time interval gains an ndash entity', () => {
    assert.ok(entity('с 9:00-18:00 в карауле').includes('9:00&ndash;18:00'));
  });
});

describe('range and dash bundles', () => {
  test('endash bundle converts a hyphen range', () => {
    assert.ok(microtypo('отряд 100-500 бойцов', NOP).includes('100–500'));
  });

  test('emdash bundle converts a spaced hyphen', () => {
    assert.ok(microtypo('Амбер - вечен.', NOP).includes('—'));
  });

  test('endash bundle converts a spaced range', () => {
    assert.ok(microtypo('дозор 12 - 19 стрелков', NOP).includes('12–19'));
  });
});

describe('dash.hyphenated_particle — кое- prefix (GAP-A1)', () => {
  test('кое какой becomes кое-какой', () => {
    assert.equal(microtypo('кое какой', NOP), 'кое-какой');
  });

  test('кое что becomes кое-что', () => {
    assert.equal(microtypo('расскажу кое что', NOP), 'расскажу кое-что');
  });

  test('existing кое-как is unchanged', () => {
    assert.equal(microtypo('кое-как', NOP), 'кое-как');
  });
});
