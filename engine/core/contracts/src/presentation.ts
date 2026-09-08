/**
 * The vocabulary of presentation steps every mechanic must express itself in.
 * A mechanic doesn't animate — it emits a `PresentationPlan`, and the board
 * executes it.
 *
 * `PresentationPlan` (what `classic`/`cascade` actually emit) stays the
 * closed four-kind vocabulary below — that is deliberate, see
 * `KnownPresentationStep`'s own doc. `PresentationStep` (what a board, a
 * `BoardStepRegistry`, and `executePlan` accept) is wider: a plugin's step
 * only needs a `kind` and its own fields, no edit to this file. See
 * `UnknownPresentationStep`'s doc for why those two are different types
 * rather than one, and `@energy8engine/play-loop`'s `BoardStepRegistry` for
 * where a plugin's step actually gets a handler.
 *
 * Two different numbers are both, informally, "the total" — do not confuse
 * them, because the next implementer meets both within one function:
 *   - The spin result's `win`/`totalWin` is what the host credits to the
 *     player's balance. The play loop reports it straight from the math
 *     engine's result. No presentation step carries it — crediting is not a
 *     presentation concern, and no step in this file means "pay the
 *     player."
 *   - `RevealWinsStep.total` is a different number: the amount that *one
 *     reveal* accounts for (a classic spin's `base_win`, or one cascade
 *     round's `win`) — what the player watches add up as that reveal
 *     plays. It is not the credited total, and in a multi-round cascade it
 *     is only one round's share of it.
 */

/** A full grid snapshot, `board[col][row]` holding a symbol id. */
export type Board = number[][];

/** A grid position, addressed the same way `cascade_history.removed` already is. */
export interface Cell {
  col: number;
  row: number;
}

/**
 * One winning line as the player reads it, not how it was scored. Field
 * names match the math engine's measured result shape (`symbol`, `count`,
 * `win`, `positions`) on purpose, so nothing has to translate between them.
 */
export interface RevealedLine {
  line: number;
  symbol: number;
  count: number;
  win: number;
  /** The cells that light up for this line. */
  positions: Cell[];
}

/** The reels land showing exactly this grid. */
export interface SpinToStep {
  kind: 'spinTo';
  board: Board;
}

/** The winning lines light up, each carrying what it paid. */
export interface RevealWinsStep {
  kind: 'revealWins';
  /**
   * The amount this reveal accounts for — a classic spin's `base_win`, or
   * one cascade round's `win`. Not the credited total; see the module doc
   * comment above.
   */
  total: number;
  /** Empty when the math gives no per-line breakdown for this reveal. */
  lines: RevealedLine[];
}

/** These cells disappear from the board. */
export interface RemoveStep {
  kind: 'remove';
  cells: Cell[];
}

/** New symbols drop in and the board reads as this grid again. */
export interface RefillStep {
  kind: 'refill';
  board: Board;
}

/**
 * One of the four steps `classic`/`cascade` actually stand on — see the
 * module doc. Kept as its own named union (rather than folding straight
 * into `PresentationStep` below) because `PresentationPlan` is defined from
 * THIS type, not from `PresentationStep`: a mechanic's `steps.push({ kind:
 * 'spinTo', ...typo })` must still fail to compile, and it only does
 * because `PresentationPlan`'s element type has no open member for a typo'd
 * literal to quietly match instead. See `UnknownPresentationStep`'s doc for
 * the mechanism that would otherwise defeat that.
 *
 * It was six. `setMultiplier` and `wait` were built before any mechanic
 * asked for them, nothing ever emitted either, and they are gone — see
 * `KNOWN_STEP_KINDS`.
 */
export type KnownPresentationStep = SpinToStep | RevealWinsStep | RemoveStep | RefillStep;

/**
 * A step naming any OTHER kind — a plugin's, task 9's `reelStep` among
 * them. Only `kind` is required; everything else is between the plugin's
 * mechanic and its `StepHandler` (`@energy8engine/play-loop`), neither of
 * which this package knows about.
 *
 * This is deliberately not merged into `KnownPresentationStep` to form
 * `PresentationStep` as a single flat union — TypeScript's excess-property
 * check on a union accepts an object literal the moment ANY member fits,
 * and an index-signature member fits almost anything, so a mistyped
 * `spinTo` (say, a misspelled field instead of the real `board`) would
 * silently type-check by matching THIS member instead of being rejected
 * for not matching `SpinToStep`. Keeping `PresentationPlan`
 * built from `KnownPresentationStep` alone, with no sibling like this one,
 * is what keeps that typo a compile error. `PresentationStep` below still
 * includes this member — that's fine, because nothing authors a
 * `PresentationPlan` by assigning a fresh object literal to the wider
 * `PresentationStep` type; only `executePlan` and a `BoardStepRegistry`
 * consume it, and both are meant to accept exactly this looseness.
 */
