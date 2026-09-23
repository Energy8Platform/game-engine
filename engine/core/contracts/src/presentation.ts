/**
 * The vocabulary of presentation steps every mechanic must express itself in.
 * A mechanic doesn't animate — it emits a `PresentationPlan`, and the board
 * executes it.
 *
 * `PresentationPlan` (what `classic`/`cascade` actually emit) stays the
 * closed vocabulary below — that is deliberate, see
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

/**
 * A cell as the math says it: a symbol id (a number, or a name like
 * `'ROCK'` — a real game's math emits names, not just ids), or a record
 * carrying that id plus whatever else the game keeps per cell (a
 * multiplier, a sticky counter, …). `symbol: null` is an empty cell.
 * Everything beyond `symbol` is untyped here on purpose — this package has
 * no way to know what a given game's cells carry, and `cellData` below
 * passes it through rather than naming it.
 */
export interface BoardCell {
  symbol: string | number | null;
  [extra: string]: unknown;
}

/**
 * A full grid snapshot, `board[col][row]` holding a symbol id (number or
 * name) or a per-cell record.
 */
export type Board = (number | string | BoardCell)[][];

/** A grid position, addressed the same way `cascade_history.removed` already is. */
export interface Cell {
  col: number;
  row: number;
}

/**
 * One winning line as the player reads it, not how it was scored. Field
 * names match the math engine's measured result shape (`symbol`, `count`,
 * `win`, `positions`) on purpose, so nothing has to translate between them.
 * `symbol` is a number or a name, exactly as a `Board` cell's is.
 */
