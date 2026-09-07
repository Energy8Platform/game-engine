import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startE8Server, type E8Handle, type SpinResult } from '../src/e8server';

// e8-server's --games-dir is NOT recursive — it must point directly at the
// folder holding the .spin file(s), not an ancestor of it (measured: pointed
// at the game's root instead of its `game/` subdir, e8-server loaded zero
// games and every play() rejected with 'unknown game "first-slot" (loaded: )').
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

let e8: E8Handle;
beforeAll(async () => {
  e8 = await startE8Server({ gamesDir: GAME, port: 0 });
}, 30_000);
afterAll(async () => {
  await e8?.stop();
});

/** One ordinary spin. Named because the `reel_steps` shape tests below read
 *  the same request four times over and the request itself says nothing. */
async function play(): Promise<SpinResult> {
  return e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
}

/** A cell as every position-bearing field names one (`lines[].positions`,
 *  `cascade_history[].removed`, `reel_steps[].winning`). */
interface Pos {
  col: number;
  row: number;
}

/** Set-membership key for a cell — the three forms list the same cells in
 *  their own orders, so comparing them means comparing sets, not arrays. */
const at = (p: Pos) => `${p.col}:${p.row}`;

/** RTP isn't tuned in this task, so a winning spin isn't guaranteed on the
 *  first draw — spin until `predicate` matches, or fail loudly instead of
 *  hanging past the suite's timeout. */
async function spinUntil(
  predicate: (r: SpinResult) => boolean,
  maxAttempts = 1000,
): Promise<SpinResult> {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    if (predicate(r)) return r;
  }
  throw new Error(`spinUntil: predicate never matched in ${maxAttempts} spins`);
}

describe('a real spin through e8-server', () => {
  it('returns a 5x3 grid of symbol ids', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(result.stage).toBe('base_game');
    expect(result.data.grid).toHaveLength(5);
    expect(result.data.grid[0]).toHaveLength(3);
    for (const col of result.data.grid) {
      for (const cell of col) expect(typeof cell).toBe('number');
    }
  });

  it('reports a win as a bet multiplier', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(typeof result.data.win).toBe('number');
    expect(result.data.win).toBeGreaterThanOrEqual(0);
  });

  it('gives different grids across spins', async () => {
    const a = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    const b = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(JSON.stringify(a.data.grid)).not.toBe(JSON.stringify(b.data.grid));
  });

  it('stops cleanly — the port is released', async () => {
    const handle = await startE8Server({ gamesDir: GAME, port: 0 });
    const port = handle.port;
    await handle.stop();
    const second = await startE8Server({ gamesDir: GAME, port });
    expect(second.port).toBe(port);
    await second.stop();
  });

  it('does not leave a proto tempdir behind', async () => {
    // The gRPC client's proto is loaded from a mkdtempSync'd directory
    // under os.tmpdir() (see grpcClient in e8server.ts) — it used to be
    // removed nowhere, so every startE8Server() call left a
    // /tmp/e8proto-* directory behind forever. The dir is cleaned up
    // synchronously, right after the proto is loaded — well before
    // startE8Server() even returns — so this doesn't need to wait on
    // stop() at all; two full start/stop cycles must leave the same set
    // of e8proto-* entries in tmpdir() as before either ran.
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('e8proto-'));

    const a = await startE8Server({ gamesDir: GAME, port: 0 });
    await a.stop();
    const b = await startE8Server({ gamesDir: GAME, port: 0 });
    await b.stop();

    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('e8proto-'));
    expect(after).toEqual(before);
  });
});

// Rulings from the brief: (1) stage data must include the winning LINES, not
// just grid+win; (2) stage data must ALSO include a cascade-shaped chain of
// steps, each carrying its board, its removed cells and its win. These tests
// pin the STRUCTURE of both — not just that the fields exist — so a
// regression that empties or malforms either shape fails loudly.
describe('data.lines — ruling 1: reveal the wins, not just grid + win', () => {
  it('a line entry carries the fields a mechanic reads: which row, which symbol, how many, how much, and where', async () => {
    const result = await spinUntil((r) => r.data.lines.length > 0);
    const line = result.data.lines[0];

    expect(typeof line.line).toBe('number');
    expect(typeof line.symbol).toBe('number');
    expect(typeof line.count).toBe('number');
    expect(line.count).toBeGreaterThanOrEqual(3);
    expect(typeof line.win).toBe('number');
    expect(line.win).toBeGreaterThan(0);

    expect(Array.isArray(line.positions)).toBe(true);
    expect(line.positions).toHaveLength(line.count);
    for (const p of line.positions) {
      expect(typeof p.col).toBe('number');
      expect(typeof p.row).toBe('number');
    }
  });
});

