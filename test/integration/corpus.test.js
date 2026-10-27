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

// The indent is the author's layout and the rules never see it: every line of every case typesets
// the same behind one, in both formats it is kept in, and taking the indent out of the result gives
// the result without it. Behind a line of its own too, where the case does not open the document.
const INDENT = ' \t ';

const indentLines = (text, indent) =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? line : indent + line.trimStart()))
    .join('\n');

test('every corpus case typesets the same behind an indent', () => {
  for (const c of cases) {
    for (const input of ['text', 'html']) {
      for (const before of ['', 'Пролог.\n']) {
        const plain = processCase({ ...c, text: before + indentLines(c.text, '') }, { input });
        const indented = processCase(
          { ...c, text: before + indentLines(c.text, INDENT) },
          { input }
        );

        assert.equal(indented.split(INDENT).join(''), plain, `${c.title} as ${input}`);
      }
    }
  }
});
