import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import * as runtime from '../src/runtime';

/**
 * The runtime half's own concern, separate from `createReelsBoard` itself:
 * where the symbol resolver comes from (a row's YAML config cannot carry
 * a function, so it comes off `ctx` as an `assets` service).
 *
 * Mounting the board's view is Task 4's concern now (the board no longer
 * mounts into a `stage` — that row and its `layer()` API are gone with
 * `@energy8engine/stage`).
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

  it('never mounts, and never throws, when stage does not appear at all', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });
});
