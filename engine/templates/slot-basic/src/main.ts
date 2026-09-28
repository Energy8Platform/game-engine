/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite, and what Task 12's preview iframe points at (same server,
 * see `engine/ide/client/src/screens/Preview.tsx`'s `Preview`).
 * This is the minimal "open, click spin" harness, not a finished game
 * shell.
 *
 * **What this file no longer does.** It used to hand `createGame` the
 * renderer size, the stage's design resolution, the reel grid and the
 * stage→mechanic binding as a JS object. All four now live in this
 * project's own `e8.patch.yml`, on top of the `e8-base` bundle its
 * `e8.profile.yml` stacks: `createGame` fetches that composition from the
 * host and applies each row's runtime half. Changing the grid is an edit
 * to a `.yml` file, and adding a plugin is a row — neither is a change to
 * this file or to the engine.
 *
 * What is left is exactly what a project file cannot hold: `mount`, a live
 * DOM element — this page's own `#mount`. It travels as the `mount`
 * service; `createGame` provides it, the renderer row attaches its canvas
 * to it, and `createGame` draws the failure screen on it when something
 * went wrong.
 *
 * The art is no longer this file's problem, either. It lives in this
 * project's own `symbols.yml`, and the `symbols1` row (`e8-base`, ahead of
 * `reels1`) reads it and supplies the `assets` service `reels1` reads off
 * `ctx` the same way `mount` arrives here — so a real game never touches
 * this file for its art, only `symbols.yml`.
 *
 * Everything the game then does — the registry, the board, executing a
 * presentation plan — is reached through `game.ctx`, off services rows
 * provided. There is no static import of a mechanic, a renderer, or the
 * play loop here; that is the property this whole slice was built for.
 *
 * The other side of that freedom is that a composition can legally leave
 * out something a row needs — and until now, nothing but THIS PAGE knew
 * that, by hand: a `REQUIRES` list of `{ service, row, pkg, what }` it
 * filtered against `game.ctx.reflect.get(...)` itself. Most of that list
 * is gone. The rows that need `board`/`mechanics`/`steps` say so in their
 * OWN `package.json` (`e8.runtime.requires` — see `E8RuntimeHalf.requires`
 * in `@energy8engine/contracts`), and `createGame` checks it after every
 * row has applied, landing the result straight in `game.diagnostics` — the
 * same list this page already reads for everything else.
 *
 * What is left of it is the two services `need()` (further down) reads
 * and records in the same call — `mechanics` and `board`. (`play` was the
 * third, until the spin loop left this file for `flow.yml` — see the flow
 * section below; nothing on this page reads it any more.)
 * `requires` is a field of a package.json, and a PAGE has none the
 * composition ever reads, so a service only this file touches is nobody
 * else's to check. Leaving it unchecked was measured, not assumed: with
 * `reelstep1` also out of the patch — no row left declaring `mechanics`
 * — dropping `mechanics1` left the page silently reporting nothing wrong,
 * over a board that could never present anything; the first click then
 * gave `Cannot read properties of undefined (reading 'forStage')`. That is
 * the silence the whole `boot` design exists to prevent, reached by an
 * edit the composition considers legal. So the check is narrowed to what
 * only this page knows, not restored wholesale — and narrowed a second
 * way now too: `need()` is the only way this file reaches either of the
 * two, enforced in the type system (see `PageCtx` below), so a third one
 * cannot start being read here without being declared here first.
 *
 * **This page keeps no diagnostics reader of its own.** Everything it
 * finds is still written into `ctx.diagnostics` — the live list the
 * `diagnostics1` row provides, through the same `reportAll` call as
 * always — but nothing here renders it: the IDE's Diagnostics tab is
 * `ide-bridge`'s forward of that same list, so what a person reads there
 * is exactly what this page and every other producer wrote.
 *
 * `@energy8engine/ide-bridge` (Task 12) is composed directly into
 * `game.ctx` below — the "hot fork to the game": it opens the SAME `/ide`
 * websocket `engine/ide/client/src/plugins/connection.ts` speaks, listens
 * for the composition row a project's `e8.yml` gives it (see this
 * project's own `e8.yml`), and rebinds `base_game` live, with no reload of
 * this page or the IDE around it. Nothing about it makes `first-slot` a
 * production game — `ide-bridge` is a plugin of the editor phase (see its
 * own module doc), and it is reached only under `import.meta.env.DEV`,
 * by a dynamic import, so a built page never carries it.
 *
 * **One file, two lives: `e8 dev` and `e8 build`.** This same entry is
 * what vite serves under the dev host and what `e8 build` bundles into a
 * static `dist/` (spec §6), and three things below exist for the second:
 *
 *  - `virtual:e8-rows` — the composition's runtime halves as a map of row
 *    id → `() => import(...)`. A composed page never names its rows;
 *    `createGame` fetches `/api/composition` and `import()`s each row's
 *    `runtimeUrl`, a string a bundler cannot follow. `e8 build` fills the
 *    map (`@energy8engine/ide-host`'s `vite-rows.ts`) so vite bundles
 *    every half, and its frozen `dist/api/composition` names
 *    the row ID as each row's `runtimeUrl`; `importModule` below looks the
 *    id up first (as an own key) and falls through to a plain
 *    `import(url)` — which is the whole path under `e8 dev`, where the map
 *    is `{}`.
 *  - `import.meta.env.E8_TARGET` — `createGame`'s `buildTarget`, baked in
 *    by `e8 build --target <name>` (the `session` seam picks
 *    `@energy8engine/session-sdk` under `platform`); unset under `e8 dev`,
 *    so the default candidate wins there.
 *  - `import.meta.env.DEV` — `ide-bridge` is the editor's, not the game's:
 *    reached only under dev, by a dynamic import, so a built page never
 *    carries it. What a built page KEEPS is everything else — the flow,
 *    the shell, and the `window.__e8` hooks at the bottom, which are how
 *    `build.spec.ts` proves the bundle plays.
 */
import { createGame } from '@energy8engine/game-runtime';
import { reportAll, type DiagnosticsService } from '@energy8engine/diagnostics';
import { rows } from 'virtual:e8-rows';
import {
  diagnostic,
  type Diagnostic,
  type FlowTraceEntry,
  type RefillStep,
  type SessionInit,
  type StepOpts,
} from '@energy8engine/contracts';
import type { EventsService, FlowService } from '@energy8engine/flow';
// Type-only, and fully erased: this module is what DECLARES the
// `ctx.board` service this page reads off the composed context. Importing
// its types is not importing it — nothing here pulls `reels` into the
// bundle, and the package is not composed by this file. It is the page
// saying, in the type system, which capabilities it expects the project's
// composition to have provided.
import type {} from '@energy8engine/reels/runtime';
// Same device again, for `ctx.spinLog` — the durable record of spins the
// `spinlog1` row provides. This page reads it only through
// `reflect.get(..., false)`, and a game with no log is a working game —
// nothing declares `spinLog` a requirement anywhere, on purpose.
import type {} from '@energy8engine/spin-log/runtime';

const mount = document.getElementById('mount')!;

const game = await createGame({
  mount,
  buildTarget: import.meta.env.E8_TARGET || undefined,
  // `Object.hasOwn`, not `rows[url]?.()`: a row id is any string an author
  // typed, and `constructor` or `toString` would otherwise reach
  // `Object.prototype` and call something that is not a row.
  loader: {
    importModule: (url) =>
      Object.hasOwn(rows, url) ? rows[url]() : import(/* @vite-ignore */ url),
  },
});

/**
 * The services this PAGE reads off `ctx` and cannot work without — not
 * `e8.runtime.requires`, kept for the reason the module doc gives:
 * `requires` is declared in a package.json, by a row, and this page is
 * not one.
 *
 * Named once, here, rather than left to be re-typed at every read: a
 * third call to `need()` (below) naming a service outside this union is
 * a compile error, so widening what the page needs starts at this line,
 * not at the read that would otherwise sneak one in uncounted.
 */
type PageNeedService = 'mechanics' | 'board';

interface PageNeedDescriptor {
  service: PageNeedService;
  row: string;
  pkg: string;
  what: string;
}

interface PageNeed extends PageNeedDescriptor {
  /** Whether `ctx.reflect.get` found something, the moment `need()` looked. */
  met: boolean;
}

const pageNeeds: PageNeed[] = [];

/**
 * Reads one service this page cannot do without, and records having read
 * it — the same call, so the record can never say something different
 * from what was actually asked for. `unmet`, a little further down, is
 * only ever a filter over what got pushed here; there is no second list
 * to keep in sync with the reads, because this IS the read.
 *
 * `ctx.reflect.get(name, false)` rather than `ctx.<name>` directly, for
 * the reason the old list gave: cordis throws on a property read of a
 * REGISTERED service this module never injected, and "nobody provided
 * one" is the answer this needs, not an exception.
 */
function need(descriptor: PageNeedDescriptor): unknown {
  const value = ctx.reflect.get(descriptor.service, false);
  pageNeeds.push({ ...descriptor, met: value !== undefined });
  return value;
}

/**
 * `game.ctx`, viewed with exactly the two services above removed — so
 * `ctx.mechanics` (or `.board`), typed straight off `ctx`
 * anywhere below this line, does not compile. `game.ctx` itself keeps its
 * full type: `ideBridge.apply(game.ctx, {})` further down needs the real
 * `Context`, and TypeScript has no way to narrow a value that still
 * exists, fully typed, under its own name — so this is the file's own
 * decision to route every other read through the narrower view, not a
 * wall the language builds unasked. What that decision buys: the two
 * reads right below (`currentMechanics()`/`currentBoard()` — see why those
 * are reads, not captures) are the only way this file
 * reaches those services from here down, because `need()` and
 * `game.ctx.reflect` are the only things still holding a reference wide
 * enough to read them.
 * `diagnostics`, `boot` and `spinLog` are untouched by the narrowing —
 * genuinely optional, not page needs — and still read straight off `ctx`
 * a few lines down, the same guarded way they always did.
 */
type PageCtx = Omit<typeof game.ctx, PageNeedService>;
const ctx: PageCtx = game.ctx;

// The type-level half of the guarantee above, pinned so it cannot go
// quietly stale: `tsc --noEmit` (part of this workspace's own `typecheck`
// script) fails the build the moment any of these three lines compiles
// cleanly, exactly the way `engine/core/contracts/tests/mechanic-open
// .test.ts` pins its own compile-time claims. There is no runtime half to
// pair it with — the point of each line is that it must never run — so
// unlike that file this is not also a `.test.ts`; it lives here, right
// next to the type it is a claim about, and is checked on every
// `npm run typecheck --workspace e8-example-first-slot`.
// @ts-expect-error `mechanics` is a page need — read it through `currentMechanics()` below, never off `ctx` directly
void ctx.mechanics;
// @ts-expect-error `board` is a page need — read it through `currentBoard()` below, never off `ctx` directly
void ctx.board;

need({
  service: 'mechanics',
  row: 'mechanics1',
  pkg: '@energy8engine/game-runtime',
  what: 'a mechanic registry to bind base_game through, at boot from e8.patch.yml and live while editing',
});

/**
 * Read per use, like `currentBoard()` below and for the same reason:
 * `mechanics1` is a HOT row. A live edit to its `stages` re-applies the
 * row's fiber, which disposes the registry this page would have captured
 * — its bindings were that run's effects; it answers nothing afterwards —
 * and provides a new one. `need()` above records the boot-time answer,
 * for its diagnostic; this is the live one.
 */
const currentMechanics = () =>
  game.ctx.reflect.get('mechanics', false) as typeof game.ctx.mechanics | undefined;

/**
 * `board` stays a page need, in the page's own words, though the read
 * that first put it here — `presentStage`'s `play.execute(plan, board)` —
 * left with the spin loop. `@energy8engine/play-loop`'s own `requires:
 * ["board"]` covers the ROW's half of the story, at boot; the flow's
 * `present` node covers the run-time half, per spin ("no board to run it
 * on"). What neither says is what THIS PAGE is: a board with a Spin
 * button over it, whose test harness (`__e8.gridSize()`/`symbols()`, at
 * the bottom) reads that board directly. A composition with no `reels1`
 * is a page over nothing, and the failure screen says so here in the
 * page's terms — naming the row — rather than only in the play loop's.
 */
need({
  service: 'board',
  row: 'reels1',
  pkg: '@energy8engine/reels',
  what: 'a board to draw the game on and to read the result back from',
});

/**
 * `board` is read per use, never captured: `reels1` is a HOT row. An edit
 * to it in the IDE re-applies the row's fiber in place — the board this
 * page would have captured is destroyed and a new one provided — so a
 * capture would be a dead board after the first live edit. `need()` above
 * still records the boot-time answer, for its diagnostic; this is the live
 * one. `undefined` when nothing provides it.
 */
const currentBoard = () =>
  game.ctx.reflect.get('board', false) as typeof game.ctx.board | undefined;

/**
 * The service `reportAll` below writes the page's own findings into — the
 * `diagnostics1` row (`@energy8engine/diagnostics`). There is no reader on
 * this page any more: the IDE's Diagnostics tab is `ide-bridge`'s forward
 * of the same list, so what a person reads there is exactly what this
 * page and every other producer — the play loop, the mechanics registry,
 * the bridge — wrote here. `game.diagnostics` — which now includes any
 * row's unmet `e8.runtime.requires` (see the module doc above) — is
 * already merged into it by the time `createGame` returns `game`. If the
 * composition was missing something a row needed, the mount is already
 * showing the failure screen by the time this line runs; `createGame`
 * draws it itself, the same `boot`-or-fallback logic it always has.
 *
 * Through `ctx.reflect.get(name, false)`: `diagnostics1` is an optional row
 * (see `e8-base`'s own bundle file), a composition without it is legal,
 * and cordis throws on a property read of a registered service this
 * module never injected. `reportAll` below is a no-op with `undefined`
 * rather than throwing.
 */
const diagnosticsLog = ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined;

const unmet = pageNeeds
  .filter((entry) => !entry.met)
  .map((entry) =>
    diagnostic(
      'error',
      'first-slot',
      entry.service,
      `this page needs ${entry.what}, and nothing in the composition provided "${entry.service}" — the "${entry.row}" row (${entry.pkg}) is what normally does`,
      `check the "${entry.row}" row: it may have been removed in e8.patch.yml, or it may be listed but failing — any diagnostic above naming "${entry.row}" says which`,
    ),
  );

/**
 * The page's own findings join the same list everything else writes to.
 * `game.diagnostics` is already in it — `createGame` mirrors what it
 * collected into the service before it returns — so only `unmet` is
 * written here, and exactly once.
 */
reportAll(diagnosticsLog, unmet);

const diagnostics = [...game.diagnostics, ...unmet];

/**
 * Draws the reasons where a person is already looking, replacing whatever
 * the renderer row attached to the mount. `createGame` does this for the
 * diagnostics IT collected; these were found after it returned, so making
 * them visible is this page's to do.
 *
 * Through the composed `boot` service, which is the point of `boot1` being
 * a row: a project shipping a branded failure screen gets this one too.
 * The fallback and the try/catch are the same two guards `createGame`'s
 * own `renderFailure` carries, for the same two reasons — `boot1` can
 * legally be dropped from a composition, and a failure screen that throws
 * must not blank the page it was supposed to explain.
 */
if (unmet.length > 0) {
  const boot = ctx.reflect.get('boot', false) as
    { renderFailure(root: HTMLElement, list: Diagnostic[]): void } | undefined;
  try {
    if (!boot) throw new Error('no boot row in this composition');
    boot.renderFailure(mount, diagnostics);
  } catch {
    mount.textContent = [
      'This game could not start',
      ...diagnostics.map((d) => `${d.plugin} — ${d.where}: ${d.message}`),
    ].join('\n');
  }
}

/**
 * The live channel from the IDE's composition screen — and NO stage or
 * mechanic is passed on purpose. The composition alone decides what
 * `base_game` is bound to; `ide-bridge` rebinds it only when a human has
 * actually written a value into its own `mechanic` field — see
 * `IdeBridgeSettableConfig.mechanic`.
 *
 * **No `onDiagnostic` callback.** `apply` is handed this game's `ctx`, and
 * `ide-bridge`'s own `report()` writes every diagnostic it raises into
 * `ctx.diagnostics` — the same list `reportAll` above writes the page's own
 * findings into, and that the IDE's Diagnostics tab reads back. A callback
 * that wrote the same event a second way would put this page back in the
 * business of keeping its own record.
 *
 * Under `import.meta.env.DEV` only, and by a dynamic import: a static
 * `import * as ideBridge` would sit in a built page's module graph whether
 * or not this branch ran, and vite drops the dead branch — import and all
 * — when `DEV` is baked to `false` by `e8 build`.
 */
// Not awaited: a top-level `await` here parks everything below it — the
// `__e8` harness included — behind a cold-cache module fetch. The bridge
// attaches when it lands; nothing on this page reads it synchronously.
if (import.meta.env.DEV) {
  void import('@energy8engine/ide-bridge').then((ideBridge) => ideBridge.apply(game.ctx, {}));
}

/**
 * **The flow drives the game (slice 19), through the shell (slice 26).**
 * Everything a click used to do here — `POST /api/spin`, `presentStage`
 * (check-then-present through the bound mechanic, `play.execute` on the
 * live board), the temporary "show the scene named after the stage" rule,
 * and `play.record` — is now this project's `flow.yml`, read by the
 * `flow1` row `e8-base` composes: `boot → show base_game → on shell.spin
 * → shell { busy } → spin { betLevel: $shell.bet } → present { turbo:
 * $shell.turbo } → … → shell { busy: false }`. The `spin` and `present`
 * node kinds (`@energy8engine/flow`'s `kinds.ts`) are the two functions
 * that were deleted from this file, one to one. The Spin the flow listens
 * to is the SHELL's: the `shell1` row (`@energy8engine/shell-pixi`, the
 * bar drawn over the canvas) re-emits every one of its events on the bus
 * as `shell.<name>`, and its live state is the flow's `$shell.*` root.
 * `pressSpin` below used to be behind this page's own Spin button, a dev
 * PROXY for that bar; the button is gone (the shell already has one) and
 * `pressSpin` is now reached only by `__e8.spin()` — same shell, same
 * `ui.spin` fallback, one caller fewer. What the flow does is shown in the
 * IDE's status bar (`ide-bridge`), not on this page.
 *
 * **NOT `ctx.events`.** That name is cordis's OWN lifecycle emitter — a
 * plain own property every `Context` is born with, which the service
 * Proxy returns before it ever looks at what a row provided — so
 * `ctx.events.emit('ui.spin')` would emit into cordis and nothing would
 * spin. `reflect.get('events', false)` is the only way to the flow bus
 * (see `@energy8engine/flow`'s `runtime.ts` for why the name is kept).
 *
 * Both read leniently, and per use: a composition without `flow1` is a
 * legal edit — nothing here throws on the first `spin()` — and `flow1` is
 * a HOT row, like `mechanics1` and `reels1` above — a re-apply disposes
 * the bus and the interpreter a capture would hold and provides fresh
 * ones.
 *
 * A rebind of `base_game` from the IDE's composition screen is what
 * `__e8.bound()` and the board itself report; nothing on this page's own
 * UI follows it any more.
 */
const currentEvents = () =>
  ctx.reflect.get('events', false) as unknown as EventsService | undefined;
const currentFlow = () => ctx.reflect.get('flow', false) as FlowService | undefined;

/**
 * The shell handle the `shell1` row provides (`@energy8engine/shell-pixi`),
 * typed structurally — as much of it as this page touches — so the page
 * imports nothing from that package, for the same reason it imports no
 * row. Read per use and leniently, like `events`/`flow` above: a
 * composition without `shell1` is a legal one (`editor.ts` composes
 * `without: ['ui.shell']` on purpose), and `pressSpin` below still emits
 * `ui.spin` for a flow with no shell to listen to.
 */
interface PageShell {
  state: Record<string, unknown>;
  actions: { spin(): void; [name: string]: (...args: any[]) => void };
  setTurbo(level: number): void;
}
const currentShell = () => ctx.reflect.get('shell', false) as PageShell | undefined;

/**
 * What `__e8.spin()` presses, now its only caller: the shell's turbo level
 * is set to `turbo` (`1`/`0` — the flow's `draw` node reads
 * `$shell.turbo`), the SHELL's own Spin is pressed (`shell.actions.spin()`
 * → `shell.spin` on the bus, which this project's `flow.yml` listens to),
 * and `ui.spin` goes out as well, for a flow that listens to that instead
 * — every e2e fixture flow, written before there was a shell. Exactly one
 * of the two has a listener in any given flow; the other lands on nobody.
 *
 * **`ui.spin`'s payload.** A flow listening to it (every e2e fixture flow)
 * reads it off `vars.event` — the flow's `on` node hands its `fire()` the
 * emitted payload UNCHANGED (`@energy8engine/flow`'s `kinds.ts`, the `on`
 * kind: `fire({ event })` with `event` the bus callback's own argument),
 * so `$event` IS the payload emitted here. The `emit` flow node kind
 * agrees: it sends `resolve(p.payload, vars)` as the event itself, with no
 * envelope of its own — a flow-emitted `{ turbo: true }` arrives as
 * `$event.turbo`, so a page that wrapped its own payload would make the
 * two paths disagree. `{ turbo: ... }` it is, below. This project's own
 * `flow.yml` reads neither: it listens to `shell.spin` and takes turbo off
 * `$shell.turbo`.
 */
function pressSpin(turbo: boolean): void {
  const shell = currentShell();
  shell?.setTurbo(turbo ? 1 : 0);
  shell?.actions.spin();
  currentEvents()?.emit('ui.spin', { turbo });
}

/** The kind of the node a trace entry names, off the document the flow is running; `undefined` between documents. */
const kindOf = (node: string) =>
  currentFlow()
    ?.doc()
    ?.nodes.find((n) => n.id === node)?.kind;

/** `__e8.viewIds()`'s numbering: one id per view object, for the page's lifetime. */
const viewIdOf = new WeakMap<object, number>();
let nextViewId = 0;

/**
 * Test-only instrumentation for the SDD plan's Task 12, step 5. Playwright
 * has no other honest way to observe what the game actually ran than
 * asking it — checking `e8.yml` or the `/ide` websocket traffic would only
 * prove a config value changed, not that the board did anything (see the
 * task brief: "a test that checks e8.yml instead of the screen would be
 * checking the wrong end of the pipe"). Nothing on this page's own UI
 * calls `window.__e8`. A page `e8 build` bundles keeps these hooks — they
 * are how `build.spec.ts` drives the static `dist/` — and a real game's
 * own entry, which is not this file, simply never installs them.
 *
 * `present(stage, data)` — the replay of one captured result under another
 * mechanic — is gone with `presentStage`: there is no page-side path that
 * presents any more, only the flow's. A test that wants "the same result
 * under a different mechanic" rebinds and spins again.
 */
(window as unknown as { __e8: unknown }).__e8 = {
  /** The composition this game actually ran with — how a test tells "the project composed it" apart from "the page hardcoded it". `createGame`'s own field plus what `need()` found unmet, which is the whole of what the boot screen was given. */
  diagnostics,
  /**
   * The SAME diagnostics service the IDE's Diagnostics tab reads, read
   * fresh — unlike `diagnostics` above, a plain array snapshotted once at
   * boot-script-evaluation time (before the `scenes` row's own boot GET, or
   * anything a spin does, has had a chance to report anything). A test
   * that wants to know what a LATER event reported — a scene that mounted
   * after boot, a spin's own diagnostics — needs this one; `diagnostics`
   * only ever answers what boot itself already knew.
   */
  liveDiagnostics(): readonly Diagnostic[] {
    return (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.list() ?? [];
  },
  /**
   * Exactly what pressing Spin does when the flow is idle —
   * `pressSpin(turbo)`: the shell's Spin plus `ui.spin` (see its own doc
   * for why both) — and then the port the flow's `present` node left by
   * (`next` or `failed`), or `failed` from its `spin` node when the host
   * refused. Both failures leave by a port named `failed`, so `kind` says
   * which node settled it: a presentation that failed is not a spin the
   * host refused. One 20 s budget for the whole thing; a rejection names
   * which half ran out.
   *
   * Unlike a direct press, it first waits for the flow to be able to hear
   * it: `flow.ready` (the document is armed, ahead of the boot GET having
   * answered) and then `!flow.busy()`, because `on` drops a fire while a
   * run is live (`busy: ignore`) — the boot run still on its way to `on`,
   * or the previous spin's last branches unwinding, which they still are
   * on the microtask a resolve of this promise lands on. A press then is
   * simply swallowed; a test awaiting a spin that never started would sit
   * out the full 20 s instead. `opts.turbo` defaults to `false`, same as
   * the flow's own `present.turbo` schema default resolves an absent var
   * to.
   */
  async spin(opts?: { turbo?: boolean }): Promise<{ out: string; kind: 'present' | 'spin' }> {
    const events = currentEvents();
    const flow = currentFlow();
    if (!events || !flow) throw new Error('no flow row in this composition');
    const deadline = Date.now() + 20_000;
    await flow.ready;
    while (flow.busy()) {
      if (Date.now() >= deadline)
        throw new Error('the flow stayed busy for 20 s — Spin was not pressed');
      await new Promise((tick) => setTimeout(tick, 10));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('no present node left the flow within 20 s of Spin — see the trace'));
      }, deadline - Date.now());
      const off = flow.onTrace((entry) => {
        const kind = kindOf(entry.node);
        if (kind !== 'present' && kind !== 'spin') return;
        if (kind === 'present' ? entry.out === null : entry.out !== 'failed') return;
        clearTimeout(timer);
        off();
        resolve({ out: entry.out!, kind });
      });
      pressSpin(opts?.turbo ?? false);
    });
  },
  /** What the removed button's second click did: hurry the run already going (`ui.skip`, caught by `play-loop`). A no-op with no event bus. */
  skip(): void {
    currentEvents()?.emit('ui.skip');
  },
  /**
   * The shell's live state, as a plain copy (`JSON.parse(JSON.stringify(…))`
   * — Playwright serialises the return value the same way, and a copy taken
   * here cannot alias a row's own object). `null` with no `shell1` row —
   * which the editor page's `__e8editor.hasShell()` is the pair of: the
   * game page HAS a shell, the scene canvas has none.
   */
  shell(): { state: Record<string, unknown> } | null {
    const shell = currentShell();
    if (!shell) return null;
    return JSON.parse(JSON.stringify({ state: shell.state })) as { state: Record<string, unknown> };
  },
  /**
   * What the session provider opened with — `session.init`, a plain copy
   * like `shell()`'s. Under `e8 dev` that is `/api/session`'s answer to the
   * address `session-host` forwarded, so it is where the Preview toolbar's
   * currency, social and device choices can be read back off the game
   * itself. Its `balance` is the one the game started with: the toolbar's
   * seed in a fresh wallet, the stored wallet after a reload (the shell's
   * state keeps the live one). `null` with no `session` row.
   */
  session(): SessionInit | null {
    const session = ctx.reflect.get('session', false) as { init: SessionInit } | undefined;
    return session ? (JSON.parse(JSON.stringify(session.init)) as SessionInit) : null;
  },
  /**
   * Presses one of the shell's own controls — `shell.actions[name](...args)`:
   * `spin`, `stepBet(1)`, `startAutoplay(2)`, … — the way a person's finger
   * on the bar would, so a test drives the real shell rather than this
   * page's proxy of it. `false` when there is no shell, or no such action.
   */
  shellAction(name: string, ...args: unknown[]): boolean {
    const action = currentShell()?.actions[name];
    if (typeof action !== 'function') return false;
    action(...args);
    return true;
  },
  /**
   * The `StepOpts` the board's last method actually ran with — `turbo`
   * included — off `currentBoard()`, the same lazy per-use read every
   * other board hook here takes (`board` is a page need; see its own
   * doc). `undefined` before the first spin, or with no board at all.
   */
  lastStepOpts(): StepOpts | undefined {
    return currentBoard()?.lastOpts;
  },
  /** The interpreter's trace of the current/last run (`FlowTraceEntry`s, capped at 500); `[]` with no flow row. */
  flowTrace(): readonly FlowTraceEntry[] {
    return currentFlow()?.trace() ?? [];
  },
  /**
   * What the durable log holds — the spins that actually happened, not the
   * presentations that were drawn. `[]` when no `spin-log` row is in the
   * composition, which is a legal composition.
   */
  spins(): readonly unknown[] {
    return ctx.reflect.get('spinLog', false)?.entries() ?? [];
  },
  /**
   * Which mechanic is bound to `stage` right now — a READ of the registry,
   * never a write. There is still no `bind()` here: rebinding goes through
   * the IDE, which is the stronger test because it exercises the whole pipe.
   *
   * It exists because the IDE's write arrives asynchronously (e8.yml ->
   * fiber restart -> /ide broadcast -> ide-bridge), so a test has to wait
   * for it, and the only other thing it could wait on is the presentation
   * it is about to assert about — waiting for the plan to look right and
   * then checking that the plan looks right. Reading the binding separates
   * "has the rebind landed" from "is the presentation correct", so the
   * second question is asked once and answered honestly.
   *
   * `null` when nothing is bound, or when the stage is bound to an id
   * nothing has registered (see `MechanicsService.forStage`).
   */
  bound(stage: string): string | null {
    return currentMechanics()?.forStage(stage)?.id ?? null;
  },
  /**
   * The LIVE board's grid size — a read of `currentBoard()`, the same lazy
   * read the play loop makes, never the boot-time capture. It exists for
   * the same reason `bound()` does: a hot edit to `reels1` (`cols` 5 → 4)
   * lands asynchronously, and a test needs something to wait on that is
   * the edit itself rather than the spin it is about to assert about.
   * `null` when nothing provides a board.
   */
  gridSize(): { cols: number; rows: number } | null {
    const grid = liveGrid();
    return grid ? { cols: grid.cols, rows: grid.rows } : null;
  },
  /**
   * What the LIVE board shows, `symbols[col][row]` (`null` for an empty
   * cell). The other half of `gridSize()`: a spin `play.execute`d on a
   * board that has since been destroyed still resolves and still gets
   * recorded (measured — the test-side mutation for it stayed green), so
   * "the spin played" is only true if the board on stage is the one that
   * changed. A fresh board after a hot re-apply is all `null` until the
   * next spin draws on it.
   */
  symbols(): (string | null)[][] | null {
    return liveSymbols();
  },
  /**
   * A stable number per cell VIEW object (`WeakMap` identity): equal numbers
   * across two reads mean the cell kept its view — slice 35's F9, read off the
   * screen. `null` for an empty cell or with no board.
   */
  viewIds(): (number | null)[][] | null {
    const grid = liveGrid();
    if (!grid) return null;
    return Array.from({ length: grid.cols }, (_, col) =>
      Array.from({ length: grid.rows }, (_, row) => {
        const view = grid.getCell(col, row)?.view;
        if (!view) return null;
        let id = viewIdOf.get(view);
        if (id === undefined) viewIdOf.set(view, (id = ++nextViewId));
        return id;
      }),
    );
  },
  /** What the `features1` row's persistent layer holds now: sticky rings and giant symbols. `null` with no board. */
  featureOverlays(): { sticky: number; giant: number } | null {
    const grid = liveGrid();
    if (!grid) return null;
    const layer = (
      grid as unknown as { children: { label?: string; children: { label?: string }[] }[] }
    ).children.find((c) => c.label === 'reels-features');
    const count = (label: string) => layer?.children.filter((c) => c.label === label).length ?? 0;
    return { sticky: count('sticky'), giant: count('giant') };
  },
  /**
   * Plays ONE `refill` step: the live board with `(col, row)` changed to
   * `symbol`, through the live board's own `refill` step method — the same
   * reels-board refill path `@energy8engine/reels`'s `board.refill` runs
   * (`engine/game/reels/src/index.ts`), read per use off `currentBoard()`
   * like every other board hook here. Throws with no board, or a board with
   * an empty cell (a refill board has none).
   */
  async refillCell(col: number, row: number, symbol: string): Promise<void> {
    const board = currentBoard();
    const next = liveSymbols();
    if (!board || !next || next.some((c) => c.includes(null)))
      throw new Error('refillCell: no board, or no seated board');
    next[col][row] = symbol;
    await board.refill({ kind: 'refill', board: next as unknown as RefillStep['board'] });
  },
  /**
   * The `multiplier` the cell at `(col, row)` carries in its DATA — what a
   * `multipliers` or `dropWilds` step leaves on it, which `symbols()` cannot
   * show (the symbol stays). A read of `getCell(col, row).data`, the same
   * data `symbols()` reads `symbol` off; `null` with no grid/cell, or a cell
   * whose data carries no number there.
   */
  cellMultiplier(col: number, row: number): number | null {
    const multiplier = liveGrid()?.getCell(col, row)?.data.multiplier;
    return typeof multiplier === 'number' ? multiplier : null;
  },
  /**
   * What the cell at `(col, row)` actually drew — the constructor name of
   * the deepest first descendant of its `SymbolView` (`Sprite` for a
   * `symbols.yml` `image` state, `AnimatedSprite` for a `spritesheet` win,
   * `Graphics` for the no-`symbols.yml`/unknown-id fallback box). Walks
   * `children[0]` down from the cell's `view`, the same wrapper-of-wrapper
   * shape `symbols1`'s `createSymbolHandle` builds it in (a state wrapper
   * `Container`, then whatever the node type actually mounted) — so a test
   * can tell "the art from symbols.yml is on screen" from "the coloured
   * box is" without asserting on pixel colour. `null` with no
   * grid/cell/view (an empty cell has none).
   */
  cellArt(col: number, row: number): string | null {
    let node = liveGrid()?.getCell(col, row)?.view;
    if (!node) return null;
    while (node.children && node.children.length > 0) node = node.children[0];
    return node.constructor.name;
  },
  /**
   * What the cell at `(col, row)` SAYS — the `text` of the first node in
   * its view that has one, depth-first, as a string; `null` when the cell
   * has no view, or when nothing in it is a text node.
   *
   * `cellArt`'s companion, and it answers the question `cellArt` cannot: a
   * cell scene's own art is a `Sprite` like any plain `image` state's, so
   * the constructor name alone cannot tell "a document mounted for THIS
   * cell" from "an image mounted". Unlike `cellArt`, which walks down the
   * first child of each node, this one searches EVERY child: a cell
   * scene's text node is a sibling of its art node, not below it. A text
   * node inside the cell can — and here does — hold a `$cell` EXPRESSION
   * rather than a value, and what this reads back is what that expression
   * resolved to against the cell's data: `orb.scene.yml` says
   * `'x{$cell.multiplier}'` and this game reads back `'x'`, because its
   * math carries no `multiplier` and a template span over a missing field
   * renders `''` (`resolveValue`, `@energy8engine/contracts`). A
   * mounted-and-bound node, not a missing one — a game whose math carries
   * the figure reads `x12` off the same document.
   */
  cellText(col: number, row: number): string | null {
    const found = (node: ViewNode): string | null => {
      if (node.text !== undefined) return String(node.text);
      for (const child of node.children ?? []) {
        const text = found(child);
        if (text !== null) return text;
      }
      return null;
    };
    const view = liveGrid()?.getCell(col, row)?.view;
    return view ? found(view) : null;
  },
  /**
   * Which texture the cell at `(col, row)` draws — the `label` of the
   * texture on the same deepest first descendant `cellArt` names, which
   * pixi's loader sets to the URL it loaded from. It tells two `image`s
   * apart where `cellArt` cannot: `orb.scene.yml` picks its art from
   * `srcOf` by `$cell.band`, and both picks are a `Sprite`. `null` with no
   * view, or when that node draws no texture.
   */
  cellTexture(col: number, row: number): string | null {
    let node = liveGrid()?.getCell(col, row)?.view;
    if (!node) return null;
    while (node.children && node.children.length > 0) node = node.children[0];
    return node.texture?.label ?? null;
  },
  /**
   * Whether the asset loader HAS `path` — `assetLoader.get(path)`, the same
   * read every `image` node makes when it fills its sprite in. The one
   * honest way to see a `scenes.require(...)` from outside: what a row
   * claims is not in any document, so no document read can prove it, and
   * a texture that never loaded draws as nothing rather than failing.
   * `false` with no `scenes` row (nothing provides a loader then either).
   *
   * Asks only about paths something is expected to have loaded: the loader
   * REPORTS a `get` for a path no batch ever asked for (`assetLoader`,
   * `@energy8engine/scenes`), so a probe for an absent path leaves a
   * warning behind it — in `ctx.diagnostics`, like everything else here.
   */
  loaded(path: string): boolean {
    const loader = ctx.reflect.get('assetLoader', false) as
      { get(url: string): unknown } | undefined;
    return loader?.get(path) != null;
  },
  /** Visible top-level scenes, as `scenes.visible()`; `[]` with no scenes row. */
  scenesVisible(): string[] {
    return (
      (ctx.reflect.get('scenes', false) as { visible?(): string[] } | undefined)?.visible?.() ?? []
    );
  },
  /** Whether a node of a mounted top-level scene is visible; `null` when there is no such node. */
  nodeVisible(scene: string, node: string): boolean | null {
    const s = ctx.reflect.get('scenes', false) as
      { view?(ref: { scene: string; node: string }): { visible: boolean } | undefined } | undefined;
    const v = s?.view?.({ scene, node });
    return v ? v.visible : null;
  },
  /**
   * Whether a mounted top-level scene node is CLIPPING something — `view.
   * mask != null`, off the same `scenes.view` every other node hook reads.
   * `nodeVisible` alone cannot prove a `mask: true` child actually mounted
   * and took hold: a node's own `visible` stays `true` whether or not a
   * child failed to mount (`mountNode` catches per-child, and a masking
   * child is mounted like any other), so it is `true` either way. This
   * reads the one thing that is actually different when the mask took —
   * `null` when there is no such node.
   */
  nodeMasked(scene: string, node: string): boolean | null {
    const s = ctx.reflect.get('scenes', false) as
      { view?(ref: { scene: string; node: string }): { mask: unknown } | undefined } | undefined;
    const v = s?.view?.({ scene, node });
    return v ? v.mask != null : null;
  },
  /**
   * A mounted top-level scene node's `text` — what a `text` node's `Text`/
   * `BitmapText` view holds (`AbstractText.text`, a plain string setter/
   * getter both share), off the same `scenes.view` `nodeMasked`/`nodeProps`
   * read from. `null` when there is no such node, or its view is some
   * other node type with no `.text` string at all (a `Sprite`, a
   * `Container`, …) — never the empty string, so a test can tell "not a
   * text node" from "a text node that currently says nothing".
   */
  nodeText(scene: string, node: string): string | null {
    const s = ctx.reflect.get('scenes', false) as
      { view?(ref: { scene: string; node: string }): { text?: unknown } | undefined } | undefined;
    const v = s?.view?.({ scene, node });
    return v && typeof v.text === 'string' ? v.text : null;
  },
  /**
   * A mounted top-level scene node's `style.fontFamily` — what a `text`
   * node's `Text`/`BitmapText` view resolved its `family`/`font` prop to
   * (`nodeText`'s companion: that reads the string it shows, this reads
   * the face it shows it in — round7's `scenes1.fonts` proof needs both).
   * `null` when there is no such node, or its view has no `.style.
   * fontFamily` string at all (anything but a `text` node).
   */
  nodeFontFamily(scene: string, node: string): string | null {
    const s = ctx.reflect.get('scenes', false) as
      | { view?(ref: { scene: string; node: string }): { style?: { fontFamily?: unknown } } | undefined }
      | undefined;
    const v = s?.view?.({ scene, node });
    const family = v?.style?.fontFamily;
    return typeof family === 'string' ? family : null;
  },
  /**
   * EVERY mounted copy of a node (`scenes.views(ref)`), each with whether
   * it is ACTUALLY on screen — walked by hand up the copy's own `.parent`
   * chain to `scenes.container` (pixi v8 dropped `worldVisible`; this is
   * the same two things pixi itself would check before drawing a node: no
   * ancestor's `visible` is `false`, and the chain actually reaches the
   * render root rather than dead-ending on a document that was mounted
   * but never `show()`n — a node with no `scene` row parent, still
   * `visible: true` by pixi's own default, is NOT on screen).
   *
   * Exists because `view()`/`nodeProps` already PICK the on-screen copy
   * for you (Task 1's `view()`) — reading a tween's target back through
   * that same lookup could never catch the tween having landed on the
   * WRONG copy; this sees every copy independently of it. `[]` with no
   * `scenes` row, or no such node.
   */
  nodeCopies(scene: string, node: string): { x: number; shown: boolean }[] {
    const s = ctx.reflect.get('scenes', false) as
      | {
          views?(ref: {
            scene: string;
            node: string;
          }): { x: number; visible: boolean; parent: unknown }[];
          container?: unknown;
        }
      | undefined;
    if (!s?.views) return [];
    const root = s.container;
    return s.views({ scene, node }).map((v) => {
      let shown = false;
      let n: { visible: boolean; parent: unknown } | null | undefined = v;
      while (n) {
        if (n === root) {
          shown = true;
          break;
        }
        if (n.visible === false) break;
        n = n.parent as typeof n;
      }
      return { x: v.x, shown };
    });
  },
  /** A mounted top-level scene node's `x`/`y`/`alpha`/`width`/`height`/`tint`, off the same `scenes.view` `nodeVisible` reads `visible` from; `null` when there is no such node. */
  nodeProps(
    scene: string,
    node: string,
  ): { x: number; y: number; alpha: number; width: number; height: number; tint: number } | null {
    const s = ctx.reflect.get('scenes', false) as
      | {
          view?(ref: {
            scene: string;
            node: string;
          }):
            | { x: number; y: number; alpha: number; width: number; height: number; tint: number }
            | undefined;
        }
      | undefined;
    const v = s?.view?.({ scene, node });
    return v
      ? { x: v.x, y: v.y, alpha: v.alpha, width: v.width, height: v.height, tint: v.tint }
      : null;
  },
  /**
   * The live stage's uniform scale — `scenes.container.scale.x`, the
   * factor `resize()`'s `fitStage` last set it to (spec: a viewport wider
   * than tall against a `contain`-fit design still scales x and y alike).
   * `null` with no `scenes` row, or before it has ever laid out. Read
   * leniently, like every other hook here: a missing `container`/`scale`
   * (an older `scenes` row) answers `null`, not a throw.
   */
  stageScale(): number | null {
    return (
      (ctx.reflect.get('scenes', false) as { container?: { scale: { x: number } } })?.container
        ?.scale.x ?? null
    );
  },
  /**
   * The last `resize`'s fit — `scenes.fit()`: the scale, the offset and
   * the SAFE rect in design units (`viewport.{left,top,right,bottom}` —
   * what a `pin` measures from, so a test can put a pinned node's
   * `nodeProps` against the edge it names). A plain copy, not the
   * runtime's own object; `null` with no `scenes` row or before the first
   * layout, like `stageScale`.
   */
  fit(): PageFit | null {
    const f = (ctx.reflect.get('scenes', false) as { fit?(): PageFit | null } | undefined)?.fit?.();
    return f ? (JSON.parse(JSON.stringify(f)) as PageFit) : null;
  },
  /** The scenes runtime's verdict on the safe rect — `scenes.orientation()`; `null` with no `scenes` row. */
  orientation(): 'landscape' | 'portrait' | null {
    return (
      (
        ctx.reflect.get('scenes', false) as { orientation?(): 'landscape' | 'portrait' } | undefined
      )?.orientation?.() ?? null
    );
  },
};

