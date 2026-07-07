import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

// Idempotent only for inputs the engine fully owns, not for already-emitted HTML (<a>, <span>), which re-processes on a second pass.

describe('per-group idempotency — one group enabled at a time', () => {
  const GROUPS = [
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
  ];

  for (const group of GROUPS) {
    test(`idempotent per group: only ${group}`, () => {
      const rules = Object.fromEntries(GROUPS.map((g) => [`${g}.*`, g === group]));
      const typo = new MicroTypo({ rules });

      const sample = 'Клинок "Грейсвандир" -- цена 1000 рублей, ГОСТ 8.417.';
      const once = typo.process(sample);
      const twice = typo.process(once);

      assert.equal(
        twice,
        once,
        `Group ${group} not idempotent:\n  once:  ${once}\n  twice: ${twice}`
      );
    });
  }
});

describe('whole-pipeline idempotency on short canonical inputs', () => {
  const CANONICAL_SAMPLES = [
    'Клинок "Грейсвандир" -- цена 1000 рублей.',
    'Тень до 31 июля.',
    'Привет "Амбер" — раз.',
    'EXAMPLE.COM — король Амбера Оберон и принц Корвин',
    '«Козырь» — карта',
    '5-10 Козырей',
    // Adjacent and degenerate angle-quote pairs convert fully and round-trip, leaving no stray straight quotes.
    '«Корвин» — «Эрик»',
    '«Амбер» «Арден»'
    // `7 °C`-style temperatures are not idempotent — the nobr group re-positions the NBSP on a second pass.
  ];

  for (const sample of CANONICAL_SAMPLES) {
    test(`idempotent: ${JSON.stringify(sample.slice(0, 30))}`, () => {
      const typo = new MicroTypo();
      const once = typo.process(sample);
      const twice = typo.process(once);
      assert.equal(twice, once);
    });
  }

  test('idempotent: emphatic particle binds forward (default config)', () => {
    const typo = new MicroTypo();
    const once = typo.process('Поди кась в Арден');
    assert.equal(typo.process(once), once);
  });

  // abbr.nowrap_era is likewise not idempotent on already-emitted HTML: reprocessing the emitted nowrap span nests a second one.
});

describe('idempotency under a few preset combinations', () => {
  const PRESET_CONFIGS = [
    { name: 'entities:true', cfg: { entities: true } },
    { name: 'paragraphs:false', cfg: { render: { paragraphs: false } } },
    { name: 'autolink:false', cfg: { render: { autolink: false } } },
    {
      name: 'hanging rules enabled',
      cfg: { rules: { 'hanging.quote': true, 'hanging.bracket': true } }
    },
    { name: 'quote.nested:false', cfg: { rules: { 'quote.nested': false } } }
  ];

  const PRESET_SAMPLE = 'Клинок "Грейсвандир" -- цена 1000 рублей, до 31 июля.';

  for (const { name, cfg } of PRESET_CONFIGS) {
    test(`idempotent under ${name}`, () => {
      const typo = new MicroTypo(cfg);
      const once = typo.process(PRESET_SAMPLE);
      const twice = typo.process(once);
      assert.equal(twice, once);
    });
  }
});

describe('edge inputs — empty / pure punctuation / pure whitespace', () => {
  test('idempotent: empty string', () => {
    const typo = new MicroTypo();
    assert.equal(typo.process(typo.process('')), typo.process(''));
  });

  test('idempotent: pure whitespace', () => {
    const typo = new MicroTypo();
    assert.equal(typo.process(typo.process('   \n\n   ')), typo.process('   \n\n   '));
  });

  test('idempotent: short already-typeset string', () => {
    const typo = new MicroTypo();
    const input = '«Козырь» — карта';
    assert.equal(typo.process(typo.process(input)), typo.process(input));
  });

  test('idempotent: numeric-heavy text', () => {
    const typo = new MicroTypo();
    const input = 'Клинок Корвина 1000 руб., пошлина 5%, путь до Амбера 5-10 дней.';
    assert.equal(typo.process(typo.process(input)), typo.process(input));
  });
});

// Deterministic LCG so a failing seed reproduces.
function lcg(seed) {
  let s = seed >>> 0;

  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;

    return s / 0x100000000;
  };
}

const LETTERS = ['a', 'b', 'я', 'ю', 'x'];

function phrase(rng) {
  let out = LETTERS[Math.floor(rng() * LETTERS.length)];
  const extra = Math.floor(rng() * 4);

  for (let i = 0; i < extra; i++) {
    out += LETTERS[Math.floor(rng() * LETTERS.length)];
  }

  return out;
}

// Single-style only: mixing or nesting raw quotes is inherently ambiguous (a `""` run reads as nested), a documented non-idempotency.
function genFlat(rng, open, close) {
  const parts = [];
  const n = 1 + Math.floor(rng() * 4);

  for (let i = 0; i < n; i++) {
    parts.push(rng() < 0.6 ? `${open}${phrase(rng)}${close}` : phrase(rng));
  }

  return parts.join(rng() < 0.5 ? '' : ' ');
}

describe('quote fuzz — single-style phrases reach a fixed point', () => {
  for (const html of [false, true]) {
    test(`adjacent/spaced «angle» phrases are idempotent (html:${html})`, () => {
      const rng = lcg(0xc0ffee);

      for (let n = 0; n < 5000; n++) {
        const input = genFlat(rng, '«', '»');
        const once = microtypo(input, { html });
        const twice = microtypo(once, { html });
        assert.equal(
          twice,
          once,
          `not idempotent (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`
        );
      }
    });

    test(`spaced "straight" phrases convert idempotently (html:${html})`, () => {
      const rng = lcg(0x1234abcd);

      for (let n = 0; n < 5000; n++) {
        // Straight quotes join with a space so the ambiguous `""` run never forms.
        const parts = [];
        const count = 1 + Math.floor(rng() * 4);

        for (let i = 0; i < count; i++) {
          parts.push(rng() < 0.6 ? `"${phrase(rng)}"` : phrase(rng));
        }
        const input = parts.join(' ');
        const once = microtypo(input, { html });
        const twice = microtypo(once, { html });
        assert.equal(
          twice,
          once,
          `not idempotent (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`
        );
      }
    });
  }

  test('no straight quote survives glued to an angle quote', () => {
    const rng = lcg(0xbeefcafe);

    for (let n = 0; n < 5000; n++) {
      const input = genFlat(rng, '«', '»');
      const out = microtypo(input);
      assert.ok(
        !/["][«»„“]|[«»„“]["]/u.test(out),
        `stray straight quote glued to angle (idx ${n}): ${JSON.stringify(input)} -> ${JSON.stringify(out)}`
      );
    }
  });
});

describe('idempotency on already-typeset text', () => {
  const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
  const entity = (text) => new MicroTypo({ ...PARAMS, entities: true }).process(text);

  test('idempotent on already-typeset text', () => {
    const text = 'Цена 100 ₽ за «Козырь» — всего 1000.';
    const once = microtypo(text, PARAMS);
    const twice = microtypo(once, PARAMS);
    assert.equal(twice, once, `\nonce:  ${once}\ntwice: ${twice}`);
  });

  test('idempotent in entity mode', () => {
    const text = 'Вот «Козырь» и число 1000.';
    const once = entity(text);
    const twice = entity(once);
    assert.equal(twice, once);
  });
});
