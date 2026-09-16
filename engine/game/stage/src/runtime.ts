/**
 * Runtime half of `stage` — the `stage1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance
 * (`/@fs/<realpath>`), not a hand-written, import-free twin.
 *
 * **`inject: ['renderer']` is what gates this row, on both paths it can
 * be reached by.** `composeFromProject` applies each row through its own
 * cordis fiber (`ctx.plugin`) and forwards this module's `inject` export
 * to it, so `ctx.renderer` below is a strict read cordis allows — a fiber
 * has none of the root context's leniency — and the row does not run
 * until `renderer` is on the context. Listed after `renderer1` (as
 * `e8-base`'s `e8.bundle.yml` has it) it applies in turn; listed before,
 * it waits and applies the moment `renderer1` provides — and if nothing
 * ever does, the loader reports it as never applied, naming `renderer`.
 * The tests' plain `ctx.plugin(stageRuntime, …)` honours the same export
 * the same way.
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