/** What `__e8.fit()` answers — `@energy8engine/scenes`'s `Fit`, spelled out so this page imports nothing from that package. */
interface PageFit {
  scale: number;
  x: number;
  y: number;
  viewport: { left: number; top: number; right: number; bottom: number };
}

/** Any pixi display object, for `cellArt`'s walk down to its deepest first descendant and `cellText`'s over the whole subtree. */
interface ViewNode {
  readonly children?: readonly ViewNode[];
  readonly constructor: { readonly name: string };
  /** A `Text`/`BitmapText` has one; every other display object does not — what `cellText` looks for. */
  readonly text?: unknown;
  /** A `Sprite` has one; its `label` is the URL it was loaded from — what `cellTexture` reads. */
  readonly texture?: { readonly label?: string };
}

/** `__e8.symbols()`'s read, shared with `refillCell` (which builds its board from it). */
function liveSymbols(): (string | null)[][] | null {
  const grid = liveGrid();
  if (!grid) return null;
  return Array.from({ length: grid.cols }, (_, col) =>
    Array.from({ length: grid.rows }, (_, row) => grid.getCell(col, row)?.data.symbol ?? null),
  );
}

/**
 * The live board's grid, as the `ReelGrid` it really is (`cols`/`rows`
 * getters, `getCell(col, row).data`/`.view`); `GridLike` types `getCell`
 * as always answering a cell, and that cell's `view` as a `SymbolView`
 * rather than the bare node `cellArt` walks — hence the cast. `undefined`
 * when nothing provides a board.
 */
function liveGrid():
  | {
      cols: number;
      rows: number;
      getCell(
        col: number,
        row: number,
      ):
        | { data: { symbol: string | null; multiplier?: unknown }; view: ViewNode | null }
        | undefined;
    }
  | undefined {
  return currentBoard()?.grid as unknown as ReturnType<typeof liveGrid>;
}
