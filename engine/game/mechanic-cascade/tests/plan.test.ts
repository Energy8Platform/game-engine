import { describe, expect, it } from 'vitest';
import { expects, plan } from '../src/index';

/**
 * A two-round chain modeled on the shape a real cascade actually produces
 * (see `@energy8engine/session-dev`'s `SpinResult` doc for the measured
 * example this mirrors): `data.grid` is the pre-cascade board the reels
 * land on; each round's `removed` names cells on the board displayed WHEN
 * that round runs (round 0 against `data.grid`, round 1 against round 0's
 * own `grid`); each round's `grid` is that SAME round's post-collapse
 * board. Every board below is a distinct value on purpose — a fixture
 * where `data.grid` happened to equal `cascade_history[0].grid` (as the
 * original, buggy fixture did) cannot tell a correct reading apart from
 * one that is off by one round.
 */
const CHAIN = {
  grid: [[1, 2, 3]], // pre-cascade: the board the reels land on
  win: 1.5,
  base_win: 0.5,
  lines: [],
  cascade_history: [
    // round 0 clears the cell at (0,1) on `grid` above, then gravity
    // drops (0,0)'s old value down into (0,1) and refills (0,0).
    { grid: [[7, 1, 3]], removed: [{ col: 0, row: 1 }], win: 0.5 },
    // round 1 clears the cell at (0,0) on round 0's OWN board [[7,1,3]]
    // above (not on `data.grid`), then refills (0,0) again.
    { grid: [[9, 1, 3]], removed: [{ col: 0, row: 0 }], win: 1.0 },
  ],
};

// A round that clears cells without paying for them, followed by the
// terminal check. `win > 0` and `removed.length > 0` agree on every round
// in CHAIN — both true together — so no test built only from CHAIN can
// tell a single `win > 0` gate apart from a gate that also continues on
// `removed.length > 0`. This fixture pins both halves at once: the chain
// must still `remove`+`refill` (the round DID clear), but must not
// fabricate a `revealWins` for money that was never won. `round1.grid` is
// deliberately different from `round0.grid` so a refill-uses-the-wrong-
// round bug would be visible here too, even though this game (first-slot)
// never actually emits a terminal round like round 1.
const CLEARS_WITHOUT_PAYING = {
  grid: [[4, 5, 6]],
  win: 0,
  base_win: 0,
  lines: [],
  cascade_history: [
    { grid: [[8, 4, 6]], removed: [{ col: 0, row: 1 }], win: 0 },
    { grid: [[1, 1, 1]], removed: [], win: 0 },
  ],
};

// A single-round chain — this game's most common winning shape (no second
// cascade round at all). The bug this pins: the old (off-by-one)
// implementation refilled a round from the NEXT array entry, so a chain
// with no next entry never refilled — the exact "permanent hole in the
// board" symptom the finding describes.
const SINGLE_ROUND = {
  grid: [[3, 9, 2]],
  win: 2.0,
  base_win: 2.0,
  lines: [],
  cascade_history: [{ grid: [[5, 3, 2]], removed: [{ col: 0, row: 0 }], win: 2.0 }],
};

describe('cascade', () => {
  it("spins to the pre-cascade board (data.grid), not any round's post-collapse board", () => {
    expect(plan(CHAIN)[0]).toEqual({ kind: 'spinTo', board: CHAIN.grid });
  });

  it('spins to data.grid even when the chain has no rounds at all', () => {
    const noCascade = { ...CHAIN, cascade_history: [] };
    expect(plan(noCascade)).toEqual([{ kind: 'spinTo', board: CHAIN.grid }]);
  });

  it('spins to the first board, then reveals and collapses each paying round', () => {
    expect(plan(CHAIN).map((s) => s.kind)).toEqual([
      'spinTo',
      'revealWins',
      'remove',
      'refill',
      'revealWins',
      'remove',
      'refill',
    ]);
  });

  it("reveals each round's own win, with no line breakdown to give", () => {
    const reveals = plan(CHAIN).filter((s) => s.kind === 'revealWins') as {
      total: number;
      lines: unknown[];
    }[];
    expect(reveals.map((r) => r.total)).toEqual([0.5, 1.0]);
    expect(reveals.every((r) => r.lines.length === 0)).toBe(true);
  });

  it('removes exactly the cells that round measured, in round order', () => {
    const removes = plan(CHAIN).filter((s) => s.kind === 'remove') as { cells: unknown[] }[];
    expect(removes[0]).toEqual({ kind: 'remove', cells: [{ col: 0, row: 1 }] });
    expect(removes[1]).toEqual({ kind: 'remove', cells: [{ col: 0, row: 0 }] });
  });

  it("refills with THAT SAME round's own post-collapse board, not the round after it", () => {
    const refills = plan(CHAIN).filter((s) => s.kind === 'refill') as { board: number[][] }[];
    expect(refills[0].board).toEqual(CHAIN.cascade_history[0].grid);
    expect(refills[1].board).toEqual(CHAIN.cascade_history[1].grid);
  });

  it("refills a single-round chain — this game's most common winning shape must not be left with an unrefilled hole", () => {
    const steps = plan(SINGLE_ROUND);
    expect(steps.map((s) => s.kind)).toEqual(['spinTo', 'revealWins', 'remove', 'refill']);
    const refill = steps.find((s) => s.kind === 'refill') as { board: number[][] };
    expect(refill.board).toEqual(SINGLE_ROUND.cascade_history[0].grid);
  });

  it('stops at the first round that cleared nothing', () => {
    const one = { ...CHAIN, cascade_history: [{ grid: [[1]], removed: [], win: 0 }] };
    expect(plan(one).map((s) => s.kind)).toEqual(['spinTo']);
  });

  it('removes cells a round cleared without paying, but does not fabricate a reveal for them', () => {
    const steps = plan(CLEARS_WITHOUT_PAYING);
    expect(steps.map((s) => s.kind)).toEqual(['spinTo', 'remove', 'refill']);
    const removes = steps.filter((s) => s.kind === 'remove');
    expect(removes).toEqual([{ kind: 'remove', cells: [{ col: 0, row: 1 }] }]);
    const refill = steps.find((s) => s.kind === 'refill') as { board: number[][] };
    expect(refill.board).toEqual(CLEARS_WITHOUT_PAYING.cascade_history[0].grid);
  });

  it('declares that it needs the pre-cascade board and the chain', () => {
    expect(expects.fields).toEqual({ grid: 'grid', cascade_history: 'list' });
  });
});

