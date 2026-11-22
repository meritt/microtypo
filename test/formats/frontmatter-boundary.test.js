import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';

const config = { html: false, input: { format: 'frontmatter' } };

for (const open of ['---', '+++']) {
  for (const boundary of ['', '\n', '\n\n\n', ' \t\r\n\n\t\r']) {
    test(`frontmatter keeps its body boundary ${JSON.stringify([open, boundary])}`, () => {
      const header = open === '---' ? 'title: Амбер' : 'title = "Амбер"';
      const lead = `${open}\n${header}\n${open}\n`;
      const input = `${lead}${boundary}Корвин - принц`;
      const expected = `${lead}${boundary}Корвин\u{00A0}— принц`;

      assert.equal(microtypo(input, config), expected);
      assert.equal(microtypo(expected, config), expected);
    });
  }
}

test('frontmatter boundary keeps indentation on the first code line', () => {
  const source = '---\ntitle: Амбер\n---\n \t\n    Корвин - принц';

  assert.equal(microtypo(source, config), source);
});

test('frontmatter without a header still trims leading empty lines', () => {
  assert.equal(microtypo('\n\nКорвин - принц', config), 'Корвин\u{00A0}— принц');
});

test('preserving the boundary leaves the original first-pass body context intact', () => {
  const header = '---\ntitle: test\n---\n';
  for (const boundary of ['\n', '\n\n', '\r\n']) {
    for (const [body, typed] of [
      ['1997год.', '1997год.'],
      ['Гост 5773-90', 'Гост 5773–90']
    ]) {
      const expected = header + boundary + typed;
      assert.equal(microtypo(header + boundary + body, config), expected);
      assert.equal(microtypo(expected, config), expected);
    }
  }
});
