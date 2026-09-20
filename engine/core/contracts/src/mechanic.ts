import { type Diagnostic, diagnostic } from './diagnostic';
import type { Board, KnownPresentationStep, PresentationPlan } from './presentation';

/**
 * A stage field's shape, not its meaning. Kept to exactly the three kinds
 * the measured math result actually produces (see the module doc below) —
 * do not add a fourth speculatively; let the mechanic that needs one force
 * the addition.
 *
 * `list` means "is an array" — any length, any element type. It does not
 * require non-empty: a losing spin's `lines` and a non-cascading spin's
 * `cascade_history` are legitimately `[]`, and rejecting that would raise
 * a false alarm on a perfectly-shaped game that simply didn't win this
 * particular sample. A game that structurally never produces the field at
 * all is already caught by the separate "field absent from sample" check
 * in `checkShape`, so an emptiness rule on top of that buys no extra
 * diagnostic power — only false positives. One consequence worth knowing:
 * a single sample cannot tell "this game never produces `cascade_history`"
 * apart from "this spin did not cascade" when the sample itself is a
 * non-cascading round — both look like `[]`. Telling those apart needs
 * the game's declared `.spin` schema, not a sample; that's a later plan.
 *
 * `grid` carries the exact same emptiness rule as `list`, for the exact
 * same reason — it isn't called out separately below only because no
 * shipped game happens to exercise it yet. `isGrid`'s `[].every(...)` is
 * vacuously true, so `[]` (or a grid whose rows are themselves empty,
 * `[[]]`) passes as a well-shaped grid. A 0×0 board is not a realistic
 * spin result today, but the same argument as `list`'s applies: a mechanic
 * that structurally never sees a grid at all is already caught by the
 * "field missing from the sample entirely" branch in `checkShape`, so
 * rejecting an empty one here would only manufacture a false alarm, never
 * catch a real one.
 */
export type FieldKind = 'number' | 'grid' | 'list';

/**
 * What one mechanic needs from a stage's spin data before it can run, e.g.
 * `classic` needs `{ grid: 'grid', lines: 'list' }` and `cascade` needs
 * `{ cascade_history: 'list' }`. `checkShape` compares this against a
 * sample of the actual measured shape.
 */
export interface SpinShapeRequirement {
  fields: Record<string, FieldKind>;
}

/**
 * A mechanic as the board runs it: it turns one stage's spin data into an
 * ordered script for the board (the step vocabulary — see
 * `presentation.ts`), and it declares up front what that stage's data must
 * contain via `requires`, so `checkShape` can catch a mismatch before the
 * player ever clicks spin instead of leaving a blank board after.
 *
 * **`TStep` is how a mechanic brings a step kind the engine has never heard
 * of.** Leave it off and `present` returns exactly `PresentationPlan` — the
 * four built-in kinds and nothing else, which is what `classic` and
 * `cascade` are and what this interface has always meant. Name your own
 * step type and `present` returns the four PLUS that one:
 *
 * ```ts
 * interface ReelStepStep { kind: 'reelStep'; shifts: number[]; settled: Board }
 * export const mechanic: SpinMechanic<ReelStepStep> = { … };
 * ```
 *
 * A type PARAMETER rather than simply widening `present` to
 * `PresentationStep[]`, and the difference is not stylistic — it is the one
 * property this contract cannot afford to lose. `PresentationStep` includes
 * `UnknownPresentationStep`, whose index signature absorbs any object
 * literal: widen `present` to it and `present: () => [{ kind: 'spinTo',
 * boardTYPO: … }]` compiles clean, in every mechanic, forever (the same
 * trap `UnknownPresentationStep`'s own doc describes, and the reason
 * `PresentationPlan` is not built from it). With a parameter, the only
 * extra shape a mechanic's literals are checked against is the one that
 * mechanic itself declared — so its own step matches precisely and a
 * mistyped `spinTo` still has nowhere to hide. Both halves are pinned by
 * `tests/mechanic-open.test.ts`, at compile time.
 *
 * Declare `TStep` as a plain interface, not one extending
 * `UnknownPresentationStep` — see `StepHandler` in
 * `@energy8engine/play-loop` for what that `extends` silently costs.
 */
