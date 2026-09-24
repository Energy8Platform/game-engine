// engine/game/reel-core/tests/tumbleController.test.ts
//
// The residue test for Task 2's fork: a tumble step that is skip()'d mid-flight must leave the
// grid exactly as if it had settled normally — every cell's alpha/scale back to identity and the
// board already holding the settled symbols — not stuck holding the pre-tumble board, and not
// stuck with the removed cells' scale/alpha animated down to 0 (skip() didn't stop the queued
// "remove" tweens from running once the in-flight `wait` delay elapsed on its own).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import { DEFAULT_REEL_CONFIG, mergeReelConfig } from '../src/index';
import { TumbleController, type TumbleStep } from '../src/cascade/TumbleController';
import { ReelGrid } from '../src/grid/ReelGrid';
import type { SymbolResolver } from '../src/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

/** Same ticker-pinning trick as tests/spinMotion.test.ts — see there for why it's needed. */
const keepTickerAlive = (): void => {};
beforeAll(() => {
  (globalThis as any).requestAnimationFrame ??= () => 0;
  (globalThis as any).cancelAnimationFrame ??= () => {};
  Ticker.shared.add(keepTickerAlive);
  Ticker.shared.update(clock.t);
});
afterAll(() => {
  Ticker.shared.remove(keepTickerAlive);
});
const clock = { t: 0 };

/** Advance the shared ticker by exactly `ms`, yielding after each frame so queued awaits run. */
async function tick(ms: number, stepMs = 16): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms) {
    const d = Math.min(stepMs, ms - elapsed);
    clock.t += d;
    elapsed += d;
    Ticker.shared.update(clock.t);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** Keep ticking until `work` settles (or `maxSteps` frames pass) — for a promise not yet done. */
async function pump<T>(work: Promise<T>, stepMs = 16, maxSteps = 800): Promise<T> {
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

describe('TumbleController.skip — a skipped tumble leaves no residue', () => {
  it('snaps to the settled board with every cell back to alpha 1 / scale 1', async () => {
    const grid = new ReelGrid({ cols: 3, rows: 3, cellSize: 50, gap: 0, resolve });
    grid.setGrid([
      [{ symbol: 'a0' }, { symbol: 'a1' }, { symbol: 'a2' }],
      [{ symbol: 'b0' }, { symbol: 'b1' }, { symbol: 'b2' }],
      [{ symbol: 'c0' }, { symbol: 'c1' }, { symbol: 'c2' }],
    ]);
    const cfg = mergeReelConfig(DEFAULT_REEL_CONFIG.cascade, {
      enabled: true,
      timings: { reveal: 40, highlight: 40, remove: 40, drop: 40, refill: 40, wait: 60 },
    });
    const ctrl = new TumbleController(grid, cfg);

    const settledGrid = [
      [{ symbol: 'x0' }, { symbol: 'a1' }, { symbol: 'a2' }],
      [{ symbol: 'y0' }, { symbol: 'b1' }, { symbol: 'b2' }],
      [{ symbol: 'c0' }, { symbol: 'c1' }, { symbol: 'c2' }],
    ];
    const step: TumbleStep = {
      winningCells: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      removedCells: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      newCells: [
        { col: 0, row: 0, symbol: 'x0' },
        { col: 1, row: 0, symbol: 'y0' },
      ],
      settledGrid,
    };

    const done = ctrl.step(step);
    // past the 40ms highlight phase, into the 60ms `wait` window (40..100ms in)
    await tick(48);
    ctrl.skip();
    // skip() doesn't force the in-flight `Tween.delay(wait)` to resolve early (it isn't a tween
    // of a target `killTweensOf` can reach) — keep the ticker moving until step()'s promise
    // actually returns.
    await pump(done);

    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const cell = grid.getCell(c, r);
        expect(cell.alpha).toBe(1);
        expect(cell.scale.x).toBe(1);
        expect(cell.scale.y).toBe(1);
      }
    }
    expect(grid.getCell(0, 0).data.symbol).toBe('x0');
    expect(grid.getCell(1, 0).data.symbol).toBe('y0');
    expect(grid.getCell(0, 1).data.symbol).toBe('a1');
    expect(grid.getCell(2, 2).data.symbol).toBe('c2');
  });
});
