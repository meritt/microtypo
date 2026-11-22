import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';

const config = { html: false, input: { format: 'markdown' } };
const header = '| Альфа | Бета |';

for (const delimiter of ['| - | - |', '| -- | -- |', '| :- | -: |', '| :--: | --: |', '- | -']) {
  for (const prefix of ['', '> ', '- ']) {
    test(`GFM delimiter stays byte-exact ${JSON.stringify([prefix, delimiter])}`, () => {
      const continuation = prefix === '- ' ? '  ' : prefix;
      const input = `${prefix}${header}\n${continuation}${delimiter}\n${continuation}| Корвин - принц | Эрик |`;
      const expected = `${prefix}${header}\n${continuation}${delimiter}\n${continuation}| Корвин\u{00A0}— принц | Эрик |`;

      assert.equal(microtypo(input, config), expected);
      assert.equal(microtypo(expected, config), expected);
    });
  }
}

test('a data row containing only hyphens is still prose', () => {
  const input = `${header}\n| - | - |\n| - | - |`;

  assert.equal(microtypo(input, config), `${header}\n| - | - |\n|\u{00A0}— |\u{00A0}— |`);
});

test('a delimiter-shaped line without a header is not a table', () => {
  assert.equal(microtypo('| - | - |', config), '|\u{00A0}— |\u{00A0}— |');
});

test('delimiter column count must match the header', () => {
  const input = `${header}\n| - | - | - |`;

  assert.equal(microtypo(input, config), `${header}\n|\u{00A0}— |\u{00A0}— |\u{00A0}— |`);
});

test('an escaped header pipe belongs to its cell', () => {
  const input = '| Альфа\\|Бета | Гамма |\n| - | - |';

  assert.equal(microtypo(input, config), input);
});

test('table-looking code stays untouched', () => {
  const input = `\`\`\`\n${header}\n| - | - |\n\`\`\``;

  assert.equal(microtypo(input, config), input);
});