describe('data.cascade_history — ruling 2: a cascade-shaped chain of steps', () => {
  it('a step carries the board after it, the cells removed, and that step\'s win', async () => {
    const result = await spinUntil((r) => r.data.cascade_history.length > 0);
    const step = result.data.cascade_history[0];

    // the board after the step: same 5x3 shape as the top-level grid
    expect(step.grid).toHaveLength(5);
    expect(step.grid[0]).toHaveLength(3);
    for (const col of step.grid) {
      for (const cell of col) expect(typeof cell).toBe('number');
    }

    // the cells removed that round — non-empty whenever the step exists at all
    expect(Array.isArray(step.removed)).toBe(true);
    expect(step.removed.length).toBeGreaterThan(0);
    for (const p of step.removed) {
      expect(typeof p.col).toBe('number');
      expect(typeof p.row).toBe('number');
    }

    // that step's own win
    expect(typeof step.win).toBe('number');
    expect(step.win).toBeGreaterThan(0);
  });
});

// The coordinator's correction: "the mechanic renders, the math pays" — win
// (== data.win, cascade-inclusive, what the server actually credits) must
// never be confused with base_win (round-0-only, what a `classic` mechanic
// would reveal alongside `lines`). Pin both halves of that invariant.
describe('data.win vs data.base_win — the mechanic renders, the math pays', () => {
  it('base_win is exactly the sum of the revealed lines', async () => {
    const result = await spinUntil((r) => r.data.lines.length > 0);
    const sumLines = result.data.lines.reduce((total: number, l: any) => total + l.win, 0);
    expect(result.data.base_win).toBeCloseTo(sumLines, 10);
  });

  it('win sums every cascade round; base_win only round 0 — they diverge once a cascade retriggers', async () => {
    const result = await spinUntil((r) => r.data.cascade_history.length >= 2);
    const sumSteps = result.data.cascade_history.reduce((total: number, s: any) => total + s.win, 0);
    expect(result.data.win).toBeCloseTo(sumSteps, 10);
    // the whole point of the invariant: once there's a second cascade round,
    // the credited total is strictly more than what `lines`/`base_win` alone
    // would show a player under a `classic` presentation.
    expect(result.data.win).toBeGreaterThan(result.data.base_win);
  });
});

