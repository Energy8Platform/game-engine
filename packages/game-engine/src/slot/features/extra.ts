// packages/game-engine/src/slot/features/extra.ts
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

const seeded = (a: number, b: number, seed: number) =>
  Math.min(b, a + Math.floor(((Math.sin(seed * 53.17) + 1) / 2) * (b - a + 1)));

/** Multiplier symbols: marked cells carry values that combine into the win. */
export const MultiplierSymbols: ReelFeature = {
  key: 'multiplier',
  label: 'Multiplier symbols',
  enabled: (c) => c.features.multiplier.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.multiplier;
    const spots = pickFromBoard(ctx.board, () => true)
      .filter((_, i) => i % 4 === 0)
      .slice(0, 3);
    const values = [2, 3, 5].slice(0, spots.length);
    spots.forEach((p, i) =>
      ctx.grid.getCell(p.col, p.row).setData({ symbol: f.symbol ?? 'wild', multiplier: values[i] }),
    );
    await Promise.all(spots.map((p) => pulseCell(ctx.grid.getCell(p.col, p.row), 1.2, 240)));
    const total =
      f.combine === 'additive'
        ? values.reduce((a, b) => a + b, 0)
        : values.reduce((a, b) => a * b, 1);
    const capped = Math.min(total, f.max);
    ctx.log?.(
      `Multiplier (${f.combine}, ${f.scope}): ${values.join(f.combine === 'additive' ? ' + ' : ' × ')} = ×${capped}`,
    );
    // fly each value toward the centre, then show the combined total
    await Promise.all(
      spots.map(async (p) => {
        const { x, y } = cellCenter(ctx.grid, p.col, p.row);
        await floatLabel(ctx.fx, x, y, `×${values[spots.indexOf(p)]}`, 0xffd24a, 500);
      }),
    );
    const cx = (ctx.grid.cols * ctx.grid.cellSize) / 2 - ctx.grid.cellSize / 2;
    const cy = (ctx.grid.rows * ctx.grid.cellSize) / 2 - ctx.grid.cellSize / 2;
    await floatLabel(ctx.fx, cx, cy, `×${capped}`, 0xffe24a, 900);
  },
};

/** Nudge / xNudge: a reel nudges one position (xNudge fills a stacked wild, +1 mult per nudge). */
export const NudgeReels: ReelFeature = {
  key: 'nudge',
  label: 'Nudge / xNudge',
  enabled: (c) => c.features.nudge.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.nudge;
    const cols = ctx.grid.cols;
    const reel = f.reels.length ? f.reels[0] : Math.floor(cols / 2);
    const rows = ctx.grid.rowsOf(reel);
    ctx.log?.(
      f.toFullReel ? `xNudge: filling reel ${reel} with wild` : `Nudge reel ${reel} by ${f.step}`,
    );
    if (f.toFullReel) {
      let mult = f.multiplierStart;
      for (let r = 0; r < rows; r++) {
        const cell = ctx.grid.getCell(reel, r);
        await morphSymbol(cell, { symbol: 'wild', multiplier: mult > 1 ? mult : undefined }, 160);
        mult += f.multiplierPerNudge;
      }
      const { x, y } = cellCenter(ctx.grid, reel, Math.floor(rows / 2));
      await floatLabel(ctx.fx, x, y, `×${mult - f.multiplierPerNudge}`, 0xff7a3c, 800);
    } else {
      // shift the whole column down by `step` cells, then settle
      const step = ctx.grid.cellPosition(reel, 1).y - ctx.grid.cellPosition(reel, 0).y;
      const cells = Array.from({ length: rows }, (_, r) => ctx.grid.getCell(reel, r));
      await Promise.all(
        cells.map((c) =>
          Tween.to(c, { 'position.y': c.y + step * f.step }, 240, easingByName('easeOutBack')),
        ),
      );
      cells.forEach((c, r) =>
        c.position.set(ctx.grid.cellPosition(reel, r).x, ctx.grid.cellPosition(reel, r).y),
      );
    }
  },
};

