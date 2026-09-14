import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import * as runtime from '../src/runtime';

/**
 * The runtime half's own two concerns, neither of which `createReelsBoard`
 * itself has: where the symbol resolver comes from (a row's YAML config
 * cannot carry a function, so it comes off `ctx` as an `assets` service),
 * and when the board's view gets mounted (whenever `stage` appears — via
 * `ctx.inject`, not call order).
 *
 * `stage` is registered AFTER `reels` on purpose in the mount test: that
 * is exactly the "ordered by dependency, not by registration order"
 * property the module doc claims. The stage stand-in is a real pixi
 * `Container` — it builds headlessly, no `Application` needed.
 */
const resolve: SymbolResolver = vi.fn((id: string) => {
  const c = new Container() as unknown as { __symbol: string };
  c.__symbol = id;
  return c as any;
});

const assetsService = {
  name: 'assets',
  apply(ctx: Context) {
    ctx.provide('assets', { resolve });
  },
};

const fakeStage = {
  name: 'stage',
  apply(ctx: Context) {
    ctx.provide('stage', { container: new Container() } as any);
  },
};

describe('reels runtime half', () => {
  it('takes its symbol resolver from the assets service when the row config has none', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);

    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(typeof ctx.board.spinTo).toBe('function');

    await ctx.fiber.dispose();
  });

  it('says what is missing, rather than building a board with no art', async () => {
    const ctx = new Context();

    // No `assets` provided anywhere, and no `resolve` in the config —
    // this throws, which is how a row reports failure: the loader turns
    // it into a Diagnostic naming the row.
    await expect(ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } })).rejects.toThrow(
      /resolver/i,
    );

    await ctx.fiber.dispose();
  });

  it('mounts its board into the stage once stage appears, even though stage is registered second', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    // Not mounted yet — stage doesn't exist yet.
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.plugin(fakeStage);

    expect(ctx.stage.container.children).toContain(ctx.board.view);

    await ctx.fiber.dispose();
  });

  it('never mounts, and never throws, when stage does not appear at all', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });
});