// Ruling 3: the SAME spin, told a third way. A ReelStep round pays its
// winning cells and then scrolls every reel DOWN by its own count of them —
// nothing is removed, the symbols ride down and fresh ones enter from the
// top. That is a different board rule from the tumble `cascade_history`
// records, so it is a different chain over the same landed board, not a
// re-labelling of the one already there. These tests pin its STRUCTURE
// (shape per step) and its BOARD RULE (what `settled` must be), because a
// `reel_steps` that quietly carried tumbled boards would satisfy every
// shape assertion and still make the mechanic that reads it render a lie.
describe('data.reel_steps — ruling 3: the same spin under the ReelStep rule', () => {
  it('a spin carries all three shapes of the same result', async () => {
    const r = await play();
    expect(Array.isArray(r.data.lines)).toBe(true);
    expect(Array.isArray(r.data.cascade_history)).toBe(true);
    expect(Array.isArray(r.data.reel_steps)).toBe(true);
  });

  it('every reel step shifts as many reels as the grid has columns', async () => {
    const r = await play();
    for (const s of r.data.reel_steps) expect(s.shifts).toHaveLength(r.data.grid.length);
  });

  it('a reel step settles onto a board of the same shape as the grid', async () => {
    const r = await play();
    for (const s of r.data.reel_steps) {
      expect(s.settled).toHaveLength(r.data.grid.length);
      expect(s.settled[0]).toHaveLength(r.data.grid[0].length);
    }
  });

  // The three above iterate `reel_steps`, and a losing spin's is empty — they
  // pass on a spin that has no chain at all without ever looking at a step.
  // This one runs the same checks against a spin that actually chained, so
  // "the field is there but always empty" cannot pass as "the field works".
  it('a step of a spin that actually chained carries its winning cells, a shift per reel, and a settled board', async () => {
    const r = await spinUntil((s) => s.data.reel_steps.length > 0);
    for (const s of r.data.reel_steps) {
      expect(s.shifts).toHaveLength(r.data.grid.length);
      expect(s.settled).toHaveLength(r.data.grid.length);
      for (const col of s.settled) expect(col).toHaveLength(r.data.grid[0].length);

      expect(Array.isArray(s.winning)).toBe(true);
      expect(s.winning.length).toBeGreaterThan(0);
      for (const p of s.winning) {
        expect(typeof p.col).toBe('number');
        expect(typeof p.row).toBe('number');
      }
      expect(typeof s.win).toBe('number');
      expect(s.win).toBeGreaterThan(0);
    }
  });

  // Asks for a spin where some reel took TWO winning cells (two paying rows
  // crossing the same reel) — measured, again, rather than tidied: with any
  // old winning spin, almost every shift is 0 or 1, and capping the reported
  // shift at 1 was run as a mutation and passed unnoticed. A shift of 2 is
  // the smallest case that tells "one per winning cell" apart from "one if
  // the reel won at all", so that is the spin this asks for. It costs ~150
  // spins on average; the assertion still runs over every step of it.
  it('a reel scrolls down once per winning cell that landed on it, not once per winning reel', async () => {
    // Predicated on `winning`, not on `shifts`: `shifts` is the field under
    // test, and a predicate that reads it would simply never match the very
    // mutation this test exists to catch.
    const r = await spinUntil((s) =>
      s.data.reel_steps.some((step: { winning: Pos[] }) =>
        step.winning.some((p) => step.winning.filter((q) => q.col === p.col).length >= 2),
      ),
    );
    for (const s of r.data.reel_steps) {
      const perReel = s.shifts.map(
        (_: number, col: number) => s.winning.filter((p: Pos) => p.col === col).length,
      );
      expect(s.shifts).toEqual(perReel);
    }
  });

  // The board rule itself, and the one check a tumbled board cannot pass:
  // after a reel scrolls down by `shift`, the symbol at row `r` is the one
  // that was at row `r - shift` on the board the step ran against. Only the
  // top `shift` cells of a reel are new.
  //
  // The predicate is not "any spin with a chain", and that is measured, not
  // fastidiousness: when every winning cell of a step sits on the BOTTOM row
  // of its reel, a tumble (remove, compact, refill the top) and a scroll
  // produce the identical board, so such a spin passes this check under
  // either rule. Filling `settled` with tumbled boards was run as a
  // mutation and slipped through exactly that way. So the spin this asks
  // for is one where a winning cell sits above the bottom row — the case
  // where the two rules genuinely disagree about where a surviving symbol
  // ends up.
  it('a reel step scrolls: the symbols ride down by that reel\'s own shift, and only the top `shift` cells are new', async () => {
    const r = await spinUntil((s) => {
      const bottom = s.data.grid[0].length - 1;
      return s.data.reel_steps.some((step: { winning: Pos[] }) =>
        step.winning.some((p) => p.row < bottom),
      );
    });
    let before: number[][] = r.data.grid;
    for (const s of r.data.reel_steps) {
      s.settled.forEach((col: number[], c: number) => {
        const shift: number = s.shifts[c];
        for (let row = shift; row < col.length; row += 1) {
          expect(col[row]).toBe(before[c][row - shift]);
        }
      });
      before = s.settled;
    }
  });
});

