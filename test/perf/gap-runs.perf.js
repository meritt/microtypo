import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { compileRuleGroup, runRuleGroup } from '../../src/rule-runner.js';
import { nobrGroup } from '../../src/rules/nobr.js';
import { spaceGroup } from '../../src/rules/space.js';

test('gap boundaries preserve particle binding at starts and across whitespace kinds', () => {
  const group = compileRuleGroup(
    { rules: nobrGroup.rules.filter(({ id }) => id === 'nbsp_particle') },
    'nobr'
  );

  for (const [input, expected] of [
    ['  ли ', '\u{00A0}ли '],
    ['\n \tже ', '\n\u{00A0}же '],
    ['\r\n\t б ', '\r\n\u{00A0}б '],
    ['\u{00A0} \tже ', '\u{00A0}\u{00A0}же '],
    ['слово \tли\u{00A0}дальше', 'слово\u{00A0}ли дальше'],
    ['слово \tли\n', 'слово\u{00A0}ли\n'],
    ['слово \tже!', 'слово\u{00A0}же!'],
    ['начало \t конец', 'начало \t конец'],
    ['начало \t\n конец', 'начало \t\n конец']
  ]) {
    assert.equal(runRuleGroup(group, input, { html: false }), expected);
  }
});

test('trailing spaces retain tabs, no-break spaces and final-line semantics', () => {
  const group = compileRuleGroup(
    { rules: spaceGroup.rules.filter(({ id }) => id === 'trim_line_end') },
    'space'
  );

  for (const [input, expected] of [
    ['   ', ''],
    ['слово   ', 'слово'],
    ['слово\t   ', 'слово\t'],
    ['слово   \t', 'слово   \t'],
    ['слово\u{00A0}   ', 'слово\u{00A0}'],
    ['слово   \n', 'слово   \n'],
    ['слово   \r\n', 'слово   \r\n'],
    ['слово   \nконец', 'слово   \nконец']
  ]) {
    assert.equal(runRuleGroup(group, input, { html: false }), expected);
  }
});

for (const [name, unit, tail] of [
  ['spaces before a word', ' ', 'конец'],
  ['mixed gap before a word', ' \t', 'конец'],
  ['spaces before a line ending', ' ', '\nконец']
]) {
  test(`uncollapsed ${name} grow linearly`, (t) => {
    const typo = new MicroTypo({ rules: { 'space.collapse_spaces': false } });
    const time = (n) => {
      const input = `начало${unit.repeat(n)}${tail}`;
      let best = Infinity;

      for (let round = 0; round < 3; round += 1) {
        const start = performance.now();
        for (let iteration = 0; iteration < 10; iteration += 1) {
          typo.process(input);
        }
        best = Math.min(best, performance.now() - start);
      }

      return best;
    };

    time(1_000);
    const [one, two, four] = [time(2_000), time(4_000), time(8_000)];

    const detail = `${name}: N ${one.toFixed(3)}ms, 2N ${two.toFixed(3)}ms, 4N ${four.toFixed(3)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
