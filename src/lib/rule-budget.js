const CHECKERS = new WeakMap();

export function bindRuleBudget(ctx, checkBudget) {
  CHECKERS.set(ctx, checkBudget);
}

export function ruleBudgetOf(ctx) {
  return CHECKERS.get(ctx);
}

export function executeRule(rule, text, ctx, checkBudget) {
  const output = rule.apply(text, ctx, checkBudget);
  checkBudget?.(rule.budgetStage);
  return output;
}
