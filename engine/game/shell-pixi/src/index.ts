/**
 * Runtime half of `shell-pixi` — the `shell1` row in `e8-base`, and the
 * default candidate behind the `ui.shell` seam (spec §4). It wraps
 * `@energy8platform/shell/pixi`'s `createPixiShell` (the bar, the bet
 * ladder, balance, win, turbo, autoplay, the menu) as a thing the flow
 * drives and listens to, exactly like a scene.
 *
 * **The row decides nothing.** The legacy `createSlotGame` owned the shell
 * AND every decision around it — when Spin is busy, what a bet change
 * means mid-autoplay, how a win counts up — as one host with the scene as
 * a callback. Here all of that is a flow's business (`flow.yml`: `on
 * shell.spin → shell { busy: true } → spin { betLevel: $shell.bet } → …`),
 * and this row is two mechanical bridges plus a construction:
 *
 *  - Shell → flow (`./relay`): every `ShellEvents` entry re-emitted on the
 *    flow bus as `shell.<name>` with an object payload. The bus is read
 *    PER EMIT through `ctx.reflect.get('events', false)` — lenient, because
 *    `flow1` composes after this row in `e8-base` (and is `hot: true`, so
 *    its bus is a new object after a re-apply); a tap that lands before a
 *    bus exists is simply dropped, not thrown at.
 *  - Flow → shell: the `shell` kind (`@energy8engine/flow`'s `kinds.ts`)
 *    reads the `shell` service this row provides and calls its setters;
 *    and the live root `shell` (`flow.provideRoot('shell', () => shell.state)`)
 *    lets any node of any run read the CURRENT `$shell.bet`, `$shell.turbo`,
 *    `$shell.autoplay.remaining`, `$shell.busy`. The root rides
 *    `ctx.inject(['flow'])` — same reason as `session-host`'s — so row
 *    order does not matter and a re-applied flow row gets it again.
 *
 * **Why `session.init` feeds construction.** A shell is built with a bet
 * ladder, a default bet, a balance and a currency, and none of those are
 * an author's to type into a YAML config — they are what the platform
 * answered at init (`SessionInit`, from whichever `session` candidate won:
 * the dev host's `/api/session` or the Energy8 SDK's `initData`). Hence
 * `inject: ['renderer', 'session']`: the row waits for both, and
 * `./config`'s `toShellConfig` lays the author's part (features, game info,
 * theme, language as an override) over the session's part.
 *
 * **Why `parent` is the row's own layer, not `app.stage`.** `PixiRenderer.
 * mount` adds the shell's root to `config.parent ?? app.stage`. Handing it
 * `app.stage` would leave the row raising a container it does not own —
 * "the last child added by `createPixiShell`", found by position. Instead
 * the row adds ONE `Container` it owns to the stage and mounts the shell
 * inside; raising the shell above a freshly (re-)mounted `scenes1` container
 * is then `setChildIndex` on that layer, and tearing down is that layer's
 * own `destroy`. The layer joins the stage only AFTER `createPixiShell`
 * returned (the shell mounts into it off-stage first, which `PixiRenderer.
 * mount` does not mind): a construction that throws — a `Config` a
 * project's YAML broke, a shell that refused — fails the row with nothing
 * left behind on the stage, rather than an empty `shell` container nobody
 * owns. `addChild` appends, so the fresh layer is already on top; the raise
 * runs whenever `scenes` is provided (`ctx.inject(['scenes'])`, which also
 * fires at once if it already is): a hot `scenes1` re-apply appends a new
 * root to the stage, above everything, the shell included.
 *
 * **Teardown.** `removePixiShell()` fades the shell out over 250 ms on the
 * app ticker and only then destroys its root; the row destroys its layer
 * (the root's parent) right away rather than waiting on a promise that
 * never settles once `renderer1`'s own dispose has taken the ticker with
 * it. Measured against pixi 8.20: setting `alpha` on a destroyed container
 * does not throw and a second `destroy` is a no-op, so the fade's ticks
 * land harmlessly.
 */
import type { Context } from 'cordis';
import { Container } from 'pixi.js';
import type { SessionService } from '@energy8engine/contracts';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { createPixiShell, removePixiShell, type Shell } from '@energy8platform/shell/pixi';
import { toShellConfig } from './config';
import { relay } from './relay';
import { Config } from './schema';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    session: SessionService;
    /** The Pixi shell handle — `state`, the setters, `actions`, `safeArea`. */
    shell: Shell;
  }
}

/** The flow bus, as much of it as this row uses. Not cordis's own `ctx.events`. */
interface EventsLike {
  emit(name: string, payload?: unknown): void;
}

/** The flow service, as much of it as this row uses. */
interface FlowLike {
  provideRoot(name: string, getter: () => unknown): () => void;
}

export const name = 'shell';
export const inject = ['renderer', 'session'];
export { Config };

export function apply(ctx: Context, config: Parameters<typeof Config>[0] = {}): void {
  const { app } = ctx.renderer;
  const { init } = ctx.session;

  const layer = new Container();
  layer.label = 'shell';
  const shell = createPixiShell({ app, parent: layer, ...toShellConfig(Config(config), init) });
  app.stage.addChild(layer);

  const raise = () => {
    if (layer.parent === app.stage) app.stage.setChildIndex(layer, app.stage.children.length - 1);
  };
  ctx.inject(['scenes'], () => raise());

  ctx.effect(
    () =>
      relay(shell, (event, payload) =>
        (ctx.reflect.get('events', false) as EventsLike | undefined)?.emit(event, payload),
      ),
    'shell-pixi:relay',
  );

  ctx.provide('shell', shell);

  ctx.inject(['flow'], (c) => {
    c.effect(
      () => (c.get('flow') as FlowLike).provideRoot('shell', () => shell.state),
      'shell-pixi:root',
    );
  });

  ctx.effect(
    () => () => {
      void removePixiShell();
      layer.destroy({ children: true });
    },
    'shell-pixi:destroy',
  );
}
