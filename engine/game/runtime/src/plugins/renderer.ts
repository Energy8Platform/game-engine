/**
 * The `renderer` seam as a cordis plugin — the cordis wiring
 * `@energy8engine/renderer-pixi` itself deliberately does not have (see
 * that package's module doc: no requesting brief, no consumer to measure a
 * service shape against, until now).
 *
 * `createPixiRenderer` rejects when pixi's `Application.init()` does — measured
 * (see task-10-report.md) to happen FAST, not hang, both in plain Node
 * (`document is not defined`) and in jsdom (`Application.init()` itself
 * throws once it reaches real canvas/WebGL work jsdom does not implement).
 * Either way this plugin's `apply()` must not let that rejection through:
 * per the "failures are data" rule this whole plan is built on (see
 * `session-dev`'s module doc for the canonical statement of it), a missing
 * renderer is a `Diagnostic`, not a reason for `createGame` to reject.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import {
  createPixiRenderer,
  type PixiRenderer,
  type PixiRendererOptions,
} from '@energy8engine/renderer-pixi';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
  }
}

export interface RendererConfig {
  options?: PixiRendererOptions;
  /** Shared with the owning `GameApp` — a failed renderer is recorded here, not thrown. */
  diagnostics: Diagnostic[];
}

export const name = 'renderer-pixi';

export async function apply(ctx: Context, config: RendererConfig): Promise<void> {
  let renderer: PixiRenderer;
  try {
    renderer = await createPixiRenderer(config.options);
  } catch (error) {
    config.diagnostics.push(
      diagnostic(
        'error',
        'renderer-pixi',
        'init',
        `the renderer did not start: ${error instanceof Error ? error.message : String(error)}`,
        'run this in a real browser with WebGL or WebGPU available — pixi cannot usefully initialise in Node or jsdom',
      ),
    );
    return;
  }

  ctx.effect(() => () => renderer.destroy(), 'renderer-pixi:app');
  ctx.provide('renderer', renderer);
}
