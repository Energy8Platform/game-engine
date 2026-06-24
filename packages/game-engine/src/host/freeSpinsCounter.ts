/**
 * Free-spins counter for the shell readout (current / total / totalWin), with RETRIGGER support.
 *
 * A bonus awards an initial pool of spins; a retrigger mid-bonus awards MORE. The full-event book
 * already contains every segment (incl. retriggered spins), but the player-facing counter must grow
 * dynamically: start at the awarded total, and each spin that awards extra bumps the total. The
 * remaining spins the shell shows are `total - current`.
 *
 * Example (the canonical case): enter(10) → 0/10. After two spins → 2/10. The third spin retriggers
 * +5 → 3/15 (i.e. 12 remaining). `awarded` per spin is the spins granted by THAT spin (0 normally,
 * the retrigger amount on a retrigger). Pure + unit-testable; the host feeds it `result.freeSpins`.
 */
export interface FreeSpinsView {
  /** Free spins played so far (1-based once spinning). */
  current: number;
  /** Total free spins awarded so far (initial + every retrigger). */
  total: number;
  /** Cumulative bonus win (the host passes the round's cumulative totalWin). */
  totalWin: number;
}

export interface FreeSpinsCounter {
  /** Bonus start: seed the total with the trigger's awarded spins. Resets current + totalWin. */
  enter(awarded: number): FreeSpinsView;
  /** One free spin presented: count it, fold in any retrigger `awarded`, carry the cumulative win. */
  spin(awarded: number, totalWin: number): FreeSpinsView;
}

export function createFreeSpinsCounter(): FreeSpinsCounter {
  let total = 0;
  let current = 0;
  return {
    enter(awarded: number): FreeSpinsView {
      total = awarded;
      current = 0;
      return { current, total, totalWin: 0 };
    },
    spin(awarded: number, totalWin: number): FreeSpinsView {
      current += 1;
      total += awarded; // a retrigger grows the pool
      return { current, total, totalWin };
    },
  };
}
