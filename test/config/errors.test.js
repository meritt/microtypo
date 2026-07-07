import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MicroTypoError,
  MicroTypoConfigError,
  MicroTypoInputError,
  MicroTypoBudgetError
} from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';

test('MicroTypoError extends Error and has ERR_MICROTYPO code', () => {
  const e = new MicroTypoError('boom');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'MicroTypoError');
  assert.equal(e.code, 'ERR_MICROTYPO');
});

test('MicroTypoConfigError has ERR_MICROTYPO_CONFIG code', () => {
  const e = new MicroTypoConfigError('bad config', { details: { issues: [] } });
  assert.ok(e instanceof MicroTypoError);
  assert.equal(e.code, 'ERR_MICROTYPO_CONFIG');
  assert.deepEqual(e.details, { issues: [] });
});

test('MicroTypoInputError has ERR_MICROTYPO_INPUT code', () => {
  const e = new MicroTypoInputError('input too long');
  assert.equal(e.code, 'ERR_MICROTYPO_INPUT');
});

test('MicroTypoBudgetError has ERR_MICROTYPO_BUDGET code', () => {
  const e = new MicroTypoBudgetError('budget exceeded');
  assert.equal(e.code, 'ERR_MICROTYPO_BUDGET');
});

test('details survive when passed', () => {
  const e = new MicroTypoInputError('x', { details: { field: 'title' } });
  assert.deepEqual(e.details, { field: 'title' });
});

test('cause is forwarded to Error options', () => {
  const cause = new Error('underlying');
  const e = new MicroTypoConfigError('top', { cause });
  assert.equal(e.cause, cause);
});

test('MicroTypo#process throws MicroTypoInputError on non-string', () => {
  const typo = new MicroTypo();

  assert.throws(() => typo.process(42), {
    code: 'ERR_MICROTYPO_INPUT',
    name: 'MicroTypoInputError'
  });
});

test('MicroTypo#process throws MicroTypoInputError when input too long', () => {
  const typo = new MicroTypo({ maxInputLength: 10 });

  assert.throws(() => typo.process('x'.repeat(20)), {
    code: 'ERR_MICROTYPO_INPUT'
  });
});

test('MicroTypo constructor throws MicroTypoConfigError on invalid entities', () => {
  assert.throws(() => new MicroTypo({ entities: 'invalid' }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

test('MicroTypo constructor throws MicroTypoConfigError on negative maxInputLength', () => {
  assert.throws(() => new MicroTypo({ maxInputLength: -1 }), {
    code: 'ERR_MICROTYPO_CONFIG',
    name: 'MicroTypoConfigError'
  });
});

test('MicroTypo constructor includes validation issues in details', () => {
  assert.throws(
    () => new MicroTypo({ maxInputLength: -5 }),
    (err) => {
      assert.equal(err.code, 'ERR_MICROTYPO_CONFIG');
      assert.ok(Array.isArray(err.details?.issues));
      assert.ok(err.details.issues.length > 0);

      return true;
    }
  );
});
