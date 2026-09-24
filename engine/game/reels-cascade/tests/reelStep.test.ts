/**
 * Ported from `first-slot`'s `plugins/reel-step` (`step.test.ts` + `chain.test.ts`): the same
 * cases, run against this package's handler. What moved: the grid and `resolve` now come from
 * `ctx.reels.kit()` (here a fake `reels`), the cascade config from the row. What did not: the
 * assertions.
 *
 * The animated path is not tested here for the reason `first-slot`'s own tests gave:
 * `ReelStepController.step` pays and scrolls through `Tween`/`Ticker.shared`, which never
 * settles without a live pixi `Application`. The real controller runs only the quiet step (no
 * winners, no shift), which it completes synchronously; the chain cases replace it with a
 * recorder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardStepRegistry, executePlan } from '@energy8engine/play-loop';
import type { BoardApi } from '@energy8engine/play-loop';
import type { PresentationStep } from '@energy8engine/contracts';
import { DEFAULT_REEL_CONFIG, type ReelSystem } from '@energy8engine/reel-core';
import type { ReelStepStep } from '../src/reelStep';

/** Every `controller.step(data, index)` call the recorder saw, in order (chain cases only). */
interface Recorded {
  winningCells: { col: number; row: number }[];
  shifts: number[];
  settledGrid: { symbol: string | null }[][];
  index: number | undefined;
}
const recorded: Recorded[] = [];
let recording = false;
/** When on, `step` holds (never settles by itself) until the controller's `skip()` releases it. */
let holding = false;
let skipCalls = 0;
const constructed: unknown[][] = [];

vi.mock('@energy8engine/reel-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@energy8engine/reel-core')>();
  const Real = actual.ReelStepController;
  return {
    ...actual,
    // Records when `recording` is on, holds when `holding` is on; otherwise the real
    // controller does the work.
    ReelStepController: class {
      private real: InstanceType<typeof Real>;
      private release: (() => void) | null = null;
      constructor(...args: ConstructorParameters<typeof Real>) {
        constructed.push(args);
        this.real = new Real(...args);
      }
      async step(data: Omit<Recorded, 'index'>, index?: number, opts?: { turbo?: boolean }) {
        if (recording) recorded.push({ ...data, index });
        else if (holding) await new Promise<void>((r) => (this.release = r));
        else await this.real.step(data as never, index, opts);
      }
      skip() {
        skipCalls++;
        this.release?.();
      }
    },
  };
});

const { createReelStepHandler } = await import('../src/reelStep');

const SETTLED = [
  [7, 1, 2],
  [4, 5, 6],
];

const QUIET_STEP: ReelStepStep = {
  kind: 'reelStep',
  winning: [],
  shifts: [0, 0],
  settled: SETTLED,
  index: 0,
};
const asStep = (step: ReelStepStep): PresentationStep => step as unknown as PresentationStep;

/** Enough of a `ReelGrid` for the path the quiet step takes. */
function fakeGrid(calls: string[]) {
  return {
    destroyed: false,
    getCell: vi.fn(),
    rowsOf: vi.fn(() => 3),
    cellPosition: vi.fn(() => ({ x: 0, y: 0 })),
    setGrid: vi.fn(() => {
      calls.push('grid.setGrid');
    }),
  };
}

/** A fake `reels` whose `kit()` hands out the grid, `resolve` and `win`. */
function fakeReels(calls: string[], resolve: unknown = () => ({})) {
  const kit = { grid: fakeGrid(calls), resolve, win: DEFAULT_REEL_CONFIG.win };
  return { kit: () => kit } as unknown as ReelSystem;
}

/** A board that records the built-in steps it is asked for. */
function fakeBoard(calls: string[]) {
  return {
    async spinTo(step: { board: number[][] }) {
      calls.push(`spinTo:${JSON.stringify(step.board)}`);
    },
    async revealWins(step: { total: number }) {
      calls.push(`revealWins:${step.total}`);
    },
    async playState(step: { cells: { col: number; row: number }[]; state: string }) {
      calls.push(`playState:${step.state}:${JSON.stringify(step.cells)}`);
    },
    async refill(step: { board: number[][] }) {
      calls.push(`refill:${JSON.stringify(step.board)}`);
    },
  };
}

const { enabled: _enabled, ...CASCADE } = DEFAULT_REEL_CONFIG.cascade;
const cascade = () => ({ ...CASCADE, enabled: true });

function handlerFor(reels: ReelSystem | undefined) {
  return createReelStepHandler({ reels: () => reels, cascade });
}

beforeEach(() => {
  recorded.length = 0;
  constructed.length = 0;
  recording = false;
  holding = false;
  skipCalls = 0;
});

