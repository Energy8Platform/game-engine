/**
 * `cascade`: a spin is a chain of rounds, each collapsing into the next.
 *
 * The math measures the chain as `cascade_history: [{ grid, removed, win }, …]`
 * with no per-round line breakdown — unlike `classic`'s `lines`, there is
 * no equivalent field here at all. That is exactly the shape `RevealWinsStep`
 * documents as legal ("empty when the math gives no per-line breakdown for
 * this reveal"), so every reveal this mechanic emits carries `lines: []`;
 * it is not a workaround, it is the case the vocabulary was built for.
 *
 * `win`/`base_win`/`lines` at the top level are `classic`'s fields (the
 * base-game line breakdown); `cascade` ignores those. `grid`, though, is
 * NOT classic-only: it is the board the reels land on BEFORE any round of
 * the chain runs, and no entry in `cascade_history` carries that board —
 * see below — so `cascade` reads it too, and `expects` declares it.
 *
 * Each `CascadeRound` is self-contained, not a pointer into its neighbour:
 * `round.removed` names cells on the board as it is displayed WHEN that
 * round runs (`data.grid` for round 0, the previous round's own `grid` for
 * every round after), and `round.grid` is that SAME round's board AFTER
 * its own clear + gravity + refill — i.e. `round.grid` is the refill board
 * for `round.removed`, not for the round after it. (Verified against a
 * real measured spin, not assumed: `@energy8engine/session-dev`'s
 * `SpinResult` doc carries one, and every cell `cascade_history[0].removed`
 * names sits inside `data.grid`'s matching payline, while
 * `cascade_history[0].grid` is the board with exactly those cells replaced
 * by gravity-shifted/refilled values — never `cascade_history[1].grid`,
 * which is a full round further along.) A chain therefore has no
 * "terminal check" entry at all in this game — `first-slot`'s `.spin`
 * breaks its loop the moment a round pays and clears nothing further,
 * without ever pushing that empty round — but the shape below still
 * tolerates a game that does emit one (see the second gate below).
 *
 * Two decisions per round, not one:
 *   - Whether to REVEAL: gated on `round.win > 0`, transferring `classic`'s
 *     reasoning verbatim — the money-bearing field is the total, and a
 *     real win must never be silently dropped from the presentation, even
 *     one that (per a hypothetical terminal round) cleared nothing.
 *   - Whether to CONTINUE the chain (remove + refill + advance): gated on
 *     `round.win > 0 || round.removed.length > 0`. `classic` never needed
 *     this second gate because it has one reveal-or-stop decision, full
 *     stop; `cascade` chains, so "did this round change the board" and
 *     "did this round pay" are no longer the same question. Gating
 *     continuation on `win` alone would strand a round that cleared cells
 *     without paying (conceivable — e.g. a collector-style removal) with
 *     those cells never removed and the chain truncated early; gating
 *     reveal on `removed.length` alone would let a paying-but-clearing-
 *     nothing final round go unrevealed. Each gate answers its own
 *     question with the field that question is actually about.
 */
import type {
  CascadeRound,
  CascadeStageData,
  PresentationPlan,
  SpinMechanic,
  SpinShapeRequirement,
  TumbleStep,
} from '@energy8engine/contracts';

// `CascadeRound` is `@energy8engine/contracts`' own type — re-exported
// under this package's established name since the module doc above (and
// its consumers) refer to it by that name.
export type { CascadeRound } from '@energy8engine/contracts';

/**
 * The measured stage data `cascade` is handed. This is
 * `@energy8engine/contracts`' `CascadeStageData` — the normative
 * field-naming convention this mechanic relies on — under the name tests
 * and callers here already use. See that type's own doc for `grid`'s and
 * `cascade_history`'s exact relationship (round-by-round before/after).
 */
export type CascadeSpinData = CascadeStageData;

/** `cascade` needs the pre-cascade board to spin to, plus the chain. */
export const expects: SpinShapeRequirement = {
  fields: { grid: 'grid', cascade_history: 'list' },
};

/**
 * `TumbleStep.fresh` for one round: what drops in from above, per column.
 * Gravity drops survivors to the bottom and fills the vacated rows from the
 * top — `deriveDrops` in `@energy8engine/reel-core`'s `TumbleController`
 * is the animation built on exactly that assumption (row 0 is the top of a
 * `Board` column) — so the fresh symbols for a column are the top *k* cells
 * of `round.grid` (the round's own post-collapse board), where *k* is how
 * many cells `round.removed` named in that column. A column `removed` never
 * touched gets no fresh cells at all: nothing dropped there.
 */
function tumbleFresh(round: CascadeRound): TumbleStep['fresh'] {
  const removedPerCol = new Map<number, number>();
  for (const cell of round.removed) {
    removedPerCol.set(cell.col, (removedPerCol.get(cell.col) ?? 0) + 1);
  }
  const fresh: TumbleStep['fresh'] = [];
  for (const [col, count] of removedPerCol) {
    for (let row = 0; row < count; row++) {
      fresh.push({ col, row, symbol: round.grid[col][row] });
    }
  }
  return fresh;
}

/**
 * Spin to the pre-cascade board, then walk the chain: reveal a round's win
 * when it has one, and collapse what it cleared — stopping at the first
 * round that neither paid nor cleared anything (see the module doc above
 * for why those are two separate gates, and why the refill/settled board is
 * the round's own rather than the next round's).
 *
 * `options?.tumble` swaps HOW a round collapses, not whether: `remove` +
 * `refill` (two teleports) becomes one `tumble` (the gravity slide `remove`
 * + `refill` cannot express at all — see `TumbleStep`'s own doc in
 * `@energy8engine/contracts`). `winning` is the same cells as `removed` —
 * this mechanic has no separate "cells that merely light up" set, unlike a
 * collector feature might — and `drops` stays omitted so the board derives
 * the slide from `removed` by gravity, the ordinary column-collapse case
 * this mechanic is.
 */
export function plan(data: CascadeSpinData, options?: { tumble?: boolean }): PresentationPlan {
  const steps: PresentationPlan = [{ kind: 'spinTo', board: data.grid }];

  for (const round of data.cascade_history) {
    const cleared = round.win > 0 || round.removed.length > 0;
    if (!cleared) break;

    if (round.win > 0) {
      steps.push({ kind: 'revealWins', total: round.win, lines: [] });
    }
    if (options?.tumble) {
      steps.push({
        kind: 'tumble',
        winning: round.removed,
        removed: round.removed,
        fresh: tumbleFresh(round),
        settled: round.grid,
      });
    } else {
      steps.push({ kind: 'remove', cells: round.removed });
      steps.push({ kind: 'refill', board: round.grid });
    }
  }

  return steps;
}

/** The registration bundle for Task 6's mechanic registry; tests call `plan` directly until then. */
export const mechanic: SpinMechanic = {
  id: 'cascade',
  requires: expects,
  present: (data, options) => plan(data as CascadeSpinData, options),
};
