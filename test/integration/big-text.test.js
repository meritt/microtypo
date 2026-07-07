import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

const scenes = ['pattern-walk', 'arden-report', 'rebma-release'];

const read = (file) =>
  readFileSync(new URL(`../fixtures/big-text/${file}`, import.meta.url), 'utf8');

describe('big text', () => {
  for (const scene of scenes) {
    const input = read(`${scene}.input.txt`);

    test(`${scene}: markup output matches golden`, () => {
      const actual = new MicroTypo({ html: true, entities: true }).process(input);
      assert.equal(actual, read(`${scene}.expected.entities.txt`));
    });

    test(`${scene}: bare unicode output matches golden`, () => {
      const actual = new MicroTypo({ entities: false }).process(input);
      assert.equal(actual, read(`${scene}.expected.unicode.txt`));
    });

    test(`${scene}: both modes process under 50ms`, () => {
      const start = performance.now();
      new MicroTypo({ html: true, entities: true }).process(input);
      new MicroTypo({ entities: false }).process(input);
      assert.ok(performance.now() - start < 50, `${scene} exceeded 50ms budget`);
    });
  }
});
