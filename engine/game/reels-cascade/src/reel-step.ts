/**
 * The `reelStep` step handler — ported from `first-slot`'s project plugin
 * (`plugins/reel-step/src/step.ts`), which drove the LEGACY `ReelStepController` against
 * `board.grid`. This one drives the forked controller (`@energy8engine/reel-core`) against the
 * reel system's own kit: `reels().kit()` hands it the live grid, the symbol art (`resolve`) and
 * the win presentation, so the handler no longer reaches into the board or an `assets` service.
 *
 * **Failures.** `run` throws rather than returning something — `executePlan` catches a
 * handler's throw and records it as a `Diagnostic`, then runs the rest of the plan. So a
 * composition with no `reels1` row, or a board with no `refill`, ends up as one readable line on
 * the failure screen instead of a frozen animation.
 *
 * **Tempo.** `opts` (`StepOpts`) is forwarded to `controller.step` (turbo halves its timings)
 * and to `board.refill` — which records what it was last called with (`ReelsBoard.lastOpts`),
 * so calling it with no `opts` would overwrite what `spinTo` had recorded.
 */
import {
  ReelStepController,
  type CascadeConfig,
  type CellData,
  type ReelGrid,
  type ReelSystem,
} from '@energy8engine/reel-core';
import { cellData } from '@energy8engine/contracts';
import type { Board, PresentationStep, StepOpts } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';

/**
 * The step this handler performs. A plain interface, not `extends UnknownPresentationStep`
 * (the index signature would swallow excess properties on literals) — narrowed with the double
 * cast `StepHandler`'s doc prescribes.
 */
export interface ReelStepStep {
  kind: 'reelStep';
  /** Cells to pay before the reels move. */
  winning: { col: number; row: number }[];
  /** Per-reel scroll distance, in cells. */
  shifts: number[];
  /** The board the reels land on once they have. */
  settled: Board;
  /** Which round of the chain this is, from 0 — the controller decelerates later rounds. */
  index: number;
}

/** The slice of the board this handler drives: the one built-in step it reuses. */
interface RefillBoard {
  refill(step: { kind: 'refill'; board: Board }, opts?: StepOpts): Promise<void>;
}

function isRefillBoard(value: unknown): value is RefillBoard {
  return typeof (value as Partial<RefillBoard> | null | undefined)?.refill === 'function';
}

/** Each `Board` cell — a number, a name, or a record — through the shared `cellData()` mapping. */
function toCellBoard(board: Board): CellData[][] {
  return board.map((col) => col.map((cell) => cellData(cell) as CellData));
}

/**
 * Builds the handler. `reels` and `cascade` are read per run, not captured: the `reels` row is
 * `hot`, and a re-apply provides a new `ReelSystem` (with a new grid) under the same handler.
 */
export function createReelStepHandler(deps: {
  reels: () => ReelSystem | undefined;
  cascade: () => CascadeConfig;
}): StepHandler {
  // One controller per grid: a controller holding a destroyed grid does nothing useful, so the
  // identity of the kit's grid is what the cached controller is keyed on.
  let controller: ReelStepController | null = null;
  let boundGrid: ReelGrid | null = null;

  return {
    kind: 'reelStep',

    async run(step: PresentationStep, board: unknown, opts?: StepOpts): Promise<void> {
      const reelStep = step as unknown as ReelStepStep;

      const reels = deps.reels();
      if (!reels) {
        throw new Error(
          'the "reelStep" step needs the reel system: no "reels" service was composed ' +
            '(the "reels1" row, @energy8engine/reels, is what provides one)',
        );
      }
      if (!isRefillBoard(board)) {
        throw new Error(
          'the "reelStep" step needs a reel board to run on: nothing with refill() was ' +
            'composed (the "reels1" row, @energy8engine/reels, is what normally provides one)',
        );
      }

      const kit = reels.kit();
      if (controller === null || boundGrid !== kit.grid) {
        boundGrid = kit.grid;
        controller = new ReelStepController(kit.grid, kit.resolve, deps.cascade(), kit.win);
      }

      await controller.step(
        {
          winningCells: reelStep.winning,
          shifts: reelStep.shifts,
          settledGrid: toCellBoard(reelStep.settled),
        },
        reelStep.index,
        opts,
      );

      // The controller settles the grid by `grid.setGrid(...)`, which never reaches the reel
      // system's own `board` closure; the board's public `refill` (→ `setBoard`) is the door
      // that does. Re-applying a board the grid already shows is synchronous and idempotent.
      await board.refill({ kind: 'refill', board: reelStep.settled }, opts);
    },
  };
}
