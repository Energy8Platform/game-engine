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
 *
 * The row is `hot`: a config change re-applies it, and the old stage's
 * `destroy()` detaches (never destroys) what other rows mounted into its
 * layers. `transitions` is provided BEFORE `stage`, so a project plugin
 * with `inject: ['transitions']` can register its own before the first
 * `enter`. Diagnostics go through `ctx.diagnostics` when that row is
 * present — read leniently, like `reels` reads `assets` — else nowhere.
 */
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import type { Container } from 'pixi.js';
import {
  createStage,
  createTransitions,
  cut,
  fade,
  type CreateStageOptions,
  type Stage,
  type TickerLike,
  type TransitionsService,
} from './index';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    stage: Stage;
    transitions: TransitionsService;
  }
}

/** The row's config — see `e8.patch.yml`'s `stage1` row and `./schema`. */
export type StageConfig = Pick<
  CreateStageOptions,
  'design' | 'mode' | 'layers' | 'scenes' | 'transition' | 'transitionMs'
>;

export const name = 'stage';
export const inject = ['renderer'];

export function apply(ctx: Context, config: StageConfig): void {
  // Looked up per call, not captured at apply time (as `mechanics` does):
  // a `diagnostics` row listed after this one must still hear the stage.
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);
  const transitions = createTransitions(report);
  transitions.register(cut);
  transitions.register(fade);
  ctx.provide('transitions', transitions);
  // Read as loosely as the tests' stand-in renderer provides it: `ticker` may be absent.
  const app = ctx.renderer.app as { stage: Container; ticker?: TickerLike };
  const stage = createStage({
    root: app.stage,
    ticker: app.ticker ?? null,
    transitions,
    report,
    ...config,
  });
  ctx.effect(() => () => stage.destroy(), 'stage:container');
  ctx.provide('stage', stage);
}
