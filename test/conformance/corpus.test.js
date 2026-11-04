import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { MicroTypo } from '../../src/index.js';
import { replay } from './replay.mjs';

// The corpus is what other implementations are held to, so it has to say what this engine does
// today: a change in behaviour fails here until `node test/conformance/build.mjs` records it.
const [header, ...cases] = readFileSync(new URL('./corpus.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function engineFor(config) {
  try {
    return new MicroTypo(config);
  } catch {
    return undefined;
  }
}

test('the conformance corpus matches the engine', () => {
  assert.equal(cases.length, header.cases);

  // Cases with no calls before `process()` share an engine per configuration: building one per case
  // is most of the run, and an engine is meant to be reused.
  const groups = Map.groupBy(cases, (c) => (c.ops.length === 0 ? JSON.stringify(c.config) : c.id));
  const stale = [];

  for (const group of groups.values()) {
    const engine = group[0].ops.length === 0 ? engineFor(group[0].config) : undefined;

    for (const c of group) {
      if (!isDeepStrictEqual(replay(c, engine), c.expect)) {
        stale.push(c.id);
      }
    }
  }

  assert.deepEqual(
    stale.slice(0, 20),
    [],
    `${stale.length} cases no longer match; rebuild the corpus`
  );
});