/**
 * `options?.tumble` (slice 25 Task 2): each round becomes ONE `tumble` step
 * instead of `remove` + `refill` — the gravity-slide vocabulary those two
 * cannot express (see `TumbleStep`'s own doc in `@energy8engine/contracts`).
 *
 * `TUMBLE_CHAIN` is a 2×2 board (`Board` is `board[col][row]`) worked by
 * hand so a `col`/`row` swap in `fresh`'s derivation cannot hide: round 0
 * clears `(0,1)` — one cell, column 0 — and settles on `[[9,1],[3,4]]`
 * (col0 = `[9,1]`, col1 = `[3,4]`), so column 0's `fresh` is its OWN
 * post-collapse board's top ONE cell: `(0,0) → 9`. Round 1 then clears
 * BOTH cells of column 1 on round 0's own board, settling on
 * `[[9,1],[7,8]]`, so column 1's `fresh` is its top TWO cells: `(1,0) → 7`,
 * `(1,1) → 8`.
 */
const TUMBLE_CHAIN = {
  grid: [
    [1, 2],
    [3, 4],
  ],
  win: 8,
  base_win: 0,
  lines: [],
  cascade_history: [
    {
      grid: [
        [9, 1],
        [3, 4],
      ],
      removed: [{ col: 0, row: 1 }],
      win: 5,
    },
    {
      grid: [
        [9, 1],
        [7, 8],
      ],
      removed: [
        { col: 1, row: 0 },
        { col: 1, row: 1 },
      ],
      win: 3,
    },
  ],
};

describe('cascade — tumble', () => {
  it('replaces remove+refill with one tumble step per round', () => {
    expect(plan(TUMBLE_CHAIN, { tumble: true }).map((s) => s.kind)).toEqual([
      'spinTo',
      'revealWins',
      'tumble',
      'revealWins',
      'tumble',
    ]);
  });

  it('derives fresh as the top k cells of the settled board (k = removed cells in that column), winning mirrors removed, and drops is omitted', () => {
    const tumbles = plan(TUMBLE_CHAIN, { tumble: true }).filter((s) => s.kind === 'tumble');
    expect(tumbles).toEqual([
      {
        kind: 'tumble',
        winning: [{ col: 0, row: 1 }],
        removed: [{ col: 0, row: 1 }],
        fresh: [{ col: 0, row: 0, symbol: 9 }],
        settled: TUMBLE_CHAIN.cascade_history[0].grid,
      },
      {
        kind: 'tumble',
        winning: [
          { col: 1, row: 0 },
          { col: 1, row: 1 },
        ],
        removed: [
          { col: 1, row: 0 },
          { col: 1, row: 1 },
        ],
        fresh: [
          { col: 1, row: 0, symbol: 7 },
          { col: 1, row: 1, symbol: 8 },
        ],
        settled: TUMBLE_CHAIN.cascade_history[1].grid,
      },
    ]);
    expect(tumbles.every((s) => !('drops' in s))).toBe(true);
  });

  it("still reveals each round's own win — same totals as remove+refill — before its tumble", () => {
    const reveals = plan(TUMBLE_CHAIN, { tumble: true }).filter((s) => s.kind === 'revealWins') as {
      total: number;
    }[];
    expect(reveals.map((r) => r.total)).toEqual([5, 3]);
  });

  it('a round that clears without paying still tumbles, but fabricates no revealWins for it', () => {
    const steps = plan(CLEARS_WITHOUT_PAYING, { tumble: true });
    expect(steps.map((s) => s.kind)).toEqual(['spinTo', 'tumble']);
  });

  it('tumble: false, or no options at all, is unchanged — the old remove+refill plan', () => {
    expect(plan(TUMBLE_CHAIN, { tumble: false })).toEqual(plan(TUMBLE_CHAIN));
    expect(plan(TUMBLE_CHAIN).map((s) => s.kind)).toEqual([
      'spinTo',
      'revealWins',
      'remove',
      'refill',
      'revealWins',
      'remove',
      'refill',
    ]);
  });
});
