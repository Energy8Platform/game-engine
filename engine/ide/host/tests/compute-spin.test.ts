import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { diagnostic, type Diagnostic, type SpinResult } from '@energy8engine/contracts';
import {
  MAX_STEPS_PER_ROUND,
  percentiles,
  playRounds,
  spin,
  summarise,
  type PlaySpin,
} from '../src/compute';

const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');
// The smallest game whose round does NOT complete on the first response —
// see its own doc comment. Plain files (spec.json, script.spin), same shape
// as `GAME` above: both play the role of a project's `game/` directory and
// are copied into one, never used as a cwd directly.
const SESSION_GAME = join(
  __dirname,
  '..',
  '..',
  '..',
  'game',
  'session-dev',
  'tests',
  'fixtures',
  'session',
);

// A copy, not the example itself: its path is unique, so `e8Servers()` can
// count exactly the processes THIS file spawned and no other suite's.
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'e8-spin-')));
cpSync(GAME, join(cwd, 'game'), { recursive: true });
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const sessionCwd = realpathSync(mkdtempSync(join(tmpdir(), 'e8-spin-session-')));
cpSync(SESSION_GAME, join(sessionCwd, 'game'), { recursive: true });
afterAll(() => rmSync(sessionCwd, { recursive: true, force: true }));

/** A one-response, already-complete round — `first-slot`'s shape, with only what a test reads varied. */
function result(win: number, over: Partial<SpinResult> = {}): SpinResult {
  return {
    win,
    totalWin: win,
    bet: 1,
    stage: 'base_game',
    data: {},
    vars: {},
    nextActions: ['spin'],
    roundComplete: true,
    spinsRemaining: 0,
    spinsPlayed: 1,
    scriptSha256: 'a'.repeat(64),
    roundId: 'r',
    ...over,
  };
}

/** Live `e8-server` processes serving `dir`'s `game/` — 0 when none. */
function e8Servers(dir: string = cwd): number {
  try {
    return execSync(`pgrep -f 'e8-server.*--games-dir ${join(dir, 'game')}'`)
      .toString()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return 0; // pgrep exits 1 on no match
  }
}

describe('spin on a real e8-server', () => {
  it('plays n spins and reports them', async () => {
    const progress: [number, number][] = [];
    const before = e8Servers();
    const r = await spin({ cwd, n: 20, seed: 'abc', onProgress: (d, n) => progress.push([d, n]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.spins).toBe(20);
    expect(r.bet).toBe(0.2); // spec.json's first betLevel
    expect(r.seed).toBe('abc');
    expect(r.rtp).toBeGreaterThanOrEqual(0);
    // Measured on seed 'abc': some spins pay and some do not, so a rate
    // that counts every spin (or none) is wrong, not merely unlucky.
    expect(r.hitRate).toBeGreaterThan(0);
    expect(r.hitRate).toBeLessThan(1);
    for (const p of Object.values(r.wins)) expect(r.maxWin).toBeGreaterThanOrEqual(p);
    expect(Object.values(r.stages).reduce((a, b) => a + b, 0)).toBe(20);
    expect(r.scriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.incompleteRounds).toBe(0); // first-slot: every action is round_complete at once
    expect(progress.at(-1)).toEqual([20, 20]);
    expect(e8Servers()).toBe(before);
  }, 30_000);

  it('the same seed gives the same report; the bet does not change the multipliers', async () => {
    const a = await spin({ cwd, n: 20, seed: 'abc' });
    const b = await spin({ cwd, n: 20, seed: 'abc' });
    expect(b.rtp).toBe(a.rtp);
    expect(b.stages).toEqual(a.stages);
    // `win` is a bet multiplier (measured: identical under 0.2/1/5), so
    // rtp must come out the same at another bet — Σwin/(n·bet) would not.
    const c = await spin({ cwd, n: 20, seed: 'abc', bet: 5 });
    expect(c.bet).toBe(5);
    expect(c.rtp).toBe(a.rtp);
    // Another seed is another stream — measured: 'xyz' pays 0.025 to
    // 'abc''s 0.2 over these 20 spins. Deterministic, so not a coin flip;
    // and the only way to tell the seed reaching the server from
    // `startE8Server`'s own constant default, which same-seed runs cannot.
    const x = await spin({ cwd, n: 20, seed: 'xyz' });
    expect(x.rtp).not.toBe(a.rtp);
  }, 60_000);

  it('a binary that is not there is a session diagnostic, and leaves no process', async () => {
    const before = e8Servers();
    const r = await spin({ cwd, n: 5, seed: 'abc', binPath: '/nonexistent/e8-server' });
    expect(r.spins).toBe(0);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].plugin).toBe('session');
    expect(e8Servers()).toBe(before);
  }, 30_000);

  it('a spin refused mid-run ends the loop: the report covers what was played, plus why', async () => {
    // Measured: the in-flight gRPC call rejects at once (`14 UNAVAILABLE`,
    // ~100ms end to end) rather than hanging on a dead socket.
    const r = await spin({
      cwd,
      n: 20,
      seed: 'abc',
      onProgress(done) {
        if (done !== 3) return;
        const pid = execSync(`pgrep -f 'e8-server.*--games-dir ${join(cwd, 'game')}'`)
          .toString()
          .trim();
        process.kill(Number(pid), 'SIGKILL');
      },
    });
    expect(r.spins).toBe(3);
    expect(Object.values(r.stages).reduce((a, b) => a + b, 0)).toBe(3);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'session' });
    expect(e8Servers()).toBe(0);
  }, 30_000);

  it("without an id in spec.json, the game comes from the .spin the spec's scriptPath names", async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'e8-spin-')));
    cpSync(join(GAME, 'script.spin'), join(other, 'game', 'math.spin'));
    writeFileSync(
      join(other, 'game', 'spec.json'),
      JSON.stringify({ scriptPath: 'math.spin', betLevels: [5] }),
    );
    try {
      const r = await spin({ cwd: other, n: 2, seed: 'abc' });
      expect(r.diagnostics).toEqual([]);
      expect(r.spins).toBe(2);
      expect(r.bet).toBe(0.2); // the .spin's first bet level, not the id-less spec's
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 30_000);

  it('n below 1 is a compute diagnostic, before any server is spawned', async () => {
    const r = await spin({ cwd, n: 0 });
    expect(r.spins).toBe(0);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ plugin: 'compute', message: 'n must be ≥ 1' });
  });
});

