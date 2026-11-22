import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { SafeSequences } from '../../src/protect/sequences.js';
import { compileRuleGroup, runRuleGroup } from '../../src/rule-runner.js';

for (const input of ['html', 'markdown']) {
  test(`${input}: a million-unit document stops before the next non-cycled rule`, (t) => {
    let now = 0;
    const calls = [];
    const typo = new MicroTypo({
      input,
      presets: false,
      maxInputLength: 1_000_000,
      maxProcessingMs: 10
    });
    const chunk = input === 'html' ? '<b>Амбер</b> ' : '*Амбер* ';
    const text = chunk.repeat(Math.floor(1_000_000 / chunk.length)).padEnd(1_000_000, ' ');
    typo.registerRuleGroup(
      {
        rules: [
          {
            id: 'first',
            handler: (ctx) => {
              calls.push('first');
              now = 11;
              return ctx.text;
            }
          },
          {
            id: 'second',
            handler: (ctx) => {
              calls.push('second');
              return ctx.text;
            }
          }
        ]
      },
      { name: 'probe' }
    );
    t.mock.method(performance, 'now', () => now);

    assert.throws(
      () => typo.process(text),
      (error) => error.code === 'ERR_MICROTYPO_BUDGET' && error.details.where === 'group:probe'
    );
    assert.deepEqual(calls, ['first']);
  });

  test(`${input}: a disabled budget permits the next rule`, (t) => {
    let now = 0;
    const calls = [];
    const typo = new MicroTypo({ input, presets: false, maxProcessingMs: 0 });
    typo.registerRuleGroup(
      {
        rules: [
          {
            id: 'first',
            handler: (ctx) => {
              calls.push('first');
              now = 1_000_000;
              return ctx.text;
            }
          },
          {
            id: 'second',
            handler: (ctx) => {
              calls.push('second');
              return ctx.text;
            }
          }
        ]
      },
      { name: 'probe' }
    );
    t.mock.method(performance, 'now', () => now);

    assert.equal(typo.process('Амбер'), 'Амбер');
    assert.deepEqual(calls, ['first', 'second']);
  });
}

test('the lifted run checks its budget before invoking the next rule', () => {
  let exhausted = false;
  const calls = [];
  const failure = new Error('budget exhausted');
  const group = compileRuleGroup(
    {
      rules: [
        {
          id: 'first',
          handler: (ctx) => {
            calls.push(ctx.text);
            exhausted = true;
            return ctx.text;
          }
        },
        {
          id: 'second',
          handler: (ctx) => {
            calls.push('second');
            return ctx.text;
          }
        }
      ]
    },
    'probe'
  );
  const inline = {
    bare: false,
    markdown: true,
    engineOpeners: new Map(),
    engineTags: new Set(),
    mintForms: null,
    mints: null,
    near: null,
    loose: null,
    cache: null
  };

  assert.throws(
    () =>
      runRuleGroup(
        group,
        '*Амбер*',
        { html: false },
        (_before, after) => after,
        inline,
        null,
        (stage) => {
          assert.equal(stage, 'group:probe');
          if (exhausted) {
            throw failure;
          }
        }
      ),
    (error) => error === failure
  );
  assert.deepEqual(calls, ['Амбер']);
});

test('a throwing rule keeps its original exception and stops the group', () => {
  const typo = new MicroTypo({ presets: false, maxProcessingMs: 200 });
  const failure = new Error('rule failed');
  const calls = [];
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'first',
          handler: () => {
            calls.push('first');
            throw failure;
          }
        },
        {
          id: 'second',
          handler: (ctx) => {
            calls.push('second');
            return ctx.text;
          }
        }
      ]
    },
    { name: 'probe' }
  );

  assert.throws(
    () => typo.process('Амбер'),
    (error) => error === failure
  );
  assert.deepEqual(calls, ['first']);
});

test('mutating ctx.checkBudget cannot disable a cycled rule budget', (t) => {
  let now = 0;
  let calls = 0;
  const typo = new MicroTypo({ presets: false, maxProcessingMs: 10 });
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'mutate',
          handler: (ctx) => {
            ctx.checkBudget = null;
            return ctx.text;
          }
        },
        {
          id: 'loop',
          cycled: true,
          handler: (ctx) => {
            calls += 1;
            now = 11;
            return `${ctx.text}x`;
          }
        }
      ]
    },
    { name: 'probe' }
  );
  t.mock.method(performance, 'now', () => now);

  assert.throws(
    () => typo.process('Амбер'),
    (error) => error.code === 'ERR_MICROTYPO_BUDGET'
  );
  assert.equal(calls, 1);
});

test('a damaged protected URL cannot trigger a retry after the budget expires', () => {
  let now = 0;
  let calls = 0;
  const sequences = new SafeSequences();
  const text = sequences.protect('https://example.com');
  const failure = new Error('budget exhausted');
  const group = compileRuleGroup(
    {
      rules: [
        {
          id: 'damage',
          handler: (ctx) => {
            calls += 1;
            now = 11;
            return ctx.text.replace('simonenko-xyz', 'broken');
          }
        }
      ]
    },
    'probe'
  );

  assert.throws(
    () =>
      runRuleGroup(
        group,
        text,
        { html: false },
        sequences.keep.bind(sequences),
        null,
        null,
        (stage) => {
          assert.equal(stage, 'group:probe');
          if (now > 10) {
            throw failure;
          }
        }
      ),
    (error) => error === failure
  );
  assert.equal(calls, 1);
});

test('a lifted rewrite cannot trigger another rule pass after the budget expires', () => {
  let now = 0;
  let calls = 0;
  const failure = new Error('budget exhausted');
  const group = compileRuleGroup(
    {
      rules: [
        {
          id: 'rewrite',
          handler: (ctx) => {
            calls += 1;
            now = 11;
            return ctx.text.replace('Амбер', 'Тень');
          }
        }
      ]
    },
    'probe'
  );
  const inline = {
    bare: false,
    markdown: true,
    engineOpeners: new Map(),
    engineTags: new Set(),
    mintForms: null,
    mints: null,
    near: null,
    loose: null,
    cache: null
  };

  assert.throws(
    () =>
      runRuleGroup(
        group,
        '*Амбер*',
        { html: false },
        (_before, after) => after,
        inline,
        null,
        (stage) => {
          assert.equal(stage, 'group:probe');
          if (now > 10) {
            throw failure;
          }
        }
      ),
    (error) => error === failure
  );
  assert.equal(calls, 1);
});

test('the final restoration cannot return successfully after the budget expires', (t) => {
  let armed = false;
  let checks = 0;
  const typo = new MicroTypo({ presets: false, maxProcessingMs: 10 });
  typo.registerRuleGroup(
    {
      rules: [
        {
          id: 'last',
          handler: (ctx) => {
            armed = true;
            return ctx.text;
          }
        }
      ]
    },
    { name: 'probe' }
  );
  t.mock.method(performance, 'now', () => (armed && ++checks > 2 ? 11 : 0));

  assert.throws(
    () => typo.process('<pre>Амбер</pre>'),
    (error) => error.code === 'ERR_MICROTYPO_BUDGET'
  );
});
