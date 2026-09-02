/**
 * Runtime half of `stage` — the cordis wiring around `./index.ts`'s
 * `createStage`/`fitStage`, browser-loadable.
 *
 * See `@energy8engine/boot`'s `src/runtime.js` module doc for why this
 * file's `import 'pixi.js'` does not actually resolve yet over
 * `GET /plugin-runtime/:id` — this is written to be correct once
 * something CAN load it, not proven working today.
 *
 * Mirrors `engine/game/runtime/src/plugins/stage.ts`: `inject: ['renderer']`
 * is what makes cordis wait to call `apply()` until `renderer1`'s row has
 * `ctx.provide`d `renderer` — ordering by dependency, not by row order in
 * the bundle/patch. If `renderer1` never provides it (its own `apply()`
 * threw), this row's `apply()` simply never runs.
 */
import { Container } from 'pixi.js';

export const name = 'stage';
export const inject = ['renderer'];

function fitStage(viewport, design, mode = 'contain') {
  const scaleX = viewport.width / design.width;
  const scaleY = viewport.height / design.height;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return {
    scale,
    x: (viewport.width - design.width * scale) / 2,
    y: (viewport.height - design.height * scale) / 2,
  };
}

/** `config` is `{ design: { width, height }, mode? }` — see `e8.patch.yml`'s `stage1` row. */
export function apply(ctx, config) {
  const root = ctx.renderer.app.stage;
  const container = new Container();
  root.addChild(container);

  const stage = {
    container,
    resize(viewportWidth, viewportHeight) {
      const fit = fitStage(
        { width: viewportWidth, height: viewportHeight },
        config.design,
        config.mode,
      );
      container.scale.set(fit.scale);
      container.position.set(fit.x, fit.y);
      return fit;
    },
    destroy() {
      root.removeChild(container);
      container.destroy({ children: true });
    },
  };

  ctx.effect(() => () => stage.destroy(), 'stage:container');
  ctx.provide('stage', stage);
}
