/**
 * `BoardApi` (from `@energy8engine/play-loop`) implemented over the legacy
 * `createReelSystem` from `@energy8platform/game-engine/slot`. This is the
 * `board` half of the seam Task 7 declared: play-loop's `executePlan` walks
 * a `PresentationPlan` and calls one method per step; this file is what
 * actually moves pixels (or, in a test, a fake standing in for pixels).
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
 *    the step that follows. (Slice 25 gave that bundle a step of its own —
 *    `tumble` — rather than trying to reassemble it from three; `cascade`
 *    is what plays it, one round per call.) So `revealWins`/`remove` are
 *    composed from the lower-level pieces instead:
 *    `reelSystem.grid.getCell(col,row)` reaches a `SymbolCell`, which exposes `setState({winning|removed|fresh})` and
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
 * because `BoardApi` used to declare six kinds. No mechanic ever emitted
 * either kind; both are gone, along with the
 * `MultiplierAccumulator` this module kept per board purely to give
 * `setMultiplier` something to move. A mechanic that wants a multiplier
 * step now brings the kind and its own handler through
 * `BoardStepRegistry` — see `KNOWN_STEP_KINDS` in
 * `@energy8engine/contracts`.
 *
 * One more measured decision baked in here: the step vocabulary's `Board`
 * carries a symbol id (a number or a name) or a per-cell record, but the
 * legacy `SymbolResolver` is keyed by `string` and the legacy `CellData` is
 * a flat `{ symbol, ...extras }`. Converted through `cellData()`
 * (`@energy8engine/contracts`) — the one function every consumer of a
 * `Board` cell goes through, so this file, a project's own plugin, and any
 * future one agree on the mapping.
 */
import { createReelSystem } from '@energy8platform/game-engine/slot';
import type {
  CellData,
  CreateReelSystemOptions,
  ReelSystem,
  ReelSystemConfig,
  SymbolView,
  StepRunOpts,
  TumbleStep as LegacyTumbleStep,
} from '@energy8platform/game-engine/slot';
import type { Container } from 'pixi.js';
import { cellData } from '@energy8engine/contracts';
import type {
  Board,
  RefillStep,
  RemoveStep,
  RevealWinsStep,
  SpinToStep,
  StepOpts,
  TumbleStep,
} from '@energy8engine/contracts';
import type { BoardApi } from '@energy8engine/play-loop';

export type { BoardApi } from '@energy8engine/play-loop';

/** The one legacy cell object `revealWins`/`remove` drive directly — measured on `SymbolCell`. */
export interface CellLike {
  setState(state: { winning?: boolean; removed?: boolean; fresh?: boolean }): void;
  setData(data: CellData): void;
  playWin(): Promise<void>;
  /** The mounted symbol's view, when there is one; `bind` is `@energy8engine/symbols`' `$cell.<field>` resolution. */
  readonly view: (SymbolView & { bind?(data: CellData): void }) | null;
  /** The data this cell last took — what `bind` resolves against. */
  readonly data: CellData;
}

/** The slice of `ReelGrid` this board needs — cell lookup, and the extent to walk for `bindAll`. */
export interface GridLike {
  getCell(col: number, row: number): CellLike;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The slice of the legacy `ReelSystem` this board is written against. The
 * real `ReelSystem` satisfies this structurally (see `createReelsBoard`
 * below); a test fake only has to implement these members.
 */
export interface LegacyReelSystem {
  readonly grid: GridLike;
  /** Read by `remove()` to re-sync this after nulling cells directly — see its comment below. */
  readonly board: CellData[][];
  spin(target: CellData[][], opts?: { turbo?: boolean }): Promise<void>;
  setBoard(target: CellData[][]): void;
  /** One cascade round per step — what `tumble` drives. */
  cascade(steps: LegacyTumbleStep[], opts?: StepRunOpts<LegacyTumbleStep>): Promise<void>;
  /** Collapse every in-flight animation (spin tape, tumble chain, overlay tweens) to its end state. */
  skip(): void;
  /** Read by `cellSize`/`config` below; the real `ReelSystem` always has it, the fake this package's tests use may not. */
  readonly config?: ReelSystemConfig;
}

/** Each `Board` cell — a number, a name, or a record — through the shared `cellData()` mapping. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((cell) => cellData(cell) as CellData));
}

/**
 * Builds `BoardApi` plus `repaint`/`cellSize`/`config`/`lastOpts`
 * (declared on `ReelsBoard` below, not on `BoardApi` itself — `Omit` just
 * borrows its extra members here) over an already-constructed legacy reel
 * system — or, in a test, a fake satisfying `LegacyReelSystem`.
 */
export function boardFromReelSystem(
  reelSystem: LegacyReelSystem,
): Omit<ReelsBoard, 'view' | 'grid' | 'destroy'> {
  // `ReelSystem.spin` sets its `board` only once the spin resolves, while the engine seats the
  // landing symbols before that: a `repaint()` in that window would `setBoard(oldBoard)` and
  // put the previous spin's art back. Deferred until the last op in flight settles, run once.
  let inFlight = 0;
  let pendingRepaint = false;
  // Every seated cell hands its own data to its view: a symbol state's `$cell.<field>` props
  // (an orb's ×N) resolve here, AFTER the op that seated it — never during a spin, where the
  // tape's symbols carry no data and the default look is what a spinning reel wants. A view
  // without `bind` (any other `SymbolView`) and an empty cell are simply skipped.
  const bindAll = () => {
    const { grid } = reelSystem;
    for (let col = 0; col < grid.cols; col++)
      for (let row = 0; row < grid.rows; row++) {
        // A ragged grid has no cell past a short reel's last row — `getCell` answers undefined.
        const cell = grid.getCell(col, row) as CellLike | undefined;
        cell?.view?.bind?.(cell.data);
      }
  };
  const repaint = () => {
    reelSystem.setBoard(reelSystem.board);
    bindAll();
  };
  // The tempo the last method was handed — what a page's `__e8.lastStepOpts()`
  // reads back to prove a turbo toggle actually reached the board. Recorded on
  // the way IN (before the op runs), so it is the one in force while it plays.
  let lastOpts: StepOpts | undefined;
  const tracked =
    <S>(run: (step: S, opts?: StepOpts) => Promise<void>) =>
    async (step: S, opts?: StepOpts) => {
      lastOpts = opts;
      inFlight++;
      try {
        await run(step, opts);
      } finally {
        if (--inFlight === 0 && pendingRepaint) {
          pendingRepaint = false;
          repaint();
        }
      }
    };
  return {
    spinTo: tracked(async (step: SpinToStep, opts?: StepOpts) => {
      await reelSystem.spin(toCellBoard(step.board), { turbo: opts?.turbo });
      bindAll();
    }),

    // `turbo` reaches nothing here, and that is measured rather than missed:
    // the only time this step spends is the legacy `SymbolCell.playWin()`,
    // which takes no run options — its tween length is `win` config, not a
    // per-call speed. So a turbo reveal runs at the same pace as a normal one
    // and the step accepts `opts` purely to keep the shape uniform. Adding an
    // artificial hold here just to have something to halve would make the
    // NON-turbo reveal slower than it is today, which nobody asked for.
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
      bindAll();
    }),

