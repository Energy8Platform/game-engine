/**
 * `BoardApi` (from `@energy8engine/play-loop`) implemented over
 * `createReelSystem` from `@energy8engine/reel-core` — the engine's own
 * pluggable reel system (slice 35), forked from the legacy
 * `@energy8platform/game-engine/slot` facade this board used to wrap. This
 * is the `board` half of the seam Task 7 declared: play-loop's
 * `executePlan` walks a `PresentationPlan` and calls one method per step;
 * this file is what actually moves pixels (or, in a test, a fake standing
 * in for pixels).
 *
 * The reel system owns the grid, the board and the `fx` overlay layer; HOW
 * the reels spin and HOW a `tumble` plays are registered into it by other
 * rows (a motion style, the `tumble` controller). Until one is, `spin`
 * snaps the reels to the result (and says so through `report`), and
 * `cascade` throws — the throw is `tumble`'s step failing, which
 * `executePlan` turns into a diagnostic.
 *
 * What Step 1's spike measured against the legacy facade, and still holds
 * of the fork (see task-9-report.md for the full record):
 *
 *  - `createReelSystem(...)` builds `Container`/`ReelGrid`/`SymbolCell`
 *    scene-graph objects headlessly — no live pixi `Application`, no DOM,
 *    plain Node is enough. `setBoard(board)` is fully SYNCHRONOUS (sets the
 *    board and returns `undefined`); `grid.getCell(col,row).setState(...)`
 *    and `.setData(...)` are synchronous too.
 *  - A registered motion style's `spin` and `SymbolCell.playWin()` are both
 *    Promise-returning and both route through the engine's
 *    `Tween`/`Ticker.shared` — without a live, running pixi `Application`
 *    driving `requestAnimationFrame`, they never settle (confirmed: 50ms of
 *    wall-clock time with no ticker pump left `spin()` still pending, and
 *    the ticker itself throws `requestAnimationFrame is not defined` the
 *    moment it tries to self-schedule in Node). This is exactly why this
 *    file's own tests run against a fake, per the play-loop module doc, or
 *    against a fake motion style registered on the real system.
 *  - `ReelSystem.cascade(steps)` exists but does not fit
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
 * reel-core's `SymbolResolver` is keyed by `string` and its `CellData` is
 * a flat `{ symbol, ...extras }`. Converted through `cellData()`
 * (`@energy8engine/contracts`) — the one function every consumer of a
 * `Board` cell goes through, so this file, a project's own plugin, and any
 * future one agree on the mapping.
 */
import { createReelSystem } from '@energy8engine/reel-core';
import type {
  CellData,
  CreateReelSystemOptions,
  ReelSystem,
  SymbolView,
  TumbleStep as CoreTumbleStep,
} from '@energy8engine/reel-core';
import type { Container } from 'pixi.js';
import { cellData } from '@energy8engine/contracts';
import type {
  Board,
  PlayStateStep,
  RefillStep,
  RemoveStep,
  RevealWinsStep,
  SpinToStep,
  StepOpts,
  TumbleStep,
} from '@energy8engine/contracts';
import type { BoardApi } from '@energy8engine/play-loop';

export type { BoardApi } from '@energy8engine/play-loop';

/** The one cell object `revealWins`/`remove` drive directly — measured on `SymbolCell`. */
export interface CellLike {
  setState(state: { winning?: boolean; removed?: boolean; fresh?: boolean }): void;
  setData(data: CellData): void;
  playWin(): Promise<void>;
  /**
   * The mounted symbol's view, when there is one; `bind` is `@energy8engine/symbols`'
   * `$cell.<field>` resolution, `playState` is its `BoundSymbolView.playState` — absent
   * for a preview's pinned state and for a symbol with no def, which is why `playState()`
   * (below) checks for it on every cell rather than assuming it.
   */
  readonly view: (SymbolView & { bind?(data: CellData): void; playState?(state: string): Promise<void> }) | null;
  /** The data this cell last took — what `bind` resolves against. */
  readonly data: CellData;
}

