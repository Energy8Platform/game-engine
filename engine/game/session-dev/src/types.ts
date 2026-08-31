/**
 * `session-dev`'s own types — the `e8-server` process/handle shape. The
 * wire shape of a spin (`SpinRequest`/`SpinResult`) used to live here as a
 * standalone copy; it is now `@energy8engine/contracts`' `spin.ts`, the
 * normative source every crossing (`dev-game.ts`'s route, `first-slot`'s
 * browser entry, both shipped mechanics) types against — re-exported below
 * so existing `from './types'`/`from './e8server'` imports inside this
 * package keep working unchanged.
 */
import type { SpinRequest, SpinResult } from '@energy8engine/contracts';

export type { SpinRequest, SpinResult } from '@energy8engine/contracts';

export interface StartE8ServerOptions {
  /** directory e8-server scans for `.spin` files (its `--games-dir`). */
  gamesDir: string;
  /** `0` picks any free port (via an OS-assigned ephemeral bind); a nonzero
   *  port is used exactly as given — the caller is responsible for it being
   *  free (no scan-and-retry: a spike doesn't need that complexity, and the
   *  "reuse the port I just released" test relies on the exact match). */
  port: number;
  /** explicit e8-server binary path; skips the lookup order in `resolveServerBinary`. */
  binPath?: string;
  /** server_seed used for every round started through this handle. */
  serverSeed?: string;
  /** milliseconds to wait for the server to become ready before rejecting (default 15000). */
  readyTimeoutMs?: number;
}

export interface E8Handle {
  /** the port the server actually bound (resolves `port: 0` to a real number). */
  readonly port: number;
  /**
   * the OS pid of the spawned e8-server process. Always defined: this
   * handle is only ever returned once the readiness poll has gotten a live
   * `ListGames` response back from it, so the process necessarily exists by
   * then. Exposed for the same reason `port` is — so a caller (chiefly a
   * test) can confirm the process is actually there, or actually gone,
   * instead of trusting that a method was merely called.
   */
  readonly pid: number;
  play(req: SpinRequest): Promise<SpinResult>;
  stop(): Promise<void>;
}
