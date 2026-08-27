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

/** Host to browser. Slice 0 sends whole snapshots: they are small, and diffing is a later problem. */
export type ServerMessage =
  { type: 'snapshot'; snapshot: Snapshot } | { type: 'diagnostics'; diagnostics: Diagnostic[] };

/** Browser to host. */
export type ClientMessage = { type: 'update'; id: string; config: unknown };
