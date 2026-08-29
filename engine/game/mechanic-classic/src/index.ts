/**
 * `classic`: a spin is a board and the base-game lines on it.
 *
 * The mechanic renders, the math pays. `revealWins.total` here is
 * `base_win` — the amount THIS reveal accounts for — never the credited
 * `win`/`totalWin`, which the host reports from the spin result directly
 * and no presentation step carries (see the module doc in
 * `@energy8engine/contracts/presentation`).
 *
 * `cascade_history` is read by the `cascade` mechanic instead; `classic`
 * ignores it entirely so switching mechanics on the same stage data
 * changes only how the result is presented, not what data each reads.
 */
import type {
  PresentationPlan,
  RevealedLine,
  SpinShapeRequirement,
  SpinMechanic,
} from '@energy8engine/contracts';

/** The measured stage data `classic` is handed; other fields (e.g. `cascade_history`) are ignored. */
export interface ClassicSpinData {
  grid: number[][];
  base_win: number;
  lines: RevealedLine[];
}

/** `classic` needs the grid, the base-game payout, and the line breakdown — nothing else. */
export const expects: SpinShapeRequirement = {
  fields: { grid: 'grid', base_win: 'number', lines: 'list' },
};

/**
 * Spin to the given board, then reveal the base-game lines — skipped
 * entirely when nothing won, since a `revealWins` step for zero lines and
 * zero total would just be a wasted beat.
 */
export function plan(data: ClassicSpinData): PresentationPlan {
  const steps: PresentationPlan = [{ kind: 'spinTo', board: data.grid }];

  if (data.lines.length > 0) {
    steps.push({ kind: 'revealWins', total: data.base_win, lines: data.lines });
  }

  return steps;
}

/** The registration bundle for Task 6's mechanic registry; tests call `plan` directly until then. */
export const mechanic: SpinMechanic = {
  id: 'classic',
  requires: expects,
  present: (data) => plan(data as ClassicSpinData),
};
