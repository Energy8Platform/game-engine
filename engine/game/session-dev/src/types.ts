/**
 * The shape of a real spin through e8-server, measured (not guessed) by
 * running the `first-slot` fixture in engine/examples/first-slot against a
 * live e8-server and reading its actual gRPC response. See
 * .superpowers/sdd/2026-08-28-slot-webide-runtime/task-1-report.md for the
 * probe transcript. Every later task in this plan is built on this shape —
 * change it deliberately, not by accident.
 */

/** A play() request into an e8-server round. Our own contract — not part of
 *  the wire protocol, which we translate to/from underneath. */
export interface SpinRequest {
  /** `game_id` from the game's `.spin` `game "..." { }` declaration. */
  gameId: string;
  /** entry action name, e.g. "spin" (see `action spin { ... }` in the .spin). */
  action: string;
  /** the bet level in currency units (one of the game's declared `bet_levels`). */
  betLevel: number;
  /** JSON-serializable action params, forwarded to the script as `params_json`. */
  params?: Record<string, unknown>;
}

/**
 * A single spin's result, translated from e8-server's `RoundResponse`.
 *
 * `data` is the game's `SpinData` enum instance for this stage, parsed from
 * `RoundResponse.data_json` — its exact fields are per-game (declared by the
 * `.spin`'s `enum SpinData tag stage { ... }`), so `data` is intentionally
 * untyped here. `stage` is lifted out of `data.stage` (the enum's tag) for
 * convenience; it is also still present inside `data` itself, since we parse
 * data_json as-is rather than stripping it.
 *
 * **The mechanic renders, the math pays.** `win` / `totalWin` (and
 * `data.win`, which is the same figure) are the CASCADE-INCLUSIVE amount
 * e8-server actually credits — every cascade round's win summed in. They
 * are deliberately **not** the sum of `data.lines[].win`, because
 * `data.lines` only describes round 0 of the cascade (the picture a
 * `classic`, non-cascading presentation would reveal). The figure that DOES
 * equal `sum(data.lines[].win)` is `data.base_win` — assert against that one
 * when checking the lines/win relationship, never against `win`/`data.win`.
 * Switching mechanics is only ever a presentation choice; what gets credited
 * does not change with it.
 *
 * Measured example (the `first-slot` fixture, a winning 5x3 lines spin with
 * one extra cascade round — round 0 pays 0.5 as `base_win`/`lines[0].win`;
 * round 1's extra 1.0 only shows up in `cascade_history` and in the
 * cascade-inclusive `win`/`data.win` of 1.5):
 *
 * ```json
 * {
 *   "win": 1.5,
 *   "totalWin": 1.5,
 *   "bet": 1,
 *   "stage": "base_game",
 *   "data": {
 *     "bet": 1,
 *     "grid": [[5,6,5],[6,6,5],[5,6,3],[6,5,5],[5,3,6]],
 *     "win": 1.5,
 *     "base_win": 0.5,
 *     "lines": [
 *       { "line": 1, "symbol": 6, "count": 3, "win": 0.5,
 *         "positions": [{"col":0,"row":1},{"col":1,"row":1},{"col":2,"row":1}] }
 *     ],
 *     "cascade_history": [
 *       { "grid": [[5,5,5],[5,6,5],[5,5,3],[6,5,5],[5,3,6]],
 *         "removed": [{"col":0,"row":1},{"col":1,"row":1},{"col":2,"row":1}],
 *         "win": 0.5 },
 *       { "grid": [[6,5,5],[5,6,5],[6,5,3],[6,5,5],[5,3,6]],
 *         "removed": [{"col":0,"row":0},{"col":1,"row":0},{"col":2,"row":0}],
 *         "win": 1 }
 *     ],
 *     "stage": "base_game"
 *   },
 *   "vars": { "max_win_reached": false },
 *   "nextActions": ["spin"],
 *   "roundComplete": true,
 *   "spinsRemaining": 0,
 *   "spinsPlayed": 1,
 *   "scriptSha256": "d04d38591d4a4074e4dc68ce0e0db03838a526354eec8ee6aa6ed057bbe7bd8f",
 *   "roundId": "session-dev-1"
 * }
 * ```
 *
 * Surprise found while measuring: e8-server injects a `bet` key into
 * `data_json` that is NOT declared anywhere in the `.spin`'s `SpinData`
 * enum — it is added by the engine itself. Consumers must tolerate unknown
 * extra keys in `data`.
 */
export interface SpinResult {
  /** this spin's win, as a bet multiplier (RoundResponse.win). Cascade-
   *  inclusive credited amount — see the type doc; not sum(data.lines[].win). */
  win: number;
  /** cumulative win for the round so far (RoundResponse.total_win); equals
   *  `win` for a single-spin round like `first-slot`, where every action is
   *  `round_complete` on the first response. */
  totalWin: number;
  /** the bet this round was started with (RoundResponse.bet). e8-server
   *  echoes it back rather than requiring the caller to remember it — the
   *  case that matters is a `Step` call on a round this handle did not
   *  itself start (not implemented by this task's `play()`, which always
   *  starts a fresh round; see the task-1 report's concerns section). */
  bet: number;
  /** the SpinData enum's tag for this response (lifted from `data.stage`). */
  stage: string;
  /** the parsed `SpinData` enum instance — per-game shape, see the type doc. */
  data: Record<string, any>;
  /** the game's persistent `Vars` after this spin, parsed from `vars_json`. */
  vars: Record<string, unknown>;
  /** actions the round accepts next (e.g. `["spin"]`, or a bonus stage's entry action). */
  nextActions: string[];
  /** whether the round ended on this response (no further `Step` calls apply). */
  roundComplete: boolean;
  spinsRemaining: number;
  spinsPlayed: number;
  /** sha256 of the compiled .spin bytes the server is running. */
  scriptSha256: string;
  /** the round id this response belongs to (useful for a future `Step` call). */
  roundId: string;
}

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
