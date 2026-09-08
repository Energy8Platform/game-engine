/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite, and what Task 12's preview iframe points at (same server,
 * see `engine/ide/client/src/screens/CompositionScreen.tsx`'s `Preview`).
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
 * filtered against `game.ctx.reflect.get(...)` itself. That list is gone.
 * The rows that actually need `board`/`mechanics`/... now say so in their
 * OWN `package.json` (`e8.runtime.requires` — see `E8RuntimeHalf.requires`
 * in `@energy8engine/contracts`), and `createGame` checks it after every
 * row has applied, landing the result straight in `game.diagnostics` — the
 * same list this page already reads for everything else. This file no
 * longer keeps a second one; if some capability this page itself reaches
 * off `ctx` (not a row) ever needed its own check again, that would be a
 * gap in the engine's mechanism, not a reason to bring `REQUIRES` back.
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
import {
  diagnostic,
  type Diagnostic,
  type PresentationStep,
  type SpinResult,
} from '@energy8engine/contracts';
// Type-only, and fully erased: these two modules are what DECLARE the
// `ctx.board` and `ctx.play` services this page reads off the composed
// context. Importing their types is not importing them — nothing here
// pulls `reels` or `play-loop` into the bundle, and neither package is
// composed by this file. It is the page saying, in the type system, which
// capabilities it expects the project's composition to have provided.
import type {} from '@energy8engine/reels/runtime';
import type {} from '@energy8engine/play-loop/runtime';
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
 * Through `reflect.get(name, false)`: `diagnostics1` is an optional row
 * (see `e8-base`'s own bundle file), a composition without it is legal,
 * and cordis throws on a property read of a registered service this
 * module never injected. `renderDiagnostics` below says so on screen
 * rather than silently showing an empty log — "there is no list" and "the
 * list is empty" are different news.
 */
const diagnosticsLog = game.ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined;

// "errors" and "warnings" are not the same news and must not read as the
// same news. A composition carrying only warnings STILL PLAYS — the game
// is on screen, Spin works, and the only thing that happened is that
// something (an unreadable `game/script.spin`, most likely) could not be
// fully read. Calling that "errors" told a developer their game was
// broken when it was running in front of them.
if (game.diagnostics.length > 0) {
  const errors = game.diagnostics.filter((d) => d.severity === 'error').length;
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
 * Through `reflect.get`: a composition with no `mechanics1` row is a legal
 * edit — `reelstep1` declares `requires: ["mechanics"]` (see its own
 * `package.json`), so `createGame` has already reported it in
 * `game.diagnostics` by the time this line runs — and this line must not
 * turn the absence into a `TypeError` that stops the page before that
 * report is drawn.
 */
const bound = game.ctx.reflect.get('mechanics', false)?.forStage('base_game')?.id;
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
  game.ctx.mechanics.bind('base_game', mechanicSelect.value);
});

/**
 * Presents `data` through the stage's currently bound mechanic and runs
 * the resulting plan on the real board — the one code path both a real
 * spin (below) and the test-only replay instrumentation (`window.__e8`,
 * further down) go through, so a Playwright test observing the latter is
 * observing exactly what a real spin would have produced, not a shortcut
 * built just for the test.
 *
 * `ctx.mechanics.present`, `ctx.play.execute` and `ctx.board` are all
 * services rows provided (`mechanics1`, `playloop1`, `reels1`) — this file
 * imports none of those packages.
 *
 * **Check-then-present is one call, and this page no longer performs it
 * itself.** It used to `check`, bail on failure, then call
 * `mechanic.present(data)` directly — the last unguarded third-party call
 * in the system: a plugin mechanic whose `present` threw took the page
 * down with it rather than producing a diagnostic. The order was also a
 * convention this page happened to follow, which the next game would have
 * had to rediscover. Both now belong to `mechanics.present`, which never
 * throws and cannot be called out of order.
 *
 * Returns the full plan, not just each step's `kind` — a step's content
 * (which board `spinTo`/`refill` name, which cells `remove` names) is
 * exactly what a person watching the board actually sees, and a kind-only
 * sequence cannot tell a correctly-refilled board apart from one with a
 * permanent hole in it. `null` when the stage could not be presented at
 * all, which an empty array cannot say: a mechanic emitting no steps is a
 * legal, successful presentation.
 */
