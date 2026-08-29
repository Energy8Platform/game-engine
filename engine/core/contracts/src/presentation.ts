/**
 * The vocabulary of presentation steps every mechanic must express itself in.
 * A mechanic doesn't animate — it emits a `PresentationPlan`, and the board
 * executes it. This is a contract, not a plugin surface: it is deliberately
 * not extensible here (a `board.step` registry for third-party steps is a
 * later plan).
 */

/** A full grid snapshot, `board[col][row]` holding a symbol id. */
export type Board = number[][];

/** A grid position, addressed the same way `cascade_history.removed` already is. */
export interface Cell {
  col: number;
  row: number;
}

/** One winning line as the player reads it, not how it was scored. */
export interface RevealedLine {
  line: number;
  symbols: number;
  amount: number;
}

/** The reels land showing exactly this grid. */
export interface SpinToStep {
  kind: 'spinTo';
  board: Board;
}

/** The winning lines light up, each carrying what it paid. */
export interface RevealWinsStep {
  kind: 'revealWins';
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
    isFiniteNumber(value.symbols) &&
    isFiniteNumber(value.amount)
  );
}

/** True for any well-formed step in the vocabulary above — false for everything else, never throws. */
export function isPresentationStep(value: unknown): value is PresentationStep {
  if (!isRecord(value)) return false;

  switch (value.kind) {
    case 'spinTo':
      return isBoard(value.board);
    case 'revealWins':
      return Array.isArray(value.lines) && value.lines.every(isRevealedLine);
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
