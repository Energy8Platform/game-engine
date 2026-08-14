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

/**
 * Every diagnostic code this package emits, across every module. `Diagnostic.code`'s own doc says
 * tests and the IDE match on this, not on prose — this is the vocabulary that promise is made
 * against, and previously nothing exported it: an IDE wanting to render a friendlier message per code,
 * or a test wanting to assert a specific failure, had no list to work from but this file's comments.
 *
 * `tests/purity.test.ts` greps every `error(...)`/`warning(...)` call site under `src/**` and asserts
 * its literal code appears here, so a code added, renamed, or removed in one place without the other
 * fails that test — the kind of check that stays true rather than rotting into aspirational doc.
 */
export const DIAGNOSTIC_CODES = [
  // activate/* — runtime/activate.ts
  'activate/bad-contribution',
  'activate/factory-failed',
  'activate/invalid-plan',
  'activate/load-failed',
  'activate/not-a-factory',

  // hooks/* — runtime/hooks.ts
  'hooks/handler-failed',
  'hooks/not-a-function',
  'hooks/recursion-limit',
  'hooks/undeclared',
  'hooks/unknown',

  // manifest/* — manifest/define.ts
  'manifest/bad-arity',
  'manifest/bad-contribution',
  'manifest/bad-contribution-list',
  'manifest/bad-create',
  'manifest/bad-enum-options',
  'manifest/bad-field-schema',
  'manifest/bad-phase',
  'manifest/bad-point-schema',
  'manifest/bad-version',
  'manifest/duplicate-contribution',
  'manifest/enabled-collision',
  'manifest/invalid',
  'manifest/missing-doc',
  'manifest/missing-engine',
  'manifest/missing-id',

  // match/* — resolve/match.ts
  'match/predicate-threw',

  // resolve/* — resolve/resolve.ts, resolve/order.ts
  'resolve/ambiguous-activation',
  'resolve/bad-hook',
  'resolve/contribution-key-collision',
  'resolve/dependency-cycle',
  'resolve/dependency-version',
  'resolve/duplicate-plugin-id',
  'resolve/engine-mismatch',
  'resolve/invalid-manifest',
  'resolve/invalid-project',
  'resolve/missing-dependency',
  'resolve/no-activation',
  'resolve/not-in-project',
  'resolve/plugin-not-found',
  'resolve/point-conflict',
  'resolve/unknown-hook',
  'resolve/unknown-point',
  'resolve/version-mismatch',

  // schema/* — schema/validate.ts, schema/merge.ts
  'schema/bad-enum-options',
  'schema/bad-field',
  'schema/field-conflict',
  'schema/not-an-object',
  'schema/not-an-option',
  'schema/out-of-range',
  'schema/too-deep',
  'schema/type-mismatch',
  'schema/unknown-field',
] as const;

export function error(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'error', code, message };
}

export function warning(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'warning', code, message };
}

/**
 * `diagnostics` is typed as required, but this is the function callers reach for right after
 * `resolvePlan` — a null/undefined plan or a diagnostics field that is not an array (a stale object,
 * a JSON round trip that lost its shape) must degrade to `false`, not throw `.some is not a function`
 * on whatever `diagnostics` actually was. `d?.severity` — not `d.severity` — for the same reason: a
 * hostile ELEMENT (`null`, a primitive) must not itself throw reading `.severity` off it. This module
 * intentionally does not import `isPlainObject` from `schema/validate.ts` to make that check: that
 * file imports `error`/`warning` from here, and diagnostics.ts is meant to stay the dependency-free
 * base of the package, not grow a cycle back into schema/validate.ts for one property read.
 */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return Array.isArray(diagnostics) && diagnostics.some((d) => d?.severity === 'error');
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

/**
 * Describe a value's type for a "wrong type" diagnostic message, e.g. `Expected a number, got
 * ${typeName(raw)}.`. Was byte-identical in `schema/validate.ts` and `runtime/activate.ts` — the same
 * shape of duplication that produced `describeError` above, unified here for the same reason: two
 * copies of a message-formatting helper can independently rot out of sync with each other.
 *
 * Two things this used to get wrong, both silent (no test pinned either string):
 *  - `` `a ${typeof v}` `` reads "a object" and "a undefined" — wrong article before a vowel sound.
 *  - `NaN` has `typeof` `'number'`, so a NaN value reported itself as "a number" — indistinguishable
 *    from a perfectly valid number in the resulting message. It now reports itself as `NaN`, the same
 *    way `null` already reports itself as `null` rather than "a object".
 */
export function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  const word = typeof v;
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}
