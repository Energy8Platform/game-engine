/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite, and what Task 12's preview iframe points at (same server,
 * see `engine/ide/client/src/screens/PreviewWall.tsx`'s `Preview`).
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
 * What is left is exactly what a project file cannot hold:
 *  - `resolve`, a function: the placeholder art below. It travels as the
 *    `assets` service, which `reels1`'s runtime half reads off `ctx` (see
 *    `@energy8engine/reels`'s `src/runtime.ts`). A real game replaces this
 *    with its own art and changes nothing else.
 *  - `mount`, a live DOM element: this page's own `#mount`. It travels the
 *    same way — `createGame` provides it as the `mount` service, the
 *    renderer row attaches its canvas to it, and `createGame` draws the
 *    failure screen on it when something went wrong.
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
 * — dropping `mechanics1` left `#status` reading `ready`, `#log` empty
 * and not one word anywhere on the page, over a board that could never
 * present anything; the first click then gave `Cannot read properties of
 * undefined (reading 'forStage')`. That is the silence the whole `boot`
 * design exists to prevent, reached by an edit the composition considers
 * legal. So the check is narrowed to what only this page knows, not
 * restored wholesale — and narrowed a second way now too: `need()` is the
 * only way this file reaches either of the two, enforced in the type
 * system (see `PageCtx` below), so a third one cannot start being read
 * here without being declared here first.
 *
 * **`<pre id="log">` is a reader, not a destination.** Everything this page
 * shows about what has gone wrong comes off `ctx.diagnostics` — the live
 * list the `diagnostics1` row provides — and every failure this page itself
 * discovers is written back into it. There is no second record kept here;
 * see `renderDiagnostics` below for why that matters and for what the
 * element used to be.
 *
 * `@energy8engine/ide-bridge` (Task 12) is composed directly into
 * `game.ctx` below — the "hot fork to the game": it opens the SAME `/ide`
 * websocket `engine/ide/client/src/plugins/connection.ts` speaks, listens
 * for the composition row a project's `e8.yml` gives it (see this
 * project's own `e8.yml`), and rebinds `base_game` live, with no reload of
 * this page or the IDE around it. Nothing about this import makes
 * `first-slot` a production game — `ide-bridge` is a plugin of the editor
 * phase (see its own module doc); a real game's bundle simply never
 * imports it.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';
import { createGame } from '@energy8engine/game-runtime';
import * as ideBridge from '@energy8engine/ide-bridge';
import { reportAll, type DiagnosticsService } from '@energy8engine/diagnostics';
import { diagnostic, type Diagnostic, type FlowTraceEntry } from '@energy8engine/contracts';
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

/** Matches `e8.patch.yml`'s `reels1` grid — this file only uses it to size the placeholder art. */
const CELL = 96;
const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];

/** Colored square + symbol id — a stand-in for real art (see energy8-slots:generating-assets for that). */
const resolve: SymbolResolver = (symbolId: string): SymbolView => {
  const view = new Container() as SymbolView;
  const n = Number(symbolId);
  const color = COLORS[(((n - 1) % COLORS.length) + COLORS.length) % COLORS.length];
  const box = new Graphics().rect(4, 4, CELL - 8, CELL - 8).fill(color);
  view.addChild(box);
  const label = new Text({
    text: symbolId,
    style: { fill: 0x10121a, fontSize: 36, fontWeight: 'bold' },
  });
  label.anchor.set(0.5);
  label.position.set(CELL / 2, CELL / 2);
  view.addChild(label);
  return view;
};

const mount = document.getElementById('mount')!;
const logEl = document.getElementById('log')!;
const statusEl = document.getElementById('status')!;
const spinBtn = document.getElementById('spin') as HTMLButtonElement;
const mechanicSelect = document.getElementById('mechanic') as HTMLSelectElement;

