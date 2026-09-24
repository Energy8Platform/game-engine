/**
 * The four morph kinds — `expandWild`, `dropWilds`, `reveal`, `transform` — against a real reel
 * system (`createReelSystem`: a real `ReelGrid`, `resolve` → an empty `Container`) and a fake board
 * whose `refill` records the board it is handed and seats it, the way the reels board's does.
 *
 * `Tween` runs on `Ticker.shared`, which never ticks by itself in Node: the ticker is pumped by
 * hand, as reel-core's `tests/fx.test.ts` does, and a run's duration is the ticker time it took.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import { Tween } from '@energy8platform/game-engine/animation';
import { createReelSystem, type CellData, type ReelSystem } from '@energy8engine/reel-core';
import {
  cellData,
  type Board,
  type PresentationStep,
  type StepOpts,
} from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import type { FeatureDeps } from '../src/shared';
import { createExpandWildHandler } from '../src/handlers/expandWild';
import { createDropWildsHandler } from '../src/handlers/dropWilds';
import { createRevealHandler } from '../src/handlers/reveal';
import { createTransformHandler } from '../src/handlers/transform';

const keepTickerAlive = (): void => {};
const clock = { t: 0 };
beforeAll(() => {
  (globalThis as any).requestAnimationFrame ??= () => 0;
  (globalThis as any).cancelAnimationFrame ??= () => {};
  Ticker.shared.add(keepTickerAlive);
  Ticker.shared.update(clock.t);
});
afterAll(() => {
  Ticker.shared.remove(keepTickerAlive);
});

const FRAME = 4;
const yieldOnce = () => new Promise<void>((r) => setImmediate(r));

/** Advance the ticker by `ms`, yielding after each frame so queued awaits run. */
async function tick(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += FRAME) {
    clock.t += FRAME;
    Ticker.shared.update(clock.t);
    await yieldOnce();
  }
}

/** Tick until `work` settles; answers the ticker time it took. */
async function pump(work: Promise<unknown>, maxMs = 10_000): Promise<number> {
  let settled = false;
  const done = work.finally(() => (settled = true));
  const start = clock.t;
  while (!settled && clock.t - start < maxMs) await tick(FRAME);
  await done;
  return clock.t - start;
}

const START = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['G', 'H', 'I'],
];
const startBoard = (): CellData[][] => START.map((col) => col.map((symbol) => ({ symbol })));

/** The start board with `over` written on top — `over` keyed `col,row`. */
function boardWith(over: Record<string, CellData>): CellData[][] {
  return startBoard().map((col, c) => col.map((cell, r) => over[`${c},${r}`] ?? cell));
}

function setup() {
  const reels = createReelSystem({
    resolve: () => new Container() as never,
    grid: { cols: 3, rows: 3, cellSize: 50, gap: 0 },
    board: startBoard(),
  });
  const refills: Board[] = [];
  const board = {
    async refill(step: { kind: 'refill'; board: Board }) {
      refills.push(step.board);
      reels.setBoard(step.board.map((col) => col.map((cell) => cellData(cell) as CellData)));
    },
  };
  return { reels, board, refills };
}

function depsOf<C>(reels: ReelSystem, config: C): FeatureDeps<C> {
  return { reels: () => reels, config: () => config, layer: () => undefined };
}

const run = (handler: StepHandler, step: object, board: unknown, opts?: StepOpts) =>
  handler.run(step as unknown as PresentationStep, board, opts);

interface Case {
  kind: string;
  create(reels: ReelSystem): StepHandler;
  step: object;
  after: CellData[][];
}

const W = { symbol: 'W' };
const CASES: Case[] = [
  {
    kind: 'expandWild',
    create: (reels) =>
      createExpandWildHandler(depsOf(reels, { ms: 280, holdMs: 500, ringColor: 0xffd700 })),
    step: { kind: 'expandWild', reel: 1, symbol: 'W' },
    after: boardWith({ '1,0': W, '1,1': W, '1,2': W }),
  },
  {
    kind: 'dropWilds',
    create: (reels) => createDropWildsHandler(depsOf(reels, { ms: 280, staggerMs: 60 })),
    step: {
      kind: 'dropWilds',
      cells: [
        { col: 0, row: 0 },
        { col: 2, row: 1 },
      ],
      symbol: 'W',
      multiplier: 3,
    },
    after: boardWith({
      '0,0': { symbol: 'W', multiplier: 3 },
      '2,1': { symbol: 'W', multiplier: 3 },
    }),
  },
  {
    kind: 'reveal',
    create: (reels) => createRevealHandler(depsOf(reels, { ms: 280 })),
    step: {
      kind: 'reveal',
      cells: [
        { col: 0, row: 1 },
        { col: 1, row: 1 },
        { col: 2, row: 2 },
      ],
      symbol: 'Q',
    },
    after: boardWith({ '0,1': { symbol: 'Q' }, '1,1': { symbol: 'Q' }, '2,2': { symbol: 'Q' } }),
  },
  {
    kind: 'transform',
    create: (reels) =>
      createTransformHandler(depsOf(reels, { ms: 280, pulseScale: 1.15, pulseMs: 220 })),
    step: {
      kind: 'transform',
      cells: [
        { col: 0, row: 2 },
        { col: 2, row: 0 },
      ],
      to: 'H1',
    },
    after: boardWith({ '0,2': { symbol: 'H1' }, '2,0': { symbol: 'H1' } }),
  },
];