export interface RevealedLine {
  line: number;
  symbol: number | string;
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
 * One cascade round as a single beat: the paying cells light up, the
 * removed ones leave, the survivors slide down into the gaps and fresh
 * symbols drop in from above, settling on `settled`.
 *
 * This is NOT `remove` + `refill` said in one breath. Those two are
 * `setBoard` twice — the board teleports, there is no gravity and nothing
 * drops. A `tumble` is handed to the renderer WHOLE precisely because the
 * slide needs to know where each survivor is going before the first frame
 * runs; a board driven one step at a time, with no lookahead, cannot
 * animate it. (`@energy8engine/reels` plays it through the legacy
 * `TumbleController`, which is exactly that animation.)
 *
 * A chain of N rounds is N `tumble` steps, each carrying its own settled
 * board — not one step carrying N rounds. `drops` is optional: omitted, the
 * renderer derives the slide from `removed` by gravity, which is what a
 * mechanic emitting ordinary column-collapse cascades wants.
 */
export interface TumbleStep {
  kind: 'tumble';
  /** Cells to highlight before they leave — usually the same as `removed`. */
  winning: Cell[];
  /** Cells that leave the board this round. */
  removed: Cell[];
  /** Explicit survivor slides. Omitted → the renderer derives gravity from `removed`. */
  drops?: { col: number; fromRow: number; toRow: number }[];
  /** What lands from above, each carrying a `Board` leaf as its symbol. */
  fresh: { col: number; row: number; symbol: number | string | BoardCell }[];
  /** The board this round settles on. */
  settled: Board;
}

/**
 * A beat on the flow bus, not a board step: `event` fires with `payload`
 * (data the mechanic computed — never a scene or shell name), and
 * `wait: true` holds the plan until every flow branch that event started
 * has ended (an `on { busy: parallel }` node). Served by the play loop's
 * built-in handler (`@energy8engine/play-loop`), never by a board — so it
 * is in `KnownPresentationStep` (a mechanic's plan may carry it, typed)
 * but NOT in `KNOWN_STEP_KINDS`/`BoardApi` (no board is obliged to know it).
 */
export interface EmitStep {
  kind: 'emit';
  event: string;
  payload?: unknown;
  wait?: boolean;
}

/**
 * These cells play a named state of their symbol (`symbols.yml`'s `states`)
 * — a death morph on a duel's losers, a celebration on the scatters — and
 * return to their resting state when it ends. Not a win reveal: no amount,
 * no line, and the state is the mechanic's to name.
 *
 * `wait` (default true) is what the plan does, not what the cells do: with
 * `false` the states start and the plan moves on, so a morph can play over
 * the tumble that follows it.
 *
 * It is read by `executePlan` (`@energy8engine/play-loop`), not by the board
 * — and read there for EVERY step kind, this one and a plugin's alike, off
 * `UnknownPresentationStep`'s index signature when the shape has no field of
 * its own. The rule is one line: `wait === false` starts the step and the
 * plan carries on.
 *
 * That is what `executePlan` READS, not what a mechanic can WRITE: a shape
 * that wants `wait: false` must declare `wait?: boolean` on ITSELF (this
 * one and `EmitStep` do; nothing else in `KnownPresentationStep` does, and
 * a plugin's own step type declares its own), because `PresentationPlan`
 * is `KnownPresentationStep[]` and stays closed on purpose — see
 * `UnknownPresentationStep`'s own doc for why widening it would cost every
 * mechanic its typo check.
 *
 * The plan still stays atomic — `executePlan` awaits every such step at
 * the end, before it returns, so a state cannot outlive the plan that
 * played it, and a failure is the ordinary `step "<kind>" failed`
 * diagnostic naming the index it started at.
 */
export interface PlayStateStep {
  kind: 'playState';
  cells: Cell[];
  state: string;
  wait?: boolean;
}

/**
 * How fast a step should play — the one thing a presentation carries
 * besides its own content. Threaded from `play.execute` (`@energy8engine/
 * play-loop`) through `executePlan` to every `BoardApi` method and every
 * registered `StepHandler`, unchanged.
 *
 * `turbo` is a REQUEST, not a promise: what it shortens is up to whatever
 * performs the step. The reels board passes it to the legacy
 * `spin`/`cascade`, which halve their own timings; a legacy `playWin` takes
 * no options at all and runs at its own pace either way. A plugin's handler
 * decides for itself. Nothing in the vocabulary says what "twice as fast"
 * means, because nothing in the vocabulary knows how long anything takes.
 */
export interface StepOpts {
  turbo?: boolean;
}

/**
 * One of the steps a mechanic may put in its plan: the six board steps
 * the built-in mechanics stand on (`KNOWN_STEP_KINDS`), plus `emit`, which
 * isn't one — see the module doc. Kept as its own named union (rather than
 * folding straight into `PresentationStep` below) because `PresentationPlan`
 * is defined from THIS type, not from `PresentationStep`: a mechanic's
 * `steps.push({ kind: 'spinTo', ...typo })` must still fail to compile, and
 * it only does because `PresentationPlan`'s element type has no open member
 * for a typo'd literal to quietly match instead. See
 * `UnknownPresentationStep`'s doc for the mechanism that would otherwise
 * defeat that.
 *
 * Seven now: `setMultiplier` and `wait` were built before any mechanic
 * asked for them, nothing ever emitted either, and they are gone. `tumble`
 * (slice 25) earned its place the way `KNOWN_STEP_KINDS` explains. `emit`
 * (slice 29) was the sixth, the first that is not a board step — see
 * `EmitStep`'s own doc for why it belongs here but not in
 * `KNOWN_STEP_KINDS`. `playState` (slice 30) is the seventh, and IS a
 * board step — see `PlayStateStep`'s own doc and `KNOWN_STEP_KINDS`.
 */
export type KnownPresentationStep =
  SpinToStep | RevealWinsStep | RemoveStep | RefillStep | TumbleStep | EmitStep | PlayStateStep;

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
 * A step as `executePlan`/`BoardStepRegistry` see it: one of the known
 * kinds by its exact shape, or anything else that at least names a `kind`.
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
 * The known kinds' names, exactly as the `switch` below and `BoardApi`'s
 * own methods (`@energy8engine/play-loop`) both key off. Exported so a
 * diagnostic naming an unknown kind can also name what IS known, without a
 * second hand-maintained copy of this list drifting from this one. Kept in
 * sync with the `switch` by hand.
 *
 * `tumble` (slice 25) is the fifth, and the one that shows what earns a
 * place here: it is not a convenience over `remove` + `refill`, it is the
 * only way to say something those two cannot say at all (see `TumbleStep`).
 *
 * It also gates which kinds a BOARD gets first refusal on: `executePlan`
 * consults `board[step.kind]` only for a kind in this list, and sends
 * everything else to the step registry. Without that gate a plugin
 * registering `toString` was silently answered by `Object.prototype`, and
 * any own method a board carried past the known ones outranked a
 * registered handler for that name.
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
 *
 * `emit` is deliberately absent even though it is a `KnownPresentationStep`
 * — it is not a board step at all, the play loop serves it itself.
 *
 * `playState` (slice 30) is the sixth. It is not `revealWins` with a field:
 * a reveal carries an amount and lights a line — a paid result. `playState`
 * carries neither; it names a state (`symbols.yml`'s `states`) for a
 * mechanic to play on cells it chose, win or not (see `PlayStateStep`).
 */
export const KNOWN_STEP_KINDS: readonly KnownPresentationStep['kind'][] = [
  'spinTo',
  'revealWins',
  'remove',
  'refill',
  'tumble',
  'playState',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A `BoardCell.symbol` value on its own: a finite number, a string, or `null`. */
function isSymbolId(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || isFiniteNumber(value);
}

function isBoardCell(value: unknown): value is BoardCell {
  return isRecord(value) && isSymbolId(value.symbol);
}

/** One `Board` leaf: a finite number, a string (a symbol name), or a `BoardCell` record. */
function isBoardLeaf(value: unknown): value is number | string | BoardCell {
  return isFiniteNumber(value) || typeof value === 'string' || isBoardCell(value);
}

function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.every((col) => Array.isArray(col) && col.every(isBoardLeaf))
  );
}

function isCell(value: unknown): value is Cell {
  return isRecord(value) && isFiniteNumber(value.col) && isFiniteNumber(value.row);
}

/** One entry of `TumbleStep.fresh`: a position plus a `Board` leaf to land there. */
function isFreshCell(value: unknown): boolean {
  return isCell(value) && isBoardLeaf((value as unknown as Record<string, unknown>).symbol);
}

/** One entry of `TumbleStep.drops`: a column and the rows a survivor slides between. */
function isDrop(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.col) &&
    isFiniteNumber(value.fromRow) &&
    isFiniteNumber(value.toRow)
  );
}

