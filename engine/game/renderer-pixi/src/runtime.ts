/**
 * Runtime half of `renderer-pixi` — the `renderer1` row in `e8-base`, and
 * the default provider of the `renderer` seam (`e8.seam` in this package's
 * package.json; `createGame` picks between candidates through
 * `@energy8engine/seam`, so this row only applies when it actually wins).
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
 * shared `diagnostics` array itself (the pattern the old hand-wired
 * `createGame` used, and task 9 retired).
 *
 * **Where the canvas goes.** A live DOM element cannot travel in a
 * bundle/patch row's YAML `config` any more than a function can, so it
 * arrives the same way the symbol resolver does: as a service the CALLER
 * provided before the first row applied (`createGame({ provide })` —
 * `mount` is the element the game owns on the page). This row reads it
 * OPTIONALLY: a game composed with no page to draw on (a test, a headless
 * play-through) still gets a working `ctx.renderer`, it is just attached
 * nowhere. `ctx.inject(['mount'], ...)` would be the wrong tool — it
 * would silently never run in exactly that case, where "the caller gave
 * us no mount" is a legitimate answer rather than "wait for one".
 *
 * That optional read goes through `ctx.reflect.get(name, false)` rather
 * than a plain `ctx.mount`: cordis THROWS on a property read of a
 * REGISTERED service a plugin did not declare in `inject` ("cannot get
 * property mount without inject" — measured, not guessed), which would
 * turn "this game has no page to draw on" into a row failure the moment
 * some other caller provides a mount somewhere. `reflect.get` is the
 * same lookup without that guard, and answers `undefined` when nobody
 * provided one.
 */
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import { createPixiRenderer, type PixiRenderer, type PixiRendererOptions } from './index';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    /** The element the game owns on the page — provided by the caller, absent headlessly. */
    mount: HTMLElement;
  }
}

export const name = 'renderer-pixi';

/** `config` is passed straight to pixi's `Application.init()` — width/height/background/... */
export async function apply(ctx: Context, config: PixiRendererOptions = {}): Promise<void> {
  // Read before the renderer is built — `createPixiRenderer` needs it to
  // decide whether to follow the mount's box (see its own doc comment).
  const mount = ctx.reflect.get('mount', false) as HTMLElement | undefined;

  // Exactly one of width/height is a config nothing downstream can act on:
  // pixi has no notion of "half a fixed size". `createPixiRenderer` has no
  // way to report that, so this row checks first, reports leniently (a
  // missing `diagnostics` service just means no one is watching yet — same
  // lenient read `session-host` uses), and strips the lone value so what
  // reaches `createPixiRenderer` reads as "absent" — following the mount.
  let options = config;
  if ((config.width === undefined) !== (config.height === undefined)) {
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(
      diagnostic(
        'warning',
        'renderer-pixi',
        'config',
        'width and height come together — following the mount instead',
        'set both, or neither',
      ),
    );
    const { width: _width, height: _height, ...rest } = config;
    options = rest;
  }

  const renderer = await createPixiRenderer(options, mount);
  ctx.effect(() => () => renderer.destroy(), 'renderer-pixi:app');

  if (mount) {
    mount.appendChild(renderer.app.canvas);
    // Reversible with the rest of the plugin: `renderer.destroy()` above
    // disposes the Application, but the canvas node it left in someone
    // else's DOM is not pixi's to remove.
    ctx.effect(() => () => renderer.app.canvas.remove(), 'renderer-pixi:canvas');
  }

  ctx.provide('renderer', renderer);
}
