// packages/game-engine/tests/slot/reelSystem.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import {
  resolveReelConfig,
  mergeReelConfig,
  effectiveRowsPerReel,
  waysCount,
  DEFAULT_REEL_CONFIG,
  PRESETS,
} from '../../src/slot';
import { AnticipationController } from '../../src/slot/motion/AnticipationController';
import { SpinEngine } from '../../src/slot/motion/SpinEngine';
import { TumbleController } from '../../src/slot/cascade/TumbleController';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { createReelSystem } from '../../src/slot/system/ReelSystem';
import type { ReelFeature } from '../../src/slot/features';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';
import type { CellData } from '../../src/slot/grid/SymbolCell';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

describe('resolveReelConfig / merge', () => {
  it('fills defaults and applies overrides without mutating defaults', () => {
    const cfg = resolveReelConfig({ grid: { cols: 6 }, motion: { style: 'strip' } });
    expect(cfg.grid.cols).toBe(6);
    expect(cfg.grid.rows).toBe(DEFAULT_REEL_CONFIG.grid.rows); // untouched default
    expect(cfg.motion.style).toBe('strip');
    expect(cfg.motion.spinUp).toBe(DEFAULT_REEL_CONFIG.motion.spinUp);
    // defaults object stays pristine
    expect(DEFAULT_REEL_CONFIG.grid.cols).toBe(5);
  });
  it('arrays replace rather than merge', () => {
    const cfg = mergeReelConfig(DEFAULT_REEL_CONFIG, { grid: { rowsPerReel: [2, 3, 4] } });
    expect(cfg.grid.rowsPerReel).toEqual([2, 3, 4]);
  });
});

describe('rows + ways', () => {
  it('effectiveRowsPerReel uses rowsPerReel when length matches cols', () => {
    expect(
      effectiveRowsPerReel({ ...DEFAULT_REEL_CONFIG.grid, cols: 3, rowsPerReel: [2, 5, 3] }),
    ).toEqual([2, 5, 3]);
    expect(effectiveRowsPerReel({ ...DEFAULT_REEL_CONFIG.grid, cols: 5, rows: 3 })).toEqual([
      3, 3, 3, 3, 3,
    ]);
  });
  it('waysCount is the product of per-reel heights', () => {
    expect(waysCount({ ...DEFAULT_REEL_CONFIG.grid, cols: 5, rows: 3 })).toBe(243);
    expect(
      waysCount({ ...DEFAULT_REEL_CONFIG.grid, cols: 6, rowsPerReel: [2, 3, 4, 4, 3, 2] }),
    ).toBe(2 * 3 * 4 * 4 * 3 * 2);
  });
});

describe('AnticipationController.decide', () => {
  const board = (scatterCols: number[]): CellData[][] =>
    Array.from({ length: 5 }, (_, c) =>
      Array.from({ length: 3 }, () => ({ symbol: scatterCols.includes(c) ? 'scatter' : 'x' })),
    );

  it('arms trailing reels once threshold is reached', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: true,
      threshold: 2,
      reels: 'trailing',
    });
    // scatters land on reels 0 and 1 → cumulative hits 2 partway through reel 0 (3 scatters), arm after reel 0
    const d = ctrl.decide(board([0, 1]));
    expect(d.active).toBe(true);
    expect(d.reels.every((r) => r >= 1)).toBe(true);
  });
  it('stays inactive when disabled', () => {
    const ctrl = new AnticipationController({
      ...DEFAULT_REEL_CONFIG.anticipation,
      enabled: false,
    });
    expect(ctrl.decide(board([0, 1, 2])).active).toBe(false);
  });
  it('stays inactive when no triggers land', () => {
    const ctrl = new AnticipationController({ ...DEFAULT_REEL_CONFIG.anticipation, enabled: true });
    expect(ctrl.decide(board([])).active).toBe(false);
  });
});

