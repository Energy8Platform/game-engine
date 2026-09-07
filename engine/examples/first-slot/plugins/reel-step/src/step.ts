/**
 * `reel-step`: the other half. The mechanic (`./mechanic.ts`) invents a step
 * the board has never heard of; this is the code that performs it.
 *
 * It is written against the legacy `ReelStepController`
 * (`@energy8platform/game-engine/slot`, a public export) rather than
 * re-deriving the animation: that controller already lays out the scroll
 * tape, pays the winning cells, decelerates later rounds and cleans up after
 * a torn-down grid. Reading it was allowed; changing it was not, and nothing
 * here does.
 *
 * **What it needs, and where each piece comes from.** All four are public
 * exports or services somebody else already provides — nothing was added to
 * the engine for this file:
 *
 *  - the grid: `board.grid` off whatever `executePlan` hands the handler.
 *    `@energy8engine/reels`' `ReelsBoard` exposes it (narrowly typed there
 *    as `GridLike`, a real `ReelGrid` at runtime — hence the cast below,
 *    which is checked at run time, not assumed).
 *  - the art: a `SymbolResolver`, off the `assets` service the game's own
 *    page provides (`createGame({ provide: { assets: { resolve } } })`) —
 *    the same channel `reels1` reads its resolver through.
 *  - the timings: `DEFAULT_REEL_CONFIG.cascade`, with `enabled: true`. The
 *    shipped default is `false`, and with it off the controller skips the
 *    scroll and simply snaps the settled board into place. That is a
 *    correct board and a silent one, so this turns it on; a row can
 *    override any of it (see `CascadeOverride`).
 *  - the order: `step.index`, carried on the step by the mechanic, because
 *    `StepHandler.run` sees one step at a time with no position.
 *
 * **Failures.** `run` throws rather than returning something — that is the
 * sanctioned channel here, not an escape from one: `executePlan` catches a
 * handler's throw and records it as a `Diagnostic`, then runs the rest of
 * the plan (its own tests pin exactly that). So a board that is not a reel
 * board, or a composition with no art, ends up as one readable line on the
 * failure screen instead of a frozen animation. Nothing throws out of
 * `apply` — see `./index.ts`.
 */
import {
  DEFAULT_REEL_CONFIG,
  ReelStepController,
  type CascadeConfig,
  type CellData,
  type ReelGrid,
  type SymbolResolver,
  type WinConfig,
} from '@energy8platform/game-engine/slot';
import type { Board, PresentationStep } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import type { ReelStepStep } from './mechanic';

/** What a row may override on the scroll. Shallow — a row sets whole sub-objects, not leaves. */
export type CascadeOverride = Partial<CascadeConfig>;

/**
 * The slice of the board this handler drives. `executePlan` types `board` as
 * `unknown` (it has no idea what a plugin's step needs), so this states the
 * shape and the handler checks it before trusting it.
 */
interface ReelStepBoard {
  /** Declared as the real thing; `isReelStepBoard` is what actually checks it. */
  grid: ReelGrid;
  /** The one built-in step this handler reuses — see `run` for why. */
  refill(step: { kind: 'refill'; board: Board }): Promise<void>;
}

/** Symbol ids are numbers in the step vocabulary; the legacy resolver is keyed by string. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((symbolId) => ({ symbol: String(symbolId) })));
}

/** A `ReelGrid` is recognised by what this handler actually calls on it, not by `instanceof`. */
function isReelGrid(value: unknown): value is ReelGrid {
  const candidate = value as Partial<ReelGrid> | null | undefined;
  return (
    typeof candidate?.getCell === 'function' &&
    typeof candidate?.rowsOf === 'function' &&
    typeof candidate?.cellPosition === 'function' &&
    typeof candidate?.setGrid === 'function'
  );
}

function isReelStepBoard(value: unknown): value is ReelStepBoard {
  const candidate = value as Partial<ReelStepBoard> | null | undefined;
  return candidate != null && typeof candidate.refill === 'function' && isReelGrid(candidate.grid);
}

/**
 * Builds the handler. `resolve` is looked up lazily, per run, rather than
 * captured at build time: a composition can legitimately provide its art
 * after this row applies, and a handler that captured `undefined` once would
 * stay broken for the life of the page.
 */
export function createReelStepHandler(options: {
  resolve: () => SymbolResolver | undefined;
  cascade?: CascadeOverride;
  win?: WinConfig;
}): StepHandler {
  const cascade: CascadeConfig = {
    ...DEFAULT_REEL_CONFIG.cascade,
    enabled: true,
    ...(options.cascade ?? {}),
  };
  const win: WinConfig = options.win ?? DEFAULT_REEL_CONFIG.win;

  // One controller per grid. The grid is rebuilt whenever the reel row's
  // geometry changes, and a controller holding a destroyed grid does
  // nothing useful (it checks `grid.destroyed` and returns) — so the
  // identity of the grid, not of the board, is what a cached controller is
  // keyed on.
  let controller: ReelStepController | null = null;
  let boundGrid: ReelGrid | null = null;

  return {
    kind: 'reelStep',

    async run(step: PresentationStep, board: unknown): Promise<void> {
      // The documented double cast — see `ReelStepStep`'s doc in
      // `./mechanic.ts` and `StepHandler`'s in `@energy8engine/play-loop`.
      const reelStep = step as unknown as ReelStepStep;

      if (!isReelStepBoard(board)) {
        throw new Error(
          'the "reelStep" step needs a reel board to run on: nothing with a reel grid was ' +
            'composed (the "reels1" row, @energy8engine/reels, is what normally provides one)',
        );
      }

      const resolve = options.resolve();
      if (typeof resolve !== 'function') {
        throw new Error(
          'the "reelStep" step needs the game\'s symbol art: no "assets" service with a ' +
            "resolve(symbolId) was provided (a .yml row cannot carry a function — the game's " +
            'own page passes it through createGame({ provide: { assets } }))',
        );
      }

      if (controller === null || boundGrid !== board.grid) {
        boundGrid = board.grid;
        controller = new ReelStepController(boundGrid, resolve, cascade, win);
      }

      await controller.step(
        {
          winningCells: reelStep.winning,
          shifts: reelStep.shifts,
          settledGrid: toCellBoard(reelStep.settled),
        },
        reelStep.index,
      );

      // The controller settles the board by calling `grid.setGrid(...)`,
      // which repaints the cells but never reaches the ReelSystem's own
      // `board` closure — that only moves inside `setBoard`/`spin`/
      // `cascade`/`reelStep`. `@energy8engine/reels` found the same gap in
      // its own `remove()` and closed it the same way; the difference is
      // that from out here the only door to `setBoard` is the board's public
      // `refill`, so that is the door used. Re-applying a board the grid is
      // already showing is synchronous and idempotent, so it costs nothing
      // visually — and without it `ctx.board` would keep reporting the
      // pre-scroll symbols to everything that reads it.
      await board.refill({ kind: 'refill', board: reelStep.settled });
    },
  };
}
