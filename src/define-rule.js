import { deepFreeze } from './lib/deep-freeze.js';

export function defineRuleGroup(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('defineRuleGroup: expected an object');
  }

  // Deep-freeze: a shallow freeze leaves rule.replacement[i] = ... mutable in place.
  const rules = Array.isArray(def.rules)
    ? Object.freeze(def.rules.map((r) => deepFreeze({ ...r })))
    : Object.freeze({ ...def.rules });

  // `classes` is deliberately left alone: registration clones and freezes it (`snapshotRaw`), so
  // freezing it here protects nothing the engine reads and takes the caller's own object with it.
  return Object.freeze({ ...def, rules });
}