/** The slice of `ReelGrid` this board needs — cell lookup, and the extent to walk for `bindAll`. */
export interface GridLike {
  getCell(col: number, row: number): CellLike;
  /** Seats a board; `remount` re-resolves even an unchanged symbol's view — what `repaint({ remount: true })` drives. */
  setGrid(cells: CellData[][], opts?: { remount?: boolean }): void;
  readonly cols: number;
  readonly rows: number;
  /** `ReelGrid.geometry`'s centre, in the view's local space — what `origin: 'center'` offsets by. Optional: this package's test fakes have none. */
  readonly geometry?: { centerX: number; centerY: number };
}

/**
 * The slice of reel-core's `ReelSystem` this board is written against. The
 * real `ReelSystem` satisfies this structurally (see `createReelsBoard`
 * below); a test fake only has to implement these members.
 */
export interface ReelSystemLike {
  readonly grid: GridLike;
  /** Read by `remove()` to re-sync this after nulling cells directly — see its comment below. */
  readonly board: CellData[][];
  spin(target: CellData[][], opts?: { turbo?: boolean }): Promise<void>;
  setBoard(target: CellData[][]): void;
  /** One cascade round per step — what `tumble` drives. */
  cascade(steps: CoreTumbleStep[], opts?: { turbo?: boolean }): Promise<void>;
  /** Collapse every in-flight animation (spin, tumble chain, overlay tweens) to its end state; `overlays: false` spares the `fx` layer. */
  skip(opts?: { overlays?: boolean }): void;
  /** Read by `cellSize`/`config` below; the real `ReelSystem` always has it, the fake this package's tests use may not. */
  readonly config?: ReelSystem['config'];
}

/** Each `Board` cell — a number, a name, or a record — through the shared `cellData()` mapping. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((cell) => cellData(cell) as CellData));
}

/**
 * Builds `BoardApi` plus `repaint`/`cellSize`/`config`/`lastOpts`
 * (declared on `ReelsBoard` below, not on `BoardApi` itself — `Omit` just
 * borrows its extra members here) over an already-constructed reel
 * system — or, in a test, a fake satisfying `ReelSystemLike`.
 */
