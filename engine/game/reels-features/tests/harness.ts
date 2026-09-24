/**
 * What every kind's test runs on: a real reel system (`createReelSystem`: a real `ReelGrid`,
 * `resolve` → an empty `Container` unless a test passes its own) and a fake board whose `refill`
 * records the board it is handed and seats it, the way the reels board's does.
 *
 * `Tween` runs on `Ticker.shared`, which never ticks by itself in Node: the ticker is pumped by
 * hand, as reel-core's `tests/fx.test.ts` does, and a run's duration is the ticker time it took.
 */
import { afterAll, beforeAll, expect } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import {
  createReelSystem,
  type CellData,
  type ReelSystem,
  type SymbolResolver,
} from '@energy8engine/reel-core';
import {
  cellData,
  type Board,
  type PresentationStep,
  type StepOpts,
} from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import type { FeatureDeps } from '../src/shared';
import type { OverlayLayer } from '../src/layer';

const keepTickerAlive = (): void => {};
const clock = { t: 0 };

/** Call once per test file: holds `Ticker.shared` for the hand pump. */
export function useManualTicker(): void {
  beforeAll(() => {
    (globalThis as any).requestAnimationFrame ??= () => 0;
    (globalThis as any).cancelAnimationFrame ??= () => {};
    Ticker.shared.add(keepTickerAlive);
    Ticker.shared.update(clock.t);
  });
  afterAll(() => {
    Ticker.shared.remove(keepTickerAlive);
  });
}

export const FRAME = 4;
export const yieldOnce = () => new Promise<void>((r) => setImmediate(r));

/** Advance the ticker by `ms`, yielding after each frame so queued awaits run. */
export async function tick(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += FRAME) {
    clock.t += FRAME;
    Ticker.shared.update(clock.t);
    await yieldOnce();
  }
}

/** Tick until `work` settles; answers the ticker time it took. */
export async function pump(work: Promise<unknown>, maxMs = 10_000): Promise<number> {
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
export const startBoard = (): CellData[][] => START.map((col) => col.map((symbol) => ({ symbol })));

/** The start board with `over` written on top — `over` keyed `col,row`. */
export function boardWith(over: Record<string, CellData>): CellData[][] {
  return startBoard().map((col, c) => col.map((cell, r) => over[`${c},${r}`] ?? cell));
}

/** Starts `work`, ticks `atMs` in, runs `beforeSkip`, skips: the run must settle with no more ticks. */
export async function skipMidRun(
  handler: StepHandler,
  work: Promise<void>,
  atMs = 30,
  beforeSkip?: () => void,
): Promise<void> {
  let settled = false;
  const done = work.finally(() => (settled = true));
  await tick(atMs);
  expect(settled).toBe(false);
  beforeSkip?.();
  handler.skip?.();
  for (let i = 0; i < 5; i++) await yieldOnce();
  expect(settled).toBe(true);
  await done;
}

/** A 3×3 grid of 50px cells on the start board, and a board whose refills are recorded. */
export function setup(resolve: SymbolResolver = () => new Container() as never) {
  const reels = createReelSystem({
    resolve,
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

export function depsOf<C>(reels: ReelSystem, config: C, layer?: OverlayLayer): FeatureDeps<C> {
  return { reels: () => reels, config: () => config, layer: () => layer };
}

export const run = (handler: StepHandler, step: object, board: unknown, opts?: StepOpts) =>
  handler.run(step as unknown as PresentationStep, board, opts);

/** Every cell at its own centre, at scale 1, fully opaque. */
export function expectCellsHome(reels: ReelSystem): void {
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
