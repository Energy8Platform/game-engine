/**
 * Runtime half of `renderer-pixi` — the `renderer1` row in `e8-base`.
 *
 * A real TypeScript module, not a hand-written twin: `dev-game` serves
 * this file straight from its own vite instance over `/@fs/<realpath>`
 * (see `engine/ide/host/src/plugins/runtime-assets.ts`'s `resolveRuntimeUrl`
 * and `engine/ide/host/src/plugins/dev-game.ts`'s `devGameRoot` service),
 * which strips the types and rewrites `pixi.js` to its optimized-deps URL
 * before the browser ever sees it — measured directly, see
 * task-8-report.md's appended finding. A raw, untranspiled `.js` twin
 * (this file's first draft) could never resolve that import; this can,
 * because something now actually processes it.
 *
 * `apply()` just throws on failure — `engine/game/loader/src/index.ts`'s
 * `composeFromProject` already catches a throwing `apply()` and turns it
 * into a row `Diagnostic`, so there is no need for this row to manage a
 * shared `diagnostics` array itself (the pattern `createGame` used, and
 * task 9 is retiring).
 */
import type { Context } from 'cordis';
import { createPixiRenderer, type PixiRenderer, type PixiRendererOptions } from './index';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
  }
}

export const name = 'renderer-pixi';

/** `config` is passed straight to pixi's `Application.init()` — width/height/background/... */
export async function apply(ctx: Context, config: PixiRendererOptions = {}): Promise<void> {
  const renderer = await createPixiRenderer(config);
  ctx.effect(() => () => renderer.destroy(), 'renderer-pixi:app');
  ctx.provide('renderer', renderer);
}
