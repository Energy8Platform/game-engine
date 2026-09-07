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
 *     `config.base_game` to the ONE stage Slice 0's example game has,
 *     synchronously, at boot — then opens a websocket at `/ide` — the
 *     SAME endpoint and the SAME `{type:'snapshot',...}`/
 *     `{type:'diagnostics',...}` protocol `engine/ide/client/src/plugins
 *     /connection.ts` speaks — and listens. `rpc.ts` broadcasts every
 *     snapshot to EVERY connected socket, not just the IDE's own browser
 *     tab, so this needs no new host-side route: it rides the exact
 *     channel that already carries the IDE's own composition screen. When
 *     a broadcast snapshot contains a row named after this package with a
 *     different `base_game`, it rebinds — live, no reload, anywhere.
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

/** The one field a human edits from the composition screen. */
export interface IdeBridgeSettableConfig {
  /**
   * Which registered mechanic renders `first-slot`'s one stage,
   * `base_game`. Any id — this is a RUNTIME fact (what a project's
   * composition registered), not a compile-time one, so it is not an enum
   * of the mechanics the engine happens to ship. See `Config` below.
   *
   * **Optional, and absent means "say nothing".** A row that names no
   * mechanic leaves whatever the composition itself bound (`e8.patch.yml`'s
   * `mechanics1.stages`) exactly as it is. That is not a convenience: this
   * module rebinds on EVERY snapshot, so a value nobody wrote would
   * otherwise be pushed over the project's own binding a second after boot,
   * silently. A human turning the knob writes a value, and from then on it
   * wins — which is the whole point of the row.
   */
  base_game?: string;
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
   * `base_game` naming a mechanic nothing registered. It has nowhere else
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

/** Duck-typed on purpose: importing `@energy8engine/game-runtime` just for this one method's type would be a real dependency for a type this module can state itself. */
interface MechanicsBinder {
  bind(stage: string, mechanicId: string): void;
  /** Ground truth for what `stage` is CURRENTLY bound to — see `bind()`'s own comment below for why this module reads it instead of remembering its own last write. */
  forStage(stage: string): { id: string } | null;
}

/** This package's OWN name — how the live-update branch recognises its row inside a broadcast `Snapshot` (see the module doc, point 2). Slice 0 assumes at most one `ide-bridge` entry per project. */
const PACKAGE_NAME = '@energy8engine/ide-bridge';

/** The one stage `first-slot` has. A per-stage registry (`board.step`-style) is explicitly out of this plan's scope — see the SDD plan's "what this does NOT do". */
const STAGE = 'base_game';

export const name = 'ide-bridge';

/**
 * A free string, not an enum.
 *
 * It WAS `Schema.union(['classic', 'cascade'])` — the two mechanics the
 * engine itself ships — and that made a project's own third mechanic
 * unnameable from the IDE: writing `base_game: reel-step` into e8.yml
 * failed cordis's config validation (`expected "classic" | "cascade"`)
 * before `apply` ever ran, so the row never came up at all. Which
 * mechanics exist is decided by what a composition registered at runtime,
 * which no schema written in this file can know.
 *
 * The cost of a free string is that a typo is no longer caught by the
 * form. That is answered where the answer is actually knowable — `apply`
 * below reports a `base_game` nothing registered through `onDiagnostic`,
 * and `MechanicsService.check` reports it again on the first spin. It is
 * the same trade `checkAgainstSchema` already makes: a name is validated
 * against what exists, not against a list kept by hand.
 *
 * **No `.default()`** — see `IdeBridgeSettableConfig.base_game`. A default
 * here is a value nobody wrote, and this module would push it over the
 * project's own binding on the first snapshot. The composition screen
 * still renders an empty field the human can fill; what it no longer does
 * is fill it in on their behalf and then act on it.
 */
export const Config = Schema.object({
  base_game: Schema.string().description('механика стадии base_game'),
});

export function apply(ctx: Context, config: IdeBridgeConfig): void {
  const mechanics = ctx.get('mechanics') as MechanicsBinder | undefined;
  if (!mechanics) {
    // Host-side registration only — see the module doc, point 1.
    return;
  }

  // Skips a rebind that would be a no-op — cheap insurance against
  // `mechanics.bind()` re-registering a `ctx.effect` on every broadcast
  // snapshot (not just ones that actually touch `base_game`; `rpc.ts`
  // broadcasts on ANY composition change). This used to remember "the
  // value I MYSELF last wrote" in a local `lastBound` variable — wrong,
  // because `main.ts`'s own local `<select>` handler binds `STAGE`
  // directly (`game.ctx.mechanics.bind(...)`), bypassing this function
  // entirely. That write updates ground truth without this module ever
  // hearing about it, so a LATER broadcast repeating the value this
  // module itself last wrote would compare equal to the stale `lastBound`
  // and be skipped — silently dropping a legitimate IDE write instead of
  // merely losing a race to it (a stronger bug than the accepted
  // last-writer-wins). Reading `mechanics.forStage(STAGE)?.id` instead
  // asks the mechanics registry itself what is CURRENTLY bound — the one
  // source that is updated no matter which of the two writers changed it
  // — so this module can never skip a write it did not itself make.
  // The last id this module complained about. Only ever suppresses a
  // repeat of the same SENTENCE — never a bind, which stays unconditional
  // above for the reason that comment gives.
  let reportedUnregistered: string | null = null;

  const bind = (mechanicId: string) => {
    if (mechanics.forStage(STAGE)?.id === mechanicId) {
      reportedUnregistered = null;
      return;
    }
    mechanics.bind(STAGE, mechanicId);
    // Now that `base_game` is a free string, a typo reaches here instead
    // of being refused by the schema — so this is where it gets answered.
    // Asked of the registry AFTER the bind, because the registry is the
    // only thing that knows: `bind` deliberately accepts an id nothing has
    // registered YET (composition order is not knowable at bind time — see
    // `MechanicsService.bind`), and by the time this module runs, the
    // composition has settled, so `forStage` returning something else is a
    // fact rather than a race.
    if (mechanics.forStage(STAGE)?.id === mechanicId) {
      reportedUnregistered = null;
      return;
    }
    // `rpc.ts` broadcasts on every composition change and an unregistered
    // id can never satisfy the dedupe above, so without this one edit
    // produces one log line per broadcast — measured, four for a single
    // keystroke-free `fill`.
    if (reportedUnregistered === mechanicId) return;
    reportedUnregistered = mechanicId;
    config.onDiagnostic?.(
      diagnostic(
        'error',
        'ide-bridge',
        STAGE,
        `the IDE bound stage "${STAGE}" to mechanic "${mechanicId}", but no mechanic with that id is registered in this game`,
        `check the spelling, or add the row that registers "${mechanicId}" to this project's composition`,
      ),
    );
  };

  // A row that names no mechanic says nothing — it does not push a value
  // nobody wrote over whatever `e8.patch.yml` already bound. See
  // `IdeBridgeSettableConfig.base_game`.
  if (typeof config.base_game === 'string' && config.base_game.length > 0) {
    bind(config.base_game);
  }

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
    const rowConfig = row.config as { base_game?: unknown } | null;
    // Same rule as the boot-time bind above: a row that names nothing —
    // absent, or cleared back to an empty string in the form — leaves the
    // running binding alone rather than resetting it to whatever the
    // engine happens to ship.
    if (typeof rowConfig?.base_game !== 'string' || rowConfig.base_game.length === 0) return;
    bind(rowConfig.base_game);
  });

  ctx.effect(() => () => socket.close(), 'ide-bridge-socket');
}
