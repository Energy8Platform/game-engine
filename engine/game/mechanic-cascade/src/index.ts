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
 * `grid`/`win`/`base_win`/`lines` at the top level are `classic`'s fields
 * (the base-game board and its line wins); `cascade` ignores them entirely
 * and reads only `cascade_history`, so `expects` declares nothing else.
 *
 * One round's `grid` becomes the NEXT round's `refill.board` — the round
 * that just cleared does not refill itself, it hands its board to the
 * round after it. A chain's last entry is therefore a "terminal check":
 * a round with nothing removed and nothing won, whose only job is to
 * supply the refill board for the round before it and signal "stop here."
 *
 * Two decisions per round, not one:
 *   - Whether to REVEAL: gated on `round.win > 0`, transferring `classic`'s
 *     reasoning verbatim — the money-bearing field is the total, and a
 *     real win must never be silently dropped from the presentation, even
 *     one that (per the terminal-check shape above) cleared nothing.
 *   - Whether to CONTINUE the chain (remove + advance to the next round):
 *     gated on `round.win > 0 || round.removed.length > 0`. `classic` never
 *     needed this second gate because it has one reveal-or-stop decision,
 *     full stop; `cascade` chains, so "did this round change the board"
 *     and "did this round pay" are no longer the same question. Gating
 *     continuation on `win` alone would strand a round that cleared cells
 *     without paying (conceivable — e.g. a collector-style removal) with
 *     those cells never removed and the chain truncated early; gating
 *     reveal on `removed.length` alone would let a paying-but-clearing-
 *     nothing final round go unrevealed. Each gate answers its own
 *     question with the field that question is actually about.
 */
import type {
  Board,
  Cell,
  PresentationPlan,
  SpinMechanic,
  SpinShapeRequirement,
} from '@energy8engine/contracts';

/** One measured round of the chain: the board it left behind, the cells it cleared, and its own win. */
export interface CascadeRound {
  grid: Board;
  removed: Cell[];
  win: number;
}

/** The measured stage data `cascade` is handed; other fields (e.g. `grid`, `lines`) are ignored — those are `classic`'s. */
export interface CascadeSpinData {
  cascade_history: CascadeRound[];
}

/** `cascade` needs only the chain — nothing about the top-level board or line breakdown. */
export const expects: SpinShapeRequirement = {
  fields: { cascade_history: 'list' },
};

/**
 * Spin to the first round's board, then walk the chain: reveal a round's
 * win when it has one, remove what it cleared, and refill with the next
 * round's board — stopping at the first round that neither paid nor
 * cleared anything (see the module doc above for why those are two
 * separate gates).
 */
export function plan(data: CascadeSpinData): PresentationPlan {
  const rounds = data.cascade_history;
  if (rounds.length === 0) return [];

  const steps: PresentationPlan = [{ kind: 'spinTo', board: rounds[0].grid }];

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const cleared = round.win > 0 || round.removed.length > 0;
    if (!cleared) break;

    if (round.win > 0) {
      steps.push({ kind: 'revealWins', total: round.win, lines: [] });
    }
    steps.push({ kind: 'remove', cells: round.removed });

    const next = rounds[i + 1];
    if (!next) break;
    steps.push({ kind: 'refill', board: next.grid });
  }

  return steps;
}

/** The registration bundle for Task 6's mechanic registry; tests call `plan` directly until then. */
export const mechanic: SpinMechanic = {
  id: 'cascade',
  requires: expects,
  present: (data) => plan(data as CascadeSpinData),
};
