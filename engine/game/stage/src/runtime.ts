/**
 * Runtime half of `stage` — the `stage1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance
 * (`/@fs/<realpath>`), not a hand-written, import-free twin.
 *
 * `inject: ['renderer']` is what makes cordis wait to call `apply()` until
 * `renderer1`'s row has `ctx.provide`d `renderer` — ordering by dependency,
 * not by row order in the bundle/patch. If `renderer1` never provides it
 * (its own `apply()` threw), this row's `apply()` simply never runs.
 */
import type { Context } from 'cordis';
import { createStage, type CreateStageOptions, type Stage } from './index';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    stage: Stage;
  }
}

export const name = 'stage';
export const inject = ['renderer'];

/** `config` is `{ design: { width, height }, mode? }` — see `e8.patch.yml`'s `stage1` row. */
export function apply(ctx: Context, config: Pick<CreateStageOptions, 'design' | 'mode'>): void {
  const stage = createStage({ root: ctx.renderer.app.stage, ...config });
  ctx.effect(() => () => stage.destroy(), 'stage:container');
  ctx.provide('stage', stage);
}
