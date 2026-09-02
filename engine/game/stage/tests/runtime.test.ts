import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

/**
 * The runtime half's own concern: turning a row's `{ design }` config into
 * a stage mounted on whatever the `renderer` seam provided. `Container`
 * builds headlessly (no pixi `Application` needed), so the renderer here
 * is a stand-in shaped only as far as this half actually reads it
 * (`renderer.app.stage`) and passed through `as any` — the real
 * `Context.renderer: PixiRenderer` augmentation already comes from
 * `@energy8engine/renderer-pixi`, so redeclaring it would conflict rather
 * than narrow.
 *
 * Unlike the plugin this replaced, this half has no try/catch of its own:
 * a row reports failure by throwing, and `composeFromProject` turns that
 * into a Diagnostic naming the row. The second test pins that shape —
 * "no renderer" must be a loud throw, not a stage quietly built on
 * nothing.
 */
function fakeRenderer(root: unknown) {
  return {
    name: 'renderer-pixi',
    apply(ctx: Context) {
      ctx.provide('renderer', { app: { stage: root } } as any);
    },
  };
}

describe('stage runtime half', () => {
  it('mounts a design-resolution container onto the renderer root', async () => {
    const ctx = new Context();
    const root = new Container();

    await ctx.plugin(fakeRenderer(root));
    await ctx.plugin(runtime, { design: { width: 1920, height: 1080 } });

    expect(ctx.stage).toBeDefined();
    expect(root.children).toContain(ctx.stage.container);

    await ctx.fiber.dispose();
  });

  it('provides no stage when the renderer never came up', async () => {
    const ctx = new Context();

    // Composed as a cordis plugin, `inject: ['renderer']` means apply is
    // never even called — nothing throws, and nothing is provided.
    await ctx.plugin(runtime, { design: { width: 1920, height: 1080 } });

    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });

  it('throws — loudly, for the loader to report — when applied with no renderer at all', async () => {
    // This is how a row is ACTUALLY applied: `composeFromProject` calls
    // `apply(ctx, config)` directly, in row order, which is what orders
    // stage1 after renderer1. That path has no `inject` gate, so a
    // missing renderer must surface as a throw the loader converts into
    // a Diagnostic naming the row — not as a stage silently built on
    // nothing.
    const ctx = new Context();

    expect(() => runtime.apply(ctx, { design: { width: 1920, height: 1080 } })).toThrow();
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });
});