export interface SpinMechanic<TStep extends { kind: string } = never> {
  id: string;
  /**
   * The FIELDS this mechanic's stage data must carry, checked against the
   * math's `.spin` schema by `checkShape`/`checkAgainstSchema`.
   *
   * Not the other `requires` in this package. `E8RuntimeHalf.requires`
   * (`./manifest.ts`) is a row's list of SERVICE names, checked after the
   * whole composition has applied. The two are read fifteen lines apart in
   * `@energy8engine/game-runtime`'s `createGame`, they share a word and
   * nothing else: different subject (a data shape vs. a service), different
   * checker, different moment. Whichever one you are reading, the other is
   * probably not the one you meant.
   */
  requires: SpinShapeRequirement;
  /**
   * `options.tumble` (slice 25) is additive: it exists for `cascade`, which
   * reads it to choose `tumble` steps over `remove`+`refill` (see
   * `@energy8engine/mechanic-cascade`'s own doc). A mechanic that has no use
   * for it — `classic`, a plugin's own — simply declares one parameter and
   * ignores the second; nothing calls `present` positionally in a way that
   * would break by adding it.
   */
  present(data: unknown, options?: { tumble?: boolean }): (KnownPresentationStep | TStep)[];
}

/**
 * A mechanic as a REGISTRY holds one: it may emit any step kind, because a
 * registry stores mechanics it did not write and cannot name their step
 * types. Every `SpinMechanic<T>` is assignable to this, including the
 * default `SpinMechanic`.
 *
 * This is the type to store and hand back, never the type to author a
 * mechanic against — and the reason is the opposite of the one you might
 * expect from `UnknownPresentationStep`. Measured, not reasoned:
 *
 *   - `KnownPresentationStep | { kind: string }` **rejects** a typo'd
 *     built-in, `{ kind: 'spinTo', boardTYPO: 1 }` — `TS2353`. It does not
 *     absorb one. That absorption is `UnknownPresentationStep`'s doing, and
 *     it comes from its INDEX SIGNATURE, which `{ kind: string }` does not
 *     have.
 *   - It also rejects a plugin's own fields, `{ kind: 'reelStep',
 *     shifts: [1] }` — `TS2353` again, "'shifts' does not exist in type
 *     '{ kind: string; }'". So it is too STRICT to author against, not too
 *     loose: a mechanic written against it could not write its own step at
 *     all. That is precisely the design task 7 tried and rejected, and it
 *     is why `TStep` exists.
 *   - As a STORAGE type it is exactly right: an existing value of any
 *     `SpinMechanic<T>` widens into it by ordinary structural subtyping,
 *     with no excess-property check involved, because nothing assigns a
 *     fresh object literal here.
 *
 * All three are pinned in `tests/mechanic-open.test.ts`.
 */
export type AnySpinMechanic = SpinMechanic<{ kind: string }>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One `Board` leaf, mirrored from `presentation.ts`'s own (private) leaf
 * check rather than imported from it — see `matchesFieldKind`'s doc for why
 * the value-level and type-level checks stay two separate, hand-kept-in-
 * sync functions instead of one shared one. A leaf is a finite number, a
 * symbol name, or a record whose `symbol` is a finite number, a name, or
 * `null`.
 */
function isBoardLeaf(value: unknown): boolean {
  return (
    isFiniteNumber(value) ||
    typeof value === 'string' ||
    (isRecord(value) &&
      (value.symbol === null || isFiniteNumber(value.symbol) || typeof value.symbol === 'string'))
  );
}

function isGrid(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every(isBoardLeaf))
  );
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function matchesKind(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'number':
      return isFiniteNumber(value);
    case 'grid':
      return isGrid(value);
    case 'list':
      return isList(value);
  }
}

/**
 * Checks a stage's requirement against a sample of the measured spin data,
 * this is the pre-flight §7.1 refers to as "`expects` checked before run":
 * a mechanic declares the fields it needs, and a mismatch becomes a
 * `Diagnostic` naming the mechanic, the stage and the field — not a blank
 * board discovered after the player clicks spin.
 *
 * Reports every mismatched field, not just the first, so the composition
 * screen shows the whole gap in one pass.
 *
 * A `list` field only checks "is this an array" (see `FieldKind`'s doc
 * comment) — an empty array passes. That means this check can confirm a
 * field is well-shaped, but a single sample can never prove a field is
 * *always* absent for a game versus merely empty on this one spin; only
 * the "field missing from the sample entirely" branch below makes that
 * claim, and only about the one sample it was given.
 */
export function checkShape(
  req: SpinShapeRequirement,
  sample: Record<string, unknown>,
  mechanicId: string,
  stage: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [field, kind] of Object.entries(req.fields)) {
    if (!(field in sample)) {
      diagnostics.push(
        diagnostic(
          'error',
          mechanicId,
          stage,
          `mechanic "${mechanicId}" needs field "${field}" (${kind}) on stage "${stage}", but it is missing`,
        ),
      );
      continue;
    }

    const value = sample[field];
    if (!matchesKind(kind, value)) {
      diagnostics.push(
        diagnostic(
          'error',
          mechanicId,
          stage,
          `mechanic "${mechanicId}" needs field "${field}" to be a ${kind} on stage "${stage}", but it is not`,
        ),
      );
    }
  }

  return diagnostics;
}
