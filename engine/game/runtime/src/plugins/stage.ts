/**
 * `stage` (scene, viewport, resize) as a cordis plugin, mounted onto
 * whatever `renderer` provides — `@energy8engine/stage` itself stays a
 * plain factory, same reasoning as `renderer.ts`'s module doc.
 *
 * `inject: ['renderer']` is the ordering itself, not a comment about it:
 * cordis only calls this plugin's `apply()` once `renderer` has been
 * `ctx.provide`d (measured directly — see task-10-report.md's cordis
 * probes), so `ctx.renderer` is never read here before it exists. If
 * `renderer-pixi` never provides it (its own `apply()` caught a failure
 * and returned early, per `renderer.ts`), this plugin's `apply()` simply
 * never runs — no service, no exception, nothing to catch here either.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { createStage, type Size, type Stage } from '@energy8engine/stage';

declare module 'cordis' {
  interface Context {
    stage: Stage;
  }
}

export interface StageConfig {
  design: Size;
  mode?: 'contain' | 'cover';
  /** Shared with the owning `GameApp` — a failed stage is recorded here, not thrown. */
  diagnostics: Diagnostic[];
}

export const name = 'stage';
export const inject = ['renderer'];

export function apply(ctx: Context, config: StageConfig): void {
  try {
    const stage = createStage({
      root: ctx.renderer.app.stage,
      design: config.design,
      mode: config.mode,
    });
    ctx.effect(() => () => stage.destroy(), 'stage:container');
    ctx.provide('stage', stage);
  } catch (error) {
    config.diagnostics.push(
      diagnostic(
        'error',
        'stage',
        'config',
        `the stage did not mount: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}