async function presentStage(
  stage: string,
  data: Record<string, unknown>,
): Promise<PresentationStep[] | null> {
  // Keep the control honest about what actually rendered. The binding has
  // two writers besides this page's `<select>`: `e8.patch.yml`, which sets
  // it, and `@energy8engine/ide-bridge`, which rebinds it live whenever a
  // human writes a value into that row from the IDE's composition screen.
  // Neither of them touches this element, so without this line the dropdown
  // would keep showing whatever it showed last while the board drew
  // something else.
  //
  // A mechanic id the dropdown has no `<option>` for leaves it alone rather
  // than blanking it: `base_game` is free text in the IDE now, so an id
  // this page never heard of is reachable and is not this control's to
  // display. It is reported instead — `ide-bridge` writes it into
  // `ctx.diagnostics`, and so does `present` below.
  //
  // Read before presenting, and tolerant of `null`: a stage bound to
  // nothing is exactly a case `present` reports, and this control has
  // nothing to say about it.
  const bound = game.ctx.mechanics.forStage(stage);
  if (bound && [...mechanicSelect.options].some((option) => option.value === bound.id)) {
    mechanicSelect.value = bound.id;
  }

  // Neither of the two calls below is followed by a log line any more, and
  // that is the point of the whole change: `mechanics.present` and
  // `play.execute` are both cordis-aware service methods that ALREADY wrote
  // what they returned into `ctx.diagnostics` (see task-2-3-report.md).
  // Re-printing the returned arrays here — as this page did, as
  // `JSON.stringify(...)` under a sentence of its own invention — was the
  // same event told twice, in a format only this page used, in a place only
  // this page could see. The `<pre>` shows them now because the service
  // does, and it shows the message the producer actually wrote.
  const { plan, diagnostics: presentProblems } = game.ctx.mechanics.present(stage, data);
  if (presentProblems.length > 0) {
    statusEl.textContent = 'presentation failed — see log';
    // `null`, not `[]`. An empty plan is a legal thing for a mechanic to
    // emit, so a caller cannot tell the two apart from the array alone —
    // and the spin handler below used to write "done" over the status this
    // line just set, announcing success on a stage that never presented.
    return null;
  }

  await game.ctx.play.execute(plan, game.ctx.board);
  return plan;
}

let lastSpin: { stage: string; data: Record<string, unknown> } | null = null;

/**
 * What this page asks the math for. It has no bet control, so the body is
 * empty and `dev-game` falls back to the composition's own bet level — but
 * it is sent, and it is what the log records, so the request in the record
 * is the request that was made rather than a guess at it.
 */
function spinRequest(): Record<string, unknown> {
  return {};
}

/**
 * Writes one spin into the composition's durable log: what was asked, what
 * came back, and the plan it was actually presented with.
 *
 * Called at each SPIN, never inside `presentStage`. `presentStage` is also
 * the replay path — `__e8.present` re-runs one captured result under a
 * different mechanic — and three replays of one spin are one line in this
 * log, not three. That is §7's distinction and the reason the log is kept
 * apart from the live events of the presentation: the result is the fact,
 * the plan is an interpretation of it.
 *
 * Through `reflect.get`: a composition with no `playloop1` row is a legal
 * edit, and it must not turn into a `TypeError` here — least of all on the
 * line whose job is keeping a record when things are going wrong. Unlike
 * `board`/`mechanics`, nothing in this composition declares `play` a
 * `requires` — no row reads `ctx.play` internally, only this page does —
 * so removing `playloop1` outright is not reported at boot the way
 * removing `reels1` or `mechanics1` now is; it surfaces on the first Spin
 * click instead, as a raw failure (see `spinFailure`). A known gap, not an
 * oversight: closing it would mean giving this PAGE a way to declare a
 * requirement, which the current mechanism does not offer to anything
 * other than a row with its own `package.json`.
 * The row that provides the durable log (`spinlog1`) is not a `requires`
 * anywhere, on purpose: a game that keeps no record is a working game, and
 * `play.record` is a no-op without one.
 */
function recordSpin(request: unknown, result: SpinResult, plan: PresentationStep[]): void {
  game.ctx.reflect.get('play', false)?.record({ request, result, plan });
}

/**
 * What to say when a click threw.
 *
 * The exception's own text is evidence, not an explanation. With
 * `mechanics1` out of the composition, this page's log used to gain
 * `error: Cannot read properties of undefined (reading 'forStage')` and
 * nothing else — true, and by itself unhelpful: it names an internal of a
 * service that is not there rather than the row a person has to put back.
 *
 * This function used to repair that itself, from a page-local `unmet` list
 * built by hand. It does not any more: a row that requires a service now
 * says so through `E8RuntimeHalf.requires`, and `createGame` already wrote
 * that diagnostic into `game.diagnostics` — and onto the screen, above
 * this one — before the first click ever happened, for every case the
 * mechanism covers. So this only reports the raw failure; the reader who
 * needs the "why" has it already, sitting higher in the same log.
 *
 * A `Diagnostic`, not a string painted into this page's own element: it
 * belongs in the same list everything else does, and reaches the IDE for
 * free by being there. `first-slot`/`spin` is the address: namespace 2 of
 * `Diagnostic.plugin` (this page is a running game, not a composition
 * row), and `spin` is where inside it.
 */
function spinFailure(error: unknown): Diagnostic {
  const raw = error instanceof Error ? error.message : String(error);
  return diagnostic('error', 'first-slot', 'spin', `error: ${raw}`);
}

