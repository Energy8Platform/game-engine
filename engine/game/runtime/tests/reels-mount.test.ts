import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { Context } from 'cordis';
import * as reelsPlugin from '../src/plugins/reels';

/**
 * `compose.test.ts` never exercises the "board mounts into stage" half of
 * `plugins/reels.ts` — under jsdom the renderer always fails, so `stage`
 * never comes up there, and that `ctx.inject(['stage'], …)` callback never
 * fires in that suite. `Container` builds headlessly (measured in Task 9),
 * so this test proves the mounting itself directly: a real `reels` plugin,
 * a `stage` stand-in that is just a real `Container` (no renderer, no
 * pixi `Application` needed to construct or mutate a `Container`), and no
 * `createGame` in between.
 *
 * `stage` is registered AFTER `reels` on purpose — this is exactly the
 * "order via inject, not via call order" property `plugins/reels.ts`'s
 * module doc claims: `ctx.inject` was measured (task-10-report.md) to run
 * its callback once the dependency appears, regardless of which was
 * registered first.
 */
const resolve: SymbolResolver = vi.fn((id: string) => {
  const c = new Container() as unknown as { __symbol: string };
  c.__symbol = id;
  return c as any;
});

// The real `Context.stage: Stage` augmentation comes from `../src/plugins/stage.ts`
// (part of the same tsc program via `tsconfig.json`'s `include`); this fake is
// deliberately narrower than that and passed through `as any` rather than
// redeclaring the module (which would conflict with it instead of narrowing it).
const fakeStage = {
  name: 'stage',
  apply(ctx: Context) {
    ctx.provide('stage', { container: new Container() } as any);
  },
};

describe('reels mounts its board into the stage via ctx.inject, not call order', () => {
  it('mounts once stage appears, even though stage is registered second', async () => {
    const ctx = new Context();
    const diagnostics: any[] = [];

    await ctx.plugin(reelsPlugin, {
      options: { resolve, config: { grid: { cols: 2, rows: 2 } } },
      diagnostics,
    });

    // Not mounted yet — stage doesn't exist yet.
    expect((ctx as any).stage).toBeUndefined();

    await ctx.plugin(fakeStage);

    expect(ctx.stage.container.children).toContain(ctx.board.view);

    await ctx.fiber.dispose();
  });

  it('never mounts, and never throws, when stage does not appear at all', async () => {
    const ctx = new Context();
    const diagnostics: any[] = [];

    await ctx.plugin(reelsPlugin, {
      options: { resolve, config: { grid: { cols: 2, rows: 2 } } },
      diagnostics,
    });

    expect(ctx.board).toBeDefined();
    expect((ctx as any).stage).toBeUndefined();

    await ctx.fiber.dispose();
  });
});