// The invariant that keeps a THIRD view of one spin from quietly disagreeing
// with the other two — the defect that cost a round in an earlier slice. See
// the `reel_steps` paragraph in `src/types.ts` for the statement these pin.
describe('data.reel_steps vs data.win — three forms, one spin, one shared round 0', () => {
  it('round 0 is the board all three forms see: the same cells, for the same base_win', async () => {
    const r = await spinUntil((s) => s.data.lines.length > 0);
    const first = r.data.reel_steps[0];

    // the money: round 0 pays the same in every telling of it
    const sumLines = r.data.lines.reduce((total: number, l: { win: number }) => total + l.win, 0);
    expect(r.data.base_win).toBeCloseTo(sumLines, 10);
    expect(first.win).toBeCloseTo(r.data.base_win, 10);
    expect(r.data.cascade_history[0].win).toBeCloseTo(r.data.base_win, 10);

    // the cells: the same set, however each form happens to order them
    const fromLines = new Set(
      r.data.lines.flatMap((l: { positions: Pos[] }) => l.positions).map(at),
    );
    expect(new Set(first.winning.map(at))).toEqual(fromLines);
    expect(new Set(r.data.cascade_history[0].removed.map(at))).toEqual(fromLines);
  });

  it('a spin has a reel chain exactly when it paid at all', async () => {
    for (let i = 0; i < 30; i += 1) {
      const r = await play();
      expect(r.data.reel_steps.length > 0).toBe(r.data.win > 0);
      expect(r.data.reel_steps.length > 0).toBe(r.data.lines.length > 0);
    }
  });

  it('the chain total is its own number and is never below the round it shares with the others', async () => {
    const r = await spinUntil((s) => s.data.reel_steps.length > 0);
    const chain = r.data.reel_steps.reduce((total: number, s: { win: number }) => total + s.win, 0);
    // Every recorded step paid something, so the chain total can only be
    // base_win (a one-round chain) or more — never less. What it is NOT is
    // the credited figure: `win` sums the TUMBLE's rounds, and from round 1
    // on the two chains are looking at different boards. See src/types.ts.
    expect(chain).toBeGreaterThanOrEqual(r.data.base_win - 1e-10);
    expect(r.data.win).toBeCloseTo(
      r.data.cascade_history.reduce((total: number, s: { win: number }) => total + s.win, 0),
      10,
    );
  });
});

// Part 3 of the invariant — "sum(reel_steps[].win) is that chain's own
// total and is NOT the credited figure" — was, until these tests, the
// loudest sentence in `src/types.ts` and the one nothing would have noticed
// losing. Measured: rewrite `reel_chain` to tumble instead of scroll and
// `reel_steps` collapses into `cascade_history`, part 3 becomes false, and
// exactly ONE test fails — the board-shape one, which is about geometry,
// not money. The board rule was protecting the money claim by accident.
//
// So the money claim gets its own checks.
//
// One candidate was written and then DELETED rather than kept: "the reel
// chain is not the tumble chain retold", comparing the two chains' boards
// per spin. It passed under the tumble mutation — for a reason that has
// nothing to do with the rule. `reel_chain` runs after the tumble loop and
// draws its own refills, so the two chains' boards differ by random symbols
// whether or not they follow the same rule. A test that green-lights the
// mutation it was written to catch is worse than no test; what actually
// pins the RULE is the scroll test above, and what pins the MONEY is
// below.
describe('data.reel_steps vs data.win — part 3, the claim that costs money to get wrong', () => {
  it('a chain that ran more than one round pays strictly more than round 0', async () => {
    // Deterministic, per spin: every recorded round paid something (the
    // math never records a round that did not), so a second round can only
    // add. This is what "never below base_win" means when there is actually
    // something above it — an accounting change that dropped later rounds'
    // payouts, or zeroed them, fails here rather than in a comment.
    const r = await spinUntil((s) => s.data.reel_steps.length >= 2);
    const chain = r.data.reel_steps.reduce((total: number, s: { win: number }) => total + s.win, 0);
    for (const step of r.data.reel_steps) expect(step.win).toBeGreaterThan(0);
    expect(chain).toBeGreaterThan(r.data.base_win);
    expect(r.data.reel_steps[0].win).toBeCloseTo(r.data.base_win, 10);
  });

  it('the chain total and the credited win diverge, and not rarely', async () => {
    // The half no single spin can show. Over a sample the two totals must
    // disagree on a large fraction of paying spins — measured at ~70% for
    // this math. A `reel_chain` that merely retold the tumble drops that to
    // ~6%, so the threshold sits far from both: with ~80 paying spins in
    // 600, an observed 0.70 sits ~7 standard deviations above 0.35 and an
    // observed 0.06 sits ~9 below it. This is a claim about a distribution,
    // and it is checked as one.
    let paid = 0;
    let diverged = 0;
    for (let i = 0; i < 600; i += 1) {
      const r = await play();
      if (r.data.reel_steps.length === 0) continue;
      paid += 1;
      const chain = r.data.reel_steps.reduce(
        (total: number, s: { win: number }) => total + s.win,
        0,
      );
      // Never below the round every form shares, on every paying spin —
      // not just on the one `spinUntil` happened to find.
      expect(chain).toBeGreaterThanOrEqual(r.data.base_win - 1e-10);
      if (Math.abs(chain - r.data.win) > 1e-9) diverged += 1;
    }

    expect(paid).toBeGreaterThan(30);
    expect(diverged / paid).toBeGreaterThan(0.35);
  }, 60_000);
});
