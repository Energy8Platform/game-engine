/**
 * Diagnostics are how this package reports every failure. Nothing here throws: a bad manifest, a
 * mistyped setting or a broken factory becomes a value that travels to the IDE and to the player-
 * facing error screen. The previous editor lost patch rejections silently; that class of bug is
 * designed out by making refusal a return value.
 */

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine code, e.g. 'schema/type-mismatch'. Tests and the IDE match on this, not on prose. */
  code: string;
  /** Human-readable sentence, shown verbatim in the IDE. */
  message: string;
  pluginId?: string;
  pointId?: string;
  contributionId?: string;
  /** Dotted path inside the value being validated, e.g. 'motion.speed' or 'stops[1]'. */
  path?: string;
  /** Actionable next step, shown verbatim in the IDE. */
  fix?: string;
}

export function error(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'error', code, message };
}

export function warning(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'warning', code, message };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/**
 * Describe an unknown thrown/rejected value for a diagnostic message. Never throws itself — which
 * `err instanceof Error ? err.message : String(err)` (this package's original idiom, duplicated
 * verbatim in `runtime/activate.ts` and `runtime/hooks.ts`) is NOT: `String(err)` throws
 * `TypeError: Cannot convert object to primitive value` for a value with no `toString`/`valueOf`/
 * `Symbol.toPrimitive` anywhere on its chain — most plainly `Object.create(null)` — and `err
 * instanceof Error` can itself throw first, against a Proxy whose `getPrototypeOf` trap throws.
 * Both call sites hand a plugin's own thrown value to this function, so both need the same total
 * one, not two copies that can independently rot out of sync with each other.
 */
export function describeError(err: unknown): string {
  try {
    if (err instanceof Error && typeof err.message === 'string') return err.message;
  } catch {
    // `err instanceof Error` itself threw (an exotic Proxy) — fall through to String().
  }
  try {
    return String(err);
  } catch {
    // No toString/valueOf/Symbol.toPrimitive on err's chain (e.g. Object.create(null)).
    // Object.prototype.toString.call never needs those — it reads err's internal slot/tag directly.
    return Object.prototype.toString.call(err);
  }
}
