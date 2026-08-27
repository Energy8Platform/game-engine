// packages/game-engine/tests/slot/spinMotion.test.ts
//
// The four seams a game needs from the motion layer, per the `pantheon-break` request:
//   1. the spin emits its schedule + a per-reel / per-cell landing signal
//   2. `cascade-drop`'s per-cell stagger is config, not a literal
//   3. `SpinRunOpts` anticipation is HONOURED rather than silently discarded
//   4. a reel's landing can be withheld (`deferReveal`) so the game brings it in itself
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import { DEFAULT_REEL_CONFIG } from '../../src/slot';
import { AnticipationController } from '../../src/slot/motion/AnticipationController';
import { SpinEngine, type ReelStopPlan } from '../../src/slot/motion/SpinEngine';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { createReelSystem } from '../../src/slot/system/ReelSystem';
import { perReelValue, type MotionConfig } from '../../src/slot/config/ReelSystemConfig';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';
import type { CellData } from '../../src/slot/grid/SymbolCell';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

/**
 * Pixi re-baselines `Ticker.shared` against `performance.now()` every time its listener list
 * empties and refills — which would scramble the hand-driven clock these timing tests read. Hold
 * one listener for the whole suite so the ticker's time base stays ours.
 */
const keepTickerAlive = (): void => {};
beforeAll(() => {
  (globalThis as any).requestAnimationFrame ??= () => 0;
  (globalThis as any).cancelAnimationFrame ??= () => {};
  Ticker.shared.add(keepTickerAlive);
  Ticker.shared.update(clock.t); // adopt our clock as the baseline
});
afterAll(() => {
  Ticker.shared.remove(keepTickerAlive);
});

/**
 * Drive `Ticker.shared` by hand (the suite runs in `environment: 'node'`, so there is no rAF loop)
 * until `work` settles. Returns a clock reading the elapsed ticker time, so a test can assert on
 * WHEN a callback fired, not just that it did.
 */
async function pump<T>(work: Promise<T>, stepMs = 16, maxSteps = 800): Promise<T> {
  let settled = false;
  const done = work.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < maxSteps && !settled; i++) {
    clock.t += stepMs;
    Ticker.shared.update(clock.t);
    // drain the microtask queue fully before the next frame, so a chain of awaits (delay → tween →
    // callback) is not spread over extra frames and skewed against the schedule under test
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return done;
}
const clock = { t: 0 };

const grid5 = () => new ReelGrid({ cols: 5, rows: 3, cellSize: 100, gap: 0, resolve });
const board = (cols = 5, rows = 3): CellData[][] =>
  Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => ({ symbol: `c${c}r${r}` })),
  );

