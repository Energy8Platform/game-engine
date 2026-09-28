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
 * **Why the paytable is fetched here, not authored.** The Pixi shell has no
 * `setGameInfo` — its game-info sections are baked into `createPixiShell`
 * once, same as the bet ladder, so `apply` is now `async` and this has to
 * happen BEFORE construction. When `gameInfo.sections` is the schema's
 * empty-array default (an author who never wrote a paytable by hand), it
 * awaits exactly ONE `GET /api/spec`, turns `spec.symbols[].pay` into a
 * `paytable` section (`./paytable`'s `paytableFrom`), and lays symbol art
 * on top from the `symbols` row's document (`ctx.reflect.get('symbols',
 * false)`, lenient — that row may not be composed — read after its
 * `ready`). Any non-empty `sections` — including one the author wrote as
 * `[]` on purpose, indistinguishable from "nothing yet" — is left alone
 * and no fetch happens at all. No host, a `null` spec, no `pay` anywhere,
 * a rejected fetch: all of it is swallowed silently and the row boots
 * with the game info exactly as authored, same as a static build with no
 * host behind it.
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
import type { SessionService, SymbolsDoc } from '@energy8engine/contracts';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { createPixiShell, removePixiShell, type SafeArea, type Shell } from '@energy8platform/shell/pixi';
import { toShellConfig } from './config';
import { paytableFrom } from './paytable';
import { relay } from './relay';
import { Config } from './schema';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    session: SessionService;
    /**
     * The Pixi shell handle — `state`, the setters, `actions`, `safeArea`.
     * F20: `setVisible(false)` hides the bar AND makes `barHeight`/
     * `safeArea.bottom` answer 0 (read live) so `scenes1` gives the space
     * back; see `wrapShell` below.
     */
    shell: Shell;
  }
}

/**
 * Wraps the real Pixi shell for F20: `setVisible(false)` hides the bar
 * (forwarded to the real shell) AND makes `barHeight`/`safeArea.bottom`
 * answer 0 — read live off the real shell on every access, not cached —
 * so `scenes1`'s per-tick insets check (`runtime.ts`'s `scenes:insets`)
 * gives the bar's space back on its own, no `refit()` needed. Shown again,
 * both answer the real shell's current values.
 *
 * A `Proxy` whose target IS the real shell — NOT `Object.create(shell)`.
 * `Object.create` makes the wrapper its own object with `shell` only as its
 * PROTOTYPE: an inherited method then runs with the WRAPPER as `this`, and
 * `ShellController.setBalance`/`setWin` (packages/shell/src/core/
 * ShellController.ts) do a bare `this.prevBalance = n` — not nested under
 * `this.state` — which would silently create a SHADOW own property on the
 * wrapper and leave the real shell's bookkeeping stale forever. The `get`
 * trap below answers the three overrides itself and otherwise reads
 * `Reflect.get(shell, key, shell)` — receiver = the REAL shell, so an
 * inherited getter also computes against it — and binds a function result
 * to the real shell (cached, so `handle.setBalance === handle.setBalance`)
 * before handing it back: every mutation an inherited method makes lands on
 * the real shell, never on a copy. `set` mirrors this for symmetry, though
 * nothing here writes through the handle today.
 */
function wrapShell(shell: Shell): Shell {
  let hidden = false;
  // Reused, not reallocated: `scenes1` reads `safeArea` every ticker frame
  // while hidden, and the wrapper adds no allocation per read. (The real
  // `shell.safeArea` getter it copies from may allocate one of its own.)
  const hiddenSafeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  const setVisible = (v: boolean) => {
    hidden = !v;
    shell.setVisible(v);
  };
  // Bound functions, cached by key so repeated reads answer the same identity.
  const bound = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  return new Proxy(shell, {
    get(_target, key) {
      if (key === 'setVisible') return setVisible;
      if (key === 'barHeight') return hidden ? 0 : shell.barHeight;
      if (key === 'safeArea') {
        if (!hidden) return shell.safeArea;
        const { top, right, left } = shell.safeArea;
        hiddenSafeArea.top = top;
        hiddenSafeArea.right = right;
        hiddenSafeArea.left = left;
        return hiddenSafeArea;
      }
      const value = Reflect.get(shell, key, shell);
      if (typeof value !== 'function') return value;
      const cached = bound.get(key);
      if (cached) return cached;
      const fn = value.bind(shell) as (...args: unknown[]) => unknown;
      bound.set(key, fn);
      return fn;
    },
    set(_target, key, value) {
      return Reflect.set(shell, key, value, shell);
    },
  });
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

export async function apply(ctx: Context, config: Parameters<typeof Config>[0] = {}): Promise<void> {
  const { app } = ctx.renderer;
  const { init } = ctx.session;

  const validated = Config(config);
  const sections = (validated.gameInfo as { sections?: unknown[] } | undefined)?.sections;
  if (Array.isArray(sections) && sections.length === 0) {
    const fetchFn = (config as { fetchFn?: typeof fetch }).fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    try {
      const res = await fetchFn('/api/spec');
      const body = res.ok ? ((await res.json()) as { spec?: unknown }) : null;
      const symbols = ctx.reflect.get('symbols', false) as { doc(): SymbolsDoc | null; ready?: Promise<void> } | undefined;
      await symbols?.ready?.catch(() => {});
      const section = paytableFrom(body?.spec ?? null, symbols?.doc() ?? null);
      if (section) validated.gameInfo = { ...validated.gameInfo, sections: [section] };
    } catch {
      // No host, or no spec: the game info stays as authored (empty). The static default build lands here.
    }
  }

  const layer = new Container();
  layer.label = 'shell';
  const shell = createPixiShell({ app, parent: layer, ...toShellConfig(validated, init) });
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

  ctx.provide('shell', wrapShell(shell));

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