describe('spin steps a round to completion (session-fixture)', () => {
  it('steps `free_spin` via nextActions[0] until roundComplete, and rtp/steps reflect that', async () => {
    const before = e8Servers(sessionCwd);
    const n = 3;
    const r = await spin({ cwd: sessionCwd, n, seed: 'abc' });
    expect(r.diagnostics).toEqual([]);
    expect(r.spins).toBe(n);
    // Every round: 1 StartRound (not a Step) + exactly 2 Step calls to
    // finish (the fixture always awards 2 free spins, win or no win) —
    // see its own doc.
    expect(r.steps).toBe(2 * n);
    expect(Object.values(r.stages).reduce((a, b) => a + b, 0)).toBe(n + r.steps);
    // No round left incomplete, so no roundComplete diagnostic at all.
    expect(r.incompleteRounds).toBe(0);
    expect(r.diagnostics.find((d) => d.where === 'roundComplete')).toBeUndefined();
    // rtp/wins/maxWin/avgWin are over each round's FINAL totalWin, not the
    // base spin's own `win` — a spin with free spins almost always differs
    // from its round's eventual total.
    expect(r.rtp).toBeGreaterThanOrEqual(0);
    expect(e8Servers(sessionCwd)).toBe(before);
  }, 30_000);
});

describe('percentiles', () => {
  it('nearest-rank on the sorted values', () => {
    expect(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ p50: 5, p90: 9, p99: 10 });
    expect(percentiles([3, 1, 2])).toEqual({ p50: 2, p90: 3, p99: 3 });
    expect(percentiles([])).toEqual({ p50: 0, p90: 0, p99: 0 });
  });
});

