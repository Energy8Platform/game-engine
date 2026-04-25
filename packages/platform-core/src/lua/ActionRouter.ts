import type { ActionDefinition, TransitionRule, GameDefinition } from './types';

export interface TransitionMatch {
  rule: TransitionRule;
  nextActions: string[];
}

/**
 * Replicates the platform's action dispatch and transition evaluation.
 * Routes play requests to the correct action, evaluates transition conditions
 * against current variables to determine next actions and session operations.
 */
export class ActionRouter {
  private actions: Record<string, ActionDefinition>;

  constructor(gameDefinition: GameDefinition) {
    this.actions = gameDefinition.actions;
  }

  /** Look up action by name and validate prerequisites */
  resolveAction(actionName: string, hasSession: boolean): ActionDefinition {
    const action = this.actions[actionName];
    if (!action) {
      throw new Error(`Unknown action: "${actionName}". Available: ${Object.keys(this.actions).join(', ')}`);
    }
    if (action.requires_session && !hasSession) {
      throw new Error(`Action "${actionName}" requires an active session`);
    }
    return action;
  }

  /** Evaluate transitions in order, return the first matching rule */
  evaluateTransitions(
    action: ActionDefinition,
    variables: Record<string, number>,
  ): TransitionMatch {
    for (const rule of action.transitions) {
      if (evaluateCondition(rule.condition, variables)) {
        return { rule, nextActions: rule.next_actions };
      }
    }
    throw new Error(
      `No matching transition for action with stage "${action.stage}". ` +
      `Variables: ${JSON.stringify(variables)}`
    );
  }
}

// ─── Condition Evaluator ────────────────────────────────

/**
 * Evaluates a transition condition expression against variables.
 *
 * Supports:
 * - "always" → true
 * - Simple comparisons: "var > 0", "var == 1", "var >= 10", "var != 0", "var < 5", "var <= 3"
 * - Logical connectives: "expr && expr", "expr || expr"
 *
 * This covers all patterns used by the platform's govaluate conditions.
 */
export function evaluateCondition(
  condition: string,
  variables: Record<string, number>,
): boolean {
  const trimmed = condition.trim();

  if (trimmed === 'always') return true;

  // Handle || (OR) — lowest precedence
  if (trimmed.includes('||')) {
    const parts = splitOnOperator(trimmed, '||');
    return parts.some(part => evaluateCondition(part, variables));
  }

  // Handle && (AND)
  if (trimmed.includes('&&')) {
    const parts = splitOnOperator(trimmed, '&&');
    return parts.every(part => evaluateCondition(part, variables));
  }

  // Single comparison: "variable op value"
  return evaluateComparison(trimmed, variables);
}

function splitOnOperator(expr: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;

    if (depth === 0 && expr.substring(i, i + operator.length) === operator) {
      parts.push(current);
      current = '';
      i += operator.length - 1;
    } else {
      current += expr[i];
    }
  }
  parts.push(current);
  return parts;
}

function evaluateComparison(
  expr: string,
  variables: Record<string, number>,
): boolean {
  // Match: variable_name operator value
  const match = expr.trim().match(
    /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|!=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/
  );

  if (!match) {
    throw new Error(`Cannot parse condition: "${expr}"`);
  }

  const [, varName, op, valueStr] = match;
  const left = variables[varName] ?? 0;
  const right = parseFloat(valueStr);

  switch (op) {
    case '>':  return left > right;
    case '>=': return left >= right;
    case '<':  return left < right;
    case '<=': return left <= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default:   return false;
  }
}
