// engine/game/reel-core/tests/fx.test.ts
//
// The fx animation primitives (Task 1's fork of packages/game-engine/src/slot/features/types.ts,
// plus the new moveCell). Drives Tween the way tests/tumbleController.test.ts does: a hand-pumped
// Ticker.shared, since the suite runs in `environment: 'node'` (no real rAF loop).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import { cellCenter, glowRing, morphSymbol, dropCell, moveCell } from '../src/fx';
import { ReelGrid } from '../src/grid/ReelGrid';
import type { SymbolResolver } from '../src/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

/** Same ticker-pinning trick as tests/tumbleController.test.ts — see there for why it's needed. */
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

/** Keep ticking until `work` settles (or `maxSteps` frames pass). */
async function pump<T>(work: Promise<T>, stepMs = 16, maxSteps = 200): Promise<T> {
  let settled = false;
  const done = work.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < maxSteps && !settled; i++) {
    clock.t += stepMs;
    Ticker.shared.update(clock.t);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return done;
}

const makeGrid = (): ReelGrid => new ReelGrid({ cols: 3, rows: 3, cellSize: 50, gap: 0, resolve });

describe('morphSymbol', () => {
  it('ends with the cell at scale 1 and holding the new data', async () => {
    const grid = makeGrid();
    const cell = grid.getCell(0, 0);
    cell.setData({ symbol: 'a' });
    await pump(morphSymbol(cell, { symbol: 'b' }, 40));
    expect(cell.scale.x).toBeCloseTo(1, 5);
    expect(cell.scale.y).toBeCloseTo(1, 5);
    expect(cell.data).toEqual({ symbol: 'b' });
  });
});

describe('glowRing', () => {
  it('adds one child to the layer, and its disposer removes it', () => {
    const grid = makeGrid();
    const fx = new Container();
    expect(fx.children).toHaveLength(0);
    const dispose = glowRing(fx, grid, 1, 1, 0xff0000);
    expect(fx.children).toHaveLength(1);
    dispose();
    expect(fx.children).toHaveLength(0);
  });
});

describe('dropCell', () => {
  it("ends at the cell's home position", async () => {
    const grid = makeGrid();
    const cell = grid.getCell(1, 2);
    const home = cellCenter(grid, 1, 2);
    await pump(dropCell(grid, cell, 1, 2, 40));
    expect(cell.position.x).toBeCloseTo(home.x, 5);
    expect(cell.position.y).toBeCloseTo(home.y, 5);
  });
});

describe('moveCell', () => {
  it("ends with the cell at `to`'s centre", async () => {
    const grid = makeGrid();
    const cell = grid.getCell(0, 0);
    const to = cellCenter(grid, 2, 1);
    await pump(moveCell(grid, cell, { col: 0, row: 0 }, { col: 2, row: 1 }, 40));
    expect(cell.position.x).toBeCloseTo(to.x, 5);
    expect(cell.position.y).toBeCloseTo(to.y, 5);
  });
});
