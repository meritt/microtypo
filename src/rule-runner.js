import { MicroTypoConfigError } from './errors/index.js';
import { applyRule, beginGroup, endGroup, mayLift } from './inline-lift.js';
import { deepFreeze } from './lib/deep-freeze.js';
import { executeRule } from './lib/rule-budget.js';
import { hasRequiredFeatures } from './lib/rule-features.js';
import { ruleTraceOf, stringReplacement } from './lib/rule-trace.js';
import { cycle } from './lib/strings.js';
import { dataPattern } from './schemas/data-rules.js';

const MAX_CYCLE_ITER = 100;

export function compileRuleGroup(groupDef, name) {
  if (!Array.isArray(groupDef.rules)) {
    throw new TypeError(`Rule group '${name}': rules must be an array`);
  }

  const compiledRules = groupDef.rules.map((rule) => compileRule(rule, name));

  const compiled = {
    name,
    budgetStage: `group:${name}`,
    title: groupDef.title || name,
    raw: snapshotRaw(groupDef),
    compiledRules,
    enabledOverride: new Map(), // ruleId → true(force-on) / false(force-off)
    settings: {}
  };

  // What a rule handler is given as `ctx.group`, and never the compiled object itself: a handler
  // setting `builtin` on that object would mark its own group trusted and skip the forgery scrub.
  // Settings stay the live object, so config applied after registration is still read; `raw` is
  // frozen at registration already.
  compiled.view = Object.freeze({
    name: compiled.name,
    title: compiled.title,
    settings: compiled.settings,
    raw: compiled.raw
  });

  return compiled;
}

// Clone+freeze: a live reference would let post-registration mutation change registered output.
function snapshotRaw(groupDef) {
  let classes;

  if (groupDef.classes) {
    try {
      classes = deepFreeze(structuredClone(groupDef.classes));
    } catch {
      throw new TypeError('Rule group: classes must be a structured-cloneable value (plain data)');
    }
  }

  return Object.freeze({
    classes,
    preParse: typeof groupDef.preParse === 'function' ? groupDef.preParse : undefined
  });
}

function compileRule(rule, groupName) {
  if (!rule || typeof rule !== 'object') {
    throw new TypeError(`Rule group '${groupName}': rule must be an object`);
  }

  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    throw new TypeError(`Rule group '${groupName}': rule.id must be a non-empty string`);
  }

  const apply = makeApplyFn(rule, groupName);
  const cycled = Boolean(rule.cycled);
  const { id, requiresPattern } = rule;

  const wrapped = cycled
    ? (text, ctx, checkBudget) =>
        cycle(
          text,
          (t) => apply(t, ctx),
          MAX_CYCLE_ITER,
          (n) => {
            if (typeof ctx.onCycleLimit === 'function') {
              ctx.onCycleLimit(id, n);
            }
          },
          checkBudget
        )
    : apply;

  return {
    id,
    groupName,
    kind: typeof rule.handler === 'function' ? 'handler' : 'regex',
    budgetStage: `group:${groupName}`,
    defaultEnabled: rule.enabled !== false,
    description: rule.description ?? '',
    htmlOnly: Boolean(rule.htmlOnly),
    requires: rule.requires ?? 0,
    requiresAny: rule.requiresAny ?? 0,
    requiresPattern:
      requiresPattern instanceof RegExp
        ? new RegExp(requiresPattern.source, requiresPattern.flags.replace(/[gy]/g, ''))
        : null,
    apply: wrapped
  };
}