describe('SpinEngine.plan', () => {
  const grid = () => new ReelGrid({ cols: 5, rows: 3, cellSize: 100, gap: 0, resolve });
  const target: CellData[][] = Array.from({ length: 5 }, (_, c) =>
    Array.from({ length: 3 }, (_, r) => ({ symbol: `c${c}r${r}` })),
  );

  it('sequential stops are staggered left to right', () => {
    const eng = new SpinEngine(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.motion,
      stopMode: 'sequential',
      stopStagger: 120,
      spinUp: 500,
      hold: 0,
    });
    const plan = eng.plan({ targetGrid: target });
    expect(plan[0].stopTime).toBe(500);
    expect(plan[2].stopTime).toBe(500 + 2 * 120);
  });
  it('sync stops all reels at the same time', () => {
    const eng = new SpinEngine(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.motion,
      stopMode: 'sync',
      spinUp: 500,
      hold: 100,
    });
    const plan = eng.plan({ targetGrid: target });
    expect(new Set(plan.map((p) => p.stopTime)).size).toBe(1);
  });
  it('rtl order reverses the stagger', () => {
    const eng = new SpinEngine(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.motion,
      stopMode: 'sequential',
      stopOrder: 'rtl',
      stopStagger: 100,
      spinUp: 0,
      hold: 0,
    });
    const plan = eng.plan({ targetGrid: target });
    expect(plan[4].stopTime).toBe(0); // last reel stops first under rtl
    expect(plan[0].stopTime).toBe(4 * 100);
  });
  it('anticipated reels stop later by the hold amount', () => {
    const eng = new SpinEngine(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.motion,
      stopMode: 'sync',
      spinUp: 500,
      hold: 0,
    });
    const plan = eng.plan({ targetGrid: target }, { anticipateReels: [4], anticipateHoldMs: 400 });
    expect(plan[4].stopTime).toBe(900);
    expect(plan[4].anticipated).toBe(true);
  });
});

describe('TumbleController.deriveDrops (via gravity model)', () => {
  it('survivors fall to the bottom when cells are removed', () => {
    const grid = new ReelGrid({ cols: 1, rows: 4, cellSize: 100, gap: 0, resolve });
    const ctrl = new TumbleController(grid, { ...DEFAULT_REEL_CONFIG.cascade, enabled: true });
    // remove rows 1 and 2 → survivors at 0 and 3 fall to bottom (rows 2 and 3)
    const drops = (ctrl as any).deriveDrops({
      removedCells: [
        { col: 0, row: 1 },
        { col: 0, row: 2 },
      ],
      winningCells: [],
      newCells: [],
      settledGrid: [],
    });
    const map = Object.fromEntries(drops.map((d: any) => [d.fromRow, d.toRow]));
    expect(map[0]).toBe(2);
    expect(map[3]).toBeUndefined(); // row 3 already at the bottom, no move
  });
});

describe('TumbleController multiplier ladder', () => {
  it('add mode climbs by step and caps', () => {
    const grid = new ReelGrid({ cols: 1, rows: 1, cellSize: 10, resolve });
    const ctrl = new TumbleController(grid, {
      ...DEFAULT_REEL_CONFIG.cascade,
      enabled: true,
      multiplier: {
        enabled: true,
        start: 1,
        mode: 'add',
        step: 2,
        cap: 5,
        persistInFreeSpins: false,
      },
    });
    expect(ctrl.multiplier).toBe(1);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(3);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(5); // capped
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(5);
  });
});

