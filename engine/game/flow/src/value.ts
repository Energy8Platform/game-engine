import { evaluateValue } from './expr';

const TEMPLATE = /\{([^{}]*)\}/g;

/**
 * A prop value: a string with `{…}` spans is a template (each span an
 * expression, `String()`ed — a missing var reads as `''`, not `null`),
 * a string starting with `$` is an expression, anything else the literal.
 * A `SyntaxError` (an unknown format included) calls `report` and answers
 * the string AS WRITTEN — the kind's own type check then names the prop.
 */
export function resolveValue(
  value: unknown,
  vars: Record<string, unknown>,
  report?: (message: string) => void,
): unknown {
  if (typeof value !== 'string') return value;
  try {
    if (/\{[^{}]*\}/.test(value)) {
      return value.replace(TEMPLATE, (_m, expr: string) => {
        const v = evaluateValue(expr, vars);
        return v === null || v === undefined ? '' : String(v);
      });
    }
    if (value.startsWith('$')) return evaluateValue(value, vars);
    return value;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    report?.(`bad value '${value}': ${e.message}`);
    return value;
  }
}
