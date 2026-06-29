// packages/game-engine/src/slot/features/types.ts
//
// Uniform interface for special reel feature mechanics. Each feature is a presentation module:
// given the current board + its config (and optional per-spin data), it plays an animation that
// visualises the mechanic. `demo()` is the self-contained showcase the reel-lab playground triggers.

import { Container, Graphics, Text } from 'pixi.js';
import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { SymbolCell, CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import type { FeatureKey, ReelSystemConfig } from '../config/ReelSystemConfig';

export interface FeatureContext {
  grid: ReelGrid;
  resolve: SymbolResolver;
  cfg: ReelSystemConfig;
  /** Overlay layer above the grid for rings/labels/sprites. */
  fx: Container;
  /** Mutable view of the current board (featureN may rewrite it). */
  board: CellData[][];
  /** Whether the current spin is a free-spin (gates onlyInFreeSpins features). */
  freeSpins?: boolean;
  /** Emit a human-readable note for the playground log. */
  log?: (msg: string) => void;
}

export interface ReelFeature {
  /** Unique id. Built-ins use a `FeatureKey`; custom features may use any string. */
  readonly key: FeatureKey | string;
  readonly label: string;
  /** Whether this feature is active for the given config. Custom features can just return `true`. */
  enabled(cfg: ReelSystemConfig): boolean;
  /** Run the feature presentation on the current board. */
  demo(ctx: FeatureContext): Promise<void>;
}

// ── shared animation helpers ────────────────────────────────────────────────

/** Center position of a cell, in fx-layer coordinates (fx shares the grid's transform). */
export function cellCenter(grid: ReelGrid, col: number, row: number): { x: number; y: number } {
  return grid.cellPosition(col, row);
}

export function rowStepOf(grid: ReelGrid): number {
  return grid.cellPosition(0, 1).y - grid.cellPosition(0, 0).y;
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
  const s = grid.cellSize;
  const g = new Graphics()
    .roundRect(x - s / 2, y - s / 2, s, s, 10)
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
  cell.position.set(home.x, home.y - rowStepOf(grid) * (row + 2));
  cell.alpha = 1;
  cell.scale.set(1);
  await Tween.to(cell, { 'position.y': home.y }, ms, easingByName('easeOutBounce'));
}

export function pickFromBoard(
  board: CellData[][],
  predicate: (c: CellData, col: number, row: number) => boolean,
): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let c = 0; c < board.length; c++)
    for (let r = 0; r < (board[c]?.length ?? 0); r++)
      if (board[c][r] && predicate(board[c][r], c, r)) out.push({ col: c, row: r });
  return out;
}