export function boardFromReelSystem(
  reelSystem: ReelSystemLike,
): Omit<ReelsBoard, 'view' | 'grid' | 'system' | 'destroy'> {
  // `ReelSystem.spin` sets its `board` only once the spin resolves, while the engine seats the
  // landing symbols before that: a `repaint()` in that window would `setBoard(oldBoard)` and
  // put the previous spin's art back. Deferred until the last op in flight settles, run once.
  let inFlight = 0;
  // The strongest repaint asked for while an op was in flight: a remount covers a plain one.
  let pendingRepaint: false | { remount: boolean } = false;
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
  const repaint = (remount = false) => {
    // A remount re-seats the SAME board through the grid — `ReelSystem.setBoard` takes no
    // options, and the board itself is unchanged, so its closure needs no update.
    if (remount) reelSystem.grid.setGrid(reelSystem.board, { remount: true });
    else reelSystem.setBoard(reelSystem.board);
    bindAll();
  };
  // The tempo the last method was handed — what a page's `__e8.lastStepOpts()`
  // reads back to prove a turbo toggle actually reached the board. Recorded on
  // the way IN (before the op runs), so it is the one in force while it plays.
  let lastOpts: StepOpts | undefined;
  // Cells whose `playState` is currently in flight — what `skip()` below walks to
  // collapse each one to its resting look. Unlike `revealWins`'s `playWin()`
  // (an `AnimatedSymbol` tween `skip()` has never reached into, and still
  // doesn't), a `playState` view exposes exactly the primitive for this —
  // `showStatic()` — because the symbols package's `playState` is built to be
  // torn down early (see `@energy8engine/symbols`' `view.ts`: "showStatic tears
  // a state in flight down early; the once it was awaiting then resolves into a
  // no-op").
  //
  // ponytail: keyed by view identity, so two playState calls OVERLAPPING on
  // one view (a `wait: false` step, then a second step naming the same cell
  // before the first ended) collapse to one entry, and the first `.finally()`
  // drops it — a `skip()` in between then misses the second. Upgrade path:
  // a Map<view, count>, deleted at zero.
  const statesPlaying = new Set<NonNullable<CellLike['view']>>();
  const tracked =
    <S>(run: (step: S, opts?: StepOpts) => Promise<void>) =>
    async (step: S, opts?: StepOpts) => {
      lastOpts = opts;
      inFlight++;
      try {
        await run(step, opts);
      } finally {
        if (--inFlight === 0 && pendingRepaint) {
          const { remount } = pendingRepaint;
          pendingRepaint = false;
          repaint(remount);
        }
      }
    };
  return {
    spinTo: tracked(async (step: SpinToStep, opts?: StepOpts) => {
      await reelSystem.spin(toCellBoard(step.board), { turbo: opts?.turbo });
      bindAll();
    }),

    // `turbo` reaches nothing here, and that is measured rather than missed:
    // the only time this step spends is `SymbolCell.playWin()`,
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

    // Not `revealWins` with a field: no amount, no line — a named state
    // (`symbols.yml`'s `states`) played on cells the mechanic chose, win or
    // not. Reaches the view directly, never through `spin`/`cascade`: the
    // reel system has no notion of a symbol's own states at all. A cell
    // past a short reel (`getCell` answers `undefined`), an empty cell (no
    // view) and a plain `SymbolView` with no `playState` of its own are all
    // skipped rather than thrown over — the same tolerance `bindAll` already
    // has for a ragged grid.
    //
    // `step.wait` is not read here, on purpose: it is the PLAN's field, not
    // the board's. Every cell is started and this settles when the last one
    // ends; whether `executePlan` holds for that promise or starts the next
    // step over the top of it (`wait: false`) is its call, for every step
    // kind at once — see `@energy8engine/play-loop`'s module doc.
    playState: tracked(async (step: PlayStateStep) => {
      const views = step.cells
        .map(({ col, row }) => (reelSystem.grid.getCell(col, row) as CellLike | undefined)?.view)
        .filter((v): v is NonNullable<typeof v> => !!v?.playState);
      await Promise.all(
        views.map((v) => {
          statesPlaying.add(v);
          return v.playState!(step.state).finally(() => statesPlaying.delete(v));
        }),
      );
    }),

    refill: tracked(async (step: RefillStep) => {
      reelSystem.setBoard(toCellBoard(step.board));
      bindAll();
    }),

    // One vocabulary step, one reel-core `TumbleStep`, one `cascade` call — a
    // chain of N rounds arrives as N of these, each settling on its own board.
    // (`cascade` is generic over the step and loops; handing it one step per
    // call is what keeps `executePlan`'s one-step-at-a-time contract intact.)
    //
    // A `remove`-style re-sync afterwards, and it is not redundant with the
    // `board = settledGrid` the reel system's `cascade` assigns as each step lands.
    // That assignment updates the ReelSystem's own closure only; the CELLS are
    // seated by `TumbleController`'s own `setGrid(settledGrid)`, which its
    // `_dead` guard skips entirely once the round was SKIPPED (or the grid
    // destroyed). Left alone, a skipped tumble leaves the visible grid on the
    // pre-tumble board while `reelSystem.board` — and `ctx.board` with it —
    // reports `settled`, and the `bindAll()` below re-binds that stale data.
    // `setBoard` is `setData` per cell (via `grid.setGrid`), so on the clean
    // path this is an idempotent re-seat of what the tumble just landed.
    tumble: tracked(async (step: TumbleStep, opts?: StepOpts) => {
      const settled = toCellBoard(step.settled);
      await reelSystem.cascade(
        [
          {
            winningCells: step.winning,
            removedCells: step.removed,
            drops: step.drops,
            // reel-core's `newCells.symbol` is a bare string: a record's extras
            // cannot ride here. They do not need to — `settledGrid` below is
            // what each cell takes its data from once the drop lands.
            //
            // The cast is for an EMPTY fresh cell. `cellData` answers `null`
            // there, and `null` is exactly what the controller's
            // `cell.setData({ symbol })` means by "no symbol" — the same value
            // `remove()` above hands it. The field is typed `string`
            // only because nothing had given it an empty one before; `?? ''`
            // would be strictly worse, since `resolve('')` is a symbol lookup
            // that cannot succeed.
            newCells: step.fresh.map(({ col, row, symbol }) => ({
              col,
              row,
              symbol: cellData(symbol).symbol as string,
            })),
            settledGrid: settled,
          },
        ],
        { turbo: opts?.turbo },
      );
      reelSystem.setBoard(settled);
      bindAll();
    }),

    // Collapse whatever is animating — `ReelSystem.skip()` forwards to the
    // live motion runner and every board controller's runner. Synchronous:
    // the op's own promise resolves a moment later, on its own.
    //
    // It is not only the in-flight ops: unless `opts.overlays` is `false`,
    // that same call kills every tween on the `fx` overlay layer and then
    // removes and destroys its children — so a bespoke ring, label or sprite
    // a game drew there is gone after a skip, whether or not anything was
    // animating. play-loop's latched skip sweeps it once per skipped run (the
    // skip that latched it) and re-fans every later step with
    // `{ overlays: false }`, so what a game draws after the first skip stays.
    //
    // `reelSystem.skip()` doesn't know a cell's `playState` exists at all —
    // that's this board's own bookkeeping, not the reel system's — so a
    // `playState` still in flight is collapsed here explicitly, the same
    // "hurry to the end state" bargain `skip()` already makes for everything
    // else. `showStatic()` on each is enough: the `.finally()` on `playState`'s
    // own promise (above) already removes it from `statesPlaying`, so calling
    // it twice for the same view can't happen.
    skip(opts?: { overlays?: boolean }) {
      for (const view of statesPlaying) view.showStatic?.();
      statesPlaying.clear();
      reelSystem.skip(opts);
    },

    // Forces a redraw without changing any symbol — a config edit (e.g. a frame style) that
    // `setBoard` alone would pick up on the NEXT spin/refill, made visible right away — or,
    // with an op in flight, as soon as it lands. An unchanged symbol keeps its view (F9);
    // `remount: true` re-resolves every cell's view — for art that reaches a view only on a
    // fresh mount (a symbol state's late-loaded scene, `@energy8engine/symbols`).
    repaint(opts?: { remount?: boolean }) {
      const remount = !!opts?.remount;
      if (inFlight > 0) pendingRepaint = { remount: remount || (pendingRepaint && pendingRepaint.remount) };
      else repaint(remount);
    },

    get cellSize() {
      const size = reelSystem.config?.grid.cellSize ?? 96;
      return { width: size, height: size };
    },

    // The reel system's own config (`grid`, `win`), read-only, so a project's
    // step handler can place itself against the SAME geometry this board
    // draws with instead of guessing it.
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
  /** Re-seats the current board so every cell redraws (`remount: true` re-resolves each view too) — after any op in flight lands; a no-op after `destroy()`. */
  repaint(opts?: { remount?: boolean }): void;
  /** One cell's footprint — square, from the reel config's `grid.cellSize` (96 when absent). */
  readonly cellSize: { width: number; height: number };
  /** The live reel system's config (`grid`, `win`) — the geometry a project's own step can draw against. */
  readonly config: ReelSystem['config'] | undefined;
  /** The `StepOpts` the last board method was handed; `undefined` before the first one. */
  readonly lastOpts: StepOpts | undefined;
  /** Collapse every in-flight animation to its end state (`overlays: false` spares `fx`); a no-op after `destroy()`. */
  skip(opts?: { overlays?: boolean }): void;
  /** The reel system underneath — what the row provides as the `reels` service, for motion/controller rows to register into. */
  readonly system: ReelSystem;
  destroy(): void;
}

/**
 * Constructs the real reel system and wraps it as `BoardApi` in one
 * call — the production entry point. `boardFromReelSystem` above is what
 * this package's tests exercise directly, against a fake; this function is
 * covered by a lighter construction/wiring check, since the animated paths
 * it drives (a motion style's `spin`, `playWin`) cannot settle without a
 * live pixi `Application` running its ticker (see the module doc above).
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
    playState: guarded(api.playState),
    view: reelSystem.view,
    grid: reelSystem.grid,
    system: reelSystem,
    // Unlike the BoardApi methods above, a stale repaint/skip is nothing to refuse over —
    // there is no spin result either could misreport — so these are no-ops, not throws.
    repaint(opts?: { remount?: boolean }) {
      if (!destroyed) api.repaint(opts);
    },
    skip(opts?: { overlays?: boolean }) {
      if (!destroyed) api.skip(opts);
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
