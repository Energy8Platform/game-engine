import { describe, it, expect } from 'vitest';
import { resolveGeometry, cellPositionOf } from '../../src/slot/grid/geometry';

describe('resolveGeometry', () => {
  it('square uniform grid matches the legacy cellSize+gap layout', () => {
    const g = resolveGeometry({ cols: 5, rows: 3, cellSize: 100, gap: 10 });
    // cell (0,0) centre at origin; reels step by cellSize+gap
    expect(cellPositionOf(g, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellPositionOf(g, 2, 0).x).toBe(220);
    expect(cellPositionOf(g, 0, 2).y).toBe(220);
    expect(g.gridW).toBe(5 * 110 - 10);
    expect(g.gridH).toBe(3 * 110 - 10);
  });

  it('rectangular cells: width and height step independently', () => {
    const g = resolveGeometry({ cols: 3, rows: 2, cellSize: 0, cellWidth: 80, cellHeight: 120, gap: 0 });
    expect(cellPositionOf(g, 1, 0).x).toBe(80);
    expect(cellPositionOf(g, 0, 1).y).toBe(120);
    expect(g.cellW.every((w) => w === 80)).toBe(true);
    expect(g.cellH.every((h) => h === 120)).toBe(true);
  });

  it('per-strip cell sizes drive per-reel x accumulation', () => {
    const g = resolveGeometry({
      cols: 3,
      rows: 2,
      cellSize: 100,
      cellSizePerReel: [{ width: 100, height: 100 }, { width: 60, height: 100 }, 100],
      gap: 0,
    });
    // x0 = 0; x1 = 50 + 0 + 30 = 80; x2 = 30 + 0 + 50 = 160
    expect(cellPositionOf(g, 0, 0).x).toBe(0);
    expect(cellPositionOf(g, 1, 0).x).toBe(80);
    expect(cellPositionOf(g, 2, 0).x).toBe(160);
    expect(g.cellW).toEqual([100, 60, 100]);
  });

  it('per-boundary colGap widens the space between specific reels', () => {
    const g = resolveGeometry({ cols: 3, rows: 1, cellSize: 100, colGap: [10, 40] });
    // x1 = 50 + 10 + 50 = 110; x2 = 110 + 50 + 40 + 50 = 250
    expect(cellPositionOf(g, 1, 0).x).toBe(110);
    expect(cellPositionOf(g, 2, 0).x).toBe(250);
  });

  it('per-reel rowGap changes vertical step for that strip only', () => {
    const g = resolveGeometry({ cols: 2, rows: 3, cellSize: 100, rowGap: [0, 20] });
    expect(cellPositionOf(g, 0, 1).y - cellPositionOf(g, 0, 0).y).toBe(100);
    expect(cellPositionOf(g, 1, 1).y - cellPositionOf(g, 1, 0).y).toBe(120);
  });

  it('variable-height reels centre about a shared line (tallest reel row 0 at y=0)', () => {
    const g = resolveGeometry({ cols: 2, rows: 3, rowsPerReel: [4, 2], cellSize: 100, gap: 0 });
    // tallest reel (4 rows) spans 300 → half = 150; its row 0 sits at y=0
    expect(cellPositionOf(g, 0, 0).y).toBe(0);
    // shorter reel (2 rows) span 100 → offset 150-50 = 100
    expect(cellPositionOf(g, 1, 0).y).toBe(100);
    // both reels share the same centre line
    const midA = (cellPositionOf(g, 0, 0).y + cellPositionOf(g, 0, 3).y) / 2;
    const midB = (cellPositionOf(g, 1, 0).y + cellPositionOf(g, 1, 1).y) / 2;
    expect(midA).toBe(midB);
  });
});
