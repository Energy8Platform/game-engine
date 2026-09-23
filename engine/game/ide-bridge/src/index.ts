/**
 * `ide-bridge`: the plan's "hot fork to the game" — the piece that lets a
 * knob turned in the IDE's composition screen reach a *running* game
 * without any reload. A plugin of the editor phase: nothing in a
 * production game's own bundle ever imports this package; only a project's
 * dev-only entry (see `engine/examples/first-slot/src/main.ts`) composes it
 * into `createGame`'s `ctx`, and only a project's `e8.yml` (read by the IDE
 * host's `ctx.loader`, exactly like `e8-example-probe`) names it as a
 * composition row.
 *
 * The SAME `apply()` runs in two structurally different places, and tells
 * them apart by asking whether `ctx.mechanics` exists rather than by any
 * environment flag:
 *
 *  1. **Host-side**, when this package is an e8.yml entry. `composition.ts`
 *     needs `apply()` to succeed (so the row shows ACTIVE, not stuck) and
 *     needs the static `Config` export to read a schema from — it does NOT
 *     need `apply()` to do anything, because the ide-host's own `ctx` never
 *     composes a `mechanics` service (only a running GAME's `ctx` does).
 *     `ctx.get('mechanics')` returns `undefined` there, and `apply()`
 *     returns immediately: no bind, no socket, no throw. (`inject:
 *     ['mechanics']` was considered and rejected — it would leave this
 *     row's fiber PENDING forever on the host, reading as "pending" instead
 *     of the true "there's nothing for this row to do here.")
 *  2. **Browser-side**, composed directly by `main.ts` into the SAME `ctx`
 *     `createGame` already put `mechanics` on. `ctx.get('mechanics')`
 *     resolves it as an ancestor-provided service (cordis's ordinary,
 *     lenient case — see `dev-game.ts`'s module doc for the ONE case that
 *     is NOT lenient, which does not apply here since this module never
 *     provides a new service of its own to read back). Binds
 *     `config.mechanic` to `config.stage` — or, when the row names no
 *     stage, to the one stage this composition binds — synchronously, at
 *     boot; then opens a websocket at `/ide` — the
 *     SAME endpoint and the SAME `{type:'snapshot',...}`/
 *     `{type:'diagnostics',...}` protocol `engine/ide/client/src/plugins
 *     /connection.ts` speaks — and listens. `rpc.ts` broadcasts every
 *     snapshot to EVERY connected socket, not just the IDE's own browser
 *     tab, so this needs no new host-side route: it rides the exact
 *     channel that already carries the IDE's own composition screen. When
 *     a broadcast snapshot contains a row named after this package naming
 *     a different mechanic, it rebinds — live, no reload, anywhere.
 *
 *     The same socket also carries the host's `{type:'game-composition',
 *     rows, changed, reload}` frame, sent after `PUT /api/composition/
 *     rows/:id` wrote a GAME row. With `reload: false` this module hands
 *     each changed row's config to the runtime's `gameRows.update`, which
 *     restarts that row's own fiber in place — the second half of the
 *     hot fork, for every row, not just this one's. And because a hot
 *     `mechanics1` re-apply replaces the registry this module bound on, it
 *     remembers the last (stage, mechanic) it applied and puts it back on
 *     the new registry when `mechanics` is provided again (`lastApplied`).
 *
 * Whether an edit needs the iframe reloaded instead is the HOST's verdict,
 * not this module's: `game-composition.reload` is `true` for a `hot:false`
 * row and for a changed field the row's schema marks `applies: 'restart'`,
 * and the IDE (`engine/ide/client/src/screens/PreviewWall.tsx`'s `Preview`)
 * reloads the frame on it — this module does nothing with such a frame,
 * since any re-apply would be thrown away with the page. This package
 * declares `"e8": { "hot": true }` in its own package.json — a config
 * change here genuinely never needs the iframe to reload, because this is
 * the mechanism that makes that true.
 */
import type { Context } from 'cordis';
import Schema from 'schemastery';
import {
  diagnostic,
  type ClientMessage,
  type Diagnostic,
  type FlowKindInfo,
  type FlowTraceEntry,
  type NodeTypeAccept,
  type ServerMessage,
} from '@energy8engine/contracts';
import { reportAll, type DiagnosticsService } from '@energy8engine/diagnostics';
// Type-only and fully erased — declares `ctx.diagnostics` on cordis's
// `Context` without importing the row itself. See `@energy8engine/spin-log`'s
// `src/runtime.ts` module doc for the same device.
import type {} from '@energy8engine/diagnostics/runtime';

/** The two fields a human edits from the composition screen. */
export interface IdeBridgeSettableConfig {
  /**
   * Which stage to rebind. Any name — which stages a game has is a RUNTIME
   * fact (the math declares them, and `SpinSchema.stages` carries them), so
   * it is no more an enum here than the mechanic below is.
   *
   * **Optional, and absent means "the one stage this composition binds".**
   * A composition that binds exactly one stage needs no answer to "which
   * one", and asking for it would make the ordinary case a two-field form
   * for no information. When the composition binds none, or more than one,
   * an absent `stage` is genuinely undecidable and is reported rather than
   * guessed.
   *
   * This field replaced a module-level `const STAGE = 'base_game'`, which
   * meant the IDE could rebind exactly one stage of one game — and the name
   * of that stage was a fact about `first-slot` compiled into a package
   * that has no business knowing it.
   */
  stage?: string;
  /**
   * Which registered mechanic renders that stage. Any id — this is a
   * RUNTIME fact (what a project's composition registered), not a
   * compile-time one, so it is not an enum of the mechanics the engine
   * happens to ship. See `Config` below.
   *
   * **Optional, and absent means "say nothing".** A row that names no
   * mechanic leaves whatever the composition itself bound (`e8.patch.yml`'s
   * `mechanics1.stages`) exactly as it is. That is not a convenience: this
   * module rebinds on EVERY snapshot, so a value nobody wrote would
   * otherwise be pushed over the project's own binding a second after boot,
   * silently. A human turning the knob writes a value, and from then on it
   * wins — which is the whole point of the row.
   *
   * It was called `base_game`, the stage's own name — one field doing two
   * jobs, which is why the stage could not be named at all.
   */
  mechanic?: string;
}

