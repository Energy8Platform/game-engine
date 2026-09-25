// Forked from packages/game-engine/src/slot/features/types.ts (slice 36).
//
// Animation primitives shared by feature presentations: cell centring/stepping helpers, and the
// ring/pulse/label/morph/drop/move effects built on them. `ReelFeature`, `FeatureContext` and
// `pickFromBoard` stay behind in the legacy module — reel-core has no feature-registration facade
// (that's a later slice); this is only the presentation toolkit a facade would call into.

import { Container, Graphics, Text } from 'pixi.js';
import { Tween } from '@energy8engine/tween';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { SymbolCell, CellData } from '../grid/SymbolCell';
import type { EasingName } from '../config/ReelSystemConfig';

/** Center position of a cell, in fx-layer coordinates (fx shares the grid's transform). */
export function cellCenter(grid: ReelGrid, col: number, row: number): { x: number; y: number } {
  return grid.cellPosition(col, row);
}

/** Vertical row-to-row step for a reel (falls back to the reel's cell height for 1-row reels). */
export function rowStepOf(grid: ReelGrid, col = 0): number {
  if (grid.rowsOf(col) > 1) return grid.cellPosition(col, 1).y - grid.cellPosition(col, 0).y;
  return grid.cellSize(col).height;
}

/** Horizontal reel-to-reel step at a boundary (falls back to the reel's cell width for 1-col grids). */
export function colStepOf(grid: ReelGrid, col = 0): number {
  if (col + 1 < grid.cols) return grid.cellPosition(col + 1, 0).x - grid.cellPosition(col, 0).x;
  return grid.cellSize(col).width;
}

/** A glowing ring drawn around a cell. Returns a disposer. */
export function glowRing(
  fx: Container,
  grid: ReelGrid,
  col: number,
  row: number,
  color: number,
): () => void {
  if (fx.destroyed) return () => {};
  const { x, y } = cellCenter(grid, col, row);
  const { width, height } = grid.cellSize(col);
  const g = new Graphics()
    .roundRect(x - width / 2, y - height / 2, width, height, 10)
    .stroke({ color, width: 3, alpha: 0.9 });
  fx.addChild(g);
  return () => g.destroy();
}

/** Pulse a cell up and back. */
export async function pulseCell(cell: SymbolCell, scale = 1.15, ms = 220): Promise<void> {
  if (cell.destroyed) return;
  await Tween.to(
    cell,
    { 'scale.x': scale, 'scale.y': scale },
    ms * 0.5,
    easingByName('easeOutBack'),
  );
  if (cell.destroyed) return;
  await Tween.to(cell, { 'scale.x': 1, 'scale.y': 1 }, ms * 0.5, easingByName('easeOutQuad'));
}

/** Floating label that rises and fades. */
export async function floatLabel(
  fx: Container,
  x: number,
  y: number,
  text: string,
  color = 0xffd24a,
  ms = 700,
): Promise<void> {
  if (fx.destroyed) return;
  const t = new Text({ text, style: { fontSize: 26, fill: color, fontWeight: '800' } });
  t.anchor.set(0.5);
  t.position.set(x, y);
  t.scale.set(0.5);
  fx.addChild(t);
  await Tween.to(t, { 'scale.x': 1, 'scale.y': 1 }, ms * 0.25, easingByName('easeOutBack'));
  await Tween.to(t, { y: y - 50, alpha: 0 }, ms * 0.75, easingByName('easeOutQuad'));
  t.destroy();
}

/** Replace a cell's symbol with a quick morph (shrink → swap → pop). */
export async function morphSymbol(cell: SymbolCell, data: CellData, ms = 280): Promise<void> {
  if (cell.destroyed) return;
  await Tween.to(cell, { 'scale.x': 0.1, 'scale.y': 0.1 }, ms * 0.4, easingByName('easeInBack'));
  if (cell.destroyed) return;
  cell.setData(data);
  cell.scale.set(0.1);
  await Tween.to(cell, { 'scale.x': 1, 'scale.y': 1 }, ms * 0.6, easingByName('easeOutBack'));
}

/** Drop a cell in from above its home position. */
export async function dropCell(
  grid: ReelGrid,
  cell: SymbolCell,
  col: number,
  row: number,
  ms = 280,
): Promise<void> {
  if (cell.destroyed) return;
  const home = grid.cellPosition(col, row);
  cell.position.set(home.x, home.y - rowStepOf(grid, col) * (row + 2));
  cell.alpha = 1;
  cell.scale.set(1);
  await Tween.to(cell, { 'position.y': home.y }, ms, easingByName('easeOutBounce'));
}

/** Slide a cell from one grid slot's centre to another's — new here, not in the legacy module. */
export async function moveCell(
  grid: ReelGrid,
  cell: SymbolCell,
  from: { col: number; row: number },
  to: { col: number; row: number },
  ms: number,
  easing?: EasingName,
): Promise<void> {
  if (cell.destroyed) return;
  const start = cellCenter(grid, from.col, from.row);
  const end = cellCenter(grid, to.col, to.row);
  cell.position.set(start.x, start.y);
  await Tween.to(cell, { 'position.x': end.x, 'position.y': end.y }, ms, easingByName(easing));
}
