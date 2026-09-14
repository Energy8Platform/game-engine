/**
 * `session-dev`'s own types — the `e8-server` process/handle shape. The
 * wire shape of a spin (`SpinRequest`/`SpinResult`) used to live here as a
 * standalone copy; it is now `@energy8engine/contracts`' `spin.ts`, the
 * normative source every crossing (`dev-game.ts`'s route, `first-slot`'s
 * browser entry, both shipped mechanics) types against — re-exported below
 * so existing `from './types'`/`from './e8server'` imports inside this
 * package keep working unchanged.
 *
 * **`reel_steps`, the third form of one spin — and how its payouts relate
 * to that spin's `win`.**
 *
 * Stated here because the sibling statement it extends is already written
 * down: `SpinResult`'s own doc in `@energy8engine/contracts` (`spin.ts`,
 * the normative source this file re-exports) says plainly that `win` is the
 * cascade-inclusive amount the server credits, that it is deliberately not
 * `sum(data.lines[].win)`, and that the figure which DOES equal that sum is
 * `data.base_win`. `reel_steps` adds a third telling of the same spin to
 * `first-slot`'s `base_game`, so it owes the same kind of sentence. It is
 * written on this side of the wire rather than in `contracts` on purpose:
 * `reel_steps` is one game's stage field consumed by one project plugin
 * (`engine/examples/first-slot/plugins/reel-step`), not a convention the
 * engine's own shipped mechanics agree on the way `ClassicStageData` and
 * `CascadeStageData` are.
 *
 * The shape, from `first-slot`'s `.spin`:
 * `reel_steps: [{ winning: [{col,row}], shifts: [int], settled: [[int]], win: float }]`
 * — one entry per ReelStep round: the cells that paid, how far each reel
 * then scrolled DOWN (one position per winning cell that landed on it,
 * `0` = the reel stays put), the board the reels settled onto, and what
 * that round paid.
 *
 * **It is a second chain over the same landed board, not a second reading
 * of `cascade_history`.** A tumble deletes winning cells wherever they sit
 * and compacts what survives; a ReelStep deletes nothing and scrolls the
 * whole reel, so from round 1 on the two chains are evaluating boards the
 * other never produces.
 *
 * So the relationship, in three parts, each measured over 20,000 real
 * spins through `e8-server` rather than asserted:
 *
 *  1. **A spin has a reel chain exactly when it paid at all.**
 *     `reel_steps.length > 0` ⟺ `win > 0` ⟺ `lines.length > 0`. Held on
 *     20,000/20,000 spins. Neither chain records a round that paid nothing.
 *  2. **Round 0 is the one board all three forms see, and they agree about
 *     it exactly.** `reel_steps[0].win === base_win === sum(lines[].win)
 *     === cascade_history[0].win`, and `reel_steps[0].winning` names the
 *     same cells as `lines[].positions` and `cascade_history[0].removed`.
 *     Held on 2,726/2,726 paying spins.
 *  3. **`sum(reel_steps[].win)` is that chain's own total and is NOT the
 *     credited figure.** It is never below `base_win` (every recorded round
 *     paid), and it is not `win`: measured, the two totals differ on 1,922
 *     of 2,726 paying spins (70%), and the reel chain returns 0.503× bet
 *     against the credited 0.208× — a ReelStep telling of `first-slot`
 *     re-triggers far more often than the tumble, because a scroll never
 *     shortens a reel. `win` is what the server credits, under every
 *     presentation, and it is the tumble's total because the tumble is the
 *     chain this game's `execute` actually walks.
 *
 * Part 3 is the part that must not be silent, and it is the same rule
 * `classic` already lives under one step further along: a `classic`
 * presentation shows `base_win` while `win` is credited, and a `reel-step`
 * presentation shows its own chain while `win` is credited. The mechanic
 * renders, the math pays. A mechanic reading `reel_steps` must report
 * `win` as the amount paid and its own steps only as what the player
 * watches happen — never sum its steps and call that the win.
 *
 * Measured example (`first-slot`, bet level 1.0), the whole divergence in
 * one spin: the reels land on `[[5,6,5],[3,6,6],[4,6,6],[4,5,2],[3,6,4]]`
 * and row 1 pays 0.5 across reels 0-2. The tumble clears those three cells,
 * refills, finds nothing more — one round, `win` 0.5. The ReelStep chain
 * scrolls reels 0-2 down by one instead, which pushes the same symbol 6
 * from row 1 to row 2 on all three reels, so it pays 0.5 a SECOND time —
 * two rounds, chain total 1.0. Same spin, same `grid`, same round 0, two
 * different chains, and 0.5 is what the player was credited.
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
  /**
   * Hears the process end AFTER it became ready — a death `stop()` did
   * not ask for, or the one it did; the caller tells them apart. A close
   * before ready is not this: that is `startE8Server`'s own rejection, and
   * no handle ever exists for it. Every callback fires, in registration
   * order, once; one registered after the exit is told at once.
   */
  onExit(cb: (info: { code: number | null; signal: string | null }) => void): void;
}
