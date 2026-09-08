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
 * A running game's own diagnostics, riding the SAME `/ide` socket the
 * project's composition already does — client to server when `ide-bridge`
 * (the dev-only row that subscribes to a game's `ctx.diagnostics`) forwards
 * what it holds, server to client when the host passes that on to the
 * editor. Identical shape both ways: the host relays this message, it does
 * not transform it.
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
}

/** Host to browser. Slice 0 sends whole snapshots: they are small, and diffing is a later problem. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'diagnostics'; diagnostics: Diagnostic[] }
  | GameDiagnosticsMessage;

/** Browser to host. */
export type ClientMessage = { type: 'update'; id: string; config: unknown } | GameDiagnosticsMessage;

/**
 * A loose runtime check for "this parsed JSON is shaped like a
 * `ServerMessage`" — as loose as the inline guards `rpc.ts` and
 * `connection.ts` already apply by hand before trusting a socket frame's
 * `.type`. Only the type tag is load-bearing here, on purpose: a receiver
 * must tell `diagnostics` and `game-diagnostics` apart by TYPE ALONE,
 * never by inspecting `plugin` or any other field — see
 * `GameDiagnosticsMessage`'s own doc for why guessing from the data is
 * exactly the mistake this type exists to make impossible.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'snapshot' || type === 'diagnostics' || type === 'game-diagnostics';
}
