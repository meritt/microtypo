import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

import { MicroTypo } from '../../src/index.js';
import { createSession } from './fuzz/session.mjs';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '9116301' },
    cases: { type: 'string', default: '200000' }
  }
});
const seed = Number(values.seed);
const cases = Number(values.cases);
assert.ok(Number.isSafeInteger(seed) && seed >= 0);
assert.ok(Number.isSafeInteger(cases) && cases > 0);
const session = await createSession({ seed });
const formats = {};
let traces = 0;
let dataRules = 0;
let errors = 0;
const outcome = (engine, input, options) => {
  try {
    return { result: engine.process(input, options) };
  } catch (error) {
    assert.ok(error.code?.startsWith('ERR_MICROTYPO'), `untyped error: ${error.message}`);
    return { error: { name: error.name, code: error.code, details: error.details } };
  }
};
for (let index = 0; index < cases; index++) {
  const kase = session.caseAt(index);
  const config =
    index % 17 === 0
      ? {
          ...kase.config,
          ruleGroups: [
            {
              name: 'terms',
              rules: [
                { id: 'amber', pattern: { source: 'Амбер', flags: 'gu' }, replacement: 'Ребма' }
              ]
            }
          ]
        }
      : kase.config;
  dataRules += index % 17 === 0 ? 1 : 0;
  const engine = new MicroTypo(config);
  const trace = index % 200 === 0;
  formats[kase.format] = (formats[kase.format] ?? 0) + 1;
  const checked = outcome(engine, kase.text, { edits: true, changes: index % 2 === 0, trace });
  if (checked.error !== undefined) {
    assert.deepEqual(
      outcome(engine, kase.text).error,
      checked.error,
      `error parity seed${seed} case${index}`
    );
    errors++;
    continue;
  }
  const { result } = checked;
  const parts = [];
  let cursor = 0;
  for (const { start, end, text } of result.edits) {
    assert.ok(
      start >= cursor && end >= start && end <= kase.text.length,
      `order seed${seed} case${index}`
    );
    assert.ok(
      !(start > 0 && kase.text.codePointAt(start - 1) > 0xffff),
      `start pair seed${seed} case${index}`
    );
    assert.ok(
      !(end > 0 && kase.text.codePointAt(end - 1) > 0xffff),
      `end pair seed${seed} case${index}`
    );
    parts.push(kase.text.slice(cursor, start), text);
    cursor = end;
  }
  parts.push(kase.text.slice(cursor));
  assert.equal(parts.join(''), result.text, `reconstruct seed${seed} case${index}`);
  assert.equal(
    engine.process(kase.text),
    result.text,
    `diagnostic parity seed${seed} case${index}`
  );
  if (trace) {
    traces++;
    for (const entry of result.trace) {
      assert.ok(entry.count > 0 && ['regex', 'handler'].includes(entry.kind));
      if (entry.kind === 'regex') {
        assert.equal(entry.ranges.length, entry.count);
      }
      for (const [start, end] of entry.ranges) {
        assert.ok(
          Number.isInteger(start) &&
            Number.isInteger(end) &&
            start >= 0 &&
            end >= start &&
            end <= kase.text.length,
          `trace bounds seed${seed} case${index}`
        );
        assert.ok(
          !(start > 0 && kase.text.codePointAt(start - 1) > 0xffff),
          `trace start pair seed${seed} case${index}`
        );
        assert.ok(
          !(end > 0 && kase.text.codePointAt(end - 1) > 0xffff),
          `trace end pair seed${seed} case${index}`
        );
      }
    }
  }
  if ((index + 1) % 10_000 === 0) {
    console.log(JSON.stringify({ seed, checked: index + 1 }));
  }
}
console.log(JSON.stringify({ seed, cases, formats, traces, dataRules, errors, violations: 0 }));
