import assert from 'node:assert/strict';
import test from 'node:test';

import { MicroTypo } from '../../src/index.js';

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