/** A motion config that lands as fast as the engine allows, so tests stay quick. */
const fast = (over: Partial<MotionConfig> = {}): MotionConfig => ({
  ...DEFAULT_REEL_CONFIG.motion,
  spinUp: 0,
  hold: 0,
  stopStagger: 0,
  settle: { ...DEFAULT_REEL_CONFIG.motion.settle, amp: 0, ms: 1 },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. the plan is public data, and the run emits it
// ─────────────────────────────────────────────────────────────────────────────

describe('SpinEngine.plan — resolved timings are handed to the caller', () => {
  it('carries the resolved per-reel slowdown so a game need not re-derive it', () => {
    const eng = new SpinEngine(grid5(), resolve, fast({ stopMode: 'sync' }));
    const plan = eng.plan(
      { targetGrid: board() },
      { anticipateReels: [3, 4], anticipateSlowdown: 0.5 },
    );
    expect(plan.map((p) => p.slowdown)).toEqual([1, 1, 1, 2, 2]); // 1 / 0.5
    expect(plan.map((p) => p.anticipated)).toEqual([false, false, false, true, true]);
  });

  it('resolves per-reel anticipation timings (the progressive ramp) reel by reel', () => {
    const eng = new SpinEngine(grid5(), resolve, fast({ stopMode: 'sync' }));
    const plan = eng.plan(
      { targetGrid: board() },
      {
        anticipateReels: [2, 3, 4],
        // indexed BY REEL: reel 2 normal-slow, 3 slower, 4 slowest
        anticipateSlowdown: [, , 0.5, 0.25, 0.125],
        anticipateHoldMs: [, , 100, 200, 400],
      },
    );
    expect(plan.map((p) => p.slowdown)).toEqual([1, 1, 2, 4, 8]);
    expect(plan.map((p) => p.stopTime)).toEqual([0, 0, 100, 200, 400]);
  });

  it('flags the reels whose reveal was deferred', () => {
    const eng = new SpinEngine(grid5(), resolve, fast());
    const plan = eng.plan({ targetGrid: board() }, { deferReveal: [3, 4] });
    expect(plan.map((p) => p.deferred)).toEqual([false, false, false, true, true]);
  });

  it('run() hands the plan over before the first frame', async () => {
    const eng = new SpinEngine(grid5(), resolve, fast());
    let handed: ReelStopPlan[] | null = null;
    await pump(eng.run({ targetGrid: board() }, { onPlan: (p) => (handed = p) }));
    expect(handed).not.toBeNull();
    expect(handed!.map((p) => p.reel)).toEqual([0, 1, 2, 3, 4]);
    // the plan the caller got IS the plan the engine executed
    expect(handed!).toEqual(eng.plan({ targetGrid: board() }));
  });
});

describe('SpinEngine.run — per-reel and per-cell landing signals', () => {
  for (const style of ['swap', 'strip', 'cascade-drop'] as const) {
    it(`${style}: onReelStop fires once per reel and onCellSeated once per cell`, async () => {
      const g = grid5();
      const eng = new SpinEngine(g, resolve, fast({ style }));
      const stops: number[] = [];
      const seated: string[] = [];
      await pump(
        eng.run(
          { targetGrid: board() },
          {
            onReelStop: (reel) => stops.push(reel),
            onCellSeated: (reel, row, data) => seated.push(`${reel}:${row}=${data.symbol}`),
          },
        ),
      );
      expect(stops.slice().sort()).toEqual([0, 1, 2, 3, 4]);
      expect(seated).toHaveLength(15);
      // every callback carries the landing symbol that actually went into the cell
      expect(seated).toContain('4:2=c4r2');
      expect(g.getCell(4, 2).data.symbol).toBe('c4r2');
    });
  }

  it('onReelStop fires AFTER the reel is seated (it is the landing frame)', async () => {
    const g = grid5();
    const eng = new SpinEngine(g, resolve, fast({ style: 'strip' }));
    const symbolsAtStop: (string | null)[] = [];
    await pump(
      eng.run(
        { targetGrid: board() },
        { onReelStop: (reel) => symbolsAtStop.push(g.getCell(reel, 0).data.symbol) },
      ),
    );
    expect(symbolsAtStop.slice().sort()).toEqual(['c0r0', 'c1r0', 'c2r0', 'c3r0', 'c4r0']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. cascade-drop stagger is config
// ─────────────────────────────────────────────────────────────────────────────

/** Assert a hand-clocked duration, allowing one 16ms frame of quantisation either way. */
function expectAbout(actual: number, expected: number): void {
  expect(actual).toBeGreaterThanOrEqual(expected - 16);
  expect(actual).toBeLessThanOrEqual(expected + 16);
}

describe('cascade-drop stagger is configurable', () => {
  /** Ticker time, RELATIVE to the spin start, at which each cell of reel `col` seated. */
  async function seatTimes(cfg: Partial<MotionConfig>, col: number): Promise<number[]> {
    const g = new ReelGrid({ cols: 2, rows: 3, cellSize: 100, gap: 0, resolve });
    const eng = new SpinEngine(g, resolve, fast({ style: 'cascade-drop', spinUp: 1, ...cfg }));
    const at: number[] = [];
    const t0 = clock.t;
    await pump(
      eng.run(
        { targetGrid: board(2, 3) },
        {
          onCellSeated: (reel, row) => {
            if (reel === col) at[row] = clock.t - t0;
          },
        },
      ),
    );
    return at;
  }

  it('cellStagger spaces consecutive cells of one reel (no `slow` hack needed)', async () => {
    const tight = await seatTimes({ cellStagger: 0, reelStaggerFactor: 0 }, 0);
    expect(tight[2] - tight[0]).toBeLessThan(64);

    // rows 0..2 land 320ms apart — the gap a per-cell arrival wants, at the NORMAL fall duration
    // (before this, the only lever was `slowdown`, which stretched the fall by the same factor)
    const wide = await seatTimes({ cellStagger: 320, reelStaggerFactor: 0 }, 0);
    expectAbout(wide[1] - wide[0], 320);
    expectAbout(wide[2] - wide[1], 320);
  });

  it('reelStaggerFactor scales the per-reel offset independently', async () => {
    const flat = await seatTimes({ cellStagger: 0, reelStaggerFactor: 0, stopStagger: 200 }, 1);
    const staggered = await seatTimes(
      { cellStagger: 0, reelStaggerFactor: 2, stopStagger: 200 },
      1,
    );
    // reel 1 waits reel * stopStagger * reelStaggerFactor = 1 * 200 * 2 = 400ms longer
    expectAbout(staggered[0] - flat[0], 400);
  });

  it('defaults preserve the previous hardcoded behaviour', () => {
    expect(DEFAULT_REEL_CONFIG.motion.cellStagger).toBe(24);
    expect(DEFAULT_REEL_CONFIG.motion.reelStaggerFactor).toBe(0.4);
    expect(DEFAULT_REEL_CONFIG.motion.dropFallFactor).toBe(0.6);
  });
});

describe('cascade-drop fill direction and reel sequencing', () => {
  const dropSys = (motion: Partial<MotionConfig>, anticipation = {}) =>
    createReelSystem({
      resolve,
      config: {
        grid: { cols: 5, rows: 3 },
        motion: fast({
          style: 'cascade-drop',
          spinUp: 300,
          stopStagger: 200,
          cellStagger: 120,
          ...motion,
        }),
        anticipation,
      },
    });
  /** A board with one scatter on reel 0 and one on reel 1 → arms reels 2, 3, 4. */
  const twoScatters: CellData[][] = Array.from({ length: 5 }, (_, c) =>
    Array.from({ length: 3 }, (_, r) => ({ symbol: c < 2 && r === 0 ? 'scatter' : `c${c}r${r}` })),
  );
  const armed = {
    enabled: true,
    triggerSymbols: ['scatter'],
    threshold: 2,
    reels: 'trailing' as const,
    slowdownFactor: 0.75,
    progressiveSlowdown: 0.8,
    holdMs: 0,
  };

  it("'top-down' (the default) seats the top row first", () => {
    const sys = dropSys({});
    const cells = sys.planSpin(board())[0].cellStopTimes!;
    expect(cells[0]).toBeLessThan(cells[1]);
    expect(cells[1]).toBeLessThan(cells[2]);
    sys.destroy();
  });

  it("'bottom-up' seats the lowest row first, the way gravity would fill it", async () => {
    const sys = dropSys({ dropOrder: 'bottom-up' });
    const cells = sys.planSpin(board())[0].cellStopTimes!;
    expect(cells[2]).toBeLessThan(cells[1]);
    expect(cells[1]).toBeLessThan(cells[0]);
    // …and the run really lands them in that order
    const seated: number[] = [];
    await pump(sys.spin(board(), { onCellSeated: (reel, row) => reel === 0 && seated.push(row) }));
    expect(seated).toEqual([2, 1, 0]);
    sys.destroy();
  });

  it("'parallel' (the default) lets a reel open while the previous one is still dropping", () => {
    const sys = dropSys({});
    const plan = sys.planSpin(board());
    // reel gap is 200 * 1 = 200ms, but a reel spans 2 * 120 = 240ms of cells
    expect(plan[1].cellStopTimes![0]).toBeLessThan(plan[0].stopTime);
    sys.destroy();
  });

  it("'chained' queues every reel behind the one before it", () => {
    const sys = dropSys({ dropSequence: 'chained' });
    const plan = sys.planSpin(board());
    for (let c = 1; c < 5; c++)
      expect(Math.min(...plan[c].cellStopTimes!)).toBeGreaterThan(plan[c - 1].stopTime);
    sys.destroy();
  });

  it("'chained-when-anticipated' keeps the base spin fast and chains only the hunt", () => {
    const sys = dropSys({ dropSequence: 'chained-when-anticipated' }, armed);

    // no anticipation → identical to 'parallel', so the stop window is untouched
    const quiet = sys.planSpin(board());
    const parallel = dropSys({}, armed);
    expect(quiet.map((p) => p.cellStopTimes)).toEqual(
      parallel.planSpin(board()).map((p) => p.cellStopTimes),
    );
    parallel.destroy();

    // two scatters → reels 0,1 still overlap; 2,3,4 queue up, each slower than the last
    const hunt = sys.planSpin(twoScatters);
    expect(hunt[1].cellStopTimes![0]).toBeLessThan(hunt[0].stopTime); // un-armed: unchanged
    for (let c = 2; c < 5; c++)
      expect(Math.min(...hunt[c].cellStopTimes!)).toBeGreaterThan(hunt[c - 1].stopTime);
    // span between the reel's first and last cell — the widening per-cell gap, order-agnostic
    const cellGap = (c: number) =>
      Math.max(...hunt[c].cellStopTimes!) - Math.min(...hunt[c].cellStopTimes!);
    expect(cellGap(3)).toBeGreaterThan(cellGap(2));
    expect(cellGap(4)).toBeGreaterThan(cellGap(3));
    sys.destroy();
  });

  it('anticipation.holdMs now delays a cascade-drop reel (it used to be ignored)', () => {
    const withHold = dropSys({}, { ...armed, holdMs: 400 });
    const without = dropSys({}, { ...armed, holdMs: 0 });
    const a = withHold.planSpin(twoScatters)[2].cellStopTimes![0];
    const b = without.planSpin(twoScatters)[2].cellStopTimes![0];
    expect(a - b).toBeCloseTo(400, 6);
    withHold.destroy();
    without.destroy();
  });

  it("stopOrder 'rtl' reverses the drop as well as the stops", () => {
    const sys = dropSys({ stopOrder: 'rtl' });
    const plan = sys.planSpin(board());
    expect(plan[4].stopTime).toBeLessThan(plan[0].stopTime);
    sys.destroy();
  });

  it('defaults preserve the engine s original drop', () => {
    expect(DEFAULT_REEL_CONFIG.motion.dropOrder).toBe('top-down');
    expect(DEFAULT_REEL_CONFIG.motion.dropSequence).toBe('parallel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. anticipation: run options honoured + game-supplied predicate
// ─────────────────────────────────────────────────────────────────────────────

describe('anticipation decisions', () => {
  const scatterBoard = (cols: number[]): CellData[][] =>
    Array.from({ length: 5 }, (_, c) =>
      Array.from({ length: 3 }, () => ({ symbol: cols.includes(c) ? 'scatter' : 'x' })),
    );

  it('a game-supplied `decide` replaces the symbol counting entirely', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: true,
      triggerSymbols: [], // no symbol would ever count
      decide: (target) => (target[0][0].symbol === 'x' ? [3, 4] : null),
    });
    expect(ctrl.decide(scatterBoard([])).reels).toEqual([3, 4]);
    // "reel 3 missed its symbol → let 4 and 5 stop normally"
    expect(ctrl.decide(scatterBoard([0])).active).toBe(false);
  });

  it('`decide` may pin its own per-reel slowdown / hold', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: true,
      decide: () => ({ reels: [3, 4], slowdown: [, , , 0.5, 0.2], holdMs: 150 }),
    });
    const d = ctrl.decide(scatterBoard([]));
    expect(perReelValue(d.slowdown, 3, 1)).toBe(0.5);
    expect(perReelValue(d.slowdown, 4, 1)).toBe(0.2);
    expect(perReelValue(d.holdMs, 4, 0)).toBe(150);
  });

  it('progressiveSlowdown ramps each successive anticipated reel', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: true,
      threshold: 3,
      slowdownFactor: 0.8,
      holdMs: 100,
      progressiveSlowdown: 0.5,
      progressiveHoldMs: 50,
    });
    const d = ctrl.decide(scatterBoard([0])); // 3 scatters on reel 0 → arm reels 1..4
    expect(d.reels).toEqual([1, 2, 3, 4]);
    expect(perReelValue(d.slowdown, 1, 0)).toBeCloseTo(0.8);
    expect(perReelValue(d.slowdown, 2, 0)).toBeCloseTo(0.4);
    expect(perReelValue(d.slowdown, 4, 0)).toBeCloseTo(0.1);
    expect(perReelValue(d.holdMs, 4, 0)).toBe(250);
  });

  it('a flat decision stays a scalar (no behaviour change at the defaults)', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: true,
      threshold: 3,
    });
    const d = ctrl.decide(scatterBoard([0]));
    expect(d.slowdown).toBe(DEFAULT_REEL_CONFIG.anticipation.slowdownFactor);
    expect(d.holdMs).toBe(DEFAULT_REEL_CONFIG.anticipation.holdMs);
  });
});

