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
 *
 * Fix round 2: `Object.prototype.toString.call(err)` — the previous last-resort fallback — is not
 * actually a dead end either. It performs its own `[[Get]]` of `err[Symbol.toStringTag]` to decide
 * what to print, and a PLAIN object (no Proxy required) with a throwing getter for that symbol
 * breaks it too — confirmed by running `{ get [Symbol.toStringTag]() { throw new Error('boom'); } }`
 * through it. Wrapped in its own try, with a fourth level — a constant that touches nothing on
 * `err` at all — below it, so there is truly nowhere left to throw from.
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
    // No toString/valueOf/Symbol.toPrimitive on err's chain (e.g. Object.create(null)) — fall
    // through to Object.prototype.toString.call, which does not need any of those.
  }
  try {
    return Object.prototype.toString.call(err);
  } catch {
    // Even this can throw: it reads err[Symbol.toStringTag], and a plain object can define that as
    // a getter that throws. Nothing left to try that still reads anything off `err`.
  }
  return 'a value that cannot be described';
}