export interface IdeBridgeConfig extends IdeBridgeSettableConfig {
  /**
   * The `/ide` websocket to listen on for live composition updates.
   * Defaults to the page's own origin (`ws://${location.host}/ide`) when
   * composed in a real browser and this is omitted — correct whenever this
   * module is composed by the SAME page `dev-game`'s catch-all route
   * served (embedded in the IDE's preview iframe, or opened directly), so
   * `main.ts` never has to compute it. A test environment with no
   * `location` global must pass this explicitly (together with
   * `socketFactory`, below) or the live-update half is skipped entirely —
   * never a crash, see `apply()`.
   */
  bridgeUrl?: string;
  /**
   * This bridge's own identity — WHICH running game a `game-diagnostics`
   * frame is, once more than one can be talking to the same host at once
   * (see `GameDiagnosticsMessage.game` in `@energy8engine/contracts` for
   * the wire field this becomes). Not a composition-screen setting:
   * `Config` below stays `stage` + `mechanic` only, because a human does
   * not type a game's identity into a form — the address this game was
   * OPENED AT already carries it, and that address is the one thing
   * distinguishing two tiles of a preview wall running the SAME project,
   * the SAME composition, in two different iframes.
   *
   * **Optional, and undecided is legitimate — the ordinary case, not a
   * broken one.** A project opened the ordinary way, one game against one
   * dev host, has nothing to gain from naming itself.
   *
   * **When omitted, `apply()` reads this page's own `?game=` query
   * parameter** (`new URLSearchParams(location.search).get('game')`) — the
   * same "explicit config wins, then the page's own address, then
   * nothing" order `bridgeUrl` above already uses for `location.host`. A
   * test environment with no `location` global gets no fallback either,
   * for the same reason `bridgeUrl` gets none there: pass this explicitly
   * instead.
   */
  game?: string;
  /** Test seam — same shape `connection.ts`'s own `socketFactory` uses. */
  socketFactory?: (url: string) => WebSocketLike;
  /**
   * Where this module reports a binding it could not make good on — a
   * mechanic nothing registered, a stage nothing else binds, or a mechanic
   * named with no stage to put it on. It has nowhere else
   * to put one: it is composed by the game's own page, not by the loader,
   * so a throw would be collected by nobody and would take the page with
   * it. Failures are data; this is the channel.
   *
   * Omitted is legitimate (the host-side half has no page to draw on), and
   * the complaint is not lost when it is: `MechanicsService.check` reports
   * the same unregistered binding, with the whole story, on the first
   * spin. This one is earlier, not instead.
   *
   * **No production caller passes one any more, and the reason it is still
   * here has changed — said plainly rather than left as a field that looks
   * abandoned.** The original reason went when this module learned to write
   * to `ctx.diagnostics` itself: `first-slot`'s page dropped its callback,
   * because passing one printed the same event into the same element a
   * second way. What the callback still is, and nothing else can be, is the
   * only observation point for what THIS MODULE decided to report. The
   * shared service now collapses byte-identical repeats
   * (`@energy8engine/diagnostics`), so a test reading the service back
   * cannot tell "the bridge reported once" from "the bridge reported five
   * times and the list kept one" — which is exactly the property this
   * module's own dedupe maps (`reportedUnregistered`, `reportedNoStage`,
   * `reportedLegacyKey`) exist to hold. Its tests read it for that, and
   * only that.
   */
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

/**
 * The slice of WebSocket this module needs — enough to fake in a test.
 *
 * `readyState`/`send` joined `addEventListener`/`close` here for the same
 * reason they are already on `connection.ts`'s own `WebSocketLike`: this
 * module used to only LISTEN on this socket (see the module doc's history
 * — "there is no `socket.send` in it at all" was true until
 * `attachDiagnosticsForwarding`). A real `WebSocket` already has both, so
 * the default factory below needs no change.
 */
export interface WebSocketLike {
  readyState: number;
  /**
   * One signature for every event type this module listens for: a
   * `message` listener reads `event.data`, and the `open` listener
   * `attachDiagnosticsForwarding` registers reads nothing at all (a
   * listener that ignores its argument is assignable to one that takes
   * it). Splitting it into overloads would buy nothing and would make
   * every fake in every test declare both.
   */
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  send(data: string): void;
  close(): void;
}

/** Duck-typed on purpose: importing `@energy8engine/game-runtime` just for these three methods' types would be a real dependency for a type this module can state itself. */
interface MechanicsBinder {
  bind(stage: string, mechanicId: string): void;
  /** Ground truth for what `stage` is CURRENTLY bound to — see `bind()`'s own comment below for why this module reads it instead of remembering its own last write. */
  forStage(stage: string): { id: string } | null;
  /** Every stage this composition has bound to a registered mechanic — the only list of stage names available on this side of the wire. */
  bindings(): Record<string, unknown>;
}

/** This package's OWN name — how the live-update branch recognises its row inside a broadcast `Snapshot` (see the module doc, point 2). Slice 0 assumes at most one `ide-bridge` entry per project. */
/** The one method of the runtime's `gameRows` service this module calls — see `@energy8engine/game-runtime`'s `GameRowsService`. */
interface GameRowsUpdater {
  update(id: string, config: Record<string, unknown>): Promise<unknown>;
}

const PACKAGE_NAME = '@energy8engine/ide-bridge';

/** A config field a human has not filled in — absent, or cleared back to empty in the form. */
function named(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const name = 'ide-bridge';

/**
 * A free string, not an enum.
 *
 * It WAS `Schema.union(['classic', 'cascade'])` — the two mechanics the
 * engine itself ships — and that made a project's own third mechanic
 * unnameable from the IDE: writing `reel-step` into e8.yml
 * failed cordis's config validation (`expected "classic" | "cascade"`)
 * before `apply` ever ran, so the row never came up at all. Which
 * mechanics exist is decided by what a composition registered at runtime,
 * which no schema written in this file can know.
 *
 * The cost of a free string is that a typo is no longer caught by the
 * form. That is answered where the answer is actually knowable — `apply`
 * below reports a mechanic nothing registered through `onDiagnostic`,
 * and `MechanicsService.check` reports it again on the first spin. It is
 * the same trade `checkAgainstSchema` already makes: a name is validated
 * against what exists, not against a list kept by hand.
 *
 * **No `.default()`** — see `IdeBridgeSettableConfig.mechanic`. A default
 * here is a value nobody wrote, and this module would push it over the
 * project's own binding on the first snapshot. The composition screen
 * still renders an empty field the human can fill; what it no longer does
 * is fill it in on their behalf and then act on it.
 */
export const Config = Schema.object({
  stage: Schema.string().description('stage (empty — the single one the composition bound)'),
  mechanic: Schema.string().description('stage mechanic'),
});

/**
 * This bridge's own identity, stamped onto every frame
 * `attachDiagnosticsForwarding` sends — see `IdeBridgeConfig.game`'s own
 * doc for where a caller gets one and `GameDiagnosticsMessage.game`
 * (`@energy8engine/contracts`) for what it means on the wire. A separate,
 * narrower type from `IdeBridgeConfig` on purpose: `attachDiagnosticsForwarding`
 * is tested standalone, against a plain fake socket (see its own doc,
 * immediately below), and a reader of ITS signature has no reason to see
 * `stage`/`mechanic`/`onDiagnostic` go past for a value this function does
 * nothing else with.
 */
export interface DiagnosticsForwardingIdentity {
  /** See `IdeBridgeConfig.game`. Absent means the ordinary case: the only game talking to this host. */
  game?: string;
}

/**
 * Subscribes `socket` to `log`, both ways. Out: on every change, sends the
 * log's WHOLE current list as one `game-diagnostics` frame (immediately
 * below). In: accepts that same frame back FROM the host and seeds what it
 * carries (the second half of this function, past the outbound doc below —
 * see the comment sitting right on it for why). Named and exported on its
 * own — not folded into `apply` — because it is the one line in this whole
 * package that lives only in development (see the module doc), and because
 * it is tested standalone, against a plain fake socket and a real
 * `createDiagnostics()` service, below.
 *
 * **Whole list, not a delta.** A delta is cheaper per frame, but it only
 * means anything to a reader that already has everything sent before it —
 * which makes "a client that just (re)connected" a case this function
 * would have to solve on its own (replay-from-empty, or a separate
 * "give me the current state" message `rpc.ts` does not have). Sending the
 * whole list every time sidesteps that entirely: the very next report after
 * a reconnect hands the new socket a complete, self-sufficient picture, not
 * an increment onto state it may not have. `log.list()` is already a
 * bounded, small array (`DEFAULT_LIMIT` — see `@energy8engine/diagnostics`),
 * so resending it in full costs nothing this module needs to economize on.
 *
 * **It states the list as soon as it can, not only when it next changes.**
 * This used to be `return log.subscribe(forward)` and nothing else, and
 * that one missing line was the whole of the defect this slice exists to
 * remove, in both directions:
 *
 *  - A game that failed AT BOOT said nothing. Everything `createGame`
 *    collected — a row whose `apply` threw, a seam with two providers, a
 *    mechanic expecting a field the math never declares — was already in
 *    the log by the time this function ran, so there was no later change
 *    to forward. Measured on a live host: the game showed "composition has
 *    errors — see log" with the reason in it, and the IDE panel said "no
 *    game connected yet", zero rows. That is exactly the recorded defect —
 *    an authoritative-looking editor beside a game lying under a failure
 *    screen — reached by the commonest failure there is.
 *  - A game whose failure had been FIXED was still shown as broken,
 *    forever. `rpc.ts` retains the last frame per source and never clears
 *    it (deliberately — see its own doc), so the only thing that can
 *    replace a stale `game` slot is the game saying what is true now. A
 *    healthy game had nothing to say and so never said it.
 *
 * So: forward once on `open`, and once immediately if the socket is
 * already open when this is called. A boot-failing game states its list; a
 * healthy one states an empty list, which is not nothing — it is the fact
 * that replaces the stale slot. No protocol change and no new message
 * type: an empty whole-list frame already means "this source has nothing",
 * because whole-list frames always meant that.
 *
 * **Never throws, and never re-enters `log`.** A closed or half-open
 * socket, or one whose `send` itself throws, is not this function's
 * failure to escalate — see `connection.ts`'s `update()` for the ordinary
 * shape of "a send failure becomes a diagnostic" and why THIS function
 * cannot follow it: the only service there is to write that diagnostic
 * into is `log` itself, and `log.report()` would notify this SAME
 * subscription again, forwarding again, over a socket that just proved it
 * cannot be forwarded to. A dev-only bridge that spins on a broken socket
 * is worse than one that goes quiet, so a send failure here is simply
 * swallowed.
 *
 * **Stamps this bridge's own identity on the way out, if it was given
 * one.** See `IdeBridgeConfig.game`'s own doc for where a caller gets one
 * and `GameDiagnosticsMessage.game` (`@energy8engine/contracts`) for what
 * it means on the wire — an absent identity is the ordinary single-game
 * case, not a broken frame, so it is simply left off rather than
 * defaulted to anything. This function does not read `location` itself to
 * find one; `apply()` does that, the same way it already resolves
 * `bridgeUrl`, so this stays a plain value in and a plain value out —
 * testable headless, with nothing here that needs a browser to run.
 */
export function attachDiagnosticsForwarding(
  socket: Pick<WebSocketLike, 'readyState' | 'send' | 'addEventListener'>,
  log: DiagnosticsService,
  identity: DiagnosticsForwardingIdentity = {},
): () => void {
  /**
   * Set by the disposer. `WebSocketLike` declares no `removeEventListener`
   * — it is the small slice of a socket this module needs, and widening it
   * for one teardown would make every fake in every test grow a method —
   * so the `open` listener below stays registered and is made inert
   * instead. It fires at most once either way.
   */
  let disposed = false;
  const forward = () => {
    if (disposed) return;
    if (socket.readyState !== WEBSOCKET_OPEN) return;
    try {
      const message: ClientMessage = {
        type: 'game-diagnostics',
        // `own()`, not `list()`. The game's list also carries what the HOST
        // said about the project (`createGame` seeds it there so `boot` and
        // the page can paint one list), and the editor already holds those
        // from the same `/api/composition` response over its own channel —
        // sending them again made the panel render one project failure
        // twice, the second copy labelled as the game's. `dropped()` is
        // still the whole list's, which can only ever OVERSTATE what this
        // frame is missing: a reader told too much was forgotten loses a
        // sentence, a reader told too little believes it has everything.
        diagnostics: [...log.own()],
        dropped: log.dropped(),
        // `undefined` when this bridge has no identity configured —
        // `JSON.stringify` drops the key entirely rather than sending it
        // as `null`, so the frame is byte-for-byte what a bridge from
        // before this field existed would have sent.
        game: identity.game,
      };
      socket.send(JSON.stringify(message));
    } catch {
      // See this function's own doc: nowhere safe to report this that
      // would not loop straight back through `log` and this subscription.
    }
  };

  // The state of the log NOW, as soon as there is a socket to say it on —
  // see this function's doc. `open` for the ordinary browser case (the
  // socket is still CONNECTING when `apply` wires this up), and the
  // immediate call for a caller that hands over an already-open one, which
  // never fires `open` again. Guarded so the two cannot both send: an
  // already-open socket does not raise `open`, and one that raises `open`
  // was not open a moment ago.
  socket.addEventListener('open', forward);
  forward();

  const unsubscribe = log.subscribe(forward);

  /**
   * The other half of this function's name — not only OUT to the host, but
   * also IN from it. `rpc.ts`'s `reportGameDiagnostics` already sends this
   * host's OWN `/api/spin` failures down this exact socket, stamped
   * `source: 'host'` — to every connected client, this one included,
   * because the host keeps one socket set and draws no line between an
   * editor tab and a game's bridge (see `rpc.ts`'s own `clients` doc).
   * Nothing on this side ever read that frame, so a failure only the HOST
   * had noticed reached the editor but never the game's own page — the gap
   * this closes.
   *
   * `seed`ed, not `report`ed. Reporting it would notify this same
   * `log.subscribe(forward)` above and go straight back out as part of
   * `own()` — closing a loop this socket cannot afford: down, report,
   * `own()`, up, down again, forever. `seed` is the same verb `createGame`
   * already uses for the host's PROJECT diagnostics (see
   * `DiagnosticsService.seed`'s own doc): a diagnostic this game did not
   * itself produce, so `list()` — what `boot` and this game's own page
   * paint — carries it, while `own()` — what `forward` above sends on —
   * does not.
   *
   * **Only `source: 'host'`, nothing else accepted.** The relay in
   * `rpc.ts` forwards a CLIENT's own frame to every OTHER client, so with
   * two games open on one dev host, this socket also receives ANOTHER
   * game's frame, stamped `source: 'game'`. Seeding that would mix one
   * game's failures into an unrelated game's list — worse than the gap
   * this closes. An absent `source` reads as `'game'` by the protocol's
   * own rule (`GameDiagnosticsMessage.source`'s doc — the meaning the
   * field had before there were two speakers), so it is rejected here
   * exactly like an explicit `'game'` would be.
   */
  socket.addEventListener('message', (event) => {
    if (disposed) return;
    let message: Extract<ServerMessage, { type: 'game-diagnostics' }>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Same family `apply()`'s own snapshot listener guards against below
      // — `null`, an array, or a primitive all pass `JSON.parse` but would
      // throw on `.type` outside this catch.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      if ((parsed as { type?: unknown }).type !== 'game-diagnostics') return;
      message = parsed as Extract<ServerMessage, { type: 'game-diagnostics' }>;
    } catch {
      return;
    }
    if (message.source !== 'host') return;
    for (const d of message.diagnostics) log.seed(d);
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}

const WEBSOCKET_OPEN = 1;

/**
 * The shape shared by every registry this module states on the socket as
 * its own report back to the host: `transitions` (`game-transitions`),
 * `nodeTypes` (`node-types`) and, as of this row, `flowNodes`
 * (`flow-kinds`). All three used to be their own copy-pasted ~30 lines —
 * `currentX`/`forwardX`/`subscribeX`, a `ctx.inject(['x'], …)` re-arm, the
 * same shape three times over with only the service name and the frame it
 * builds changing. A third copy was the wrong side of the choice
 * (task-4-brief.md gave both options); this is the one fold.
 *
 * States the registry as soon as there is an open socket and something to
 * read, again on every `svc.subscribe` notification, and again once the
 * SERVICE is (re-)provided — a hot row re-apply disposes the registry this
 * was subscribed to and provides a fresh one, and without the re-arm the
 * subscription would still be live on an object nothing will ever notify
 * again. See `attachDiagnosticsForwarding`'s own doc for why "state it
 * now, not only on the next change" matters for a socket that may already
 * be open, or may not be, by the time this runs.
 *
 * Read leniently (`ctx.reflect.get(serviceName, false)`), like every other
 * lookup in this module: a composition with no row providing `serviceName`
 * sends nothing here, never throws. Returns the disposer — the caller
 * wraps it in its own `ctx.effect`, same as this module's other teardowns.
 */
function forwardRegistry<T extends { subscribe(listener: () => void): () => void }>(
  ctx: Context,
  serviceName: string,
  socket: Pick<WebSocketLike, 'readyState' | 'send' | 'addEventListener'>,
  toFrame: (svc: T) => ClientMessage,
): () => void {
  const current = () => ctx.reflect.get(serviceName, false) as T | undefined;

  const forward = () => {
    const svc = current();
    if (!svc) return;
    if (socket.readyState !== WEBSOCKET_OPEN) return;
    try {
      socket.send(JSON.stringify(toFrame(svc)));
    } catch {
      // See `attachDiagnosticsForwarding`'s own doc: nowhere safe to report
      // a send failure that would not loop straight back through this same
      // path.
    }
  };

  let unsubscribe: (() => void) | undefined;
  const subscribe = () => {
    unsubscribe?.();
    unsubscribe = current()?.subscribe(forward);
  };

  socket.addEventListener('open', forward);
  subscribe();
  forward();

  let readFrom = current();
  ctx.inject([serviceName], () => {
    const fresh = current();
    if (!fresh || fresh === readFrom) return;
    readFrom = fresh;
    subscribe();
    forward();
  });

  return () => unsubscribe?.();
}

export function apply(ctx: Context, config: IdeBridgeConfig): void {
  /**
   * Read per use, never captured: `mechanics1` is a HOT row. A live edit
   * to it re-applies that row's fiber, which disposes the registry this
   * module would have captured (its bindings and registrations were that
   * run's effects — it answers nothing afterwards) and provides a new one.
   * `reflect.get(…, false)` because this module never injects it: the
   * registry's absence is an answer here, not an exception.
   */
  const currentMechanics = () => ctx.reflect.get('mechanics', false) as MechanicsBinder | undefined;
  const mechanics = currentMechanics();
  if (!mechanics) {
    // Host-side registration only — see the module doc, point 1.
    return;
  }

  /**
   * The stages this COMPOSITION binds, read once per registry, before this
   * module has bound anything on it.
   *
   * Once per registry, and up front, for a reason: this module's own binds
   * land in `mechanics.bindings()` too, so reading it fresh each time would
   * make the answer depend on what the human had already typed. Reading it
   * at boot — after `createGame` has resolved, so every row that was going
   * to bind has — makes it a fact about the project rather than about this
   * session. And again whenever `mechanics` is re-provided (the `inject`
   * at the bottom of this function): a hot `mechanics1` re-apply that
   * changes `stages` is a new fact about the project, and the old list
   * would warn about a stage the composition now does bind.
   *
   * It is also the only list of stage names available on this side of the
   * wire. The math's own list lives in `SpinSchema.stages`, which
   * `createGame` reads and does not put on the context; a stage a project
   * declares but binds to nothing is therefore invisible here, which is
   * exactly why the check below is a warning and not a refusal.
   */
  let composedStages = Object.keys(mechanics.bindings());
  let soleComposedStage = composedStages.length === 1 ? composedStages[0] : null;
  /**
   * The binding this module last put on a registry — from its own row at
   * boot, or from the latest snapshot naming one. Replayed onto the NEXT
   * registry: a hot `mechanics1` re-apply disposes the one this was bound
   * on, and the fresh one carries only the composition's own `stages`.
   * Nothing re-broadcasts a snapshot on a game-row PUT (the host sends a
   * `game-composition` frame, which names the changed row, not this one),
   * so without the replay the human's override silently reverted until the
   * next unrelated composition change (measured — Task 4's review, (e)).
   */
  let lastApplied: { stage: string; mechanic: string } | null = null;

  // The last id this module complained about, per stage. Only ever
  // suppresses a repeat of the same SENTENCE — never a bind, which stays
  // unconditional below for the reason given there.
  const reportedUnregistered = new Map<string, string>();
  const reportedUnknownStage = new Set<string>();

  // Two independent destinations, not one written twice: `onDiagnostic` is
  // this module's ORIGINAL channel — a callback the caller supplies,
  // because this row is composed by the game's own page, not by the
  // loader, and had nowhere else to put one (see the module doc). The
  // shared `diagnostics` service is the SAME `ctx` this function was
  // handed (`apply(ctx, config)` — a running game's `ctx`, when this row
  // is composed browser-side), so writing there directly means an IDE
  // panel reading the service sees this without the page having to relay
  // it. `reflect.get(name, false)` rather than `ctx.diagnostics`: cordis
  // throws on a property read of a registered service this function did
  // not `inject`, and "no such row composed" is the answer wanted here,
  // not an exception.
  const report = (d: Diagnostic) => {
    config.onDiagnostic?.(d);
    reportAll(ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined, [d]);
  };

  const bind = (stage: string, mechanicId: string) => {
    const mechanics = currentMechanics();
    // Between a hot re-apply's dispose and its re-provide there is no
    // registry to bind on; a frame landing in that gap is dropped, and the
    // row's own config (which the re-apply reads) is what stands.
    if (!mechanics) return;
    // Skips a rebind that would be a no-op — cheap insurance against
    // `mechanics.bind()` re-registering a `ctx.effect` on every broadcast
    // snapshot (not just ones that actually touch the binding; `rpc.ts`
    // broadcasts on ANY composition change). This used to remember "the
    // value I MYSELF last wrote" in a local variable — wrong, because
    // `main.ts`'s own local `<select>` handler binds the stage directly
    // (`game.ctx.mechanics.bind(...)`), bypassing this function entirely.
    // That write updates ground truth without this module ever hearing
    // about it, so a LATER broadcast repeating the value this module
    // itself last wrote would compare equal to the stale local and be
    // skipped — silently dropping a legitimate IDE write instead of
    // merely losing a race to it (a stronger bug than the accepted
    // last-writer-wins). Reading `mechanics.forStage(stage)?.id` instead
    // asks the mechanics registry itself what is CURRENTLY bound — the one
    // source that is updated no matter which of the three writers changed
    // it — so this module can never skip a write it did not itself make.
    if (mechanics.forStage(stage)?.id === mechanicId) {
      reportedUnregistered.delete(stage);
      return;
    }
    mechanics.bind(stage, mechanicId);

    // A stage nothing else in this composition binds. Not refused — a game
    // may legitimately have a stage its patch leaves unbound, and this
    // module cannot see the math's own list of them (see `composedStages`).
    // But it is also exactly what a mistyped stage name looks like, and
    // without this the human turns the knob and nothing happens, in
    // silence. So it is said, once per stage, at `warning`.
    if (!composedStages.includes(stage) && !reportedUnknownStage.has(stage)) {
      reportedUnknownStage.add(stage);
      report(
        diagnostic(
          'warning',
          'ide-bridge',
          stage,
          `the IDE bound stage "${stage}", which nothing else in this composition binds — it binds: ${
            composedStages.length > 0 ? composedStages.join(', ') : '(none)'
          }`,
          `check the stage name, or leave it as it is if the math really does declare "${stage}"`,
        ),
      );
    }

    // Now that the mechanic is a free string, a typo reaches here instead
    // of being refused by the schema — so this is where it gets answered.
    // Asked of the registry AFTER the bind, because the registry is the
    // only thing that knows: `bind` deliberately accepts an id nothing has
    // registered YET (composition order is not knowable at bind time — see
    // `MechanicsService.bind`), and by the time this module runs, the
    // composition has settled, so `forStage` returning something else is a
    // fact rather than a race.
    if (mechanics.forStage(stage)?.id === mechanicId) {
      reportedUnregistered.delete(stage);
      return;
    }
    // `rpc.ts` broadcasts on every composition change and an unregistered
    // id can never satisfy the dedupe above, so without this one edit
    // produces one log line per broadcast — measured, four for a single
    // keystroke-free `fill`.
    if (reportedUnregistered.get(stage) === mechanicId) return;
    reportedUnregistered.set(stage, mechanicId);
    report(
      diagnostic(
        'error',
        'ide-bridge',
        stage,
        `the IDE bound stage "${stage}" to mechanic "${mechanicId}", but no mechanic with that id is registered in this game`,
        `check the spelling, or add the row that registers "${mechanicId}" to this project's composition`,
      ),
    );
  };

  /** Was told which stage, or has nothing to say about which. */
  let reportedNoStage = false;
  /** Said once about the field that no longer exists — see `applyRow`. */
  let reportedLegacyKey = false;

  /**
   * One row's worth of intent — from this row's own config at boot, and
   * from every broadcast snapshot afterwards. Both go through here so the
   * two paths cannot drift apart.
   */
  const applyRow = (settable: IdeBridgeSettableConfig & { base_game?: unknown }) => {
    // The field this row used to have, still written in somebody's
    // `e8.yml`.
    //
    // `base_game` named the mechanic AND, by its own name, the stage — one
    // field doing two jobs, which is why the stage could not be named at
    // all. It is `stage` + `mechanic` now, with no alias: an alias would be
    // keeping the hardcoded stage name, and the engine ships no published
    // games that would need one.
    //
    // What it must not be is silent, and it was. Schemastery passes an
    // unknown key through untouched, so the value survives all the way to
    // here, `mechanic` reads as absent, and this function returns — which
    // is byte-for-byte what the LEGITIMATE "a row that names no mechanic
    // leaves the binding alone" case does. A person whose row stopped
    // working would have had nothing at all to look at.
    if (named(settable.base_game) !== null && !reportedLegacyKey) {
      reportedLegacyKey = true;
      report(
        diagnostic(
          'error',
          'ide-bridge',
          'base_game',
          'this row sets "base_game", which this version of ide-bridge does not read, so it is doing nothing',
          'replace "base_game: <mechanic>" with "mechanic: <mechanic>", and add "stage: <stage>" if this game binds more than one stage',
        ),
      );
    }

    // A row that names no mechanic says nothing — it does not push a value
    // nobody wrote over whatever `e8.patch.yml` already bound. See
    // `IdeBridgeSettableConfig.mechanic`.
    const mechanicId = named(settable.mechanic);
    if (mechanicId === null) return;

    const stage = named(settable.stage) ?? soleComposedStage;
    if (stage === null) {
      // Nothing to guess from: this composition binds no stage at all, or
      // more than one and the row did not say which. Reported rather than
      // picked, and once — `rpc.ts` broadcasts on every change.
      if (reportedNoStage) return;
      reportedNoStage = true;
      report(
        diagnostic(
          'error',
          'ide-bridge',
          'stage',
          `the IDE named mechanic "${mechanicId}" but no stage, and this composition binds ${
            composedStages.length === 0
              ? 'no stage to fall back on'
              : `more than one: ${composedStages.join(', ')}`
          }`,
          'fill in the "stage" field on this row with the stage to rebind',
        ),
      );
      return;
    }
    reportedNoStage = false;
    lastApplied = { stage, mechanic: mechanicId };
    bind(stage, mechanicId);
  };

  applyRow(config);

  // Re-fires whenever `mechanics` is provided again — a hot `mechanics1`
  // re-apply restarts that row's fiber, which disposes the registry this
  // module bound on and provides a fresh one (see `lastApplied`). A row
  // that registers its mechanic from its OWN `inject` (`reelstep1`) was
  // composed before this module and so re-registers first: by the time
  // this runs, the id `lastApplied` names resolves again.
  //
  // Fires once at boot too, and asynchronously (measured: cordis runs the
  // callback on a later tick) — AFTER `applyRow(config)` above has bound on
  // the registry `composedStages` was read from. Re-reading it then would
  // count this module's own bind as one of the composition's, which is
  // exactly what the read-once rule exists to prevent; so a registry that
  // was already read is skipped, by identity.
  let readFrom = mechanics;
  ctx.inject(['mechanics'], () => {
    const fresh = currentMechanics();
    if (!fresh || fresh === readFrom) return;
    readFrom = fresh;
    composedStages = Object.keys(fresh.bindings());
    soleComposedStage = composedStages.length === 1 ? composedStages[0] : null;
    if (lastApplied) bind(lastApplied.stage, lastApplied.mechanic);
  });

  const url =
    config.bridgeUrl ?? (typeof location !== 'undefined' ? `ws://${location.host}/ide` : undefined);
  if (!url) return; // no address to reach the host at — stays on the boot-time binding only.

  // This bridge's own identity — see `IdeBridgeConfig.game`'s own doc for
  // the fallback order. Resolved here, next to `url` above, for the same
  // reason: a test environment with no `location` global must be able to
  // pass it straight in rather than this module reaching for a global it
  // does not have.
  const gameId =
    config.game ??
    (typeof location !== 'undefined'
      ? (new URLSearchParams(location.search).get('game') ?? undefined)
      : undefined);

  const factory =
    config.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
  const socket = factory(url);

  // The one line that lives only in development (see the module doc): a
  // running game's own diagnostics, forwarded to the host so the IDE shows
  // the SAME list a panel embedded in the game itself would read. Optional
  // in exactly the way `report` above already is — a composition with no
  // `diagnostics` row leaves this simply unwired, never broken.
  const diagnosticsLog = ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined;
  if (diagnosticsLog) {
    const detachForwarding = attachDiagnosticsForwarding(socket, diagnosticsLog, { game: gameId });
    ctx.effect(() => detachForwarding, 'ide-bridge-diagnostics-forwarding');
  }

  socket.addEventListener('message', (event) => {
    // Narrowed straight to the one variant this module reads — a second,
    // separate `message.type !== 'snapshot'` check after the cast was
    // tried first and rejected: it can never fire without THIS check
    // already having returned, so no test could ever tell the two apart —
    // exactly the kind of structurally-inert branch a mutation check is
    // for catching before it ships. One check, cast directly to the
    // narrowed shape, instead.
    let message: Extract<ServerMessage, { type: 'snapshot' }>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Malformed frames are ignored, not just unparsable ones — `null`, an
      // array, or a primitive all pass JSON.parse but would throw on
      // `.type` below, outside this catch, since parsing itself succeeded.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      if ((parsed as { type?: unknown }).type !== 'snapshot') return;
      message = parsed as Extract<ServerMessage, { type: 'snapshot' }>;
    } catch {
      return;
    }

    const row = message.snapshot.rows.find((candidate) => candidate.name === PACKAGE_NAME);
    if (!row) return;
    // Same rule as the boot-time bind above, and literally the same code
    // path: a row that names no mechanic — absent, or cleared back to an
    // empty string in the form — leaves the running binding alone rather
    // than resetting it to whatever the engine happens to ship.
    const rowConfig = (row.config ?? {}) as {
      stage?: unknown;
      mechanic?: unknown;
      base_game?: unknown;
    };
    applyRow({
      stage: typeof rowConfig.stage === 'string' ? rowConfig.stage : undefined,
      mechanic: typeof rowConfig.mechanic === 'string' ? rowConfig.mechanic : undefined,
      // Carried through so a hand-edited `e8.yml` broadcast over `/ide`
      // gets the same complaint the boot-time config does — the IDE's own
      // form cannot produce this key, but a file can.
      base_game: rowConfig.base_game,
    });
  });

  // The host's word on a GAME row edit (`PUT /api/composition/rows/:id`):
  // the rows as they now stand, which ids changed, and whether the change
  // is one a running game can take in place. `reload: true` is the IDE's
  // to act on — it reloads the iframe, and any re-apply done here first
  // would only be thrown away with it. `reload: false` re-applies each
  // changed row through the runtime's `gameRows` (the row's own fiber:
  // cordis disposes its effects and runs `apply` again with the frame's
  // config), in the order the host listed them. A row `gameRows` does not
  // know answers `'unknown'` and stays silent (spec §4); one whose
  // re-apply threw is reported by `gameRows` itself, onto the same
  // diagnostics this socket already forwards. Read leniently, so a game
  // built on a runtime without `gameRows` ignores the frame, not throws.
  //
  // The IDE's Scenes screen (`scenes`/`scene-select`/`scene-preview`),
  // its Flow screen (`flow`) and, as of this row, its Symbols screen
  // (`symbols`) ride the same listener rather than separate ones: every one
  // of these frames is the host telling this ONE running game to do
  // something right now, and all are read leniently against a service that
  // may not be on this `ctx` at all — a game with no `scenes`/`flow`/
  // `symbols` row (or an older runtime) simply has nothing to do with them,
  // the same way one with no `gameRows` has nothing to do with a
  // `game-composition` frame.
  socket.addEventListener('message', (event) => {
    let message: Extract<
      ServerMessage,
      | { type: 'game-composition' }
      | { type: 'scene-preview' }
      | { type: 'scenes' }
      | { type: 'scene-select' }
      | { type: 'flow' }
      | { type: 'symbols' }
    >;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const type = (parsed as { type?: unknown }).type;
      if (
        type !== 'game-composition' &&
        type !== 'scene-preview' &&
        type !== 'scenes' &&
        type !== 'scene-select' &&
        type !== 'flow' &&
        type !== 'symbols'
      )
        return;
      message = parsed as Extract<
        ServerMessage,
        | { type: 'game-composition' }
        | { type: 'scene-preview' }
        | { type: 'scenes' }
        | { type: 'scene-select' }
        | { type: 'flow' }
        | { type: 'symbols' }
      >;
    } catch {
      return;
    }

    const scenes = ctx.reflect.get('scenes', false) as
      | {
          replace?(docs: unknown[]): void;
          show?(id: string, opts?: { preview?: boolean }): Promise<void>;
          highlight?(ref: { scene: string; node: string } | null): void;
        }
      | undefined;
    if (message.type === 'scene-preview') {
      // A preview: the IDE looking at a document, not the game showing it.
      if (scenes?.show) void scenes.show(message.scene, { preview: true });
      return;
    }
    if (message.type === 'scenes') {
      if (scenes?.replace && Array.isArray(message.scenes)) scenes.replace(message.scenes);
      return;
    }
    if (message.type === 'scene-select') {
      if (scenes?.highlight)
        scenes.highlight(
          message.node === null ? null : { scene: message.scene, node: message.node },
        );
      return;
    }
    if (message.type === 'flow') {
      // `doc: null` too — `replace(null)` stops the run and clears `doc()`.
      const flow = ctx.reflect.get('flow', false) as { replace?(doc: unknown): void } | undefined;
      flow?.replace?.(message.doc);
      return;
    }
    if (message.type === 'symbols') {
      // `doc: null` too — `replace(null)` clears the doc; live views fall back to the box.
      const symbols = ctx.reflect.get('symbols', false) as
        { replace?(doc: unknown): void } | undefined;
      symbols?.replace?.(message.doc);
      return;
    }

    if (message.reload) return;
    const gameRows = ctx.reflect.get('gameRows', false) as GameRowsUpdater | undefined;
    if (!gameRows) return;
    for (const id of message.changed) {
      const row = message.rows.find((candidate) => candidate.id === id);
      if (!row) continue;
      void gameRows.update(id, row.config);
    }
  });

  // The running game's `transitions` registry, as ids (`GameTransitionsMessage`)
  // — read leniently (`ctx.reflect.get('transitions', false)`): a
  // composition with no `stage` row sends nothing here, never throws. See
  // `forwardRegistry`'s own doc for the shape shared with `nodeTypes` and
  // `flowNodes` below.
  ctx.effect(
    () =>
      forwardRegistry<{ ids(): string[]; subscribe(listener: () => void): () => void }>(
        ctx,
        'transitions',
        socket,
        (transitions) => ({ type: 'game-transitions', ids: transitions.ids() }),
      ),
    'ide-bridge-transitions-forwarding',
  );

  // The running game's node-type registry: its ids and each type's own
  // props schema, so the IDE's Scenes screen can render a node's fields and
  // offer its type as a pick (`NodeTypesMessage`). Read leniently
  // (`ctx.reflect.get('nodeTypes', false)`): a composition with no `scenes`
  // row sends nothing here, never throws.
  //
  // `JSON.parse(JSON.stringify(t.schema))`: a schemastery `Schema` is not
  // itself JSON — `JSON.stringify` calls its own `toJSON()`, producing the
  // same deduped `{ uid, refs }` shape `CompositionRow.schema` already
  // sends. A reader rebuilds it with `new Schema(json)` before reading
  // `.type`/`.dict`/`.meta`.
  ctx.effect(
    () =>
      forwardRegistry<{
        list(): {
          type: string;
          schema: unknown;
          accept?: NodeTypeAccept;
          assetProps?: string[];
          assetMapProps?: string[];
        }[];
        subscribe(listener: () => void): () => void;
      }>(ctx, 'nodeTypes', socket, (nodeTypes) => ({
        type: 'node-types',
        types: nodeTypes.list().map((t) => ({
          type: t.type,
          schema: JSON.parse(JSON.stringify(t.schema)),
          ...(t.accept ? { accept: t.accept } : {}),
          ...(t.assetProps ? { assetProps: t.assetProps } : {}),
          ...(t.assetMapProps ? { assetMapProps: t.assetMapProps } : {}),
        })),
      })),
    'ide-bridge-node-types-forwarding',
  );

  // The running game's flow node-kind registry (`ctx.flowNodes` —
  // `@energy8engine/flow`'s `flow1` row): every kind's id, its output
  // ports, whether it's a trigger, and its props schema, so the flow
  // editor can offer a node's kind as a pick and render its fields
  // (`FlowKindsMessage`). Same shape, same reasons as `nodeTypes` just
  // above — read leniently (`ctx.reflect.get('flowNodes', false)`): a
  // composition with no `flow` row sends nothing here, never throws.
  ctx.effect(
    () =>
      forwardRegistry<{
        list(): { kind: string; outs: readonly string[]; trigger?: boolean; schema: unknown }[];
        subscribe(listener: () => void): () => void;
      }>(ctx, 'flowNodes', socket, (flowNodes) => ({
        type: 'flow-kinds',
        kinds: flowNodes.list().map((k): FlowKindInfo => ({
          kind: k.kind,
          outs: [...k.outs],
          trigger: !!k.trigger,
          schema: JSON.parse(JSON.stringify(k.schema)),
        })),
      })),
    'ide-bridge-flow-kinds-forwarding',
  );

  // The running game's flow TRACE — every node a run entered or left,
  // batched per animation frame rather than sent one `flow-trace` message
  // per entry: the interpreter can produce several in the same tick (a
  // `boot` trigger firing straight into a `merge`, say), and a reader
  // wants "what happened this frame", not a socket write per node. Not
  // `forwardRegistry`'s shape — there is no "current list" to read back
  // and no registry to re-subscribe to on change, only a stream
  // (`flow.onTrace`) to buffer and flush.
  //
  // `requestAnimationFrame` when it exists (a real browser tab); `setTimeout(fn, 0)`
  // in a test environment or a worker with no `window`. Either way: at most
  // one flush pending at a time (`scheduled`), so N entries arriving in one
  // tick become one frame, not N.
  //
  // Re-armed on re-provide of `flow`, like every registry above: a hot
  // `flow1` re-apply disposes the `FlowService` this was subscribed to
  // (see `flow/src/runtime.ts`'s `ctx.effect(() => () => flow.stop(), …)`)
  // and provides a fresh one, whose trace this module has not yet heard.
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 0);