describe('createReelSystem', () => {
  it('drops a rowsPerReel whose length no longer matches cols (keeps geometry + ways consistent)', () => {
    const sys = createReelSystem({
      resolve,
      config: { grid: { cols: 5, rows: 3, rowsPerReel: [4, 6, 3, 7, 5, 2] } },
    });
    expect(sys.grid.cols).toBe(5);
    expect(sys.grid.rowsPerReel).toEqual([3, 3, 3, 3, 3]); // mismatched array dropped → uniform
    expect(sys.ways).toBe(243);
    expect(sys.config.grid.rowsPerReel).toBeUndefined();
    sys.destroy();
  });
  it('keeps a valid rowsPerReel (Megaways) and computes ways from it', () => {
    const sys = createReelSystem({
      resolve,
      config: { grid: { cols: 6, rowsPerReel: [2, 3, 4, 4, 3, 2] } },
    });
    expect(sys.grid.rowsPerReel).toEqual([2, 3, 4, 4, 3, 2]);
    expect(sys.ways).toBe(2 * 3 * 4 * 4 * 3 * 2);
    sys.destroy();
  });
  it('registers and runs custom features alongside built-ins', async () => {
    let ran = 0;
    const mine: ReelFeature = {
      key: 'custom:test',
      label: 'Test',
      enabled: () => true,
      demo: async () => {
        ran++;
      },
    };
    const sys = createReelSystem({ resolve, config: {}, features: [mine] });
    expect(sys.features().some((f) => f.key === 'custom:test')).toBe(true);
    expect(sys.enabledFeatures().some((f) => f.key === 'custom:test')).toBe(true);
    await sys.runFeature('custom:test');
    expect(ran).toBe(1);
    // late registration also works
    let ran2 = 0;
    sys.registerFeature({
      key: 'custom:late',
      label: 'Late',
      enabled: () => true,
      demo: async () => {
        ran2++;
      },
    });
    await sys.runFeature('custom:late');
    expect(ran2).toBe(1);
    sys.destroy();
  });
  it('cascade/reelStep call onStep after every settled step (the per-step payout hook)', async () => {
    // cascade.enabled: false makes each step settle the board synchronously — no ticker needed.
    const sys = createReelSystem({
      resolve,
      config: { grid: { cols: 2, rows: 2 }, cascade: { enabled: false } },
    });
    const cell = (symbol: string): CellData[][] => [
      [{ symbol }, { symbol }],
      [{ symbol }, { symbol }],
    ];
    const seen: Array<{ i: number; mult: number; symbol: string }> = [];
    await sys.cascade(
      [
        { winningCells: [], removedCells: [], newCells: [], settledGrid: cell('a') },
        { winningCells: [], removedCells: [], newCells: [], settledGrid: cell('b') },
      ],
      {
        onStep: (i, step, mult) => {
          seen.push({ i, mult, symbol: step.settledGrid[0][0].symbol });
        },
      },
    );
    expect(seen).toEqual([
      { i: 0, mult: 1, symbol: 'a' },
      { i: 1, mult: 1, symbol: 'b' },
    ]);
    // the hook sees the board AFTER its step settled
    expect(sys.board[0][0].symbol).toBe('b');

    const reelSeen: number[] = [];
    await sys.reelStep([{ shifts: [0, 0], winningCells: [], settledGrid: cell('c') }], {
      onStep: (i) => reelSeen.push(i),
    });
    expect(reelSeen).toEqual([0]);
    sys.destroy();
  });
  it('exposes the running cascade multiplier (starts at config.start)', () => {
    const sys = createReelSystem({
      resolve,
      config: { cascade: { multiplier: { enabled: true, start: 2 } } },
    });
    expect(sys.multiplier).toBe(2);
    sys.destroy();
  });
});

describe('presets', () => {
  it('every preset resolves to a valid config', () => {
    for (const p of Object.values(PRESETS)) {
      const cfg = resolveReelConfig(p.config);
      expect(cfg.grid.cols).toBeGreaterThan(0);
      expect(cfg.motion.style).toBeDefined();
    }
  });
  it('megaways preset has variable rows', () => {
    const cfg = resolveReelConfig(PRESETS.megaways.config);
    expect(cfg.grid.rowsPerReel).toHaveLength(cfg.grid.cols);
    expect(new Set(cfg.grid.rowsPerReel).size).toBeGreaterThan(1);
  });
});