export interface UnknownPresentationStep {
  kind: string;
  [field: string]: unknown;
}

/**
 * A step as `executePlan`/`BoardStepRegistry` see it: one of the four
 * known kinds by its exact shape, or anything else that at least names a `kind`.
 * NOT what mechanics build `PresentationPlan` out of — see
 * `KnownPresentationStep`'s doc for why those stay two different types.
 */
export type PresentationStep = KnownPresentationStep | UnknownPresentationStep;

/**
 * What a mechanic emits instead of animating: an ordered script for the
 * board. Built from `KnownPresentationStep`, not `PresentationStep` — see
 * that type's doc comment. This is the vocabulary `classic`/`cascade`
 * stand on (Task 4) and it stays closed on purpose: widening it would
 * silently drop compile-time checking from THEIR code, not just open a
 * door for someone else's.
 */
export type PresentationPlan = KnownPresentationStep[];

/**
 * The four kinds' names, exactly as the `switch` below and `BoardApi`'s
 * four methods (`@energy8engine/play-loop`) both key off. Exported so a
 * diagnostic naming an unknown kind can also name what IS known, without a
 * second hand-maintained copy of this list drifting from this one. Kept in
 * sync with the `switch` by hand.
 *
 * It also gates which kinds a BOARD gets first refusal on: `executePlan`
 * consults `board[step.kind]` only for a kind in this list, and sends
 * everything else to the step registry. Without that gate a plugin
 * registering `toString` was silently answered by `Object.prototype`, and
 * any own method a board carried past the four outranked a registered
 * handler for that name.
 *
 * **It was six.** `setMultiplier` and `wait` were built before any
 * mechanic asked for them and none ever did: `classic`, `cascade` and the
 * project plugin `reel-step` between them produce `spinTo`, `revealWins`,
 * `remove` and `refill`, and the only literals of the other two anywhere
 * in the repo were in tests. The cost was paid by a developer chasing a
 * misspelling: this list is what an "unknown kind" diagnostic offers, and
 * a third of what it offered named nothing any mechanic here could make.
 *
 * `BoardStepRegistry` (`@energy8engine/play-loop`) is what makes a
 * speculative built-in unnecessary: a mechanic that needs a multiplier
 * step or a beat brings the kind AND the handler that performs it, the way
 * the `reel-step` plugin brings `reelStep`. Adding a kind back to this
 * list is therefore not how to get one — it is how to oblige every board
 * in existence to implement it.
 */
export const KNOWN_STEP_KINDS: readonly KnownPresentationStep['kind'][] = [
  'spinTo',
  'revealWins',
  'remove',
  'refill',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.every((col) => Array.isArray(col) && col.every((cell) => isFiniteNumber(cell)))
  );
}

function isCell(value: unknown): value is Cell {
  return isRecord(value) && isFiniteNumber(value.col) && isFiniteNumber(value.row);
}

function isRevealedLine(value: unknown): value is RevealedLine {
  return (
    isRecord(value) &&
    isFiniteNumber(value.line) &&
    isFiniteNumber(value.symbol) &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.win) &&
    Array.isArray(value.positions) &&
    value.positions.every(isCell)
  );
}

/**
 * True for any well-formed `PresentationStep` — false for everything else,
 * never throws. "Well-formed" means two different things depending on
 * `kind`: for one of the four known kinds, the FULL shape that kind's own
 * interface promises (a `spinTo` needs a real `board`, not just any
 * object); for anything else, only that it names a `kind` at all — this
 * function has no way to know what shape a plugin's step should be, and
 * saying "false" for every kind it doesn't recognize is exactly the
 * closed-vocabulary behaviour the registry (`@energy8engine/play-loop`)
 * exists to end. A step whose kind is unknown but which lands on no
 * registered handler either still gets caught — as a DIFFERENT diagnostic,
 * from `executePlan` itself, once it has a registry (or lack of one) to
 * check against; this function only answers "is this readable as a step
 * at all," not "does anything know how to run it."
 */
export function isPresentationStep(value: unknown): value is PresentationStep {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'spinTo':
      return isBoard(value.board);
    case 'revealWins':
      return (
        isFiniteNumber(value.total) &&
        Array.isArray(value.lines) &&
        value.lines.every(isRevealedLine)
      );
    case 'remove':
      return Array.isArray(value.cells) && value.cells.every(isCell);
    case 'refill':
      return isBoard(value.board);
    default:
      // Not one of the four — not malformed BY THAT FACT alone. `value.kind`
      // is already confirmed a string above, which is everything
      // `UnknownPresentationStep` requires.
      return true;
  }
}
