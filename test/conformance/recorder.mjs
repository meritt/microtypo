import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { MicroTypo as Base } from '../../src/engine.js';
import { snapshot, Unsupported } from './snapshot.mjs';

export * from '../../src/engine.js';

// The calls a case replays, in order. Any other call that changes the engine stops it producing
// cases: `registerRuleGroup` takes rule code, which no other implementation can run.
const RECORDED = new Set(['applyOptions', 'setLayout', 'setPrefix', 'addSafeTag', 'addSafeBlock']);
const PASSED = new Set(['constructor', 'process', 'getRuleGroup', 'listRuleGroups']);

const cases = [];
const logs = new WeakMap();
// Above zero while the engine runs a constructor or a recorded call: the calls it makes to its own
// methods then are part of that call, not calls of their own.
let depth = 0;

// Appended: a capture run spawns many short-lived processes, and a reused pid must not overwrite
// what an earlier one recorded.
process.on('exit', () => {
  if (cases.length > 0) {
    appendFileSync(
      join(process.env.MICROTYPO_CAPTURE_DIR, `${process.pid}.jsonl`),
      `${cases.map((c) => JSON.stringify(c)).join('\n')}\n`
    );
  }
});

// `undefined` when the value has no JSON form that means the same.
function attempt(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Unsupported) {
      return;
    }

    throw error;
  }
}

function nested(fn) {
  depth++;

  try {
    return fn();
  } finally {
    depth--;
  }
}

export class MicroTypo extends Base {
  constructor(config) {
    const entry =
      depth === 0
        ? attempt(() =>
            config === undefined ? { ops: [] } : { config: snapshot(config), ops: [] }
          )
        : undefined;

    depth++;

    try {
      super(config);
    } catch (error) {
      depth--;

      if (entry) {
        cases.push(entry);
      }

      throw error;
    }

    depth--;

    logs.set(this, entry);
  }

  process(text, options) {
    const entry = depth === 0 && typeof text === 'string' ? logs.get(this) : undefined;
    const c =
      entry &&
      attempt(() => ({
        ...entry,
        ops: [...entry.ops],
        text,
        ...(options !== undefined && { options: snapshot(options) })
      }));

    if (c) {
      cases.push(c);
    }

    return super.process(text, options);
  }
}

for (const method of Object.getOwnPropertyNames(Base.prototype)) {
  if (PASSED.has(method)) {
    continue;
  }

  MicroTypo.prototype[method] = function (...args) {
    let entry = depth === 0 ? logs.get(this) : undefined;

    if (entry) {
      const snapped = RECORDED.has(method) ? attempt(() => args.map(snapshot)) : undefined;

      if (snapped) {
        entry.ops.push({ method, args: snapped });
      } else {
        logs.set(this, undefined);
        entry = undefined;
      }
    }

    try {
      return nested(() => Base.prototype[method].apply(this, args));
    } catch (error) {
      // A failing call is a case of its own: what it throws is part of the contract.
      if (entry) {
        cases.push({ ...entry, ops: [...entry.ops] });
      }

      throw error;
    }
  };
}