spinBtn.addEventListener('click', async () => {
  spinBtn.disabled = true;
  statusEl.textContent = 'spinning…';
  try {
    const request = spinRequest();
    const res = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    // `dev-game`'s route responds with the bare `SpinResult` (contracts'
    // normative envelope for this crossing) on 2xx, or `{ diagnostics }`
    // on a non-2xx — see dev-game.ts's own route handler.
    const body: SpinResult | { diagnostics: Diagnostic[] } = await res.json();

    if (!res.ok) {
      // These diagnostics are `session-dev`'s, produced on the HOST side of
      // `/api/spin` (`dev-game.ts`'s route) — a different PROCESS from this
      // page's own `game.ctx`. This page used to relay them into
      // `ctx.diagnostics`, because for a while it was the only thing that
      // could: the host had no way of its own to speak about a running
      // game. It has one now — `dev-game`'s route broadcasts the same
      // diagnostics as a `game-diagnostics` frame over `/ide` (see that
      // route, and `rpc.ts`'s `broadcastGameDiagnostics`) — so relaying
      // them here made ONE failure travel twice for this project and only
      // this project: once straight from the host, and once round through
      // this page, `ctx.diagnostics` and `ide-bridge`. The host's is the
      // one that works for every game, including one whose page never
      // wired a relay, so it is the one that stays.
      //
      // What this page keeps is the part it is genuinely the only witness
      // to: that the click it was handling did not produce a spin.
      statusEl.textContent = 'spin failed — the host reported it to the IDE';
      return;
    }

    // The `win N (total M), stage "S"` line this used to print into `#log`
    // went with the rest of them. It was the one thing there that was not a
    // diagnostic at all, and a log that IS the diagnostics list has no row
    // shape for "nothing went wrong, here is the money" — dressing one up
    // as an `info` diagnostic would push every spin of every game into the
    // IDE's failure panel. What the spin paid is on the board, `#status`
    // still reaches `done`, and the durable record is `spinlog1`'s
    // (`recordSpin` below; `__e8.spins()` for a test).
    const result = body as SpinResult;
    lastSpin = { stage: result.stage, data: result.data };
    const steps = await presentStage(result.stage, result.data);
    recordSpin(request, result, steps ?? []);
    // Only when the stage actually presented. `presentStage` has already
    // said what went wrong and set the status to match; writing "done" over
    // it announced a spin that never reached the board.
    if (steps) statusEl.textContent = 'done';
  } catch (error) {
    reportAll(diagnosticsLog, [spinFailure(error)]);
    statusEl.textContent = 'error — see log';
  } finally {
    spinBtn.disabled = false;
  }
});

/**
 * Test-only instrumentation for the SDD plan's Task 12, step 5. Playwright
 * has no other honest way to observe "the SAME spin result presents
 * differently under a different mechanic" than asking the game what it
 * actually ran — checking `e8.yml` or the `/ide` websocket traffic would
 * only prove a config value changed, not that the board did anything
 * different (see the task brief: "a test that checks e8.yml instead of the
 * screen would be checking the wrong end of the pipe"). Nothing on this
 * page's own UI calls `window.__e8`; a production game bundle never
 * imports this file's test harness, either.
 */
(window as unknown as { __e8: unknown }).__e8 = {
  /** The composition this game actually ran with — how a test tells "the project composed it" apart from "the page hardcoded it". `createGame`'s own field: every row's unmet `requires` is in it too, there being no second, page-local list any more. */
  diagnostics: game.diagnostics,
  /** Hits `/api/spin` for real and presents the result under whichever mechanic is currently bound. Returns the raw result and the full plan the mechanic actually emitted (step kind AND content — see `presentStage`'s doc). */
  async spin(): Promise<{ result: SpinResult; steps: PresentationStep[] }> {
    const request = spinRequest();
    const res = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body: SpinResult | { diagnostics: unknown[] } = await res.json();
    if (!res.ok) {
      throw new Error(
        `spin failed: ${JSON.stringify((body as { diagnostics: unknown[] }).diagnostics)}`,
      );
    }
    const result = body as SpinResult;
    lastSpin = { stage: result.stage, data: result.data };
    // `?? []` keeps this harness's own contract an array. A failed
    // presentation is reported on the page (see `presentStage`); what a
    // test observing this needs is "which steps ran", and none did.
    const steps = (await presentStage(result.stage, result.data)) ?? [];
    // Recorded here too, and for the same reason the button records: this
    // is a real spin, indistinguishable from a click. A harness that
    // skipped it would make the log say something different from what the
    // game does.
    recordSpin(request, result, steps);
    return { result, steps };
  },
  /** Re-presents arbitrary (or the last captured) stage data under whichever mechanic is currently bound — the same `data`, a possibly different mechanic. */
  async present(stage?: string, data?: Record<string, unknown>): Promise<PresentationStep[]> {
    const target = stage && data ? { stage, data } : lastSpin;
    if (!target) throw new Error('no spin to present yet');
    return (await presentStage(target.stage, target.data)) ?? [];
  },
  /**
   * What the durable log holds — the spins that actually happened, not the
   * presentations that were drawn. `[]` when no `spin-log` row is in the
   * composition, which is a legal composition.
   */
  spins(): readonly unknown[] {
    return game.ctx.reflect.get('spinLog', false)?.entries() ?? [];
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
    return game.ctx.reflect.get('mechanics', false)?.forStage(stage)?.id ?? null;
  },
};