function isRevealedLine(value: unknown): value is RevealedLine {
  return (
    isRecord(value) &&
    isFiniteNumber(value.line) &&
    (isFiniteNumber(value.symbol) || typeof value.symbol === 'string') &&
    isFiniteNumber(value.count) &&
    isFiniteNumber(value.win) &&
    Array.isArray(value.positions) &&
    value.positions.every(isCell)
  );
}

/**
 * The legacy cell shape `SymbolCell.setData` (`@energy8platform/game-engine`)
 * takes: `symbol` normalized to a string (`String(n)` for a number, `null`
 * stays `null`), whatever else a `BoardCell` carried spread through
 * untyped — a project's own extra fields (a multiplier, a sticky counter)
 * are this function's to pass along, not to know the shape of. Every
 * consumer that turns a `Board` cell into the legacy shape (`@energy8engine/
 * reels`' `toCellBoard`, a project plugin's own) goes through this one
 * function, so "how a cell becomes `CellData`" has exactly one definition.
 */
export function cellData(cell: number | string | BoardCell): { symbol: string | null } & Record<string, unknown> {
  if (typeof cell === 'number' || typeof cell === 'string') return { symbol: String(cell) };
  const { symbol, ...extra } = cell;
  return { symbol: symbol === null ? null : String(symbol), ...extra };
}

/**
 * True for any well-formed `PresentationStep` — false for everything else,
 * never throws. "Well-formed" means two different things depending on
 * `kind`: for one of the known kinds, the FULL shape that kind's own
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
    case 'tumble':
      return (
        Array.isArray(value.winning) &&
        value.winning.every(isCell) &&
        Array.isArray(value.removed) &&
        value.removed.every(isCell) &&
        Array.isArray(value.fresh) &&
        value.fresh.every(isFreshCell) &&
        isBoard(value.settled) &&
        // Optional, and only checked when present: "no drops" is the
        // gravity-derived case a cascade mechanic emits, not a malformed step.
        (value.drops === undefined || (Array.isArray(value.drops) && value.drops.every(isDrop)))
      );
    case 'emit':
      return (
        typeof value.event === 'string' &&
        value.event.length > 0 &&
        (value.wait === undefined || typeof value.wait === 'boolean')
      );
    case 'playState':
      return (
        Array.isArray(value.cells) &&
        value.cells.every(isCell) &&
        typeof value.state === 'string' &&
        value.state.length > 0 &&
        (value.wait === undefined || typeof value.wait === 'boolean')
      );
    default:
      // Not one of the known kinds — not malformed BY THAT FACT alone. `value.kind`
      // is already confirmed a string above, which is everything
      // `UnknownPresentationStep` requires.
      return true;
  }
}
