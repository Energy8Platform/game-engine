/**
 * Runtime half of `stage` — the `stage1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance
 * (`/@fs/<realpath>`), not a hand-written, import-free twin.
 *
 * **What orders this row after `renderer1` is the composition, not an
 * `inject`.** `composeFromProject` applies rows one at a time, in the
 * order the project resolved them, calling `module.apply?.(ctx, config)`
 * directly — cordis's dependency gating never runs on this path, so
 * neither the `inject` export below nor the (now deleted) `e8.runtime.
 * inject` manifest field has any say in when this row applies. `stage1`
 * reads `ctx.renderer` successfully because `e8-base`'s `e8.bundle.yml`
 * lists `renderer1` before it, and for no other reason. Reorder the rows
 * and this row's `apply()` runs against a context with no `renderer` on
 * it and throws — which the loader turns into a diagnostic naming
 * `stage1`, so the failure is loud, but it names the wrong culprit.
 *
 * The `inject` export is kept because it IS honoured on the other path
 * this module can be reached by — a plain `ctx.plugin(stageRuntime, …)`,
 * which is how the tests compose it. It is not what orders the row in a
 * real game.
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
