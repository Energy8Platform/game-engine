// packages/game-engine/tests/slot/reelStepController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { DEFAULT_REEL_CONFIG } from '../../src/slot';
import { ReelStepController, buildReelStepTape } from '../../src/slot/cascade/ReelStepController';
import { createReelSystem } from '../../src/slot/system/ReelSystem';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';
import type { CellData } from '../../src/slot/grid/SymbolCell';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const sym = (s: string): CellData => ({ symbol: s });

describe('buildReelStepTape', () => {
  it('stacks the fresh top symbols above the current reel and starts shift cells high', () => {
    // reel currently shows a,b,c; scroll down by 1 → fresh symbol X enters the top, settled = X,a,b
    const before = [sym('a'), sym('b'), sym('c')];
    const settled = [sym('X'), sym('a'), sym('b')];
    const { stack, shift, startOffsetCells } = buildReelStepTape(before, settled, 1);
    expect(shift).toBe(1);
    expect(startOffsetCells).toBe(-1);
    // tape top→bottom: [incoming(X)] then the current reel (a,b,c)
    expect(stack.map((c) => c.symbol)).toEqual(['X', 'a', 'b', 'c']);
    // when the tape slides down by 1 (cell i → row i), the window (rows 0..2) reads the settled reel
    expect(stack.slice(0, before.length).map((c) => c.symbol)).toEqual(['X', 'a', 'b']);
  });

  it('takes exactly `shift` fresh symbols for a multi-position scroll', () => {
    const before = [sym('a'), sym('b'), sym('c')];
    const settled = [sym('X'), sym('Y'), sym('a')];
    const { stack, shift } = buildReelStepTape(before, settled, 2);
    expect(shift).toBe(2);
    expect(stack.map((c) => c.symbol)).toEqual(['X', 'Y', 'a', 'b', 'c']);
    expect(stack.slice(0, 3).map((c) => c.symbol)).toEqual(['X', 'Y', 'a']);
  });

  it('clamps the shift to the visible window height', () => {
    const before = [sym('a'), sym('b'), sym('c')];
    const settled = [sym('X'), sym('Y'), sym('Z')];
    const { shift, startOffsetCells, stack } = buildReelStepTape(before, settled, 9);
    expect(shift).toBe(3);
    expect(startOffsetCells).toBe(-3);
    expect(stack.map((c) => c.symbol)).toEqual(['X', 'Y', 'Z', 'a', 'b', 'c']);
  });

  it('is a no-op layout when shift is 0', () => {
    const before = [sym('a'), sym('b'), sym('c')];
    const { stack, shift, startOffsetCells } = buildReelStepTape(before, before, 0);
    expect(shift).toBe(0);
    expect(startOffsetCells).toBe(0);
    expect(stack.map((c) => c.symbol)).toEqual(['a', 'b', 'c']);
  });
});

describe('ReelStepController multiplier ladder', () => {
  const grid = () => new ReelGrid({ cols: 1, rows: 1, cellSize: 10, resolve });

  it('mul mode climbs by step and caps', () => {
    const ctrl = new ReelStepController(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.cascade,
      enabled: true,
      multiplier: {
        enabled: true,
        start: 1,
        mode: 'mul',
        step: 2,
        cap: 8,
        persistInFreeSpins: false,
      },
    });
    expect(ctrl.multiplier).toBe(1);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(2);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(4);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(8);
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(8); // capped
  });

  it('resetMultiplier returns to config.start', () => {
    const ctrl = new ReelStepController(grid(), resolve, {
      ...DEFAULT_REEL_CONFIG.cascade,
      enabled: true,
      multiplier: {
        enabled: true,
        start: 3,
        mode: 'add',
        step: 1,
        cap: null,
        persistInFreeSpins: false,
      },
    });
    (ctrl as any).advanceMultiplier();
    expect(ctrl.multiplier).toBe(4);
    ctrl.resetMultiplier();
    expect(ctrl.multiplier).toBe(3);
  });
});

describe('createReelSystem.reelStep', () => {
  it('exposes a reelStep method and the shared running multiplier', () => {
    const sys = createReelSystem({
      resolve,
      config: { cascade: { multiplier: { enabled: true, start: 2 } } },
    });
    expect(typeof sys.reelStep).toBe('function');
    expect(sys.multiplier).toBe(2);
    sys.destroy();
  });
});
