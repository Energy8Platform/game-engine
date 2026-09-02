/**
 * Runtime half of `renderer-pixi` — the cordis wiring around
 * `./index.ts`'s `createPixiRenderer`, browser-loadable.
 *
 * See `@energy8engine/boot`'s `src/runtime.js` module doc for the shared
 * constraint every runtime half in `e8-base` is written under (no
 * TypeScript, no bare specifiers resolve in a raw, un-bundled `import()`)
 * and why this file's own `import 'pixi.js'` below does not actually work
 * yet over `GET /plugin-runtime/:id` — it is correct once something CAN
 * load it, not proven working today.
 *
 * Mirrors `engine/game/runtime/src/plugins/renderer.ts` structurally:
 * failures are data. Unlike that file, this one does not manage a shared
 * `diagnostics` array — `engine/game/loader/src/index.ts`'s
 * `composeFromProject` already catches a throwing `apply()` and turns it
 * into a row `Diagnostic` itself, so the simpler, honest thing for a row
 * to do is just throw on failure and let the loader do that job once, in
 * one place, for every row — not reinvent it per package.
 */
import { Application } from 'pixi.js';

export const name = 'renderer-pixi';

/** `config` is passed straight to pixi's `Application.init()` — the same shape `main.ts` calls `renderer` today (width/height/background/...). */
export async function apply(ctx, config) {
  const app = new Application();
  await app.init(config ?? {});

  const renderer = {
    app,
    destroy() {
      app.destroy(true, { children: true });
    },
  };

  ctx.effect(() => () => renderer.destroy(), 'renderer-pixi:app');
  ctx.provide('renderer', renderer);
}
