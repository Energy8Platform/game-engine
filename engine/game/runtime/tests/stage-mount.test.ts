import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import * as stagePlugin from '../src/plugins/stage';

/**
 * `compose.test.ts` never reaches `plugins/stage.ts`'s own `apply()` at
 * all — under jsdom `renderer-pixi` always fails, so `stage`'s
 * `inject: ['renderer']` is never satisfied there. `Container` builds
 * headlessly (measured in Task 9), so this test stands a fake `renderer`
 * service in for the real one — a plain object shaped like `PixiRenderer`
 * whose `app.stage` is a real `Container` — and exercises `stage.ts`
 * directly, both the success path and its own try/catch. The fake below
 * is deliberately shaped only as far as `stage.ts` actually reads
 * (`renderer.app.stage`) and passed through `as any` — the real
 * `Context.renderer: PixiRenderer` augmentation already comes from
 * `../src/plugins/renderer.ts` (imported transitively via `stagePlugin`'s
 * own module graph), so redeclaring it here would conflict instead of
 * narrowing it.
 */
function fakeRenderer(root: unknown) {
  return {
    name: 'renderer-pixi',
    apply(ctx: Context) {
      ctx.provide('renderer', { app: { stage: root } } as any);
    },
  };
}

describe('the stage plugin', () => {
  it('mounts a design-resolution container onto the renderer root, once renderer exists', async () => {
    const ctx = new Context();
    const diagnostics: any[] = [];
    const root = new Container();

    await ctx.plugin(fakeRenderer(root));
    await ctx.plugin(stagePlugin, { design: { width: 1920, height: 1080 }, diagnostics });

    expect(ctx.stage).toBeDefined();
    expect(root.children).toContain(ctx.stage.container);
    expect(diagnostics).toEqual([]);

    await ctx.fiber.dispose();
  });

  it('records a diagnostic, and provides no stage, when createStage itself throws', async () => {
    const ctx = new Context();
    const diagnostics: any[] = [];

    // A `root` that isn't a real `Container` — `createStage` calls
    // `root.addChild(container)`, which throws against this.
    await ctx.plugin(fakeRenderer(null));
    await ctx.plugin(stagePlugin, { design: { width: 1920, height: 1080 }, diagnostics });

    expect((ctx as any).stage).toBeUndefined();
    expect(diagnostics.some((d) => d.severity === 'error' && d.plugin === 'stage')).toBe(true);

    await ctx.fiber.dispose();
  });
});
