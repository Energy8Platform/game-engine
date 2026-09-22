/**
 * The two halves, joined. `plan.test.ts` checks what the mechanic emits and
 * `step.test.ts` checks what the handler does with a step; neither checked
 * that the handler is handed what the mechanic actually produced — the
 * handler's tests build their own `QUIET_STEP` instead. So a plan that
 * carried the wrong cells, or the wrong round index, would satisfy both
 * files and still pay the wrong cells on the board.
 *
 * This runs a REAL plan from `plan()` through the REAL `executePlan` and the
 * REAL registry, with only the legacy `ReelStepController` replaced — by a
 * recorder, because the genuine one drives `Tween`/`Ticker.shared` and never
 * settles without a live pixi `Application` (see `step.test.ts`'s module
 * doc). What the recorder captures is exactly the boundary this file exists
 * to pin: the `ReelStepData` and the step index the handler hands the
 * controller, per round, in order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardStepRegistry, executePlan } from '@energy8engine/play-loop';
import type { BoardApi } from '@energy8engine/play-loop';
import type { PresentationStep } from '@energy8engine/contracts';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';

/** Every `controller.step(data, index)` call the handler made, in order. */
interface Recorded {
  winningCells: { col: number; row: number }[];
  shifts: number[];
  settledGrid: { symbol: string | null }[][];
  index: number | undefined;
}
const recorded: Recorded[] = [];

vi.mock('@energy8platform/game-engine/slot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@energy8platform/game-engine/slot')>();
  return {
    ...actual,
    // Only this one is replaced. `DEFAULT_REEL_CONFIG` stays real, so the
    // config the handler builds (and the `enabled: true` it sets) is the
    // real thing rather than a stand-in that could drift from it.
    ReelStepController: class {
      // eslint-disable-next-line @typescript-eslint/no-useless-constructor
      constructor(..._args: unknown[]) {}
      async step(data: Omit<Recorded, 'index'>, index?: number) {
        recorded.push({ ...data, index });
      }
    },
  };
});

// Imported AFTER the mock declaration on purpose — `vi.mock` is hoisted, so
// these pick up the replacement.
const { plan } = await import('../src/mechanic');
const { createReelStepHandler } = await import('../src/step');

const DATA = {
  grid: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  reel_steps: [
    {
      winning: [{ col: 0, row: 0 }],
      shifts: [1, 0],
      settled: [
        [7, 1, 2],
        [4, 5, 6],
      ],
      win: 0.5,
    },
    {
      winning: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
      shifts: [0, 2],
      settled: [
        [7, 1, 2],
        [8, 9, 4],
      ],
      win: 1.25,
    },
  ],
};

/** A board that records the built-in steps and satisfies the handler's guard. */
function fakeBoard() {
  const calls: string[] = [];
  return {
    calls,
    grid: {
      destroyed: false,
      getCell: vi.fn(),
      rowsOf: vi.fn(() => 3),
      cellPosition: vi.fn(() => ({ x: 0, y: 0 })),
      setGrid: vi.fn(),
    },
    async spinTo(step: { board: number[][] }) {
      calls.push(`spinTo:${JSON.stringify(step.board)}`);
    },
    async revealWins(step: { total: number }) {
      calls.push(`revealWins:${step.total}`);
    },
    // A real `ReelsBoard` carries this one (`@energy8engine/reels`); a board
    // that did not would make `executePlan` report the plan's `playState`
    // rather than run it, which is exactly what the `diagnostics` assertion
    // below would catch.
    async playState(step: { cells: { col: number; row: number }[]; state: string }) {
      calls.push(`playState:${step.state}:${JSON.stringify(step.cells)}`);
    },
    async refill(step: { board: number[][] }) {
      calls.push(`refill:${JSON.stringify(step.board)}`);
    },
  };
}

const stubResolve = () => (() => ({})) as unknown as SymbolResolver;

beforeEach(() => {
  recorded.length = 0;
});

describe('reel-step: the plan the mechanic emits is the plan the board runs', () => {
  it('hands the controller each round’s own cells, shifts, board and position', async () => {
    const board = fakeBoard();
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: stubResolve }));

    const diagnostics = await executePlan(
      plan(DATA) as PresentationStep[],
      board as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toEqual([]);
    expect(recorded).toEqual([
      {
        winningCells: DATA.reel_steps[0].winning,
        shifts: [1, 0],
        // Symbol ids are numbers in the step vocabulary and strings to the
        // legacy resolver — asserted, not assumed, because the conversion
        // is the handler's and nothing else checks it.
        settledGrid: [
          [{ symbol: '7' }, { symbol: '1' }, { symbol: '2' }],
          [{ symbol: '4' }, { symbol: '5' }, { symbol: '6' }],
        ],
        index: 0,
      },
      {
        winningCells: DATA.reel_steps[1].winning,
        shifts: [0, 2],
        settledGrid: [
          [{ symbol: '7' }, { symbol: '1' }, { symbol: '2' }],
          [{ symbol: '8' }, { symbol: '9' }, { symbol: '4' }],
        ],
        index: 1,
      },
    ]);
  });

  it('and the built-in steps around them keep their own content too', async () => {
    const board = fakeBoard();
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: stubResolve }));

    await executePlan(plan(DATA) as PresentationStep[], board as unknown as BoardApi, registry);

    // The reels land on the pre-chain board, each round's payout is read
    // out and its paid cells pop before its scroll, and each scroll
    // re-syncs the board it settled onto — the whole sequence, by content.
    expect(board.calls).toEqual([
      `spinTo:${JSON.stringify(DATA.grid)}`,
      'revealWins:0.5',
      `playState:pop:${JSON.stringify(DATA.reel_steps[0].winning)}`,
      `refill:${JSON.stringify(DATA.reel_steps[0].settled)}`,
      'revealWins:1.25',
      `playState:pop:${JSON.stringify(DATA.reel_steps[1].winning)}`,
      `refill:${JSON.stringify(DATA.reel_steps[1].settled)}`,
    ]);
  });
});
