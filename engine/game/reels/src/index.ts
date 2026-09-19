/**
 * `BoardApi` (from `@energy8engine/play-loop`) implemented over the legacy
 * `createReelSystem` from `@energy8platform/game-engine/slot`. This is the
 * `board` half of the seam Task 7 declared: play-loop's `executePlan` walks
 * a `PresentationPlan` and calls one of these four methods per step; this
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
 *
 * This board used to carry two more methods, `setMultiplier` and `wait`,
 * because `BoardApi` used to declare six kinds rather than four. No
 * mechanic ever emitted either kind; both are gone, along with the
 * `MultiplierAccumulator` this module kept per board purely to give
 * `setMultiplier` something to move. A mechanic that wants a multiplier
 * step now brings the kind and its own handler through
 * `BoardStepRegistry` — see `KNOWN_STEP_KINDS` in
 * `@energy8engine/contracts`.
 *
 * One more measured decision baked in here: the step vocabulary's `Board`
 * is `number[][]` (symbol ids as numbers), but the legacy `SymbolResolver`
 * is keyed by `string`. Converted with `String(id)` — the only generic,
 * lossless mapping available without a game-specific symbol legend.
 */
import { createReelSystem } from '@energy8platform/game-engine/slot';
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
  SpinToStep,
} from '@energy8engine/contracts';
import type { BoardApi } from '@energy8engine/play-loop';

export type { BoardApi } from '@energy8engine/play-loop';

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
  /** Read by `cellSize` below; the real `ReelSystem` always has it, the fake this package's tests use may not. */
  readonly config?: { grid: { cellSize: number } };
}

/** Symbol ids in the step vocabulary are numbers; the legacy resolver is keyed by string. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((symbolId) => ({ symbol: String(symbolId) })));
}

/**
 * Builds `BoardApi` plus `repaint`/`cellSize` (declared on `ReelsBoard`
 * below, not on `BoardApi` itself — `Omit` just borrows its two extra
 * members here) over an already-constructed legacy reel system — or, in a
 * test, a fake satisfying `LegacyReelSystem`.
 */
export function boardFromReelSystem(
  reelSystem: LegacyReelSystem,
): Omit<ReelsBoard, 'view' | 'grid' | 'destroy'> {
  // `ReelSystem.spin` sets its `board` only once the spin resolves, while the engine seats the
  // landing symbols before that: a `repaint()` in that window would `setBoard(oldBoard)` and
  // put the previous spin's art back. Deferred until the last op in flight settles, run once.
  let inFlight = 0;
  let pendingRepaint = false;
  const repaint = () => reelSystem.setBoard(reelSystem.board);
  const tracked =
    <S>(run: (step: S) => Promise<void>) =>
    async (step: S) => {
      inFlight++;
      try {
        await run(step);
      } finally {
        if (--inFlight === 0 && pendingRepaint) {
          pendingRepaint = false;
          repaint();
        }
      }
    };
  return {
    spinTo: tracked(async (step: SpinToStep) => {
      await reelSystem.spin(toCellBoard(step.board));
    }),

    revealWins: tracked(async (step: RevealWinsStep) => {
      const cells = step.lines.flatMap((line) => line.positions);
      await Promise.all(
        cells.map(({ col, row }) => {
          const cell = reelSystem.grid.getCell(col, row);
          cell.setState({ winning: true });
          return cell.playWin();
        }),
      );
    }),

    remove: tracked(async (step: RemoveStep) => {
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
    }),

    refill: tracked(async (step: RefillStep) => {
      reelSystem.setBoard(toCellBoard(step.board));
    }),

    // Forces a redraw without changing any symbol — a config edit (e.g. a frame style) that
    // `setBoard` alone would pick up on the NEXT spin/refill, made visible right away — or,
    // with an op in flight, as soon as it lands.
    repaint() {
      if (inFlight > 0) pendingRepaint = true;
      else repaint();
    },

    get cellSize() {
      const size = reelSystem.config?.grid.cellSize ?? 96;
      return { width: size, height: size };
    },
  };
}

export interface ReelsBoard extends BoardApi {
  /** Root container — mount this into the stage. */
  readonly view: Container;
  /** The grid this board drives — same object `revealWins`/`remove` reach via `getCell`. */
  readonly grid: GridLike;
  /** Re-`setBoard`s the current board to force every cell to redraw — after any op in flight lands; a no-op after `destroy()`. */
  repaint(): void;
  /** One cell's footprint — square, from the reel config's `grid.cellSize` (96 when absent). */
  readonly cellSize: { width: number; height: number };
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
  const api = boardFromReelSystem(reelSystem);
  // A hot `reels1` re-apply (`gameRows.update`) runs `destroy()` on THIS
  // board and provides a new one; a caller still holding this one (a spin
  // in flight, a page that read `ctx.board` once) would otherwise drive a
  // torn-down reel system — measured: the legacy `spin` resolved on it and
  // the spin was recorded as presented, silently. Refused instead, on every
  // `BoardApi` method: `executePlan` turns the throw into a diagnostic and
  // the page paints "presentation failed".
  let destroyed = false;
  const guarded =
    <S>(run: (step: S) => Promise<void>) =>
    async (step: S) => {
      if (destroyed) throw new Error('board destroyed — reels1 was re-applied; spin again');
      await run(step);
    };
  return {
    spinTo: guarded(api.spinTo),
    revealWins: guarded(api.revealWins),
    remove: guarded(api.remove),
    refill: guarded(api.refill),
    view: reelSystem.view,
    grid: reelSystem.grid,
    // Unlike the four BoardApi methods above, a stale repaint is nothing to refuse over —
    // there is no spin result it could misreport — so this is a no-op, not a throw.
    repaint() {
      if (!destroyed) api.repaint();
    },
    get cellSize() {
      return api.cellSize;
    },
    destroy() {
      destroyed = true;
      reelSystem.destroy();
    },
  };
}
