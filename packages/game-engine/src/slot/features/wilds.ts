// packages/game-engine/src/slot/features/wilds.ts
import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import {
  type FeatureContext,
  type ReelFeature,
  cellCenter,
  dropCell,
  floatLabel,
  glowRing,
  morphSymbol,
  pickFromBoard,
  pulseCell,
} from './types';

function reelsOf(cfg: number[], cols: number): number[] {
  return cfg.length
    ? cfg.filter((r) => r >= 0 && r < cols)
    : Array.from({ length: cols }, (_, i) => i);
}
const randInt = (a: number, b: number, seed: number) =>
  Math.min(b, a + Math.floor(((Math.sin(seed * 99.13) + 1) / 2) * (b - a + 1)));

/** Expanding wild: a landed wild grows to fill its whole reel. */
export const ExpandingWild: ReelFeature = {
  key: 'expandingWild',
  label: 'Expanding wild',
  enabled: (c) => c.features.expandingWild.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.expandingWild;
    if (f.onlyInFreeSpins && !ctx.freeSpins) {
      ctx.log?.('Expanding wild: free-spins only');
      return;
    }
    const cols = ctx.grid.cols;
    const eligible = reelsOf(f.reels, cols);
    const reel = eligible[randInt(0, eligible.length - 1, cols)];
    const rows = ctx.grid.rowsOf(reel);
    ctx.log?.(`Expanding wild on reel ${reel}`);
    const disposers: (() => void)[] = [];
    for (let r = 0; r < (f.toFullReel ? rows : Math.min(2, rows)); r++) {
      const cell = ctx.grid.getCell(reel, r);
      await morphSymbol(cell, { symbol: f.symbol }, f.ms / Math.max(1, rows));
      disposers.push(glowRing(ctx.fx, ctx.grid, reel, r, 0xffd700));
      if (ctx.board[reel]) ctx.board[reel][r] = { symbol: f.symbol };
    }
    await Tween.delay(500);
    disposers.forEach((d) => d());
  },
};

/** Sticky symbols: chosen symbols lock in place for N spins. */
export const StickySymbols: ReelFeature = {
  key: 'sticky',
  label: 'Sticky symbols',
  enabled: (c) => c.features.sticky.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.sticky;
    const targets = pickFromBoard(ctx.board, (c) => !!c.symbol).slice(0, 3);
    const picks = targets.filter((_, i) => i % 2 === 0);
    ctx.log?.(`Sticky: locking ${picks.length} cell(s) for ${f.durationSpins || 'feature'} spins`);
    await Promise.all(
      picks.map(async (p, i) => {
        const cell = ctx.grid.getCell(p.col, p.row);
        cell.setData({ symbol: f.symbols[0] ?? 'wild', sticky: { remaining: f.durationSpins } });
        glowRing(ctx.fx, ctx.grid, p.col, p.row, f.ringColor);
        await pulseCell(cell, 1.2, 260);
        const { x, y } = cellCenter(ctx.grid, p.col, p.row);
        await floatLabel(
          ctx.fx,
          x,
          y - ctx.grid.cellSize / 2,
          f.durationSpins ? `STICKY ${f.durationSpins}` : 'STICKY',
          f.ringColor,
          600 + i * 50,
        );
      }),
    );
  },
};

/** Walking wild: a wild shifts one reel each spin until it leaves the grid. */
export const WalkingWild: ReelFeature = {
  key: 'walkingWild',
  label: 'Walking wild',
  enabled: (c) => c.features.walkingWild.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.walkingWild;
    const cols = ctx.grid.cols;
    const dir = f.direction === 'left' ? -1 : 1;
    let col = dir === 1 ? 0 : cols - 1;
    // clamp the row into each reel's own height (Megaways reels differ in length)
    const rowIn = (c: number) =>
      Math.min(Math.floor(ctx.grid.rowsOf(col) / 2), ctx.grid.rowsOf(c) - 1);
    let row = rowIn(col);
    await morphSymbol(ctx.grid.getCell(col, row), { symbol: f.symbol }, 240);
    ctx.log?.(`Walking wild marching ${f.direction}`);
    // walk across the grid
    for (let step = 0; step < cols; step++) {
      const next = col + dir * f.stepPerSpin;
      if (next < 0 || next >= cols) break;
      const nextRow = rowIn(next);
      const from = cellCenter(ctx.grid, col, row);
      const to = cellCenter(ctx.grid, next, nextRow);
      ctx.grid.getCell(col, row).setData({ symbol: null });
      const ghost = ctx.grid.getCell(next, nextRow);
      ghost.setData({ symbol: f.symbol });
      ghost.position.set(from.x, from.y);
      const ring = glowRing(ctx.fx, ctx.grid, next, nextRow, 0xff66cc);
      await Tween.to(
        ghost,
        { 'position.x': to.x, 'position.y': to.y },
        260,
        easingByName('easeInOutQuad'),
      );
      ring();
      col = next;
      row = nextRow;
    }
  },
};

/** Random wild injection: a few wilds drop onto random positions. */
export const RandomWild: ReelFeature = {
  key: 'randomWild',
  label: 'Random wild injection',
  enabled: (c) => c.features.randomWild.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.randomWild;
    const n = Array.isArray(f.count) ? randInt(f.count[0], f.count[1], ctx.grid.cols + 7) : f.count;
    const spots = pickFromBoard(ctx.board, () => true);
    const chosen: { col: number; row: number }[] = [];
    for (let i = 0; i < n && spots.length; i++)
      chosen.push(spots.splice(randInt(0, spots.length - 1, i + 3), 1)[0]);
    ctx.log?.(
      `Injecting ${chosen.length} wild(s)${f.sticky ? ' (sticky)' : ''}${f.multiplier > 1 ? ` ×${f.multiplier}` : ''}`,
    );
    await Promise.all(
      chosen.map(async (p) => {
        const cell = ctx.grid.getCell(p.col, p.row);
        cell.setData({
          symbol: 'wild',
          multiplier: f.multiplier > 1 ? f.multiplier : undefined,
          sticky: f.sticky ? { remaining: 0 } : undefined,
        });
        await dropCell(ctx.grid, cell, p.col, p.row, 300);
        if (f.sticky) glowRing(ctx.fx, ctx.grid, p.col, p.row, 0xec4899);
      }),
    );
  },
};
