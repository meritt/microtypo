// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node pinned in
// `package.json`, one file at a time, and no other test run, coverage or build beside it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

// One paragraph where a rule asks at every match whether the engine's no-wrap wrapper holds it, at
// 1x, 2x and 4x, best of three at each size. The question reads the paragraph once for a rule: 4x
// the input lands near 4x the time, a reading at every match near 16x.
function assertLinear(t, config, build, n) {
  const typo = new MicroTypo({ ...config, maxInputLength: 5_000_000, maxProcessingMs: 0 });
  const best = (k) => {
    const text = build(n * k);
    let ms = Infinity;

    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();

      typo.process(text);
      ms = Math.min(ms, performance.now() - start);
    }

    return ms;
  };

  best(1);

  const [one, two, four] = [best(1), best(2), best(4)];
  const detail = `1x ${one.toFixed(1)}ms, 2x ${two.toFixed(1)}ms, 4x ${four.toFixed(1)}ms (${(four / one).toFixed(1)}x)`;

  t.diagnostic(detail);
  assert.ok(four < one * 8 + 5, detail);
}

test('labels after initials grow linearly in a text no rule before them changed', (t) => {
  assertLinear(t, { html: true }, (n) => 'Р. Г. ул. Мира в г. пр. Ленина '.repeat(n), 8000);
});

test('labels grow linearly in a text whose end an earlier rule rewrote', (t) => {
  assertLinear(t, { html: true }, (n) => `${'в г. пр. Ленина ул. пр. Мира '.repeat(n)}а - б`, 8000);
});

test('account labels and split digit groups grow linearly', (t) => {
  assertLinear(
    t,
    { html: true },
    (n) => 'нэ. р/с 3786968270 и пр.арт. 3539555 '.repeat(n) + '12345 '.repeat(n * 2),
    12_000
  );
});

test('era marks between words grow linearly with nested wrappers kept', (t) => {
  assertLinear(
    t,
    { html: true, rules: { 'other.drop_nested_nowrap': false } },
    (n) => 'у нэ. м те. слово слово слово слово '.repeat(n),
    8000
  );
});

test('a label before a label grows linearly past lifted markup', (t) => {
  assertLinear(
    t,
    { html: true, input: 'html' },
    (n) => '<b>Р</b> в г. пр. Ленина ул. пр. Мира '.repeat(n),
    4000
  );
});

// Ordinary prose: every sentence holds a phrase the engine wraps, and each rule that reads the
// wrappers asks about them once a sentence.
for (const [name, sentence] of [
  ['initials and an address', 'Письмо получил А. С. Пушкин, ул. Мира, д. 5, г. Москва. '],
  ['era marks', 'В 5 в. до н. э. и в 3 в. н. э. жили люди. '],
  ['и т. д. and т. е.', 'Яблоки, груши и т. д. лежали, т. е. были тут. '],
  ['time ranges', 'Встреча с 10:00-11:00 и 12:30-13:45 в офисе, затем обед и т. д. ']
]) {
  test(`prose with ${name} in every sentence grows linearly`, (t) => {
    assertLinear(t, { html: true }, (n) => sentence.repeat(n), 6000);
  });
}
