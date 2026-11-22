import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLOSE, OPEN } from '../../src/protect/placeholders.js';
import { Vault } from '../../src/protect/vault.js';

test('one-entry restoration accepts zero-padded ids and leaves other ids unchanged', () => {
  const vault = new Vault('B');
  const zero = `${OPEN}B000${CLOSE}`;
  const unknown = `${OPEN}B01${CLOSE}`;
  assert.equal(vault.restoreAll(`${zero}${unknown}`), `${zero}${unknown}`);
  const first = vault.store('Амбер');
  assert.equal(vault.restoreAll(`${first}|${zero}|${unknown}`), `Амбер|Амбер|${unknown}`);
  vault.store('Тень');
  assert.equal(vault.restoreAll(`${first}|${zero}|${unknown}`), 'Амбер|Амбер|Тень');
  vault.reset();
  assert.equal(vault.restoreAll(`${zero}${unknown}`), `${zero}${unknown}`);
});

test('vault contents keep dollar substitutions literal', () => {
  for (const content of ['$$', '$&', '$1', '$`', "$'", '$<name>', '', 'Амбер']) {
    const vault = new Vault('B');
    const token = vault.store(content);
    assert.equal(vault.restoreAll(`a${token}b${token}c`), `a${content}b${content}c`);
  }
});