    // One vocabulary step, one legacy `TumbleStep`, one `cascade` call — a
    // chain of N rounds arrives as N of these, each settling on its own board.
    // (`cascade` is generic over the step and loops; handing it one step per
    // call is what keeps `executePlan`'s one-step-at-a-time contract intact.)
    //
    // No `remove`-style re-sync afterwards, deliberately: unlike `setData` and
    // `grid.setGrid`, which repaint cells without reaching the ReelSystem's own
    // `board` closure, the facade's `cascade` assigns `board = settledGrid`
    // itself as each step lands. A `setBoard` on top would be a redundant
    // re-resolve of every view the tumble just seated.
    tumble: tracked(async (step: TumbleStep, opts?: StepOpts) => {
      await reelSystem.cascade(
        [
          {
            winningCells: step.winning,
            removedCells: step.removed,
            drops: step.drops,
            // The legacy `newCells.symbol` is a bare string: a record's extras
            // cannot ride here. They do not need to — `settledGrid` below is
            // what each cell takes its data from once the drop lands.
            //
            // The cast is for an EMPTY fresh cell. `cellData` answers `null`
            // there, and `null` is exactly what the controller's
            // `cell.setData({ symbol })` means by "no symbol" — the same value
            // `remove()` above hands it. The legacy field is typed `string`
            // only because nothing had given it an empty one before; `?? ''`
            // would be strictly worse, since `resolve('')` is a symbol lookup
            // that cannot succeed.
            newCells: step.fresh.map(({ col, row, symbol }) => ({
              col,
              row,
              symbol: cellData(symbol).symbol as string,
            })),
            settledGrid: toCellBoard(step.settled),
          },
        ],
        { turbo: opts?.turbo },
      );
      bindAll();
    }),

    // Collapse whatever is animating — the legacy `ReelSystem.skip()` forwards
    // to the live spin/tumble/reel-step controllers. Synchronous: the op's own
    // promise resolves a moment later, on its own.
    //
    // It is not only the in-flight ops: that same call unconditionally kills
    // every tween on the `fx` overlay layer and then removes and destroys its
    // children — so a bespoke ring, label or sprite a game drew there is gone
    // after a skip, whether or not anything was animating. Nothing here can
    // narrow that without reaching past the facade; a game that draws into
    // `fx` redraws it after a skip.
    skip() {
      reelSystem.skip();
    },

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

    // The reel system's own config, read-only, so a project's step handler can
    // time itself against the SAME `cascade.timings`/`motion` numbers this
    // board animates with instead of guessing them.
    get config() {
      return reelSystem.config;
    },

    get lastOpts() {
      return lastOpts;
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
  /** The live reel system's config — the timings a project's own step can animate against. */
  readonly config: ReelSystemConfig | undefined;
  /** The `StepOpts` the last board method was handed; `undefined` before the first one. */
  readonly lastOpts: StepOpts | undefined;
  /** Collapse every in-flight animation to its end state; a no-op after `destroy()`. */
  skip(): void;
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
    <S>(run: (step: S, opts?: StepOpts) => Promise<void>) =>
    async (step: S, opts?: StepOpts) => {
      if (destroyed) throw new Error('board destroyed — reels1 was re-applied; spin again');
      await run(step, opts);
    };
  return {
    spinTo: guarded(api.spinTo),
    revealWins: guarded(api.revealWins),
    remove: guarded(api.remove),
    refill: guarded(api.refill),
    tumble: guarded(api.tumble),
    view: reelSystem.view,
    grid: reelSystem.grid,
    // Unlike the BoardApi methods above, a stale repaint/skip is nothing to refuse over —
    // there is no spin result either could misreport — so these are no-ops, not throws.
    repaint() {
      if (!destroyed) api.repaint();
    },
    skip() {
      if (!destroyed) api.skip();
    },
    get cellSize() {
      return api.cellSize;
    },
    get config() {
      return api.config;
    },
    get lastOpts() {
      return api.lastOpts;
    },
    destroy() {
      destroyed = true;
      reelSystem.destroy();
    },
  };
}
