/**
 * The `renderer` seam (§4 of the design spec): a thin factory over pixi's
 * `Application`, so `stage`/`reels` (and, later, whatever boots the game)
 * depend on this seam's shape rather than on `pixi.js` directly.
 *
 * Measured alongside Task 9's reel-system spike: `Application.init()`
 * needs a real DOM. In plain Node it rejects immediately with
 * `ReferenceError: document is not defined`; jsdom does not get further
 * either (a live pixi Application cannot usefully initialise there — see
 * the project MEMORY note "Pixi headless init hang", corroborated here).
 * So this file's actual initialisation is not unit-testable at all — it is
 * proven working in Task 12's headless BROWSER run, per this task's brief.
 * What this suite tests instead is the mapping this factory itself adds on
 * top of `Application`: that `createPixiRenderer` forwards its options to
 * `Application.init` unchanged and hands back the `{ app, destroy() }`
 * shape — against a mocked `Application`, not a real one.
 */
import { Application, type ApplicationOptions } from 'pixi.js';

export interface PixiRenderer {
  /** The live pixi Application this seam provides — `stage` mounts onto `app.stage`. */
  readonly app: Application;
  destroy(): void;
}

export type PixiRendererOptions = Partial<ApplicationOptions>;

/** Builds and initialises a pixi `Application`. Rejects if `Application.init()` does — this
 *  function adds no error handling of its own, since none was measured to be needed here. */
export async function createPixiRenderer(options: PixiRendererOptions = {}): Promise<PixiRenderer> {
  const app = new Application();
  await app.init(options);
  return {
    app,
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