describe('summarise', () => {
  it("win math reads each round's FINAL totalWin, but stages tallies every response in it", () => {
    const round = [
      // The base response: pays 0.5, but the round is not over yet.
      result(0.5, {
        totalWin: 0.5,
        roundComplete: false,
        nextActions: ['free_spin'],
        roundId: 'r1',
      }),
      // The step that finishes it — a running total, not this response's own `win`.
      result(1.5, { totalWin: 2, stage: 'free_spins', roundComplete: true, roundId: 'r1' }),
    ];
    const s = summarise([round, [result(0)]]);
    expect(s.spins).toBe(2);
    expect(s.steps).toBe(1); // one round stepped once, one round not stepped at all
    expect(s.rtp).toBe(1); // (2 + 0) / 2 — the FINAL totalWin, not 0.5 nor 1.5
    expect(s.maxWin).toBe(2);
    expect(s.hitRate).toBe(0.5);
    expect(s.stages).toEqual({ base_game: 2, free_spins: 1 });
    expect(s.incompleteRounds).toBe(0);
    expect(s.diagnostics).toEqual([]);
  });

  it('a round still not roundComplete after the step cap gets one diagnostic naming it', () => {
    // A fake never-completing round: MAX_STEPS_PER_ROUND+1 responses (the
    // opening one plus every step), none of them roundComplete — the shape
    // `spin`'s own loop would hand `summarise` after giving up at the cap.
    // No binary involved: this is what makes the cap testable at all.
    const stuck: SpinResult[] = Array.from({ length: MAX_STEPS_PER_ROUND + 1 }, (_, i) =>
      result(1, {
        totalWin: i + 1,
        roundComplete: false,
        nextActions: ['free_spin'],
        roundId: 'r-stuck',
      }),
    );
    const s = summarise([stuck, [result(3)]]);
    expect(s.spins).toBe(2);
    expect(s.steps).toBe(MAX_STEPS_PER_ROUND); // capped, not MAX_STEPS_PER_ROUND+1 or unbounded
    expect(s.incompleteRounds).toBe(1);
    expect(s.rtp).toBe((MAX_STEPS_PER_ROUND + 1 + 3) / 2); // the stuck round's FINAL totalWin still counts
    expect(s.diagnostics).toEqual([
      {
        severity: 'warning',
        plugin: 'compute',
        where: 'roundComplete',
        message: `round r-stuck did not complete in ${MAX_STEPS_PER_ROUND} steps`,
      },
    ]);
  });

  it('complete rounds carry no warning; no rounds is all zeros', () => {
    expect(summarise([[result(1)], [result(0)]])).toMatchObject({
      incompleteRounds: 0,
      diagnostics: [],
      rtp: 0.5,
      steps: 0,
    });
    expect(summarise([])).toEqual({
      spins: 0,
      steps: 0,
      rtp: 0,
      hitRate: 0,
      maxWin: 0,
      avgWin: 0,
      stages: {},
      wins: { p50: 0, p90: 0, p99: 0 },
      incompleteRounds: 0,
      scriptSha256: null,
      diagnostics: [],
    });
  });
});

describe('playRounds', () => {
  /** A `PlaySpin` that answers from a canned queue — no session, no binary. */
  function scripted(
    steps: Array<{ result?: SpinResult; diagnostics?: Diagnostic[] }>,
  ): PlaySpin {
    let i = 0;
    return async () => {
      const step = steps[i++];
      if (!step) throw new Error('play called more times than scripted');
      return { result: step.result, diagnostics: step.diagnostics ?? [] };
    };
  }

  it('a Step failing after a successful Step in the same round discards that round whole', async () => {
    const play = scripted([
      // Round 1: completes on the opening response.
      { result: result(0.5, { roundComplete: true, roundId: 'r1' }) },
      // Round 2 opens, not complete yet.
      {
        result: result(0, {
          totalWin: 0,
          roundComplete: false,
          nextActions: ['free_spin'],
          roundId: 'r2',
        }),
      },
      // Round 2's first Step succeeds — still not complete.
      {
        result: result(1, {
          totalWin: 1,
          roundComplete: false,
          nextActions: ['free_spin'],
          roundId: 'r2',
        }),
      },
      // Round 2's second Step fails: the round is discarded whole, and the
      // run ends there — no further calls to `play`.
      { diagnostics: [diagnostic('error', 'session', 'play', 'e8-server died')] },
    ]);
    const { rounds, diagnostics } = await playRounds(2, { gameId: 'g', action: 'spin', betLevel: 1 }, play);
    expect(rounds).toHaveLength(1); // round 1 only — round 2's two responses are nowhere in it
    expect(rounds[0]).toHaveLength(1);
    expect(rounds[0][0].roundId).toBe('r1');
    expect(diagnostics).toEqual([
      { severity: 'error', plugin: 'session', where: 'play', message: 'e8-server died' },
    ]);
  });

  it('an incomplete round offering no next action stops there — not another play() call, not discarded', async () => {
    const play = scripted([
      // Opens the round: not complete, and nothing to step with. If the
      // loop guard is missing `nextActions.length > 0`, it calls `play`
      // again with `action: undefined` — `scripted` throws when that
      // happens, since only one response is queued here.
      {
        result: result(0.5, {
          totalWin: 0.5,
          roundComplete: false,
          nextActions: [],
          roundId: 'r1',
        }),
      },
    ]);
    const { rounds, diagnostics } = await playRounds(1, { gameId: 'g', action: 'spin', betLevel: 1 }, play);
    expect(diagnostics).toEqual([]); // playRounds itself reports nothing on this path
    expect(rounds).toHaveLength(1); // pushed whole, same as a completed round
    expect(rounds[0]).toHaveLength(1);
    expect(rounds[0][0]).toMatchObject({ roundId: 'r1', roundComplete: false });

    // summarise is what turns it into a diagnostic — a different message
    // than the step-cap one, since the round never reached the cap.
    const s = summarise(rounds);
    expect(s.incompleteRounds).toBe(1);
    expect(s.diagnostics).toEqual([
      {
        severity: 'warning',
        plugin: 'compute',
        where: 'roundComplete',
        message: 'round r1 did not complete: no next action',
      },
    ]);
  });
});
