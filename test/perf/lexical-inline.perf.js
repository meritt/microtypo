import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { DEFAULT_GROUPS } from '../../src/rules/registry.js';

const disabled = Object.fromEntries(DEFAULT_GROUPS.map(([name]) => [name, false]));

test('lexical prerequisites read abbreviations through inline markup', () => {
  const typo = new MicroTypo({ input: 'html', rules: { ...disabled, 'abbr.nowrap_etc': true } });
  assert.equal(typo.process('и <em>т.</em> д.'), 'и\u{00A0}<em>т.</em>\u{00A0}д.');
});

test('lexical prerequisites read digit groups through inline markup', () => {
  const typo = new MicroTypo({
    input: 'html',
    rules: { ...disabled, 'number.thin_space_triads': true }
  });
  assert.equal(typo.process('1 <em>234</em>'), '1\u{202F}<em>234</em>');
});
