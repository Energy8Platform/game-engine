/**
 * The Energy8 platform's `PlayResultData` (`@energy8platform/game-sdk`)
 * turned into the seam's `SpinResult` (`@energy8engine/contracts`), by the
 * table in spec §3. Pure, and exported on its own so the table can be
 * tested row by row without a platform behind it.
 *
 * **Verified against the SDK's types, not a platform** (spec §10): every
 * reading below is what `types.ts`/`protocol.ts` promise, not what a real
 * launch was measured to send. Confirm on the first real launch.
 *
 * Units. `SpinResult` speaks in bet multipliers (`spin.ts`: that is what
 * e8-server's wire sends) and `withAmounts` (`session.ts`) turns them back
 * into money by `× bet`. The platform's `totalWin`/`session.totalWin` are
 * money (`DevBridge` credits `totalWin` straight onto the balance; a Lua
 * script returns `total_win = bet * 0.5`), so they are divided by `bet`
 * here — spec §3's table writes `totalWin = session?.totalWin ?? totalWin`
 * without the division, but read literally that puts money in a
 * multiplier field and `withAmounts` would hand the shell `money × bet`.
 * `data.win` is the game's own field: for a `.spin` game it is e8-server's
 * `data_json.win`, a multiplier already (the same field `spin.ts` lifts
 * `win` from), so it is taken as-is.
 *
 * `roundComplete` without a session is `true`, not "no next actions": on
 * every real host a COMPLETED round still carries the NEXT round's entry
 * actions in `nextActions` (e8's `next_actions: ['spin']`, `DevBridge`'s
 * default `nextActions ?? ['spin']`, Stake's `nextRoundActions`), so an
 * emptiness test would never hold and a flow's `if roundComplete → step`
 * loop would play paid rounds forever. No session ⇒ a single-action round
 * ⇒ complete; `nextActions` stays informational — the reading
 * `packages/game-engine/src/host/slotPlay.ts`'s `enrichRoundMeta` already
 * uses.
 *
 * | `SpinResult`     | from                                                          |
 * |------------------|---------------------------------------------------------------|
 * | `bet`            | `session.betAmount` when the host echoes the round's bet (Stake, Artube), else the bet this row sent |
 * | `win`            | `data.win` when numeric, else `totalWin / bet` (0 at bet 0)   |
 * | `totalWin`       | `(session?.totalWin ?? totalWin) / bet` (0 at bet 0)          |
 * | `stage`          | `data.stage` when a string, else the `action` that ran        |
 * | `data`           | `data` when a record, else `{}`                               |
 * | `vars`           | `data.vars` when a record, else `{}`                          |
 * | `nextActions`    | `nextActions`, `[]` when a host omits it                      |
 * | `roundComplete`  | `session.completed === true` with a session, else `true`      |
 * | `spinsRemaining` | `session.spinsRemaining`, 0 without a session                 |
 * | `spinsPlayed`    | `session.spinsPlayed`, 0 without a session                    |
 * | `balance`        | `balanceAfter`                                                |
 * | `roundId`        | `roundId`                                                     |
 * | `scriptSha256`   | `''` — the platform names no script hash                      |
 */
import type { SpinResult } from '@energy8engine/contracts';
import type { PlayResultData } from '@energy8platform/game-sdk';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `requestBet` is the `PlayParams.bet` this row sent — the round's bet unless the host echoes a different one. */
export function normalise(raw: PlayResultData, requestBet: number): SpinResult {
  const data = isRecord(raw.data) ? raw.data : {};
  const bet = raw.session?.betAmount ?? requestBet;
  const perBet = (money: number) => (bet > 0 ? money / bet : 0);
  return {
    bet,
    win: typeof data.win === 'number' ? data.win : perBet(raw.totalWin),
    totalWin: perBet(raw.session?.totalWin ?? raw.totalWin),
    stage: typeof data.stage === 'string' ? data.stage : raw.action,
    data,
    vars: isRecord(data.vars) ? data.vars : {},
    nextActions: raw.nextActions ?? [],
    roundComplete: raw.session ? raw.session.completed === true : true,
    spinsRemaining: raw.session?.spinsRemaining ?? 0,
    spinsPlayed: raw.session?.spinsPlayed ?? 0,
    scriptSha256: '',
    roundId: raw.roundId,
    balance: raw.balanceAfter,
  };
}
