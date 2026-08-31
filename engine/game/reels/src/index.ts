/**
 * `BoardApi` (from `@energy8engine/play-loop`) implemented over the legacy
 * `createReelSystem` from `@energy8platform/game-engine/slot`. This is the
 * `board` half of the seam Task 7 declared: play-loop's `executePlan` walks
 * a `PresentationPlan` and calls one of these six methods per step; this
 * file is what actually moves pixels (or, in a test, a fake standing in
 * for pixels).
 *
 * What Step 1's spike measured (see task-9-report.md for the full record):
 *
 *  - `createReelSystem(...)` builds `Container`/`ReelGrid`/`SymbolCell`
 *    scene-graph objects headlessly — no live pixi `Application`, no DOM,
 *    plain Node is enough. `setBoard(board)` is fully SYNCHRONOUS (sets the
 *    board and returns `undefined`); `grid.getCell(col,row).setState(...)`
 *    and `.setData(...)` are synchronous too.
 *  - `spin(target)` and `SymbolCell.playWin()` are both Promise-returning
 *    and both route through the legacy `Tween`/`Ticker.shared` — without a
 *    live, running pixi `Application` driving `requestAnimationFrame`,
 *    they never settle (confirmed: 50ms of wall-clock time with no ticker
 *    pump left `spin()` still pending, and the ticker itself throws
 *    `requestAnimationFrame is not defined` the moment it tries to
 *    self-schedule in Node). This is exactly why this file's own tests run
 *    against a fake, per the play-loop module doc, and why a real spin can
 *    only be proven working in Task 12's headless BROWSER run.
 *  - `ReelSystem.cascade(steps)` / `.reelStep(steps)` exist but do not fit
 *    `revealWins`/`remove`/`refill` as independent calls: a `TumbleStep`
 *    bundles `winningCells` + `removedCells` + `newCells` + `settledGrid`
 *    into ONE call, while `BoardApi` invokes these three methods
 *    separately, one `PresentationStep` at a time, with no lookahead to
 *    the step that follows. So `revealWins`/`remove` are composed from the
 *    lower-level pieces instead: `reelSystem.grid.getCell(col,row)` reaches
 *    a `SymbolCell`, which exposes `setState({winning|removed|fresh})` and
 *    `playWin()` directly — the same primitives `TumbleController` itself
 *    is built on, just driven one step at a time rather than bundled.
 *    IMPORTANT gap this created (found in review, fixed here): touching a
 *    cell through `grid.getCell(...).setData(...)` repaints the view but
 *    does NOT reach `ReelSystem`'s own `board` closure — that only changes
 *    inside `setBoard`/`spin`/`cascade`/`reelStep`. Left alone, `remove()`
 *    would leave `reelSystem.board` (and `ctx.board`, which every built-in
 *    feature reads) reporting the pre-removal symbols. `remove()` re-syncs
 *    it with one `setBoard(...)` call at the end, over a snapshot of the
 *    current board with just the removed cells nulled — see its comment.
 *  - `setMultiplier` has no counterpart on `ReelSystem` at all — its own
 *    `multiplier` getter is READ-ONLY (climbs only via `cascade`/
 *    `reelStep`). `MultiplierAccumulator` — a separate, headless legacy
 *    class with `.value`/`.set()`/`.add()`/`.reset()` — is the piece that
 *    fits, so this module owns one per board.
 *  - `wait` has no legacy counterpart at all; it is a plain timer.
 *
 * One more measured decision baked in here: the step vocabulary's `Board`
 * is `number[][]` (symbol ids as numbers), but the legacy `SymbolResolver`
 * is keyed by `string`. Converted with `String(id)` — the only generic,
 * lossless mapping available without a game-specific symbol legend.
 */
import { MultiplierAccumulator, createReelSystem } from '@energy8platform/game-engine/slot';
import type {
  CellData,
  CreateReelSystemOptions,
  ReelSystem,
} from '@energy8platform/game-engine/slot';
import type { Container } from 'pixi.js';
import type {
  Board,
  RefillStep,
  RemoveStep,
  RevealWinsStep,
  SetMultiplierStep,
  SpinToStep,
  WaitStep,
} from '@energy8engine/contracts';
import type { BoardApi } from '@energy8engine/play-loop';

export type { BoardApi } from '@energy8engine/play-loop';
export { MultiplierAccumulator } from '@energy8platform/game-engine/slot';
export type { CarryPolicy } from '@energy8platform/game-engine/slot';

