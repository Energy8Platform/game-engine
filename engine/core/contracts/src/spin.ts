/**
 * The `/api/spin` wire shape, measured (not guessed) by running the
 * `first-slot` fixture in `engine/examples/first-slot` against a live
 * `e8-server` and reading its actual gRPC response — see
 * `.superpowers/sdd/2026-08-28-slot-webide-runtime/task-1-report.md` for
 * the probe transcript. This used to live only as documentation on
 * `session-dev`'s own `types.ts`, imported by nothing outside that package
 * — every consumer across the wire (`dev-game.ts`'s route, `first-slot`'s
 * browser entry, both shipped mechanics) re-derived the shape from reading
 * that file's prose instead of importing a type. This module is the
 * normative source now; `session-dev` re-exports it rather than declaring
 * its own copy, and both sides of `/api/spin` type against it directly.
 *
 * Change this shape deliberately, not by accident — later tasks and both
 * shipped mechanics are built on it.
 */
import type { Board, Cell, RevealedLine } from './presentation';

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
  /**
   * An OPEN round to step, rather than a new one to start. A round on
   * e8-server is `StartRound` then `Step(round_id, action)` until it answers
   * `roundComplete: true`; absent this, every call starts a fresh round and a
   * game with a session stage (free spins) can never be played past its first
   * response. Pass back the `roundId` of a result whose `roundComplete` was
   * `false`, with one of the `nextActions` it named. An id the server does not
   * know is an error, not a new round.
   */
  roundId?: string;
}

/**
 * One measured round of a cascading chain: the cells it cleared (named on
 * the board displayed when it ran) and the board it left behind after its
 * own gravity + refill. See `cascade_history`'s doc on `SpinResult.data`
 * below for how a round's `removed`/`grid` relate to its neighbours — they
 * are the round's own before/after, never a pointer into the next one.
 */
export interface CascadeRound {
  grid: Board;
  removed: Cell[];
  win: number;
}

/**
 * The stage-data field convention the two shipped mechanics rely on — the
 * subset of `SpinResult.data`'s per-game shape that `mechanic-classic` and
 * `mechanic-cascade` agree to read by name. This is NOT enforced here —
 * that is `SpinShapeRequirement`/`checkShape` in `mechanic.ts`, which
 * checks field *kinds* ('number' | 'grid' | 'list'), not field *names* or
 * this exact per-field typing. This is the normative record of which
 * names carry which shape, so a third mechanic, a `.spin` author, or an
 * agent has one place to read the convention instead of reverse-engineering
 * it from `mechanic-classic`/`mechanic-cascade`'s source — until it moves
 * to the door the spec already names for this: `e8 --emit-schema` reading
 * it straight out of the `.spin`'s `enum SpinData tag stage { ... }`.
 *
 * `classic` reads exactly these fields off `SpinResult.data` and ignores
 * `cascade_history`; `base_win` is the amount THIS mechanic's one reveal
 * accounts for, never the cascade-inclusive `win`/`totalWin` — see
 * `SpinResult.win`'s doc for why those two numbers are not the same thing.
 */
export interface ClassicStageData {
  grid: Board;
  base_win: number;
  lines: RevealedLine[];
}

/**
 * `cascade` reads exactly these fields off `SpinResult.data` and ignores
 * `base_win`/`lines` (those are `classic`'s). `grid` is the pre-cascade
 * board the reels land on — round 0's `removed` is named against it, and
 * no `cascade_history` entry carries it. Each `CascadeRound` is
 * self-contained: `removed` names cells on the board as displayed WHEN
 * that round ran (`grid` above for round 0, the previous round's own
 * `grid` for every round after), and `grid` is that SAME round's board
 * AFTER its own clear + gravity + refill — the refill board for its own
 * `removed`, never for the round after it.
 */
export interface CascadeStageData {
  grid: Board;
  cascade_history: CascadeRound[];
}

/**
 * A single spin's result, translated from e8-server's `RoundResponse`.
 *
 * `data` is the game's `SpinData` enum instance for this stage, parsed from
 * `RoundResponse.data_json` — its exact fields are per-game (declared by
 * the `.spin`'s `enum SpinData tag stage { ... }`), so `data` stays
 * intentionally untyped here (`Record<string, unknown>`) rather than
 * pretending to be one of `ClassicStageData`/`CascadeStageData` — a stage a
 * third mechanic reads may carry neither convention at all. `stage` is
 * lifted out of `data.stage` (the enum's tag) for convenience; it is also
 * still present inside `data` itself, since we parse `data_json` as-is
 * rather than stripping it.
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
   *  itself start — `SpinRequest.roundId` reaches exactly that. */
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
  /** the round id this response belongs to. While `roundComplete` is
   *  `false`, pass it back as `SpinRequest.roundId` to step the round. */
  roundId: string;
}
