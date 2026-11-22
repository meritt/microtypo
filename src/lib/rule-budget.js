import { ruleTraceOf } from './rule-trace.js';
import { sessionMap } from './session-maps.js';

const CHECKERS = sessionMap();

export function bindRuleBudget(ctx, checkBudget) {
  CHECKERS.set(ctx, checkBudget);
}

export function ruleBudgetOf(ctx) {
  return CHECKERS.get(ctx);
}

function executeRule(rule, text, ctx, checkBudget, projection) {
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

// `keep(before, after, rerun)` settles what the rule's change leaves in the text; see
// `SafeSequences.keep`.
export function executeKeptRule(rule, text, ctx, keep, checkBudget, projection) {
  const output = executeRule(rule, text, ctx, checkBudget, projection);
  return keep === null ? output : keep(text, output, (t) => executeRule(rule, t, ctx, checkBudget));
}
