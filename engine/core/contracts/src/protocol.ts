import type { Diagnostic } from './diagnostic';

/** One row of the composition: a plugin as the IDE shows it. */
export interface CompositionRow {
  /** Loader entry id, e.g. "a1b2c3:probe1". Stable across restarts. */
  id: string;
  /** Package name as written in the composition file. */
  name: string;
  disabled: boolean;
  /** cordis FiberState: 2 is ACTIVE, 3 is FAILED. */
  state: number | null;
  config: unknown;
  /**
   * A schemastery schema's raw `toJSON()` output — its own deduped
   * `{ uid, refs }` graph, not a flat `{ type, dict, meta }` object — or
   * null when the plugin declares no Config. A reader must rebuild it with
   * `new Schema(json)` (from the `schemastery` package) before reading
   * `.type`/`.dict`/`.meta`; reading those fields directly off this value
   * will find them undefined.
   */
  schema: unknown | null;
  /** Whether a config change restarts the plugin in place. */
  hot: boolean;
  /** Where the browser fetches this plugin's client half, or null when it has none. */
  clientUrl: string | null;
}

export interface Snapshot {
  rows: CompositionRow[];
  diagnostics: Diagnostic[];
}

/**
 * Which speaker a `game-diagnostics` frame's list belongs to.
 *
 * Two of them reach the editor, and they are not the same voice:
 *
 *  - `game` — a running game's own `ctx.diagnostics`, forwarded by
 *    `ide-bridge` from the browser. Several connected game sockets are
 *    several VIEWS of one game in this dev model (`e8 dev` serves one
 *    project), so they share this one source and the most recent wins —
 *    the same assumption `ctx.composition.snapshot()` already makes for
 *    the one `Snapshot` every client shares.
 *  - `host` — the host speaking for itself, for the one producer that is
 *    not in a browser at all: `dev-game.ts`'s `/api/spin` route, which
 *    runs in the host process and has no `ctx.diagnostics` to write into.
 *
 * **Set by the HOST, never declared by the sender**, and inferred from
 * where the frame entered rather than from anything in it: a frame that
 * arrived on an `/ide` socket is `game`, a frame the host originated is
 * `host`. A browser page has no identity this protocol could verify, and
 * "who said this" is a routing fact the host owns — the same reasoning
 * that keeps a reader from telling the two namespaces apart by inspecting
 * `Diagnostic.plugin`.
 */
export type GameDiagnosticsSource = 'game' | 'host';

/**
 * A running game's own diagnostics, riding the SAME `/ide` socket the
 * project's composition already does — client to server when `ide-bridge`
 * (the dev-only row that subscribes to a game's `ctx.diagnostics`) forwards
 * what it holds, server to client when the host passes that on to the
 * editor.
 *
 * **Each frame carries a whole list, and it replaces that SOURCE's list —
 * not the reader's whole picture.** Whole-list rather than a delta because
 * a delta only means something to a reader that already holds everything
 * before it, which makes "a client that just connected" a problem the
 * sender would have to solve. Per-source rather than global because two
 * speakers share this message type (see `GameDiagnosticsSource`) and
 * neither of them ever holds the other's list: a host frame carrying its
 * own `/api/spin` failure used to overwrite everything the game had
 * reported, terminally, since nothing makes the game speak again
 * afterwards. Measured, not theorised — see `engine/apps/web/tests/e2e/
 * diagnostics.spec.ts`. A reader keeps one list per source and shows the
 * union.
 *
 * **Its own type, deliberately not a reuse of `{type:'diagnostics'}`.**
 * That message carries the PROJECT's diagnostics, whose `plugin` is a
 * composition row id — a string a human wrote in `e8.yml`/`e8.patch.yml`.
 * A game's diagnostics carry a seam or mechanic id instead (see
 * `Diagnostic.plugin`'s own doc for the two disjoint namespaces). The two
 * namespaces could not meet on one socket before a live game could reach
 * the IDE at all; now that it can, the message TYPE is what tells a reader
 * which namespace `plugin` is drawn from. It has to be the type and not the
 * `plugin` string itself — a human is entitled to name a composition row
 * `session`, the same word a live game's own session seam uses to name
 * itself, and a reader guessing from that string would get it wrong on
 * exactly that project.
 */
export interface GameDiagnosticsMessage {
  type: 'game-diagnostics';
  diagnostics: Diagnostic[];
  /**
   * How many more this game's bounded log has forgotten — see
   * `@energy8engine/diagnostics`'s `DiagnosticsService.dropped()`. Travels
   * on every frame, not just once, because a panel that renders this list
   * has no other way to say the list is incomplete; a `dropped` a reader
   * has to remember from an earlier frame is a `dropped` that goes stale
   * the moment it's not repeated.
   */
  dropped: number;
  /**
   * Whose list this is — see `GameDiagnosticsSource`.
   *
   * Optional in the type, and that is not laziness about the server half:
   * the two directions genuinely differ. A client→server frame never
   * carries one (a game does not name itself; the host stamps it on the
   * way through), and a host older than this field sends none either. The
   * host always sets it on a server→client frame. **A reader that finds
   * it absent must read it as `game`** — the meaning this message had
   * before there was a second speaker — rather than inventing a third
   * bucket.
   */
  source?: GameDiagnosticsSource;
}

/** Host to browser. Slice 0 sends whole snapshots: they are small, and diffing is a later problem. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'diagnostics'; diagnostics: Diagnostic[] }
  | GameDiagnosticsMessage;

/** Browser to host. */
export type ClientMessage =
  { type: 'update'; id: string; config: unknown } | GameDiagnosticsMessage;
