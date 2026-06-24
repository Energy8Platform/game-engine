// packages/game-engine/tests/slot/reelSpinController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { ReelSpinController } from '../../src/slot/anim/ReelSpinController';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';
import type { CellData } from '../../src/slot/grid/SymbolCell';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const grid = () => new ReelGrid({ cols: 5, rows: 3, cellSize: 100, gap: 0, resolve });
const target: CellData[][] = Array.from({ length: 5 }, (_, c) =>
  Array.from({ length: 3 }, (_, r) => ({ symbol: `c${c}r${r}` })),
);

describe('ReelSpinController.plan', () => {
  it('stops each reel later than the previous (stagger)', () => {
    const ctrl = new ReelSpinController(grid(), { spinUp: 500, stopStagger: 120 });
    const plan = ctrl.plan({ targetGrid: target });
    expect(plan).toHaveLength(5);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].stopTime).toBeGreaterThan(plan[i - 1].stopTime);
    }
    expect(plan[0].stopTime).toBe(500);
    expect(plan[2].stopTime).toBe(500 + 2 * 120);
  });
  it('landing is the reel target column', () => {
    const ctrl = new ReelSpinController(grid());
    const plan = ctrl.plan({ targetGrid: target });
    expect(plan[3].landing.map((c) => c.symbol)).toEqual(['c3r0', 'c3r1', 'c3r2']);
  });
  it('turbo shrinks spinUp + stagger', () => {
    const ctrl = new ReelSpinController(grid(), { spinUp: 500, stopStagger: 120 });
    const t = ctrl.plan({ targetGrid: target }, { turbo: true });
    expect(t[0].stopTime).toBe(250);
    expect(t[1].stopTime).toBe(250 + 60);
  });
});
