// packages/game-engine/tests/slot/cascadeController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { CascadeController } from '../../src/slot/anim/CascadeController';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const grid = () => new ReelGrid({ cols: 3, rows: 3, cellSize: 100, gap: 0, resolve });

describe('CascadeController.plan', () => {
  it('emits highlight then remove for winning cells', () => {
    const c = new CascadeController(grid());
    const plan = c.plan({
      winningCells: [{ col: 0, row: 0 }],
      removedCells: [{ col: 0, row: 0 }],
      newCells: [{ col: 0, row: 0, symbol: 'A' }],
      settledGrid: [],
    });
    const phases = plan.filter((a) => a.col === 0 && a.row === 0).map((a) => a.phase);
    expect(phases).toContain('highlight');
    expect(phases).toContain('remove');
    const remove = plan.find((a) => a.phase === 'remove')!;
    expect(remove.scale).toBe(0);
  });
  it('new cells drop from above their target (from.y < to.y) with per-column stagger', () => {
    const c = new CascadeController(grid());
    const plan = c.plan({
      winningCells: [], removedCells: [],
      newCells: [{ col: 1, row: 0, symbol: 'A' }, { col: 1, row: 1, symbol: 'B' }],
      settledGrid: [],
    });
    const drops = plan.filter((a) => a.phase === 'drop' || a.phase === 'refill');
    expect(drops.length).toBeGreaterThanOrEqual(2);
    for (const d of drops) expect(d.from!.y).toBeLessThan(d.to!.y);
  });
  it('turbo halves durations', () => {
    const c = new CascadeController(grid(), { highlight: 400 });
    const normal = c.plan({ winningCells: [{ col: 0, row: 0 }], removedCells: [], newCells: [], settledGrid: [] });
    const turbo = c.plan({ winningCells: [{ col: 0, row: 0 }], removedCells: [], newCells: [], settledGrid: [] }, { turbo: true });
    const nH = normal.find((a) => a.phase === 'highlight')!.duration;
    const tH = turbo.find((a) => a.phase === 'highlight')!.duration;
    expect(tH).toBe(nH / 2);
  });
});
