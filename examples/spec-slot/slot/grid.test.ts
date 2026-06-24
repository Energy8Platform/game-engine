import { describe, it, expect } from 'vitest';
import { ReelGrid, CascadeController } from '@energy8platform/game-engine/slot';
import { model } from '../game.spec';
import { resolveSymbol } from './symbols';

describe('spec-slot grid composition', () => {
  it('builds a grid sized from the spec and sets symbols from the model', () => {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    expect(grid.cols).toBe(cols);
    const symbolId = model.spec.symbols[0].id;
    grid.setGrid(Array.from({ length: cols }, () => Array.from({ length: rows }, () => ({ symbol: symbolId }))));
    expect(grid.getCell(0, 0).view).not.toBeNull();
  });
  it('CascadeController.plan produces remove + drop descriptors on the spec grid', () => {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, resolve: resolveSymbol });
    const c = new CascadeController(grid);
    const plan = c.plan({
      winningCells: [{ col: 0, row: 0 }],
      removedCells: [{ col: 0, row: 0 }],
      newCells: [{ col: 0, row: 0, symbol: model.spec.symbols[0].id }],
      settledGrid: [],
    });
    expect(plan.some((a) => a.phase === 'remove')).toBe(true);
    expect(plan.some((a) => a.phase === 'drop')).toBe(true);
  });
});