/** Hold-and-spin / Hold & Win: special symbols lock and respins reset on each new lock. */
export const HoldAndSpin: ReelFeature = {
  key: 'holdAndSpin',
  label: 'Hold & Spin (respin)',
  enabled: (c) => c.features.holdAndSpin.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.holdAndSpin;
    const all = pickFromBoard(ctx.board, () => true);
    const sym = f.lockSymbols[0] ?? 'coin';
    const locked = new Set<string>();
    const lock = async (p: { col: number; row: number }, value: string) => {
      const cell = ctx.grid.getCell(p.col, p.row);
      cell.setData({ symbol: sym });
      await dropCell(ctx.grid, cell, p.col, p.row, 240);
      glowRing(ctx.fx, ctx.grid, p.col, p.row, 0xffcf5c);
      const { x, y } = cellCenter(ctx.grid, p.col, p.row);
      await floatLabel(ctx.fx, x, y, value, 0xffe24a, 500);
      locked.add(`${p.col}:${p.row}`);
    };
    // trigger
    const trigger = all.slice(0, f.triggerThreshold);
    ctx.log?.(`Hold & Spin triggered with ${trigger.length} ${sym}`);
    await Promise.all(trigger.map((p, i) => lock(p, `${(i + 1) * 5}`)));
    let respins = f.respinsAwarded;
    let round = 0;
    while (respins > 0) {
      round++;
      const free = all.filter((p) => !locked.has(`${p.col}:${p.row}`));
      const landed = free.filter((_, i) => seeded(0, 3, i + round * 3) === 0).slice(0, 2);
      ctx.log?.(
        `Respin ${round}: ${respins} left` + (landed.length ? ` — ${landed.length} new lock` : ''),
      );
      if (landed.length && f.resetOnNewSymbol) {
        respins = f.respinsAwarded;
        await Promise.all(landed.map((p) => lock(p, 'JP')));
      } else respins--;
      if (locked.size >= all.length) {
        ctx.log?.(f.fullGridAwardsGrand ? 'Full grid — GRAND!' : 'Full grid');
        break;
      }
      await Tween.delay(120);
    }
    ctx.log?.(`Hold & Spin: ${locked.size} locked`);
  },
};

/** Random pre-spin reel modifiers (add rows, inject wilds, set giant, guaranteed wilds). */
export const ReelModifier: ReelFeature = {
  key: 'reelModifier',
  label: 'Random reel modifier',
  enabled: (c) => c.features.reelModifier.enabled,
  async demo(ctx: FeatureContext) {
    const f = ctx.cfg.features.reelModifier;
    const pool = f.pool.length
      ? f.pool
      : [{ effect: 'addWilds' as const, magnitude: 3, weight: 1 }];
    const totalW = pool.reduce((a, m) => a + m.weight, 0);
    let roll = ((Math.sin(ctx.grid.cols * 7.7) + 1) / 2) * totalW;
    let mod = pool[0];
    for (const m of pool) {
      roll -= m.weight;
      if (roll <= 0) {
        mod = m;
        break;
      }
    }
    ctx.log?.(`Reel modifier: ${mod.effect} (+${mod.magnitude})`);
    if (mod.effect === 'addRows') {
      const next = ctx.grid.rowsPerReel.map((r) => r + mod.magnitude);
      // grow the board (new cells on top) and keep the system config in sync so the new rows
      // aren't blank and a later spin/rebuild doesn't revert the shape
      for (let c = 0; c < ctx.board.length; c++) {
        const col = ctx.board[c] ?? (ctx.board[c] = []);
        const fill = col[0]?.symbol ?? 'h1';
        for (let i = 0; i < mod.magnitude; i++) col.unshift({ symbol: fill });
      }
      ctx.cfg.grid.rowsPerReel = next;
      ctx.grid.reshape(next);
      ctx.grid.setGrid(ctx.board);
    } else if (mod.effect === 'addWilds' || mod.effect === 'guaranteedWilds') {
      const spots = pickFromBoard(ctx.board, () => true);
      const chosen: { col: number; row: number }[] = [];
      for (let i = 0; i < mod.magnitude && spots.length; i++)
        chosen.push(spots.splice(seeded(0, spots.length - 1, i), 1)[0]);
      await Promise.all(
        chosen.map(async (p) => {
          const cell = ctx.grid.getCell(p.col, p.row);
          cell.setData({ symbol: 'wild' });
          await dropCell(ctx.grid, cell, p.col, p.row, 280);
        }),
      );
    } else if (mod.effect === 'setGiant') {
      const cell = ctx.grid.getCell(0, 0);
      await pulseCell(cell, 1.3, 300);
    }
  },
};