const game = await createGame({
  mount,
  // The one value with no home in a `.yml` row: a function.
  provide: { assets: { resolve } },
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
  what: 'a mechanic registry to turn a spin result into a presentation',
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
 * The game's own live diagnostics list — the service the `diagnostics1` row
 * provides (`@energy8engine/diagnostics`). Everything this page shows in
 * `<pre id="log">` is read from here, and there is no second list, no
 * private channel: `game.diagnostics` — which now includes any row's unmet
 * `e8.runtime.requires` (see the module doc above) — is already merged
 * into it by the time `createGame` returns `game`. If the composition was
 * missing something a row needed, the mount is already showing the
 * failure screen by the time this line runs; `createGame` draws it
 * itself, the same `boot`-or-fallback logic it always has.
 *
 * Through `ctx.reflect.get(name, false)`: `diagnostics1` is an optional row
 * (see `e8-base`'s own bundle file), a composition without it is legal,
 * and cordis throws on a property read of a registered service this
 * module never injected. `renderDiagnostics` below says so on screen
 * rather than silently showing an empty log — "there is no list" and "the
 * list is empty" are different news.
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

// "errors" and "warnings" are not the same news and must not read as the
// same news. A composition carrying only warnings STILL PLAYS — the game
// is on screen, Spin works, and the only thing that happened is that
// something (an unreadable `game/script.spin`, most likely) could not be
// fully read. Calling that "errors" told a developer their game was
// broken when it was running in front of them.
if (diagnostics.length > 0) {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  statusEl.textContent =
    errors > 0 ? 'composition has errors — see log' : 'composition has warnings — see log';
} else {
  statusEl.textContent = 'ready';
}

/**
 * `<pre id="log">` — a READER of the diagnostics service, and nothing else.
 *
 * It used to be a destination: four different places in this file called a
 * local `log()` that pushed a formatted string into the element, which made
 * this page a second, private record of what had gone wrong — visible only
 * to whoever had this tab open, and different from what the IDE was shown.
 * That is the exact shape §8 of the design spec rules out ("the game, the
 * IDE and the agent see the same list"), and it is why the recorded defect
 * was possible at all: six healthy rows on the composition screen next to a
 * game lying under a failure screen.
 *
 * So the element now renders `ctx.diagnostics` and re-renders on
 * `subscribe`. Everything it shows was reported by whichever producer
 * actually saw the failure — the play loop, the mechanics registry, the
 * bridge, this page — and the same list is what `ide-bridge` forwards to
 * the IDE panel, verbatim. Nothing is formatted for one surface and not the
 * other: this line and `DiagnosticsPanel`'s row render the same four fields
 * in the same order.
 *
 * Oldest first, which is `list()`'s own order — the newest entry is at the
 * bottom, and the element is scrolled to it, so a bounded viewport still
 * shows the thing that just happened. (The old `log()` prepended, with a
 * wall-clock timestamp per line; a `Diagnostic` carries no time, and
 * inventing one here would have been this page's phrasing of the service's
 * data again, in miniature.)
 *
 * `dropped()` is rendered rather than ignored for the same reason the panel
 * renders it: the list is bounded, and a reader that shows only the
 * survivors while saying nothing about the rest looks complete while it
 * isn't.
 */
function renderDiagnostics(): void {
  if (!diagnosticsLog) {
    logEl.textContent =
      'no "diagnostics1" row in this composition, so this game keeps no list to show';
    return;
  }
  const lines = diagnosticsLog
    .list()
    .map(
      (d) => `[${d.severity}] ${d.plugin} (${d.where}): ${d.message}${d.fix ? ` — ${d.fix}` : ''}`,
    );
  const dropped = diagnosticsLog.dropped();
  if (dropped > 0) {
    lines.push(`… and ${dropped} older ones this list has forgotten — it keeps a bounded history`);
  }
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

renderDiagnostics();
diagnosticsLog?.subscribe(renderDiagnostics);

/**
 * The `<select>` starts on whatever the COMPOSITION actually bound, not on
 * whichever `<option>` happens to be first in the HTML.
 *
 * It used to start on the HTML's first option and immediately bind that,
 * which silently overrode `e8.patch.yml`: the patch could say
 * `base_game: reel-step` and the page would rebind to `classic` before the
 * developer touched anything. Two files stating the default, one of them
 * always losing, and nothing on screen saying so. Reading it back off the
 * registry leaves `e8.patch.yml` the single place that decides, and leaves
 * this control what it always was — a way to change it afterwards.
 *
 * A stage bound to a mechanic nothing registered reads as `null` here (see
 * `MechanicsService.forStage`), and the `<select>`'s own current value
 * stands. That is not a case to paper over: `mechanics.check` reports it
 * with the whole story on the first spin, and it is the only report that
 * can, because only it knows whether the registration ever arrived.
 *
 * Through the `mechanics` handle `need()` captured above, optionally
 * chained rather than read fresh: a composition with no `mechanics1` row
 * is a legal edit — `need()`'s own boot-time check has already reported
 * it and drawn the failure screen by the time this line runs, and
 * `reelstep1` will have said the same about its own half if that row is
 * in the composition — and this line must not turn the absence into a
 * `TypeError` that stops the page before those reports are drawn.
 */
const bound = currentMechanics()?.forStage('base_game')?.id;
if (bound) mechanicSelect.value = bound;

/**
 * The live channel from the IDE's composition screen — and NO stage or
 * mechanic is passed on purpose.
 *
 * This used to hand over `mechanicSelect.value`, so the page's own
 * `<option>` order re-bound the stage at boot and quietly overrode
 * `e8.patch.yml`. Both defaults are gone now: the composition decides what
 * is bound (the `<select>` above is seeded FROM it), and `ide-bridge` binds
 * only when a human has actually written a value into its row — see
 * `IdeBridgeSettableConfig.mechanic`. Whoever turns a knob last still
 * wins; what no longer happens is a knob turning itself.
 *
 * **No `onDiagnostic` callback any more.** This call used to pass one, and
 * it printed the bridge's complaints into this page's own log — the
 * callback exists because `ide-bridge` is composed HERE, by the page, and
 * for a while a caller's callback really was the only place it could put
 * one. It is not any more: `apply` is handed this game's `ctx`, and
 * `ide-bridge`'s own `report()` writes every diagnostic it raises into
 * `ctx.diagnostics` — the same list the `<pre>` above renders. Passing a
 * callback that wrote the same event into the same element a second way
 * would put this page back in the business of keeping its own record.
 */
ideBridge.apply(game.ctx, {});

mechanicSelect.addEventListener('change', () => {
  currentMechanics()!.bind('base_game', mechanicSelect.value);
});

/**
 * **The flow drives the game (slice 19).** Everything a click used to do
 * here — `POST /api/spin`, `presentStage` (check-then-present through the
 * bound mechanic, `play.execute` on the live board), the temporary "show
 * the scene named after the stage" rule, and `play.record` — is now this
 * project's `flow.yml`, read by the `flow1` row `e8-base` composes: `boot
 * → show base_game → on ui.spin → spin → present → back to on`. The
 * `spin` and `present` node kinds (`@energy8engine/flow`'s `kinds.ts`)
 * are the two functions that were deleted from this file, one to one.
 * What this page still says is "the button was pressed", by emitting into
 * the bus `flow1` provides — and what it still shows is what the flow's
 * trace says happened.
 *
 * **NOT `ctx.events`.** That name is cordis's OWN lifecycle emitter — a
 * plain own property every `Context` is born with, which the service
 * Proxy returns before it ever looks at what a row provided — so
 * `ctx.events.emit('ui.spin')` would emit into cordis and nothing would
 * spin. `reflect.get('events', false)` is the only way to the flow bus
 * (see `@energy8engine/flow`'s `runtime.ts` for why the name is kept).
 *
 * Both read leniently, and per use: a composition without `flow1` is a
 * legal edit, and the page says so in `#status` instead of throwing on the
 * first click; and `flow1` is a HOT row, like `mechanics1` and `reels1`
 * above — a re-apply disposes the bus and the interpreter a capture would
 * hold and provides fresh ones. The one thing that cannot be read per use,
 * the `#status` trace listener, is re-armed on re-provide the way
 * `ide-bridge` re-arms its own (`ctx.inject(['flow'], …)`).
 *
 * **The `<select>` no longer follows the presentation.** It used to be
 * re-synced from `mechanics.forStage(stage)` inside `presentStage`, so a
 * rebind from the IDE's composition screen showed up here on the next
 * spin. The stage is now `vars.result.stage` inside a `present` node's
 * run, which the trace does not carry; the control shows what a person
 * picked in it, seeded once from the composition above, and a rebind from
 * the IDE is what `__e8.bound()` and the board itself report.
 */
const currentEvents = () =>
  ctx.reflect.get('events', false) as unknown as EventsService | undefined;
const currentFlow = () => ctx.reflect.get('flow', false) as FlowService | undefined;

/** The kind of the node a trace entry names, off the document the flow is running; `undefined` between documents. */
const kindOf = (node: string) =>
  currentFlow()
    ?.doc()
    ?.nodes.find((n) => n.id === node)?.kind;

if (!currentEvents() || !currentFlow()) {
  statusEl.textContent = 'no flow row — the spin button does nothing';
}

// No `disabled` while a spin is in flight: the `on` node drops a fire while
// a run is live (`busy: ignore`, its default), which is the same click
// swallowed one layer down — and a button this page disabled would stay
// so for good under a document with no `present` node to re-enable it on.
spinBtn.addEventListener('click', () => {
  const events = currentEvents();
  if (!events) return;
  statusEl.textContent = 'spinning…';
  events.emit('ui.spin');
});

// `#status` after a click, from the trace rather than from a return value
// this page no longer has: `done`/`presentation failed — see log` are the
// two `present` ports, and a `spin` that left by `failed` is the host's
// non-2xx, which `dev-game`'s route has already broadcast to the IDE.
const watchStatus = (flow: FlowService) =>
  flow.onTrace((entry) => {
    const kind = kindOf(entry.node);
    if (kind === 'present' && entry.out === 'next') statusEl.textContent = 'done';
    else if (kind === 'present' && entry.out === 'failed')
      statusEl.textContent = 'presentation failed — see log';
    else if (kind === 'spin' && entry.out === 'failed')
      statusEl.textContent = 'spin failed — the host reported it to the IDE';
  });
let watched = currentFlow();
if (watched) watchStatus(watched);
ctx.inject(['flow'], () => {
  const fresh = currentFlow();
  if (fresh && fresh !== watched) watchStatus((watched = fresh));
});

/**
 * Test-only instrumentation for the SDD plan's Task 12, step 5. Playwright
 * has no other honest way to observe what the game actually ran than
 * asking it — checking `e8.yml` or the `/ide` websocket traffic would only
 * prove a config value changed, not that the board did anything (see the
 * task brief: "a test that checks e8.yml instead of the screen would be
 * checking the wrong end of the pipe"). Nothing on this page's own UI
 * calls `window.__e8`; a production game bundle never imports this file's
 * test harness, either.
 *
 * `present(stage, data)` — the replay of one captured result under another
 * mechanic — is gone with `presentStage`: there is no page-side path that
 * presents any more, only the flow's. A test that wants "the same result
 * under a different mechanic" rebinds and spins again.
 */
(window as unknown as { __e8: unknown }).__e8 = {
  /** The composition this game actually ran with — how a test tells "the project composed it" apart from "the page hardcoded it". `createGame`'s own field plus what `need()` found unmet, which is the whole of what the boot screen and `#log` were given. */
  diagnostics,
  /**
   * Exactly what the button does — `events.emit('ui.spin')` — and then the
   * port the flow's `present` node left by (`next` or `failed`), or
   * `failed` from its `spin` node when the host refused. Rejects after 20 s
   * with nothing having left: no `on ui.spin` in the document, no
   * `present` after `spin`, or the fire dropped because a run was still
   * live (`on`'s `busy: ignore`).
   */
  spin(): Promise<{ out: string }> {
    const events = currentEvents();
    const flow = currentFlow();
    if (!events || !flow) return Promise.reject(new Error('no flow row in this composition'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('no present node left the flow within 20 s of ui.spin — see the trace'));
      }, 20_000);
      const off = flow.onTrace((entry) => {
        const kind = kindOf(entry.node);
        const left =
          kind === 'present' ? entry.out !== null : kind === 'spin' && entry.out === 'failed';
        if (!left) return;
        clearTimeout(timer);
        off();
        resolve({ out: entry.out! });
      });
      events.emit('ui.spin');
    });
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
    const grid = liveGrid();
    if (!grid) return null;
    return Array.from({ length: grid.cols }, (_, col) =>
      Array.from({ length: grid.rows }, (_, row) => grid.getCell(col, row)?.data.symbol ?? null),
    );
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
};

/**
 * The live board's grid, as the `ReelGrid` it really is (`cols`/`rows`
 * getters, `getCell(col, row).data`); `GridLike` names only `getCell`,
 * hence the cast. `undefined` when nothing provides a board.
 */
function liveGrid():
  | {
      cols: number;
      rows: number;
      getCell(col: number, row: number): { data: { symbol: string | null } } | undefined;
    }
  | undefined {
  return currentBoard()?.grid as unknown as ReturnType<typeof liveGrid>;
}
