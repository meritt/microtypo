import { deepFreeze } from './lib/deep-freeze.js';

export function defineRuleGroup(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('defineRuleGroup: expected an object');
  }

  // Deep-freeze: a shallow freeze leaves rule.replacement[i] = ... mutable in place.
  const rules = Array.isArray(def.rules)
    ? Object.freeze(def.rules.map((r) => deepFreeze({ ...r })))
    : Object.freeze({ ...def.rules });

  if (def.classes) {
    deepFreeze(def.classes);
  }

  return Object.freeze({ ...def, rules });
}
