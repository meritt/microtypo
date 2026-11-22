import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileRuleGroup, runRuleGroup } from '../../src/rule-runner.js';

const CASES = [
  [/z/g, 'no match'],
  [/a/g, 'aba'],
  [/a/y, 'ba'],
  [/a/gy, 'aaba'],
  [/(?:)/g, 'ab'],
  [/(?:)/gu, '😀a'],
  [/a*/gy, 'baa'],
  [/(?<x>a)(b)?/dg, 'aba'],
  [/(?<=a)b/g, 'abab'],
  [/$/g, 'tail']
];

for (const [pattern, input] of CASES) {
  test(`string replacement preserves native substitutions: ${pattern}`, () => {
    for (const replacement of [null, undefined, '', 'x', '$&', '$1', '$$', '$`', "$'", '$<x>']) {
      pattern.lastIndex = 2;
      const native = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
      );
      const group = compileRuleGroup({ rules: [{ id: 'replace', pattern, replacement }] }, 'probe');
      for (let round = 0; round < 2; round++) {
        assert.equal(
          runRuleGroup(group, input, { html: false }),
          input.replace(native, replacement ?? '')
        );
      }
      assert.equal(pattern.lastIndex, 2);
    }
  });

  for (const throws of [false, true]) {
    const observe = (compiled) => {
      const calls = [];
      const replace = (args) => {
        calls.push(args);
        if (throws) {
          throw new TypeError('callback failure');
        }
        return `[${args[0]}]`;
      };
      pattern.lastIndex = 2;
      const native = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
      );
      const group = compileRuleGroup(
        { rules: [{ id: 'replace', pattern, replacement: replace }] },
        'probe'
      );
      const output = [];
      for (let round = 0; round < 2; round++) {
        try {
          output.push(
            compiled
              ? runRuleGroup(group, input, { html: false })
              : input.replace(native, (...args) => replace(args))
          );
        } catch (error) {
          output.push({ name: error.name, message: error.message });
        }
      }
      return { output, calls, callerLastIndex: pattern.lastIndex };
    };

    test(`function replacement preserves native matches and callbacks: ${pattern}, throws=${throws}`, () => {
      assert.deepEqual(observe(true), observe(false));
    });
  }
}

test('replacement steps keep their order and share the callback context', () => {
  const ctx = { html: false, observed: [] };
  const group = compileRuleGroup(
    {
      rules: [
        {
          id: 'steps',
          pattern: [/a/g, /b/g, /c/g],
          replacement: [
            (args, state) => {
              state.observed.push(args[0]);
              return 'b';
            },
            'c',
            (args, state) => {
              state.observed.push(args[0]);
              return 'd';
            }
          ]
        }
      ]
    },
    'probe'
  );

  assert.equal(runRuleGroup(group, 'a', ctx), 'd');
  assert.deepEqual(ctx.observed, ['a', 'c']);
});

test('a non-function replacement is converted even when its pattern does not match', () => {
  let calls = 0;
  const group = compileRuleGroup(
    {
      rules: [
        {
          id: 'coerce',
          pattern: /z/g,
          replacement: {
            toString() {
              calls++;
              return 'a';
            }
          }
        }
      ]
    },
    'probe'
  );

  assert.equal(runRuleGroup(group, 'b', { html: false }), 'b');
  assert.equal(calls, 1);
});

test('non-string rule text keeps the original replace call without coercion', () => {
  for (const replacement of ['x', () => 'x']) {
    const seen = [];
    const text = {
      [Symbol.toPrimitive]() {
        throw new Error('unexpected text coercion');
      },
      replace(pattern, substitute) {
        seen.push([pattern.lastIndex, typeof substitute]);
        pattern.lastIndex = 7;
        return this;
      }
    };
    const group = compileRuleGroup(
      { rules: [{ id: 'replace', pattern: /z/g, replacement }] },
      'probe'
    );
    assert.equal(runRuleGroup(group, text, { html: false }), text);
    assert.equal(runRuleGroup(group, text, { html: false }), text);
    assert.deepEqual(seen, [
      [0, typeof replacement],
      [7, typeof replacement]
    ]);
  }
});

test('non-string text without replace still throws before any text conversion', () => {
  for (const replacement of ['x', () => 'x']) {
    let conversions = 0;
    const group = compileRuleGroup(
      { rules: [{ id: 'replace', pattern: /z/g, replacement }] },
      'probe'
    );
    const values = [
      undefined,
      null,
      7,
      true,
      Symbol('text'),
      {
        toString() {
          conversions++;
          return 'no match';
        }
      }
    ];
    for (const value of values) {
      assert.throws(() => runRuleGroup(group, value, { html: false }), TypeError);
    }
    assert.equal(conversions, 0);
  }
});
