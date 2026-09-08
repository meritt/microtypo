import { deepFreeze } from './lib/deep-freeze.js';
import { cycle } from './lib/strings.js';

const MAX_CYCLE_ITER = 100;

export function compileRuleGroup(groupDef, name) {
  if (!Array.isArray(groupDef.rules)) {
    throw new TypeError(`Rule group '${name}': rules must be an array`);
  }

  const compiledRules = groupDef.rules.map((rule) => compileRule(rule, name));

  const compiled = {
    name,
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
  const { id } = rule;

  const wrapped = cycled
    ? (text, ctx) =>
        cycle(
          text,
          (t) => apply(t, ctx),
          MAX_CYCLE_ITER,
          (n) => {
            if (typeof ctx.onCycleLimit === 'function') {
              ctx.onCycleLimit(id, n);
            }
          },
          ctx.checkBudget
        )
    : apply;

  return {
    id,
    defaultEnabled: rule.enabled !== false,
    description: rule.description ?? '',
    htmlOnly: Boolean(rule.htmlOnly),
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

    return (text, ctx) => {
      ctx.text = text;
      const r = handler(ctx);

      return typeof r === 'string' ? r : ctx.text;
    };
  }

  if (rule.pattern == null) {
    throw new TypeError(
      `Rule '${groupName}.${rule.id}': must define either { pattern, replacement } or { handler }`
    );
  }

  const patterns = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];

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

  const compiledPatterns = patterns.map(ensureGlobal);

  return (text, ctx) => {
    let result = text;

    for (let i = 0; i < compiledPatterns.length; i++) {
      const re = compiledPatterns[i];
      const repl = replacements[i];

      if (typeof repl === 'function') {
        result = result.replace(re, (...args) => repl(args, ctx));
      } else {
        result = result.replace(re, repl ?? '');
      }
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

export function runRuleGroup(compiled, text, ctx) {
  ctx.text = text;
  ctx.group = compiled.view;

  if (compiled.raw.preParse) {
    compiled.raw.preParse(ctx);
  }

  for (const rule of compiled.compiledRules) {
    if (!isRuleEnabled(compiled, rule)) {
      continue;
    }

    // htmlOnly rules must not fire under html:false, or they emit a marker-stripped fragment.
    if (rule.htmlOnly && !ctx.html) {
      continue;
    }

    ctx.text = rule.apply(ctx.text, ctx);
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
