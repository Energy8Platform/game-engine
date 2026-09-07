import { describe, expect, it } from 'vitest';
import { plan } from '../src/mechanic';

// The brief's fixture, verbatim: two reels, three rows, one paying step
// followed by a step that neither pays nor shifts. Note what it does NOT
// carry — a per-step `win`. The real math emits one (see `first-slot`'s
// `.spin`), but this mechanic never reads it: what to draw is decided by the
// cells that won and the reels that moved, and the money is the play loop's
// business, not a presentation's.
const DATA = {
  grid: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  reel_steps: [
    { winning: [{ col: 0, row: 0 }], shifts: [1, 0], settled: [[7, 1, 2], [4, 5, 6]] },
    { winning: [], shifts: [0, 0], settled: [[7, 1, 2], [4, 5, 6]] },
  ],
};

describe('reel-step: one spin result becomes a presentation plan', () => {
  it('lands the reels, then walks the steps', () => {
    expect(plan(DATA).map((s) => s.kind)).toEqual(['spinTo', 'revealWins', 'reelStep']);
  });

  it('the reelStep step carries the shifts and the settled board', () => {
    const step = plan(DATA).find((s) => s.kind === 'reelStep')!;
    expect(step).toMatchObject({ shifts: [1, 0], settled: DATA.reel_steps[0].settled });
  });

  it('stops at a step that neither pays nor shifts', () => {
    // The second entry moves nothing and wins nothing — the chain is over.
    expect(plan(DATA).filter((s) => s.kind === 'reelStep')).toHaveLength(1);
  });

  it('a spin with no reel steps is just the landing', () => {
    expect(plan({ ...DATA, reel_steps: [] }).map((s) => s.kind)).toEqual(['spinTo']);
  });
});
