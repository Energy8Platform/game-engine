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

/**
 * A multi-round chain, so every field of every step has a value that is
 * distinguishable from every other round's — the fixture above cannot tell
 * "round 1's cells" from "round 0's" because it only ever has one paying
 * round, and cannot tell `index: n` from `index: 0` for the same reason.
 *
 * That gap was measured, not imagined: emitting `winning: []`, `index: 0`
 * and `total: 0` unconditionally left all ten of this plugin's tests green.
 * Both of those fields are load-bearing at run time — `winning` is what the
 * legacy `ReelStepController` highlights and pays before the reels move,
 * `index` is what decelerates later rounds — so that mutation is a visible
 * defect on the board that nothing objected to. Same shape as the cascade
 * bug `engine/apps/web/tests/e2e/runtime.spec.ts` records having shipped:
 * a step list whose KINDS are right and whose CONTENT is wrong.
 */
const CHAIN = {
  grid: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  reel_steps: [
    {
      winning: [{ col: 0, row: 0 }],
      shifts: [1, 0],
      settled: [
        [7, 1, 2],
        [4, 5, 6],
      ],
      win: 0.5,
    },
    {
      winning: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
      shifts: [0, 2],
      settled: [
        [7, 1, 2],
        [8, 9, 4],
      ],
      win: 1.25,
    },
    {
      winning: [],
      shifts: [0, 0],
      settled: [
        [7, 1, 2],
        [8, 9, 4],
      ],
      win: 0,
    },
  ],
};

/** Every step of the plan, in order, as plain objects — content, not kinds. */
const chainSteps = () => plan(CHAIN);

describe('reel-step: what each step actually carries', () => {
  it('every reelStep carries its OWN round — cells, shifts, board and position', () => {
    const reelSteps = chainSteps().filter((s) => s.kind === 'reelStep');

    expect(reelSteps).toEqual([
      {
        kind: 'reelStep',
        winning: CHAIN.reel_steps[0].winning,
        shifts: [1, 0],
        settled: CHAIN.reel_steps[0].settled,
        index: 0,
      },
      {
        kind: 'reelStep',
        winning: CHAIN.reel_steps[1].winning,
        shifts: [0, 2],
        settled: CHAIN.reel_steps[1].settled,
        index: 1,
      },
    ]);
  });

  it('each reveal carries that round’s own payout, and comes before its step', () => {
    // `revealWins.total` is what the player watches add up for THIS round —
    // not the credited total, which no presentation step carries (see the
    // module doc in `@energy8engine/contracts`' `presentation.ts`).
    expect(chainSteps()).toEqual([
      { kind: 'spinTo', board: CHAIN.grid },
      { kind: 'revealWins', total: 0.5, lines: [] },
      expect.objectContaining({ kind: 'reelStep', index: 0 }),
      { kind: 'revealWins', total: 1.25, lines: [] },
      expect.objectContaining({ kind: 'reelStep', index: 1 }),
    ]);
  });

  it('a round the math gave no payout for still reveals a number, not undefined', () => {
    // `RevealWinsStep.total` is typed `number`, and `isPresentationStep`
    // rejects a `revealWins` whose total is not finite — so a chain with no
    // per-round figure (the brief's own fixture) must reveal 0, not leave
    // the field off and become a malformed step at execution time.
    const noWin = plan({
      grid: CHAIN.grid,
      reel_steps: [{ winning: [{ col: 0, row: 0 }], shifts: [1, 0], settled: CHAIN.grid }],
    });
    expect(noWin).toContainEqual({ kind: 'revealWins', total: 0, lines: [] });
  });

  it('a round that moves reels without paying still moves them, and reveals nothing', () => {
    // The second gate, stated as content: no reveal (nothing was paid), but
    // the reels must still be seen to move, or the board jumps to a
    // position the player never watched arrive.
    const moved = plan({
      grid: CHAIN.grid,
      reel_steps: [{ winning: [], shifts: [0, 2], settled: CHAIN.reel_steps[1].settled }],
    });
    expect(moved).toEqual([
      { kind: 'spinTo', board: CHAIN.grid },
      {
        kind: 'reelStep',
        winning: [],
        shifts: [0, 2],
        settled: CHAIN.reel_steps[1].settled,
        index: 0,
      },
    ]);
  });
});