/** The one legacy cell object `revealWins`/`remove` drive directly — measured on `SymbolCell`. */
export interface CellLike {
  setState(state: { winning?: boolean; removed?: boolean; fresh?: boolean }): void;
  setData(data: CellData): void;
  playWin(): Promise<void>;
}

/** The slice of `ReelGrid` this board needs — cell lookup only. */
export interface GridLike {
  getCell(col: number, row: number): CellLike;
}

/**
 * The slice of the legacy `ReelSystem` this board is written against —
 * exactly the three members Step 1 measured. The real `ReelSystem`
 * satisfies this structurally (see `createReelsBoard` below); a test fake
 * only has to implement these three.
 */
export interface LegacyReelSystem {
  readonly grid: GridLike;
  /** Read by `remove()` to re-sync this after nulling cells directly — see its comment below. */
  readonly board: CellData[][];
  spin(target: CellData[][]): Promise<void>;
  setBoard(target: CellData[][]): void;
}

/** Symbol ids in the step vocabulary are numbers; the legacy resolver is keyed by string. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((symbolId) => ({ symbol: String(symbolId) })));
}

/**
 * Builds `BoardApi` over an already-constructed legacy reel system — or,
 * in a test, a fake satisfying `LegacyReelSystem`. `multiplier` defaults
 * to a fresh spin-scoped accumulator when the caller doesn't supply one.
 */
export function boardFromReelSystem(
  reelSystem: LegacyReelSystem,
  multiplier: MultiplierAccumulator = new MultiplierAccumulator({ policy: 'spin' }),
): BoardApi {
  return {
    async spinTo(step: SpinToStep) {
      await reelSystem.spin(toCellBoard(step.board));
    },

    async revealWins(step: RevealWinsStep) {
      const cells = step.lines.flatMap((line) => line.positions);
      await Promise.all(
        cells.map(({ col, row }) => {
          const cell = reelSystem.grid.getCell(col, row);
          cell.setState({ winning: true });
          return cell.playWin();
        }),
      );
    },

    async remove(step: RemoveStep) {
      if (step.cells.length === 0) return;
      for (const { col, row } of step.cells) {
        const cell = reelSystem.grid.getCell(col, row);
        cell.setState({ removed: true });
        cell.setData({ symbol: null });
      }
      // `SymbolCell.setData` only repaints the cell view — it does NOT reach the ReelSystem's
      // own `board` closure (that's updated only by `setBoard`/`spin`/`cascade`/`reelStep`).
      // Left alone, `reelSystem.board` — and `ctx.board` inside every built-in feature — would
      // keep reporting the pre-removal symbols after this step. Re-sync it through the same
      // measured-synchronous `setBoard` primitive `refill` already uses; re-applying the
      // (mostly) unchanged board is idempotent, so this costs nothing visually.
      const snapshot = reelSystem.board.map((col) => col.map((cell) => ({ ...cell })));
      for (const { col, row } of step.cells) {
        if (snapshot[col]?.[row]) snapshot[col][row] = { symbol: null };
      }
      reelSystem.setBoard(snapshot);
    },

    async refill(step: RefillStep) {
      reelSystem.setBoard(toCellBoard(step.board));
    },

    async setMultiplier(step: SetMultiplierStep) {
      multiplier.set(step.value);
    },

    async wait(step: WaitStep) {
      await new Promise<void>((resolve) => setTimeout(resolve, step.ms));
    },
  };
}

export interface ReelsBoard extends BoardApi {
  /** Root container — mount this into the stage. */
  readonly view: Container;
  /** The grid this board drives — same object `revealWins`/`remove` reach via `getCell`. */
  readonly grid: GridLike;
  /** Current value of this board's multiplier accumulator (what `setMultiplier` last set). */
  readonly multiplier: number;
  destroy(): void;
}

/**
 * Constructs the real legacy reel system and wraps it as `BoardApi` in one
 * call — the production entry point. `boardFromReelSystem` above is what
 * this package's tests exercise directly, against a fake; this function is
 * covered by a lighter construction/wiring check, since the animated paths
 * it drives (`spin`, `playWin`) cannot settle without a live pixi
 * `Application` running its ticker (see the module doc above).
 */
export function createReelsBoard(options: CreateReelSystemOptions): ReelsBoard {
  const reelSystem: ReelSystem = createReelSystem(options);
  const acc = new MultiplierAccumulator({ policy: 'spin' });
  const api = boardFromReelSystem(reelSystem, acc);
  return {
    ...api,
    view: reelSystem.view,
    grid: reelSystem.grid,
    get multiplier() {
      return acc.value;
    },
    destroy() {
      reelSystem.destroy();
    },
  };
}