  let buffer: FlowTraceEntry[] = [];
  let scheduled = false;
  const flushTrace = () => {
    scheduled = false;
    if (buffer.length === 0) return;
    const entries = buffer;
    buffer = [];
    if (socket.readyState !== WEBSOCKET_OPEN) return;
    try {
      const message: ClientMessage = { type: 'flow-trace', entries };
      socket.send(JSON.stringify(message));
    } catch {
      // See `attachDiagnosticsForwarding`'s own doc: nowhere safe to report
      // a send failure that would not loop straight back through this same
      // path.
    }
  };

  const currentFlow = () =>
    ctx.reflect.get('flow', false) as
      | {
          onTrace(fn: (e: FlowTraceEntry) => void): () => void;
          trace?(): readonly FlowTraceEntry[];
        }
      | undefined;

  let unsubscribeTrace: (() => void) | undefined;
  const subscribeTrace = () => {
    unsubscribeTrace?.();
    unsubscribeTrace = currentFlow()?.onTrace((e) => {
      buffer.push(e);
      if (scheduled) return;
      scheduled = true;
      schedule(flushTrace);
    });
  };

  subscribeTrace();

  // The boot run traces before this socket is open, and `flushTrace` drops
  // on a closed socket: on `open`, the interpreter's own backlog
  // (`flow.trace()`, the run so far) goes out as one frame. It holds
  // whatever is still buffered, so the buffer is cleared rather than sent twice.
  socket.addEventListener('open', () => {
    const backlog = currentFlow()?.trace?.() ?? [];
    if (backlog.length === 0) return;
    buffer = [];
    try {
      const message: ClientMessage = { type: 'flow-trace', entries: [...backlog] };
      socket.send(JSON.stringify(message));
    } catch {
      // as `flushTrace`
    }
  });

  let readFromFlow = currentFlow();
  ctx.inject(['flow'], () => {
    const fresh = currentFlow();
    if (!fresh || fresh === readFromFlow) return;
    readFromFlow = fresh;
    subscribeTrace();
  });
  ctx.effect(() => () => unsubscribeTrace?.(), 'ide-bridge-flow-trace-forwarding');

  ctx.effect(() => () => socket.close(), 'ide-bridge-socket');
}
