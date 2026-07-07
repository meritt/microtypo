import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineRuleGroup } from '../../src/define-rule.js';
import { MicroTypoBudgetError, MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';

const MAX = 5_000_000; // documented maxInputLength ceiling

describe('input length cap', () => {
  test('rejects input past a custom maxInputLength', () => {
    const typo = new MicroTypo({ maxInputLength: 100 });
    assert.doesNotThrow(() => typo.process('x'.repeat(100)));

    assert.throws(() => typo.process('x'.repeat(101)), {
      code: 'ERR_MICROTYPO_INPUT'
    });
  });

  test('default cap is 30_000 and rejects 30_001 chars', () => {
    const typo = new MicroTypo();

    assert.doesNotThrow(() => typo.process('x'.repeat(30_000)));
    assert.throws(() => typo.process('x'.repeat(30_001)), {
      code: 'ERR_MICROTYPO_INPUT'
    });
  });

  test('30K adversarial input finishes within 5s', () => {
    const typo = new MicroTypo();
    const input = 'a'.repeat(30_000);
    const start = Date.now();
    typo.process(input);
    const ms = Date.now() - start;
    assert.ok(ms < 5000, `adversarial 30K took ${ms}ms (budget 5000)`);
  });
});

describe('maxInputLength ceiling', () => {
  test('above the ceiling is rejected', () => {
    assert.throws(() => new MicroTypo({ maxInputLength: MAX + 1 }), MicroTypoConfigError);
  });

  test('at the ceiling is accepted', () => {
    assert.doesNotThrow(() => new MicroTypo({ maxInputLength: MAX }));
  });

  test('a normal value is accepted', () => {
    assert.doesNotThrow(() => new MicroTypo({ maxInputLength: 50_000 }));
  });
});

describe('wall-clock budget', () => {
  test('throws when a rule group overruns the deadline', () => {
    const typo = new MicroTypo({ maxProcessingMs: 50, presets: false });
    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'Slow',
        rules: [
          {
            id: 'busy_wait',
            handler: () => {
              const until = performance.now() + 100;

              while (performance.now() < until) {
                /* burn past the budget */
              }
            }
          }
        ]
      }),
      { name: 'Slow', position: 'start' }
    );

    assert.throws(() => typo.process('x'), {
      code: 'ERR_MICROTYPO_BUDGET'
    });
  });

  test('a tight budget interrupts a large input', () => {
    const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 1 });
    const input = '«a» '.repeat(200_000);
    assert.throws(() => typo.process(input), MicroTypoBudgetError);
  });

  test('adversarial nested quotes never block the event loop', () => {
    const typo = new MicroTypo({ maxInputLength: 1_000_000, maxProcessingMs: 500 });
    const input = '«'.repeat(500_000) + '»'.repeat(500_000);
    const start = performance.now();

    try {
      typo.process(input);
    } catch (error) {
      if (!(error instanceof MicroTypoBudgetError)) {
        throw error;
      }
    }

    const ms = performance.now() - start;
    assert.ok(ms < 2000, `event loop blocked for ${ms.toFixed(0)}ms`);
  });

  test('a tight budget interrupts malformed XML construct scanning', () => {
    const typo = new MicroTypo({
      input: 'xml',
      maxInputLength: 1_000_000,
      maxProcessingMs: 0.0001
    });
    const input = `<!DOCTYPE note [ <!ENTITY w "${'Корвин '.repeat(80_000)}"> `;

    assert.throws(() => typo.process(input), MicroTypoBudgetError);
  });

  test('maxProcessingMs:0 disables the budget', () => {
    const typo = new MicroTypo({ maxProcessingMs: 0 });
    assert.doesNotThrow(() => typo.process('Это «обычный» текст про Амбер с числом 1000.'));
  });

  test('maxProcessingMs:0 disables the budget under a small length cap', () => {
    const typo = new MicroTypo({ maxProcessingMs: 0, maxInputLength: 1000 });
    assert.doesNotThrow(() => typo.process('«Корвин» «Эрик» "Амбер" — да'));
  });

  test('real text stays well under the default budget', () => {
    const typo = new MicroTypo();
    const text = 'Корвин шёл к «Амберу» — путь длиной 1000 шагов.'.repeat(200);
    const start = Date.now();
    typo.process(text);
    assert.ok(Date.now() - start < 500, `Took too long`);
  });
});

describe('cycle-limit hook', () => {
  test('onCycleLimit stays silent on normal input', () => {
    const typo = new MicroTypo();
    let hookCalls = 0;
    typo.onCycleLimit = () => hookCalls++;
    typo.process('обычный текст про Амбер без проблем');
    assert.equal(hookCalls, 0);
  });
});