/** Every cell at its own centre, at scale 1, fully opaque. */
function expectCellsHome(reels: ReelSystem): void {
  const { grid } = reels;
  for (let col = 0; col < grid.cols; col++)
    for (let row = 0; row < grid.rowsOf(col); row++) {
      const cell = grid.getCell(col, row);
      const home = grid.cellPosition(col, row);
      expect([cell.position.x, cell.position.y, cell.scale.x, cell.scale.y, cell.alpha]).toEqual([
        home.x,
        home.y,
        1,
        1,
        1,
      ]);
    }
}

describe.each(CASES)('$kind', ({ kind, create, step, after }) => {
  it('is the step kind', () => {
    expect(create(setup().reels).kind).toBe(kind);
  });

  it('lands the board the data says, through one refill', async () => {
    const { reels, board, refills } = setup();
    await pump(run(create(reels), step, board));

    expect(refills).toEqual([after]);
    expect(reels.board).toEqual(after);
    expectCellsHome(reels);
    // transient rings are gone with the run
    expect(reels.fx.children).toHaveLength(0);
  });

  it('skip() mid-animation: the run resolves at once, on the same end board', async () => {
    const { reels, board, refills } = setup();
    const handler = create(reels);
    let settled = false;
    const work = run(handler, step, board).finally(() => (settled = true));
    // 30ms in: every kind mid-tween, and dropWilds' second cell still in its stagger delay
    await tick(30);
    expect(settled).toBe(false);

    handler.skip?.();
    // no ticking from here: the run must not be waiting on a tween or a delay any more
    for (let i = 0; i < 5; i++) await yieldOnce();
    expect(settled).toBe(true);
    await work;

    expect(refills).toEqual([after]);
    expectCellsHome(reels);
    expect(reels.fx.children).toHaveLength(0);
    // nothing left animating that could move a cell after the skip
    expect(Tween.activeTweens).toBe(0);
    await tick(1000);
    expectCellsHome(reels);
  });

  it('turbo halves the run', async () => {
    const normal = setup();
    const full = await pump(run(create(normal.reels), step, normal.board));
    const quick = setup();
    const half = await pump(run(create(quick.reels), step, quick.board, { turbo: true }));

    expect(quick.refills).toEqual([after]);
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });

  it('a skip between runs does not pre-skip the next run', async () => {
    const { reels, board, refills } = setup();
    const handler = create(reels);
    const first = await pump(run(handler, step, board));
    handler.skip?.();
    const second = await pump(run(handler, step, board));

    expect(second).toBeGreaterThan(first * 0.9);
    expect(refills).toEqual([after, after]);
  });
});

describe('expandWild', () => {
  const handlerFor = (reels: ReelSystem) =>
    createExpandWildHandler(depsOf(reels, { ms: 280, holdMs: 500, ringColor: 0xffd700 }));

  it('`rows` narrows the reel to those rows', async () => {
    const { reels, board, refills } = setup();
    await pump(
      run(handlerFor(reels), { kind: 'expandWild', reel: 1, symbol: 'W', rows: [0, 2] }, board),
    );
    expect(refills).toEqual([boardWith({ '1,0': W, '1,2': W })]);
  });

  it('a reel outside the grid is refused before anything moves', async () => {
    const { reels, board, refills } = setup();
    await expect(
      run(handlerFor(reels), { kind: 'expandWild', reel: 9, symbol: 'W' }, board),
    ).rejects.toThrow('expandWild: reel 9 is outside the grid');
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
  });

  it('a row outside the reel is refused through the cell check', async () => {
    const { reels, board, refills } = setup();
    await expect(
      run(handlerFor(reels), { kind: 'expandWild', reel: 1, symbol: 'W', rows: [3] }, board),
    ).rejects.toThrow('expandWild: rows[0] (1, 3) is outside the grid');
    expect(refills).toEqual([]);
  });

  it('a record symbol keeps its extras', async () => {
    const { reels, board, refills } = setup();
    await pump(
      run(
        handlerFor(reels),
        { kind: 'expandWild', reel: 0, symbol: { symbol: 'W', multiplier: 2 } },
        board,
      ),
    );
    const w2 = { symbol: 'W', multiplier: 2 };
    expect(refills).toEqual([boardWith({ '0,0': w2, '0,1': w2, '0,2': w2 })]);
  });
});

describe('cell kinds refuse a cell outside the grid, board untouched', () => {
  it.each([
    [
      'dropWilds',
      (r: ReelSystem) => createDropWildsHandler(depsOf(r, { ms: 280, staggerMs: 60 })),
      { symbol: 'W' },
    ],
    ['reveal', (r: ReelSystem) => createRevealHandler(depsOf(r, { ms: 280 })), { symbol: 'Q' }],
    [
      'transform',
      (r: ReelSystem) =>
        createTransformHandler(depsOf(r, { ms: 280, pulseScale: 1.15, pulseMs: 220 })),
      { to: 'H1' },
    ],
  ] as const)('%s', async (kind, create, data) => {
    const { reels, board, refills } = setup();
    await expect(
      run(
        create(reels),
        {
          kind,
          cells: [
            { col: 0, row: 0 },
            { col: 0, row: 3 },
          ],
          ...data,
        },
        board,
      ),
    ).rejects.toThrow(`${kind}: cells[1] (0, 3) is outside the grid`);
    await expect(run(create(reels), { kind, cells: [], ...data }, board)).rejects.toThrow(
      `${kind}: cells is empty`,
    );
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
  });
});
