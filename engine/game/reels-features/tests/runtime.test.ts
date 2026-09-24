/**
 * The `features1` row, composed on the REAL `reels1` and `playloop1` rows (not fakes) — the same
 * device `reels-motion`'s "on the real reels row" describe block uses, and for the same reason:
 * this row's own claims are about a real `ReelGrid` (`kit().grid` gaining/losing an actual child)
 * and a real `ReelSystem.onSpinStart` hook, not about what a hand-rolled stand-in was told to do.
 */
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Container } from 'pixi.js';
import type { CellData, DeepPartial } from '@energy8engine/reel-core';
import * as reelsRow from '@energy8engine/reels/runtime';
import * as playloopRow from '@energy8engine/play-loop/runtime';
import * as runtime from '../src/runtime';
import type { FeaturesRowConfig } from '../src/runtime';
import { pump, useManualTicker } from './harness';

useManualTicker();

const KINDS = [
  'expandWild',
  'walkWild',
  'dropWilds',
  'reveal',
  'transform',
  'multipliers',
  'sticky',
  'giant',
  'nudge',
].sort();

const assetsService = {
  name: 'assets',
  apply(ctx: Context) {
    ctx.provide('assets', { resolve: () => new Container() as never });
  },
};

/** A 3×3 grid — big enough for every kind's cells/paths/areas the tests below use. */
const GRID = { grid: { cols: 3, rows: 3, cellSize: 50, gap: 0 } };

const board3x3 = (symbol: string): CellData[][] =>
  Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ symbol })));

/** Composes assets → reels1 → playloop1 → features1, real packages throughout. */
async function composeReal(ctx: Context, config: DeepPartial<FeaturesRowConfig> = {}) {
  await ctx.plugin(assetsService);
  const reelsFiber = ctx.plugin(reelsRow, GRID);
  await reelsFiber;
  await ctx.plugin(playloopRow, {});
  await ctx.plugin(runtime, config);
  return reelsFiber;
}

const layerViewOf = (ctx: Context) =>
  ctx.reels.kit().grid.children.find((c) => c.label === 'reels-features');

/** `steps.kinds()`, minus play-loop's own built-in `emit` handler — not this row's to prove. */
const ourKinds = (ctx: Context) => ctx.steps.kinds().filter((k) => k !== 'emit').sort();

describe('reels-features runtime half (real reels + play-loop rows)', () => {
  it('registers all nine kinds into steps on apply', async () => {
    const ctx = new Context();
    await composeReal(ctx);

    expect(ourKinds(ctx)).toEqual(KINDS);

    await ctx.fiber.dispose();
  });

  it('a section switched off is absent from steps; the other eight stay', async () => {
    const ctx = new Context();
    await composeReal(ctx, { giant: { enabled: false } });

    expect(ctx.steps.has('giant')).toBe(false);
    for (const kind of KINDS.filter((k) => k !== 'giant')) expect(ctx.steps.has(kind)).toBe(true);

    await ctx.fiber.dispose();
  });

  it('an empty config (a bundle row no patch configured) hands a handler the default `ms`', async () => {
    const ctx = new Context();
    await composeReal(ctx, {});

    // `reveal`'s only tunable is `ms` (default 280): the run settling around that long, and not
    // sooner, proves the handler read the row's own default rather than an unset `undefined`
    // (which `Tween.to` would treat as a 0ms jump).
    const reveal = ctx.steps.get('reveal')!;
    const elapsed = await pump(
      reveal.run(
        { kind: 'reveal', cells: [{ col: 0, row: 0 }], symbol: 'wild' } as never,
        ctx.board,
      ),
    );
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThanOrEqual(300);

    await ctx.fiber.dispose();
  });

  it("dispose removes every kind and the row's overlay layer", async () => {
    const ctx = new Context();
    await composeReal(ctx);

    const grid = ctx.reels.kit().grid;
    const steps = ctx.steps;
    expect(grid.children.some((c) => c.label === 'reels-features')).toBe(true);
    expect(steps.kinds().filter((k) => k !== 'emit').sort()).toEqual(KINDS);

    await ctx.fiber.dispose();

    expect(steps.kinds().filter((k) => k !== 'emit')).toEqual([]);
    expect(grid.children.some((c) => c.label === 'reels-features')).toBe(false);
  });

  it('reels.spin() clears a giant left over from the previous spin (onSpinStart)', async () => {
    const ctx = new Context();
    await composeReal(ctx);

    const giant = ctx.steps.get('giant')!;
    await pump(
      giant.run(
        { kind: 'giant', col: 0, row: 0, width: 1, height: 1, symbol: 'H1' } as never,
        ctx.board,
      ),
    );
    const layerView = layerViewOf(ctx)!;
    expect(layerView.children.some((c) => c.label === 'giant')).toBe(true);

    await ctx.reels.spin(board3x3('A'));

    expect(layerView.children.some((c) => c.label === 'giant')).toBe(false);

    await ctx.fiber.dispose();
  });

  it('a hot re-apply of reels1 re-applies the row on the new system', async () => {
    const ctx = new Context();
    const reelsFiber = await composeReal(ctx);

    const firstReels = ctx.reels;
    const firstGrid = firstReels.kit().grid;
    expect(ourKinds(ctx)).toEqual(KINDS);
    expect(layerViewOf(ctx)).toBeDefined();

    // leave a giant up on the OLD system, to prove the new one starts with none carried over
    const giant = ctx.steps.get('giant')!;
    await pump(
      giant.run(
        { kind: 'giant', col: 0, row: 0, width: 1, height: 1, symbol: 'H1' } as never,
        ctx.board,
      ),
    );
    expect(layerViewOf(ctx)!.children.some((c) => c.label === 'giant')).toBe(true);

    await reelsFiber.update({ grid: { cols: 4, rows: 3, cellSize: 50, gap: 0 } });
    await vi.waitFor(() => {
      expect(ctx.reels).toBeDefined();
      expect(ctx.reels).not.toBe(firstReels);
    });

    const secondGrid = ctx.reels.kit().grid;
    expect(secondGrid).not.toBe(firstGrid);

    // kinds unaffected by reels1's own hot swap — nothing here depends on which system is live
    expect(ourKinds(ctx)).toEqual(KINDS);
    // the old grid lost its layer child; the new grid has a fresh, EMPTY one
    expect(firstGrid.children.some((c) => c.label === 'reels-features')).toBe(false);
    const freshLayer = layerViewOf(ctx)!;
    expect(freshLayer.children).toHaveLength(0);

    await ctx.fiber.dispose();
  });
});
