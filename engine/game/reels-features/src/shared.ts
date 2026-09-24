/**
 * What every feature handler stands on. A feature step carries an OUTCOME the mechanic already
 * decided (which reel expands, which cells reveal to what); the handler checks it against the live
 * grid, animates it, and re-seats the board where the data says it ends. It never draws a number.
 *
 *  - `checkCells` / `need` — the data check and the kit/board lookup. Both THROW: `executePlan`
 *    turns a handler's throw into the ordinary `step "<kind>" failed: …` diagnostic, and since both
 *    run before anything moves, the board is untouched.
 *  - `reseat` — the end of every handler: the live board with the changed cells, through the reels
 *    board's `refill` (so `ctx.board`, `__e8.symbols()` and the symbols row's `bind` all see it).
 *  - `createPace` — one run's tempo: turbo halves every duration (the `tumble` rule), a skip zeroes
 *    what is still to start.
 *  - `createFeatureHandler` — the one handler shape the kinds share (see its doc for skip).
 */
import {
  glowRing,
  type CellData,
  type ReelGrid,
  type ReelKit,
  type ReelSystem,
  type SymbolCell,
} from '@energy8engine/reel-core';
import { Tween } from '@energy8platform/game-engine/animation';
import type { Board, PresentationStep, StepOpts } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import type { OverlayLayer } from './layer';

export type Cell = { col: number; row: number };

/**
 * What a handler reads per run, never captures: `reels1` is `hot`, and a re-apply provides a new
 * `ReelSystem` (a new grid) under the same handler; the row's config and layer follow it.
 */
export interface FeatureDeps<C> {
  reels(): ReelSystem | undefined;
  config(): C;
  layer(): OverlayLayer | undefined;
}

/** The slice of the reels board a feature drives: the one built-in step it re-seats through. */
export interface RefillBoard {
  refill(step: { kind: 'refill'; board: Board }, opts?: StepOpts): Promise<void>;
}

/** One cell a step changes, and the data it ends on. */
export type Change = Cell & { data: CellData };

/**
 * Throws `${kind}: ${field}[${i}] (${col}, ${row}) is outside the grid` for a cell past a reel's
 * own height (rowsOf) or past cols; `${kind}: ${field} is empty` for [].
 */
export function checkCells(kind: string, grid: ReelGrid, cells: Cell[], field = 'cells'): void {
  if (!cells?.length) throw new Error(`${kind}: ${field} is empty`);
  cells.forEach((cell, i) => {
    const { col, row } = cell ?? {};
    const inside =
      Number.isInteger(col) &&
      Number.isInteger(row) &&
      col >= 0 &&
      col < grid.cols &&
      row >= 0 &&
      // a ragged (Megaways) grid: a short reel ends before `grid.rows` does
      row < grid.rowsOf(col);
    if (!inside) throw new Error(`${kind}: ${field}[${i}] (${col}, ${row}) is outside the grid`);
  });
}

/** The live board with `changes` applied, re-seated through the board's refill (→ ctx.board, symbols bind). */
export async function reseat(
  board: RefillBoard,
  kit: ReelKit,
  changes: Change[],
  opts?: StepOpts,
): Promise<void> {
  // a copy: `kit.board` is the reel system's own, and the refill is what changes it
  const next = kit.board.map((col) => col.slice());
  for (const { col, row, data } of changes) next[col][row] = data;
  // `CellData` is a `BoardCell` (`{ symbol, ...extras }`), minus the index signature TS wants
  await board.refill({ kind: 'refill', board: next as unknown as Board }, opts);
}

/** Turbo and skip for one run: `ms(n)` is n × 0.5 under turbo, 0 once skipped; `skipped` is read after every await. */
export interface Pace {
  ms(n: number): number;
  readonly skipped: boolean;
  skip(): void;
}

export function createPace(opts?: StepOpts): Pace {
  const factor = opts?.turbo ? 0.5 : 1;
  let skipped = false;
  return {
    ms: (n) => (skipped ? 0 : n * factor),
    get skipped() {
      return skipped;
    },
    skip() {
      skipped = true;
    },
  };
}

function isRefillBoard(value: unknown): value is RefillBoard {
  return typeof (value as Partial<RefillBoard> | null | undefined)?.refill === 'function';
}

