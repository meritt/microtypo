import assert from 'node:assert/strict';
import test from 'node:test';

import { CliUsageError } from '../../src/cli/errors.js';
import { coerceScalar, isPlainObject, mergeConfig, setPath } from '../../src/cli/util.js';

test('coerceScalar: booleans, numbers, strings', () => {
  assert.equal(coerceScalar('true'), true);
  assert.equal(coerceScalar('false'), false);
  assert.equal(coerceScalar('42'), 42);
  assert.equal(coerceScalar('Амбер'), 'Амбер');
  assert.equal(coerceScalar(''), '');
});

test('isPlainObject distinguishes objects from arrays and null', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
});

test('mergeConfig: override wins, nested objects deep-merge', () => {
  const merged = mergeConfig(
    { entities: false, rules: { 'quote.nested': true, 'quote.inch': true } },
    { rules: { 'quote.nested': false } }
  );
  assert.deepEqual(merged, {
    entities: false,
    rules: { 'quote.nested': false, 'quote.inch': true }
  });
});

test('setPath creates a nested path', () => {
  const target = {};
  setPath(target, 'rules.quote', false);
  assert.deepEqual(target, { rules: { quote: false } });
});

test('setPath rejects __proto__ and does not pollute Object.prototype', () => {
  assert.throws(() => setPath({}, '__proto__.polluted', 'x'), CliUsageError);
  assert.equal({}.polluted, undefined);
});

test('setPath rejects constructor/prototype segments anywhere in the path', () => {
  assert.throws(() => setPath({}, 'a.constructor.polluted', 'x'), CliUsageError);
  assert.throws(() => setPath({}, 'a.prototype', 'x'), CliUsageError);
  assert.throws(() => setPath({}, 'prototype', 'x'), CliUsageError);
});

test('mergeConfig rejects a __proto__ override key without corrupting the prototype chain', () => {
  const override = JSON.parse('{"__proto__":{"polluted":"yes"}}');
  assert.throws(() => mergeConfig({}, override), CliUsageError);
  assert.equal({}.polluted, undefined);
});

test('mergeConfig rejects __proto__ nested one level down', () => {
  const override = { rules: JSON.parse('{"__proto__":{"polluted":"yes"}}') };
  assert.throws(() => mergeConfig({ rules: {} }, override), CliUsageError);
});
