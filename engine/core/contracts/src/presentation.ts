/**
 * The vocabulary of presentation steps every mechanic must express itself in.
 * A mechanic doesn't animate — it emits a `PresentationPlan`, and the board
 * executes it. This is a contract, not a plugin surface: it is deliberately
 * not extensible here (a `board.step` registry for third-party steps is a
 * later plan).
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

/** The active win multiplier becomes this value. */
export interface SetMultiplierStep {
  kind: 'setMultiplier';
  value: number;
}

/** Nothing happens for this long — a beat for the player to read the board. */
export interface WaitStep {
  kind: 'wait';
  ms: number;
}

/** One step of a presentation plan. */
export type PresentationStep =
  | SpinToStep
  | RevealWinsStep
  | RemoveStep
  | RefillStep
  | SetMultiplierStep
  | WaitStep;

/** What a mechanic emits instead of animating: an ordered script for the board. */
export type PresentationPlan = PresentationStep[];

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

/** True for any well-formed step in the vocabulary above — false for everything else, never throws. */
export function isPresentationStep(value: unknown): value is PresentationStep {
  if (!isRecord(value)) return false;

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
    case 'setMultiplier':
      return isFiniteNumber(value.value);
    case 'wait':
      return isFiniteNumber(value.ms);
    default:
      return false;
  }
}