/** The (kit, board) pair a handler needs, or a throw naming what is missing — the reels-cascade messages. */
export function need(
  kind: string,
  deps: FeatureDeps<unknown>,
  board: unknown,
): { kit: ReelKit; board: RefillBoard; reels: ReelSystem } {
  const reels = deps.reels();
  if (!reels) {
    throw new Error(
      `the "${kind}" step needs the reel system: no "reels" service was composed ` +
        '(the "reels1" row, @energy8engine/reels, is what provides one)',
    );
  }
  if (!isRefillBoard(board)) {
    throw new Error(
      `the "${kind}" step needs a reel board to run on: nothing with refill() was ` +
        'composed (the "reels1" row, @energy8engine/reels, is what normally provides one)',
    );
  }
  return { kit: reels.kit(), board, reels };
}

/** What one run's animation works with. */
export interface FeatureRun {
  readonly kit: ReelKit;
  readonly pace: Pace;
  /** The grid's cell, remembered for the run: a skip kills its tweens, the run's end puts it home (its centre, scale 1, alpha 1). */
  cell(col: number, row: number): SymbolCell;
  /** A transient `glowRing` on `kit.fx`, gone when the run ends. */
  ring(col: number, row: number, color: number): void;
}

/** A kind, as `createFeatureHandler` takes it. */
export interface Feature<S, C> {
  /** Checks `step` against the live grid (throws naming the bad field) and answers the cells it changes — before anything moves. */
  changes(step: S, grid: ReelGrid): Change[];
  /** Plays the step. Reads `run.pace.skipped` after every await and stops starting things once it is set. */
  animate(step: S, changes: Change[], run: FeatureRun, config: C): Promise<void>;
}

/**
 * The handler every kind is: `need` → `changes` (the data check) → `animate` → `reseat`.
 *
 * **Skip.** play-loop's skip reaches `skip()` mid-run, and — latched — re-fans it onto every later
 * step right after that step's `run` was called; so the pace is made synchronously at the start of
 * `run`, never carried over: a skip that lands between two steps finds no live run and the next
 * one starts unskipped. A skip kills the tweens of every cell the run touched and lets `run` go on
 * at once — it does not wait for the animation, which may be in a `Tween.delay` (a stagger, a
 * hold) no kill reaches; that tail sees `pace.skipped` when it wakes and starts nothing. A killed
 * fx primitive (`morphSymbol`, `pulseCell`) starts its next tween one job later — ahead of `run`'s
 * own continuation — so the run's end kills again, then puts every touched cell home and disposes
 * its rings before re-seating the board.
 */
export function createFeatureHandler<S, C>(
  kind: string,
  deps: FeatureDeps<C>,
  feature: Feature<S, C>,
): StepHandler {
  /** Each live run's skip — a `wait: false` step can overlap the next one of its kind. */
  const live = new Set<() => void>();

  return {
    kind,

    skip: () => live.forEach((skip) => skip()),

    async run(raw: PresentationStep, board: unknown, opts?: StepOpts): Promise<void> {
      const step = raw as unknown as S;
      const { kit, board: target } = need(kind, deps, board);
      const changes = feature.changes(step, kit.grid);

      const pace = createPace(opts);
      const cells = new Map<SymbolCell, Cell>();
      const rings: (() => void)[] = [];
      let release!: () => void;
      const skipped = new Promise<void>((r) => (release = r));
      // kills first: the killed chains resume (and start their next tween) before `run` does
      const skip = () => {
        cells.forEach((_, cell) => Tween.killTweensOf(cell));
        pace.skip();
        release();
      };
      live.add(skip);

      const run: FeatureRun = {
        kit,
        pace,
        cell(col, row) {
          const cell = kit.grid.getCell(col, row);
          cells.set(cell, { col, row });
          return cell;
        },
        ring(col, row, color) {
          rings.push(glowRing(kit.fx, kit.grid, col, row, color));
        },
      };

      try {
        await Promise.race([feature.animate(step, changes, run, deps.config()), skipped]);
      } finally {
        live.delete(skip);
        rings.forEach((dispose) => dispose());
        cells.forEach(({ col, row }, cell) => {
          Tween.killTweensOf(cell);
          if (cell.destroyed) return;
          const home = kit.grid.cellPosition(col, row);
          cell.position.set(home.x, home.y);
          cell.scale.set(1);
          cell.alpha = 1;
        });
      }
      // no cell changed (a kind that only draws on the layer) — nothing to re-seat
      if (changes.length) await reseat(target, kit, changes, opts);
    },
  };
}
