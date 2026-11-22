// Which rules a case actually exercises: a rule counts when switching it changes the output. The
// other rules stay as they are by default, and a rule off by default is measured switched on alone:
// with every rule on, `nobr.nowrap_hyphen` wraps whatever `nobr.nowrap_hyphen_short` would, and the
// shorter rule could never count.
//
// Trying all rules on every case costs a hundred runs per case. The engine copy records instead each
// rule that changed the text at its own step: a rule that did not cannot change the output when
// switched off, so only the recorded ones are tried.
import { DEFAULT_GROUPS } from '../../../src/rules/registry.js';
import { TRACE } from './engine.mjs';
import { withRuleOff } from './shrink.mjs';

export const RULE_IDS = DEFAULT_GROUPS.flatMap(([group, def]) =>
  def.rules.map((rule) => `${group}.${rule.id}`)
);

const OFF_BY_DEFAULT = DEFAULT_GROUPS.flatMap(([group, def]) =>
  def.rules.filter((rule) => rule.enabled === false).map((rule) => `${group}.${rule.id}`)
);

// The case's own configuration with the rules as they are by default: its format, markup and render
// settings decide where a rule can fire, its rule switches would hide rules from the count.
function coverageConfig({ rules: _rules, presets: _presets, ...config }) {
  return config;
}

// `cover(case)` is the rules the case exercises, or null when the engine rejects the case.
export function createCoverage(MicroTypo, restart) {
  const trace = new Set();
  const run = (config, text) => {
    restart();
    return new MicroTypo(config).process(text);
  };

  return function cover(kase) {
    const config = coverageConfig(kase.config);
    let out;

    trace.clear();
    globalThis[TRACE] = trace;

    try {
      out = run(config, kase.text);
    } catch {
      return null;
    } finally {
      globalThis[TRACE] = undefined;
    }

    const changes = (variant) => {
      try {
        return run(variant, kase.text) !== out;
      } catch {
        return true;
      }
    };

    return [
      ...[...trace].filter((rule) => changes(withRuleOff(config, rule))),
      ...OFF_BY_DEFAULT.filter(
        (rule) => !trace.has(rule) && changes({ ...config, rules: { [rule]: true } })
      )
    ];
  };
}