function makeApplyFn(rule, groupName) {
  if (typeof rule.handler === 'function') {
    if (rule.pattern != null || rule.replacement != null) {
      throw new TypeError(
        `Rule '${groupName}.${rule.id}': handler is exclusive — drop pattern/replacement`
      );
    }

    // Captured, not read through `rule`: a live reference lets post-registration mutation change
    // registered output, which snapshotRaw already denies to classes and preParse.
    const { handler } = rule;

    const invoke = (text, ctx) => {
      ctx.text = text;
      const r = handler(ctx);
      return typeof r === 'string' ? r : ctx.text;
    };
    return (text, ctx) => {
      const trace = ruleTraceOf(ctx);

      return trace === undefined ? invoke(text, ctx) : trace.handler(text, () => invoke(text, ctx));
    };
  }

  if (rule.pattern == null) {
    throw new TypeError(
      `Rule '${groupName}.${rule.id}': must define either { pattern, replacement } or { handler }`
    );
  }

  const patterns = (Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern]).map((pattern) =>
    pattern instanceof RegExp || pattern === null || typeof pattern !== 'object'
      ? pattern
      : dataPattern(pattern)
  );
  const hasDataPattern = (Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern]).some(
    (pattern) => pattern !== null && typeof pattern === 'object' && !(pattern instanceof RegExp)
  );
  if (
    hasDataPattern &&
    !(
      typeof rule.replacement === 'string' ||
      (Array.isArray(rule.replacement) &&
        rule.replacement.every((replacement) => typeof replacement === 'string'))
    )
  ) {
    throw new MicroTypoConfigError('data rule replacement must be a string', {
      details: { rule: `${groupName}.${rule.id}` }
    });
  }

  for (const p of patterns) {
    if (!(p instanceof RegExp)) {
      throw new TypeError(
        `Rule '${groupName}.${rule.id}': pattern must be RegExp (got ${typeof p})`
      );
    }
  }

  let replacements;

  if (Array.isArray(rule.replacement)) {
    if (rule.replacement.length !== patterns.length) {
      throw new TypeError(
        `Rule '${groupName}.${rule.id}': replacement array length (${rule.replacement.length}) must match pattern array length (${patterns.length})`
      );
    }

    // Copy so caller-side mutation of the replacement array can't change compiled output.
    replacements = Object.freeze([...rule.replacement]);
  } else {
    replacements = Array(patterns.length).fill(rule.replacement);
  }

  const steps = patterns.map((pattern, index) => {
    const re = ensureGlobal(pattern);
    const replacement = replacements[index];

    if (typeof replacement === 'string' || replacement == null) {
      return (result, ctx) => {
        const trace = ruleTraceOf(ctx);
        if (trace !== undefined) {
          re.lastIndex = 0;
          return trace.replace(result, re, (args) => stringReplacement(replacement ?? '', args));
        }
        if (typeof result === 'string') {
          re.lastIndex = 0;
          if (!re.test(result)) {
            return result;
          }
          re.lastIndex = 0;
        }
        return result.replace(re, replacement ?? '');
      };
    }

    if (typeof replacement !== 'function') {
      return (result, ctx) => {
        const trace = ruleTraceOf(ctx);
        if (trace !== undefined) {
          re.lastIndex = 0;
          const template = `${replacement}`;
          return trace.replace(result, re, (args) => stringReplacement(template, args));
        }
        return result.replace(re, replacement);
      };
    }

    return (result, ctx) => {
      const trace = ruleTraceOf(ctx);
      if (trace !== undefined) {
        re.lastIndex = 0;
        return trace.replace(result, re, (args) => replacement(args, ctx));
      }
      if (typeof result === 'string') {
        re.lastIndex = 0;
        if (!re.test(result)) {
          return result;
        }
        re.lastIndex = 0;
      }
      return result.replace(re, (...args) => replacement(args, ctx));
    };
  });

  if (steps.length === 1) {
    return steps[0];
  }

  return (text, ctx) => {
    let result = text;

    for (const step of steps) {
      result = step(result, ctx);
    }

    return result;
  };
}

