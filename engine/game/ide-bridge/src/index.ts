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
 *     row's fiber PENDING forever on the host, reading as "ждёт" instead of
 *     the true "there's nothing for this row to do here.")
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
 * A `hot:false` row is a different, legitimate story this module has no
 * part in: `engine/ide/client/src/screens/CompositionScreen.tsx`'s
 * `Preview` component reloads the iframe for THAT case instead. This
 * package declares `"e8": { "hot": true }` in its own package.json — a
 * config change here genuinely never needs the iframe to reload, because
 * this is the mechanism that makes that true.
 */
import type { Context } from 'cordis';
import Schema from 'schemastery';
import { diagnostic, type Diagnostic, type ServerMessage } from '@energy8engine/contracts';

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
   */
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

/** The slice of WebSocket this module needs — enough to fake in a test. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
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
  stage: Schema.string().description('стадия (пусто — та единственная, что связал состав)'),
  mechanic: Schema.string().description('механика стадии'),
});

export function apply(ctx: Context, config: IdeBridgeConfig): void {
  const mechanics = ctx.get('mechanics') as MechanicsBinder | undefined;
  if (!mechanics) {
    // Host-side registration only — see the module doc, point 1.
    return;
  }

  /**
   * The stages this COMPOSITION binds, read once, before this module has
   * bound anything itself.
   *
   * Once, and up front, for a reason: this module's own binds land in
   * `mechanics.bindings()` too, so reading it fresh each time would make
   * the answer depend on what the human had already typed. Reading it at
   * boot — after `createGame` has resolved, so every row that was going to
   * bind has — makes it a fact about the project rather than about this
   * session.
   *
   * It is also the only list of stage names available on this side of the
   * wire. The math's own list lives in `SpinSchema.stages`, which
   * `createGame` reads and does not put on the context; a stage a project
   * declares but binds to nothing is therefore invisible here, which is
   * exactly why the check below is a warning and not a refusal.
   */
  const composedStages = Object.keys(mechanics.bindings());
  const soleComposedStage = composedStages.length === 1 ? composedStages[0] : null;

  // The last id this module complained about, per stage. Only ever
  // suppresses a repeat of the same SENTENCE — never a bind, which stays
  // unconditional below for the reason given there.
  const reportedUnregistered = new Map<string, string>();
  const reportedUnknownStage = new Set<string>();

  const report = (d: Diagnostic) => config.onDiagnostic?.(d);

  const bind = (stage: string, mechanicId: string) => {
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
    bind(stage, mechanicId);
  };

  applyRow(config);

  const url =
    config.bridgeUrl ?? (typeof location !== 'undefined' ? `ws://${location.host}/ide` : undefined);
  if (!url) return; // no address to reach the host at — stays on the boot-time binding only.

  const factory =
    config.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
  const socket = factory(url);

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

  ctx.effect(() => () => socket.close(), 'ide-bridge-socket');
}
