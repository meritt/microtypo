import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

// Entity-mode by default; a case opts into Unicode output with params.entities: false.
const raw = await readFile(new URL('../fixtures/corpus.json', import.meta.url), 'utf8');
const cases = JSON.parse(raw);

const grouped = Map.groupBy(cases, (c) => c.grtitle || 'Default');

function processCase(c, extra = {}) {
  const entities = c.params?.entities ?? true;

  return new MicroTypo({ html: true, ...c.params, ...extra, entities }).process(c.text);
}

for (const [groupName, groupCases] of grouped) {
  test(groupName, async (t) => {
    for (const [i, c] of groupCases.entries()) {
      const title = c.title || `case #${i}`;

      await t.test(title, () => {
        assert.equal(processCase(c), c.result);
      });

      await t.test(`${title} [class]`, () => {
        assert.equal(
          processCase(c, { render: { hanging: 'class' } }),
          c.result_classes ?? c.result
        );
      });
    }
  });
}

test('corpus integrity', () => {
  for (const [i, c] of cases.entries()) {
    assert.equal(typeof c.text, 'string', `#${i} text must be a string`);
    assert.equal(typeof c.result, 'string', `#${i} result must be a string`);
    assert.ok(
      c.result_classes === null || typeof c.result_classes === 'string',
      `#${i} result_classes must be null or a string`
    );
    assert.equal(typeof c.title, 'string', `#${i} title must be a string`);
  }

  assert.equal(
    raw,
    `${JSON.stringify(cases, null, 2)}\n`,
    'corpus.json must be canonically formatted'
  );
});
