import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
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

  it('provides transitions with cut and fade registered, and a stage built from the config', async () => {
    const ctx = new Context();
    await ctx.plugin(fakeRenderer(new Container()));
    await ctx.plugin(runtime, {
      design: { width: 1, height: 1 },
      layers: [
        { id: 'a', z: 1 },
        { id: 'b', z: 0 },
      ],
      scenes: { s: { layers: ['a'] } },
    });
    expect(ctx.transitions.ids().sort()).toEqual(['cut', 'fade']);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['b', 'a']);
    await ctx.stage.enter('s');
    expect(ctx.stage.layer('b')!.visible).toBe(false);
    await ctx.fiber.dispose();
  });

  it('re-applies on fiber.update: a new stage with the new layers, a child mounted in the old layer survives', async () => {
    const ctx = new Context();
    const root = new Container();
    await ctx.plugin(fakeRenderer(root));
    const fiber = await ctx.plugin(runtime, {
      design: { width: 1, height: 1 },
      layers: [{ id: 'reels', z: 0 }],
    });
    const before = ctx.stage;
    const view = new Container();
    before.layer('reels')!.addChild(view);
    fiber.update({
      design: { width: 1, height: 1 },
      layers: [
        { id: 'bg', z: 0 },
        { id: 'reels', z: 1 },
      ],
    });
    await fiber.await();
    expect(ctx.stage).not.toBe(before);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['bg', 'reels']);
    expect(view.destroyed).toBe(false);
    expect(root.children).toEqual([ctx.stage.container]);
    await ctx.fiber.dispose();
  });

  it('re-applies on fiber.update: a child mounted on the root stage container survives too', async () => {
    const ctx = new Context();
    const root = new Container();
    await ctx.plugin(fakeRenderer(root));
    const fiber = await ctx.plugin(runtime, { design: { width: 1, height: 1 } });
    const view = new Container();
    ctx.stage.container.addChild(view);
    fiber.update({ design: { width: 1, height: 1 }, layers: [{ id: 'bg', z: 0 }] });
    await fiber.await();
    expect(view.destroyed).toBe(false);
    expect(view.parent).toBeNull();
    expect(root.children).toEqual([ctx.stage.container]);
    await ctx.fiber.dispose();
  });

  it('reports through ctx.diagnostics when present', async () => {
    const ctx = new Context();
    const reported: Diagnostic[] = [];
    await ctx.plugin({
      name: 'diagnostics',
      apply(c: Context) {
        c.provide('diagnostics', { report: (d: Diagnostic) => reported.push(d) });
      },
    });
    await ctx.plugin(fakeRenderer(new Container()));
    // One scene declared, so entering another is something to say.
    await ctx.plugin(runtime, {
      design: { width: 1, height: 1 },
      scenes: { base_game: { layers: ['reels'] } },
    });
    await ctx.stage.enter('nope');
    expect(reported).toHaveLength(1);
    await ctx.fiber.dispose();
  });
});