// Always a fresh RegExp, never the caller's: handing back their object leaves the compiled rule
// reading a live reference — the same door the captured handler above closes — and inherits
// whatever lastIndex they left on it.
function ensureGlobal(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

// A step `{ id, apply }` the engine takes on a fragment before its groups, run as a rule of a builtin
// group. A text with nothing to lift takes it as it is: a custom group may yet add markup to it.
export function runStep(step, text, ctx, keep, inline, features = null, checkBudget = null) {
  const trace = ruleTraceOf(ctx);
  trace?.begin({ ...step, groupName: ctx.group.name }, text);
  const result = runStepBody(step, text, ctx, keep, inline, features, checkBudget);
  trace?.finish(result);
  return result;
}

function runStepBody(step, text, ctx, keep, inline, features, checkBudget) {
  if (features !== null && !hasRequiredFeatures(step, text, features, false)) {
    return text;
  }
  if (inline === null || !mayLift(text, inline)) {
    if (features !== null && !hasRequiredFeatures(step, text, features)) {
      return text;
    }
    const output = executeRule(step, text, ctx, checkBudget);
    ruleTraceOf(ctx)?.accept();
    return output;
  }

  const lifted = beginGroup(text, inline, ctx);

  if (lifted === null) {
    const output = executeRule(step, text, ctx, checkBudget);
    ruleTraceOf(ctx)?.accept();
    return output;
  }

  applyRule(lifted, step, ctx, keep, inline, features, checkBudget);

  return endGroup(lifted, inline);
}

// `keep(before, after, rerun)` settles what one rule's change leaves in the text; see
// `SafeSequences.keep`. `inline` is the fragment's lifting of inline markup, given to builtin groups
// only: each rule runs on the text without the markup first (see `inline-lift.js`).
export function runRuleGroup(
  compiled,
  text,
  ctx,
  keep = null,
  inline = null,
  features = null,
  checkBudget = null
) {
  ctx.text = text;
  ctx.group = compiled.view;

  if (compiled.raw.preParse) {
    compiled.raw.preParse(ctx);
    checkBudget?.(compiled.budgetStage);
  }

  const lifted = inline !== null && keep !== null ? beginGroup(ctx.text, inline, ctx) : null;
  const trace = ruleTraceOf(ctx);

  for (const rule of compiled.compiledRules) {
    if (!isRuleEnabled(compiled, rule)) {
      continue;
    }

    // htmlOnly rules must not fire under html:false, or they emit a marker-stripped fragment.
    if (rule.htmlOnly && !ctx.html) {
      continue;
    }

    if (lifted !== null) {
      trace?.begin(rule, endGroup(lifted, inline));
      applyRule(lifted, rule, ctx, keep, inline, features, checkBudget);
      trace?.finish(endGroup(lifted, inline));
      continue;
    }

    if (features !== null && !hasRequiredFeatures(rule, ctx.text, features)) {
      continue;
    }

    const input = ctx.text;
    trace?.begin(rule, input);
    const output = executeRule(rule, input, ctx, checkBudget);
    const next =
      keep === null ? output : keep(input, output, (t) => executeRule(rule, t, ctx, checkBudget));
    ctx.text = next;
    trace?.accept();
    trace?.finish(next);
  }

  if (lifted !== null) {
    ctx.text = endGroup(lifted, inline);
  }

  return ctx.text;
}

// Read-only descriptor, never the live compiled group whose mutation would change future output.
export function describeRuleGroup(compiled) {
  return Object.freeze({
    name: compiled.name,
    title: compiled.title,
    builtin: Boolean(compiled.builtin),
    rules: Object.freeze(
      compiled.compiledRules.map((rule) =>
        Object.freeze({ id: rule.id, defaultEnabled: rule.defaultEnabled })
      )
    )
  });
}

export function isRuleOn(compiled, id) {
  const rule = compiled.compiledRules.find((r) => r.id === id);

  return rule !== undefined && isRuleEnabled(compiled, rule);
}

export function canRunRuleGroup(compiled, text, features, html) {
  return compiled.compiledRules.some(
    (rule) =>
      isRuleEnabled(compiled, rule) &&
      (!rule.htmlOnly || html) &&
      hasRequiredFeatures(rule, text, features, false)
  );
}

function isRuleEnabled(compiled, rule) {
  const override = compiled.enabledOverride.get(rule.id);

  if (override === true) {
    return true;
  }

  if (override === false) {
    return false;
  }

  return rule.defaultEnabled;
}
