// packages/game-engine/src/slot/features/symbols.ts
import { Container } from 'pixi.js';
import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import {
  type FeatureContext,
  type ReelFeature,
  cellCenter,
  colStepOf,
  floatLabel,
  morphSymbol,
  pickFromBoard,
  pulseCell,
  rowStepOf,
} from './types';

const pick = <T>(arr: T[], seed: number): T =>
  arr[Math.floor(((Math.sin(seed * 12.9898) + 1) / 2) * arr.length) % arr.length];

/** Mystery symbols: all mystery tiles reveal the SAME single random symbol per spin. */
export const MysterySymbols: ReelFeature = {
  key: 'mystery',
  label: 'Mystery symbols',
  enabled: (c) => c.features.mystery.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.mystery;
    const spots = pickFromBoard(ctx.board, () => true)
      .filter((_, i) => i % 3 === 0)
      .slice(0, 5);
    spots.forEach((p) => ctx.grid.getCell(p.col, p.row).setData({ symbol: f.symbol }));
    await Promise.all(spots.map((p) => pulseCell(ctx.grid.getCell(p.col, p.row), 1.1, 200)));
    const pool = f.revealPool.length ? f.revealPool : ['h1', 'h2', 'h3'];
    const reveal = pick(pool, ctx.grid.cols + spots.length);
    ctx.log?.(`Mystery: ${spots.length} tiles reveal "${reveal}"`);
    await Promise.all(
      spots.map((p) => morphSymbol(ctx.grid.getCell(p.col, p.row), { symbol: reveal }, f.ms)),
    );
    spots.forEach((p) => {
      if (ctx.board[p.col]) ctx.board[p.col][p.row] = { symbol: reveal };
    });
  },
};

/** Symbol transform / upgrade: every instance of one symbol type becomes another. */
export const SymbolTransform: ReelFeature = {
  key: 'transform',
  label: 'Symbol transform / upgrade',
  enabled: (c) => c.features.transform.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.transform;
    const present = Array.from(
      new Set(
        pickFromBoard(ctx.board, (c) => !!c.symbol).map((p) => ctx.board[p.col][p.row].symbol!),
      ),
    );
    const lows = present.filter((s) => /^(l|o|a|k|q|j|t|10)/i.test(s));
    const source =
      f.source === 'randomLow'
        ? (pick(lows.length ? lows : present, ctx.grid.cols) ?? present[0])
        : f.source;
    if (!source) {
      ctx.log?.('Transform: nothing to convert');
      return;
    }
    const matches = pickFromBoard(ctx.board, (c) => c.symbol === source);
    const targets = f.allInstances ? matches : matches.slice(0, 1);
    ctx.log?.(`Transform: ${targets.length}× "${source}" → "${f.target}"`);
    await Promise.all(
      targets.map(async (p, i) => {
        await Tween.delay(i * 40);
        await morphSymbol(ctx.grid.getCell(p.col, p.row), { symbol: f.target }, f.ms);
        if (ctx.board[p.col]) ctx.board[p.col][p.row] = { symbol: f.target };
      }),
    );
  },
};

/** Giant / colossal symbol spanning width×height cells. */
export const GiantSymbol: ReelFeature = {
  key: 'giant',
  label: 'Giant / colossal symbol',
  enabled: (c) => c.features.giant.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.giant;
    if (f.onlyInFreeSpins && !ctx.freeSpins) {
      ctx.log?.('Giant: free-spins only');
      return;
    }
    const cols = ctx.grid.cols;
    const w = Math.min(f.width, cols);
    const anchorCol = Math.max(0, Math.floor((cols - w) / 2));
    // span only as tall as the SHORTEST covered reel so every covered cell exists (Megaways-safe)
    let minRows = ctx.grid.rowsOf(anchorCol);
    for (let c = anchorCol; c < anchorCol + w; c++) minRows = Math.min(minRows, ctx.grid.rowsOf(c));
    const h = Math.min(f.height, minRows);
    const sym = f.symbols.length ? pick(f.symbols, cols) : 'h1';
    ctx.log?.(`Giant ${w}×${h} "${sym}"`);
    const view = ctx.resolve(sym);
    if (!view) return;
    const cs = ctx.grid.cellSize(anchorCol);
    const stepX = colStepOf(ctx.grid, anchorCol);
    const step = rowStepOf(ctx.grid, anchorCol);
    const tl = cellCenter(ctx.grid, anchorCol, 0);
    const giant = new Container();
    giant.addChild(view);
    // span w×h cells (footprint ignores gaps, matching the previous single-cell unit)
    view.resize?.({ width: cs.width * w, height: cs.height * h });
    giant.position.set(tl.x + ((w - 1) * stepX) / 2, tl.y + ((h - 1) * step) / 2);
    // hide covered cells
    for (let c = anchorCol; c < anchorCol + w; c++)
      for (let r = 0; r < h; r++) ctx.grid.getCell(c, r).visible = false;
    giant.scale.set(0.2);
    giant.alpha = 0;
    ctx.fx.addChild(giant);
    await Tween.to(
      giant,
      { 'scale.x': 1, 'scale.y': 1, alpha: 1 },
      420,
      easingByName('easeOutBack'),
    );
    await Tween.delay(600);
    giant.destroy();
    for (let c = anchorCol; c < anchorCol + w; c++)
      for (let r = 0; r < h; r++) ctx.grid.getCell(c, r).visible = true;
  },
};

/** Split symbol (xSplit): doubles every symbol to its left. */
export const SplitSymbol: ReelFeature = {
  key: 'split',
  label: 'Split symbol (xSplit)',
  enabled: (c) => c.features.split.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.split;
    const cols = ctx.grid.cols;
    const splitReel = f.reels.length ? f.reels[0] : cols - 1;
    const row = Math.floor(ctx.grid.rowsOf(splitReel) / 2);
    await morphSymbol(ctx.grid.getCell(splitReel, row), { symbol: f.symbol }, 240);
    ctx.log?.(`Split ×${f.factor}: doubling symbols left of reel ${splitReel}`);
    const left = pickFromBoard(ctx.board, (_c, col) => col < splitReel);
    await Promise.all(
      left.map(async (p, i) => {
        await Tween.delay((i % 6) * 30);
        const { x, y } = cellCenter(ctx.grid, p.col, p.row);
        const cs = ctx.grid.cellSize(p.col);
        await pulseCell(ctx.grid.getCell(p.col, p.row), 1.12, 200);
        await floatLabel(
          ctx.fx,
          x + cs.width / 3,
          y - cs.height / 3,
          `×${f.factor}`,
          0x9b5cff,
          600,
        );
      }),
    );
  },
};

/** Stacked symbols: a reel shows a full stack of one symbol. */
export const StackedSymbols: ReelFeature = {
  key: 'stacked',
  label: 'Stacked symbols',
  enabled: (c) => c.features.stacked.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.stacked;
    const cols = ctx.grid.cols;
    const reel = Math.floor(cols / 2);
    const rows = ctx.grid.rowsOf(reel);
    const sym = f.symbols.length ? pick(f.symbols, reel) : 'h1';
    const height = Math.min(f.height, rows);
    ctx.log?.(`Stacked "${sym}" ×${height} on reel ${reel}`);
    const start = Math.floor((rows - height) / 2);
    await Promise.all(
      Array.from({ length: height }, (_, i) => start + i).map(async (r, i) => {
        await Tween.delay(i * 50);
        const cell = ctx.grid.getCell(reel, r);
        await morphSymbol(cell, { symbol: sym }, 220);
        if (ctx.board[reel]) ctx.board[reel][r] = { symbol: sym };
      }),
    );
  },
};
