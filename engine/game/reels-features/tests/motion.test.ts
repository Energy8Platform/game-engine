/**
 * The kinds that move cells — `walkWild` (a symbol walked along a path) and `nudge` (a reel slid
 * by whole rows) — on `./harness`'s reel system. Both end with every cell back home.
 */
import { describe, expect, it } from 'vitest';
import { Tween } from '@energy8platform/game-engine/animation';
import type { ReelSystem } from '@energy8engine/reel-core';
import type { StepHandler } from '@energy8engine/play-loop';
import { createWalkWildHandler } from '../src/handlers/walkWild';
import { createNudgeHandler } from '../src/handlers/nudge';
import {
  FRAME,
  boardWith,
  depsOf,
  expectCellsHome,
  pump,
  run,
  setup,
  skipMidRun,
  startBoard,
  tick,
  useManualTicker,
} from './harness';

useManualTicker();

async function expectTurboHalves(create: (reels: ReelSystem) => StepHandler, step: object) {
  const normal = setup();
  const full = await pump(run(create(normal.reels), step, normal.board));
  const quick = setup();
  const half = await pump(run(create(quick.reels), step, quick.board, { turbo: true }));
  expect(half / full).toBeGreaterThan(0.4);
  expect(half / full).toBeLessThan(0.6);
}

describe('walkWild', () => {
  const cfg = { morphMs: 240, stepMs: 260, easing: 'easeInOutQuad' as const, ringColor: 0xff66cc };
  const create = (reels: ReelSystem) => createWalkWildHandler(depsOf(reels, cfg));
  const step = {
    kind: 'walkWild',
    path: [
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    symbol: 'W',
  };
  const EMPTY = { symbol: null };
  const after = boardWith({ '2,0': { symbol: 'W' }, '0,1': EMPTY, '1,1': EMPTY });

  it('is the step kind', () => {
    expect(create(setup().reels).kind).toBe('walkWild');
  });

  it('the symbol ends on the last cell, the cells it left empty, every cell home', async () => {
    const { reels, board, refills } = setup();
    await pump(run(create(reels), step, board));

    expect(refills).toEqual([after]);
    expect(reels.board).toEqual(after);
    expectCellsHome(reels);
    expect(reels.fx.children).toHaveLength(0);
  });

  it('a path of one cell, or none, is refused; so is a path cell outside the grid', async () => {
    const { reels, board, refills } = setup();
    const handler = create(reels);
    for (const path of [[{ col: 0, row: 0 }], [], undefined]) {
      await expect(run(handler, { kind: 'walkWild', path, symbol: 'W' }, board)).rejects.toThrow(
        'walkWild: path needs at least 2 cells',
      );
    }
    await expect(
      run(
        handler,
        {
          kind: 'walkWild',
          path: [
            { col: 0, row: 1 },
            { col: 3, row: 1 },
          ],
          symbol: 'W',
        },
        board,
      ),
    ).rejects.toThrow('walkWild: path[1] (3, 1) is outside the grid');
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
  });

  // mid-morph; mid-step onto (1,1); mid-step onto (2,0) — one ring up, the last step's gone
  it.each([
    [30, null],
    [300, { col: 1, row: 1 }],
    [600, { col: 2, row: 0 }],
  ])('skip() %sms in: the end board, every cell home, no ring', async (atMs, walking) => {
    const { reels, board, refills } = setup();
    const handler = create(reels);
    await skipMidRun(handler, run(handler, step, board), atMs, () => {
      if (!walking) return;
      // the walker is on its way from the cell to its left
      const walker = reels.grid.getCell(walking.col, walking.row);
      expect(walker.x).toBeLessThan(reels.grid.cellPosition(walking.col, walking.row).x);
      expect(reels.fx.children).toHaveLength(1);
    });

    expect(refills).toEqual([after]);
    expectCellsHome(reels);
    expect(reels.fx.children).toHaveLength(0);
    expect(Tween.activeTweens).toBe(0);
    await tick(1000);
    expectCellsHome(reels);
  });

  it('turbo halves the run', () => expectTurboHalves(create, step));
});

describe('nudge', () => {
  const cfg = { ms: 240, easing: 'easeOutBack' as const };
  const create = (reels: ReelSystem) => createNudgeHandler(depsOf(reels, cfg));
  const step = { kind: 'nudge', reel: 2, by: 1, settled: ['A', 'B', 'C'] };
  const after = boardWith({
    '2,0': { symbol: 'A' },
    '2,1': { symbol: 'B' },
    '2,2': { symbol: 'C' },
  });

  it('is the step kind', () => {
    expect(create(setup().reels).kind).toBe('nudge');
  });

  it('the reel lands on `settled`, every cell home', async () => {
    const { reels, board, refills } = setup();
    await pump(run(create(reels), step, board));

    expect(refills).toEqual([after]);
    expect(reels.board).toEqual(after);
    expectCellsHome(reels);
  });

  it('`by: 0` — or `settled` equal to the reel — completes with no motion', async () => {
    const { reels, board, refills } = setup();
    const still = await pump(run(create(reels), { ...step, by: 0 }, board));
    expect(still).toBeLessThanOrEqual(FRAME);
    expect(refills).toEqual([after]);

    await pump(run(create(reels), { ...step, by: 0, settled: ['G', 'H', 'I'] }, board));
    expect(refills[1]).toEqual(startBoard());
    expectCellsHome(reels);
  });

  it.each([
    [{ settled: ['A', 'B'] }, 'nudge: settled has 2 cells, reel 2 has 3'],
    [{ settled: undefined }, 'nudge: settled has 0 cells, reel 2 has 3'],
    [{ reel: 9 }, 'nudge: reel 9 is outside the grid'],
    [{ by: 1.5 }, 'nudge: by must be a whole number'],
  ])('%o is refused, board untouched', async (over, message) => {
    const { reels, board, refills } = setup();
    await expect(run(create(reels), { ...step, ...over }, board)).rejects.toThrow(message);
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
  });

  it('skip() mid-slide: the end board, every cell home', async () => {
    const { reels, board, refills } = setup();
    const handler = create(reels);
    await skipMidRun(handler, run(handler, step, board), 120, () => {
      // the reel is sliding down; its neighbours are not
      expect(reels.grid.getCell(2, 0).y).toBeGreaterThan(reels.grid.cellPosition(2, 0).y);
      expect(reels.grid.getCell(1, 0).y).toBe(reels.grid.cellPosition(1, 0).y);
    });

    expect(refills).toEqual([after]);
    expectCellsHome(reels);
    expect(Tween.activeTweens).toBe(0);
    await tick(1000);
    expectCellsHome(reels);
  });

  it('turbo halves the run', () => expectTurboHalves(create, step));
});
