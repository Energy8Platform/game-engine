import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

describe('ReelGrid', () => {
  it('lays out cols×rows cells at cellSize+gap positions', () => {
    const grid = new ReelGrid({ cols: 5, rows: 5, cellSize: 100, gap: 10, resolve });
    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(5);
    expect(grid.cellPosition(0, 0)).toEqual({ x: 0, y: 0 });
    expect(grid.cellPosition(2, 3)).toEqual({ x: 2 * 110, y: 3 * 110 });
    const cell = grid.getCell(2, 3);
    expect(cell.x).toBe(220);
    expect(cell.y).toBe(330);
  });
  it('works for a 7×7 cascade grid', () => {
    const grid = new ReelGrid({ cols: 7, rows: 7, cellSize: 76, gap: 8, resolve });
    expect(grid.getCell(6, 6).x).toBe(6 * 84);
  });
  it('setGrid pushes data into each cell', () => {
    const grid = new ReelGrid({ cols: 2, rows: 2, cellSize: 50, resolve });
    grid.setGrid([
      [{ symbol: 'A' }, { symbol: 'B' }],
      [{ symbol: 'C' }, { symbol: 'D' }],
    ]);
    expect((resolve as any)).toHaveBeenCalledWith('A');
    expect((resolve as any)).toHaveBeenCalledWith('D');
  });
  it('resize relayouts cells', () => {
    const grid = new ReelGrid({ cols: 2, rows: 1, cellSize: 50, gap: 0, resolve });
    grid.resize(80);
    expect(grid.getCell(1, 0).x).toBe(80);
  });
  it('cellSize(col) returns per-strip rectangular dimensions', () => {
    const grid = new ReelGrid({
      cols: 3,
      rows: 2,
      cellSize: 100,
      cellSizePerReel: [100, { width: 60, height: 120 }, 100],
      gap: 0,
      resolve,
    });
    expect(grid.cellSize(0)).toEqual({ width: 100, height: 100 });
    expect(grid.cellSize(1)).toEqual({ width: 60, height: 120 });
    // reel 1's narrower cells shift reel 2 leftward vs a uniform grid (2*100)
    expect(grid.getCell(1, 0).x).toBe(80);
    expect(grid.getCell(2, 0).x).toBe(160);
  });
});