describe('ReelSystem honours anticipation passed on the run options', () => {
  it('an explicit anticipateReels wins over the configured decision', () => {
    const sys = createReelSystem({
      resolve,
      config: {
        motion: fast({ stopMode: 'sync' }),
        anticipation: { enabled: true, triggerSymbols: ['scatter'], threshold: 1 },
      },
    });
    const target = board();
    // config alone would arm nothing (no scatters on the board)
    expect(sys.anticipationFor(target).active).toBe(false);
    // …and the caller's list is now respected rather than discarded
    const d = sys.anticipationFor(target, { anticipateReels: [4], anticipateHoldMs: 700 });
    expect(d.active).toBe(true);
    expect(d.reels).toEqual([4]);
    expect(d.holdMs).toBe(700);
    sys.destroy();
  });

  it('planSpin returns the schedule spin() will run — including the override', () => {
    const sys = createReelSystem({
      resolve,
      config: { motion: fast({ stopMode: 'sync' }) },
    });
    const plan = sys.planSpin(board(), { anticipateReels: [4], anticipateHoldMs: 400 });
    expect(plan[4].stopTime).toBe(400);
    expect(plan[4].anticipated).toBe(true);
    expect(plan[0].stopTime).toBe(0);
    sys.destroy();
  });

  it('spin() runs exactly the plan planSpin advertised', async () => {
    const sys = createReelSystem({ resolve, config: { motion: fast({ stopMode: 'sync' }) } });
    const target = board();
    const opts = { anticipateReels: [3, 4], anticipateSlowdown: 0.5 };
    const advertised = sys.planSpin(target, opts);
    let executed: ReelStopPlan[] | null = null;
    await pump(sys.spin(target, { ...opts, onPlan: (p) => (executed = p) }));
    expect(executed).toEqual(advertised);
    sys.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. deferReveal
// ─────────────────────────────────────────────────────────────────────────────

describe('deferReveal withholds a reel s landing', () => {
  for (const style of ['swap', 'strip', 'cascade-drop'] as const) {
    it(`${style}: the deferred reel goes dark and unseated, the others land normally`, async () => {
      const g = grid5();
      // seed the previous round so "unseated" is provable — the old symbol must NOT survive visible
      for (let c = 0; c < 5; c++)
        for (let r = 0; r < 3; r++) g.getCell(c, r).setData({ symbol: 'prev' });
      const eng = new SpinEngine(g, resolve, fast({ style }));
      const stops: number[] = [];
      const seated: number[] = [];
      await pump(
        eng.run(
          { targetGrid: board() },
          {
            deferReveal: [4],
            onReelStop: (reel) => stops.push(reel),
            onCellSeated: (reel) => seated.push(reel),
          },
        ),
      );
      // the reel DID stop — the caller is told so
      expect(stops).toContain(4);
      // …but nothing was handed back for it
      expect(seated).not.toContain(4);
      for (let r = 0; r < 3; r++) {
        expect(g.getCell(4, r).visible).toBe(false);
        expect(g.getCell(4, r).data.symbol).not.toBe('c4r2');
      }
      // the untouched reels landed as usual
      expect(g.getCell(3, 0).visible).toBe(true);
      expect(g.getCell(3, 0).data.symbol).toBe('c3r0');
    });
  }

  it('a slam stop does not reveal a deferred reel', async () => {
    const g = grid5();
    const eng = new SpinEngine(g, resolve, fast({ style: 'strip', spinUp: 5000 }));
    const run = eng.run({ targetGrid: board() }, { deferReveal: [4] });
    // let the tapes start, then hard-cancel mid-spin
    clock.t += 32;
    Ticker.shared.update(clock.t);
    await Promise.resolve();
    eng.skip();
    await pump(run);
    expect(g.getCell(4, 0).visible).toBe(false);
    expect(g.getCell(0, 0).visible).toBe(true);
  });

  it('a later spin without deferReveal reveals the reel again', async () => {
    const g = grid5();
    const eng = new SpinEngine(g, resolve, fast({ style: 'strip' }));
    await pump(eng.run({ targetGrid: board() }, { deferReveal: [4] }));
    expect(g.getCell(4, 0).visible).toBe(false);
    await pump(eng.run({ targetGrid: board() }));
    expect(g.getCell(4, 0).visible).toBe(true);
    expect(g.getCell(4, 0).data.symbol).toBe('c4r0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// the config may now carry a function, so cloning must survive one
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// the composition the four seams exist for: an escalating scatter hunt
// ─────────────────────────────────────────────────────────────────────────────

describe('scenario: the 2nd scatter arms a progressively slower per-cell drop', () => {
  it('each armed reel drops its cells one by one, slower than the reel before it', async () => {
    // one scatter on reel 0 and one on reel 1 → the running count hits 2 on reel 1, so reels
    // 2..4 are armed. Reel 2 (the first armed one) still runs at the base speed; 3 and 4 ramp.
    const target: CellData[][] = Array.from({ length: 5 }, (_, c) =>
      Array.from({ length: 3 }, (_, r) => ({
        symbol: c < 2 && r === 0 ? 'scatter' : `c${c}r${r}`,
      })),
    );
    const sys = createReelSystem({
      resolve,
      config: {
        grid: { cols: 5, rows: 3 },
        motion: {
          style: 'cascade-drop',
          spinUp: 300,
          hold: 0,
          stopStagger: 300,
          cellStagger: 200, // one cell every 200ms…
          reelStaggerFactor: 1, // …and one reel every 300ms
          dropFallFactor: 0.6,
          settle: { amp: 0, ms: 1 },
        },
        anticipation: {
          enabled: true,
          triggerSymbols: ['scatter'],
          threshold: 2,
          reels: 'trailing',
          slowdownFactor: 1,
          progressiveSlowdown: 0.7, // each armed reel 30% slower than the one before
          holdMs: 0,
        },
      },
    });
    expect(sys.anticipationFor(target).reels).toEqual([2, 3, 4]);

    const at: number[][] = Array.from({ length: 5 }, () => []);
    const t0 = clock.t;
    await pump(
      sys.spin(target, {
        onCellSeated: (reel, row) => {
          at[reel][row] = clock.t - t0;
        },
      }),
    );

    // every reel seated its 3 cells one at a time
    for (const rows of at) expect(rows).toHaveLength(3);
    // un-armed reels keep the configured 200ms cell gap
    expectAbout(at[0][1] - at[0][0], 200);
    expectAbout(at[1][2] - at[1][1], 200);
    // the armed reels widen it: 200 / 0.7 then 200 / 0.7²
    expectAbout(at[2][1] - at[2][0], 200);
    expectAbout(at[3][1] - at[3][0], 200 / 0.7);
    expectAbout(at[4][1] - at[4][0], 200 / 0.7 / 0.7);
    // …and the tension is monotone: each reel takes longer than the last
    const span = at.map((rows) => rows[2] - rows[0]);
    for (let c = 1; c < span.length; c++) expect(span[c]).toBeGreaterThanOrEqual(span[c - 1]);
    // Reels start in order, but a reel's offset is a FORMULA (reel * stopStagger *
    // reelStaggerFactor * slowdown), not "wait for the previous reel to finish". Here reel 1
    // opens at 512 while reel 0 is still dropping (it finishes at 608), because
    // stopStagger * reelStaggerFactor (300) is under (rows - 1) * cellStagger (400).
    for (let c = 1; c < 5; c++) expect(at[c][0]).toBeGreaterThan(at[c - 1][0]);
    expect(at[1][0]).toBeLessThan(at[0][2]); // overlapping, by the numbers above
    // Once the ramp inflates the offsets, the reels do separate on their own.
    expect(at[3][0]).toBeGreaterThan(at[2][2]);
    expect(at[4][0]).toBeGreaterThan(at[3][2]);
    sys.destroy();
  });
});

describe('a function-valued config survives merge + setConfig', () => {
  it('keeps `anticipation.decide` by reference through resolve / update', () => {
    const decide = () => [4];
    const sys = createReelSystem({
      resolve,
      config: { motion: fast(), anticipation: { enabled: true, decide } },
    });
    expect(sys.config.anticipation.decide).toBe(decide);
    // a later, unrelated update must not drop it (structuredClone would have thrown here)
    sys.update({ motion: { stopStagger: 200 } });
    expect(sys.config.anticipation.decide).toBe(decide);
    expect(sys.anticipationFor(board()).reels).toEqual([4]);
    sys.destroy();
  });
});