describe('reelStep: the step the board did not have', () => {
  it('is a kind the board has no method for — without the handler it is a diagnostic', async () => {
    const calls: string[] = [];
    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      fakeBoard(calls) as unknown as BoardApi,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reelStep');
    expect(calls).toEqual([]);
  });

  it('runs through the registry, reaches the grid, and re-syncs the board', async () => {
    const calls: string[] = [];
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(fakeReels(calls)));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      fakeBoard(calls) as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toEqual([]);
    expect(calls).toEqual(['grid.setGrid', `refill:${JSON.stringify(SETTLED)}`]);
  });

  it('builds the controller from the kit and the row config, with enabled on', async () => {
    const calls: string[] = [];
    const reels = fakeReels(calls);
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(reels));

    await executePlan(
      [asStep(QUIET_STEP), asStep(QUIET_STEP)],
      fakeBoard(calls) as unknown as BoardApi,
      registry,
    );

    const kit = reels.kit();
    // one controller for the two steps — the grid did not change
    expect(constructed).toEqual([[kit.grid, kit.resolve, { ...CASCADE, enabled: true }, kit.win]]);
  });

  it('a new grid gets a new controller', async () => {
    const calls: string[] = [];
    let reels = fakeReels(calls);
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ reels: () => reels, cascade }));
    const board = fakeBoard(calls) as unknown as BoardApi;

    await executePlan([asStep(QUIET_STEP)], board, registry);
    reels = fakeReels(calls);
    await executePlan([asStep(QUIET_STEP)], board, registry);

    expect(constructed).toHaveLength(2);
    expect(constructed[1][0]).toBe(reels.kit().grid);
  });

  it('skip() hurries the held controller step, and the run settles on the settled board', async () => {
    holding = true;
    const calls: string[] = [];
    const handler = handlerFor(fakeReels(calls));

    const run = handler.run(asStep(QUIET_STEP), fakeBoard(calls), undefined);
    // `run` reaches `controller.step` synchronously — the step is held there now
    expect(constructed).toHaveLength(1);
    handler.skip?.();
    expect(skipCalls).toBe(1);
    await run;

    expect(calls).toEqual([`refill:${JSON.stringify(SETTLED)}`]);
  });

  it('skip() with no run yet is a no-op', () => {
    expect(() => handlerFor(fakeReels([])).skip?.()).not.toThrow();
    expect(skipCalls).toBe(0);
  });

  it('unregistering takes the step away again', () => {
    const registry = createBoardStepRegistry();
    const off = registry.register(handlerFor(fakeReels([])));
    expect(registry.has('reelStep')).toBe(true);
    off();
    expect(registry.has('reelStep')).toBe(false);
  });

  it('a board with no refill is a diagnostic naming the row that provides one', async () => {
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(fakeReels([])));

    const notAReelBoard = { async spinTo() {} };
    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      notAReelBoard as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reels1');
  });

  it('a composition with no reels is a diagnostic naming the row, not a frozen board', async () => {
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(undefined));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      fakeBoard([]) as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reels1');
  });

  it('a failing step is data: the plan carries on to the next step', async () => {
    const calls: string[] = [];
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(undefined));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP), { kind: 'spinTo', board: [[1]] }],
      fakeBoard(calls) as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(calls).toEqual(['spinTo:[[1]]']);
  });
});

/**
 * `chain.test.ts`'s cases. The plan there came from `first-slot`'s mechanic (which stays in
 * `first-slot`); here it is written out by hand — the same four built-in kinds around two
 * `reelStep` rounds — so what is pinned is still the handler's boundary: each round's data and
 * index reach the controller, and each round re-syncs the board it settled onto.
 */
const GRID = [
  [1, 2, 3],
  [4, 5, 6],
];
const ROUNDS: ReelStepStep[] = [
  { kind: 'reelStep', winning: [{ col: 0, row: 0 }], shifts: [1, 0], settled: SETTLED, index: 0 },
  {
    kind: 'reelStep',
    winning: [
      { col: 1, row: 1 },
      { col: 1, row: 2 },
    ],
    shifts: [0, 2],
    settled: [
      [7, 1, 2],
      [8, 9, 4],
    ],
    index: 1,
  },
];
const PLAN: PresentationStep[] = [
  { kind: 'spinTo', board: GRID },
  ...ROUNDS.flatMap((r, i) => [
    { kind: 'revealWins', total: [0.5, 1.25][i], lines: [] } as unknown as PresentationStep,
    {
      kind: 'playState',
      cells: r.winning,
      state: 'pop',
      wait: true,
    } as unknown as PresentationStep,
    asStep(r),
  ]),
];

describe('reelStep: the plan is the plan the board runs', () => {
  it('hands the controller each round’s own cells, shifts, board and position', async () => {
    recording = true;
    const calls: string[] = [];
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(fakeReels(calls)));

    const diagnostics = await executePlan(PLAN, fakeBoard(calls) as unknown as BoardApi, registry);

    expect(diagnostics).toEqual([]);
    expect(recorded).toEqual([
      {
        winningCells: ROUNDS[0].winning,
        shifts: [1, 0],
        settledGrid: [
          [{ symbol: '7' }, { symbol: '1' }, { symbol: '2' }],
          [{ symbol: '4' }, { symbol: '5' }, { symbol: '6' }],
        ],
        index: 0,
      },
      {
        winningCells: ROUNDS[1].winning,
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
    recording = true;
    const calls: string[] = [];
    const registry = createBoardStepRegistry();
    registry.register(handlerFor(fakeReels(calls)));

    await executePlan(PLAN, fakeBoard(calls) as unknown as BoardApi, registry);

    expect(calls).toEqual([
      `spinTo:${JSON.stringify(GRID)}`,
      'revealWins:0.5',
      `playState:pop:${JSON.stringify(ROUNDS[0].winning)}`,
      `refill:${JSON.stringify(ROUNDS[0].settled)}`,
      'revealWins:1.25',
      `playState:pop:${JSON.stringify(ROUNDS[1].winning)}`,
      `refill:${JSON.stringify(ROUNDS[1].settled)}`,
    ]);
  });
});
