import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { replay } from '../conformance/replay.mjs';
import { loadEngine } from './fuzz/engine.mjs';

const { MicroTypo, restart, unfiltered } = await loadEngine();
const [header, ...cases] = readFileSync(
  new URL('../conformance/corpus.jsonl', import.meta.url),
  'utf8'
)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert.equal(cases.length, header.cases);
const groups = Map.groupBy(cases, (item) =>
  item.ops.length === 0 ? JSON.stringify(item.config) : item.id
);
const differences = [];
let checked = 0;
let constructorRejected = 0;

for (const group of groups.values()) {
  let filtered;
  let full;
  try {
    filtered = new MicroTypo(group[0].config);
    full = new MicroTypo(group[0].config);
  } catch {
    constructorRejected += group.length;
    continue;
  }

  for (const item of group) {
    restart();
    const filteredResult = replay(item, filtered);
    restart();
    const fullResult = unfiltered(() => replay(item, full));
    checked += 1;
    if (!isDeepStrictEqual(filteredResult, fullResult)) {
      differences.push({ id: item.id, case: item, filtered: filteredResult, full: fullResult });
    }
  }
}

assert.equal(checked + constructorRejected, cases.length);
console.log(
  JSON.stringify({
    corpus: cases.length,
    checked,
    constructorRejected,
    differences: differences.length,
    examples: differences.slice(0, 10)
  })
);
assert.equal(differences.length, 0, 'rule feature filtering changes corpus output');
