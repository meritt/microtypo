import { ruleTraceOf } from './rule-trace.js';

const CHECKERS = new WeakMap();

export function bindRuleBudget(ctx, checkBudget) {
  CHECKERS.set(ctx, checkBudget);
}

export function ruleBudgetOf(ctx) {
  return CHECKERS.get(ctx);
}

export function executeRule(rule, text, ctx, checkBudget, projection) {
  const trace = ruleTraceOf(ctx);
  const output =
    trace === undefined
      ? rule.apply(text, ctx, checkBudget)
      : trace.execute(
          text,
          () => rule.apply(text, ctx, checkBudget),
          rule.kind === undefined,
          projection
        );
  checkBudget?.(rule.budgetStage);
  return output;
}
