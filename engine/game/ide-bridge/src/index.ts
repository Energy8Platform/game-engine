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
import type { ServerMessage } from '@energy8engine/contracts';

/** The one field a human edits from the composition screen. */
export interface IdeBridgeSettableConfig {
  /** Which registered mechanic renders `first-slot`'s one stage, `base_game`. */
  base_game: string;
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
}

/** The slice of WebSocket this module needs — enough to fake in a test. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

/** Duck-typed on purpose: importing `@energy8engine/game-runtime` just for this one method's type would be a real dependency for a type this module can state itself. */
interface MechanicsBinder {
  bind(stage: string, mechanicId: string): void;
}

/** This package's OWN name — how the live-update branch recognises its row inside a broadcast `Snapshot` (see the module doc, point 2). Slice 0 assumes at most one `ide-bridge` entry per project. */
const PACKAGE_NAME = '@energy8engine/ide-bridge';

/** The one stage `first-slot` has. A per-stage registry (`board.step`-style) is explicitly out of this plan's scope — see the SDD plan's "what this does NOT do". */
const STAGE = 'base_game';

export const name = 'ide-bridge';

// Deliberately not annotated `: Schema<IdeBridgeSettableConfig>` — the
// schema's own inferred type (`base_game: 'classic' | 'cascade'`) is
// narrower than `IdeBridgeSettableConfig.base_game: string`, and
// schemastery's `Schema<T>` needs its declared T to match what it actually
// validates. `IdeBridgeSettableConfig` stays the broader, simpler type
// `apply()` itself works with (mirroring what actually arrives over the
// wire — `mechanics.bind(stage, id: string)` and a broadcast row's config
// are both untyped strings at that boundary); letting `Config` infer its
// own precise literal-union type here costs nothing since nothing else in
// this module names `Config`'s type.
export const Config = Schema.object({
  base_game: Schema.union(['classic', 'cascade'] as const)
    .default('classic')
    .description('механика стадии base_game'),
});

export function apply(ctx: Context, config: IdeBridgeConfig): void {
  const mechanics = ctx.get('mechanics') as MechanicsBinder | undefined;
  if (!mechanics) {
    // Host-side registration only — see the module doc, point 1.
    return;
  }

  let lastBound: string | undefined;
  const bind = (mechanicId: string) => {
    if (mechanicId === lastBound) return;
    lastBound = mechanicId;
    mechanics.bind(STAGE, mechanicId);
  };

  bind(config.base_game);

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
    if (typeof rowConfig?.base_game !== 'string') return;
    bind(rowConfig.base_game);
  });

  ctx.effect(() => () => socket.close(), 'ide-bridge-socket');
}
