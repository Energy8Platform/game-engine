import { describe, it, expect } from 'vitest';
import { genStakeAdapter } from '../src/codegen/stakeAdapter';
import { genMainTs } from '../src/codegen/mainTs';

const a = { id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true } as const;

describe('genStakeAdapter', () => {
  const { adapter } = genStakeAdapter(a);
  it('builds createGameAdapter with the model + schema + segmentOf', () => {
    expect(adapter).toContain('createGameAdapter');
    expect(adapter).toContain('segmentOf');
    expect(adapter).toContain("import { model } from '../game.spec'");
  });
  it('imports spinSchema from the shared game/schema (not stake/schema)', () => {
    expect(adapter).toContain("from '../game/schema'");
    expect(adapter).toContain('spinSchema');
  });
  it('reads free_spins?.awarded (nested form, not flat free_spins_awarded)', () => {
    expect(adapter).toContain('payload.free_spins?.awarded');
    expect(adapter).not.toContain('free_spins_awarded');
  });
});

describe('genMainTs', () => {
  it('enables the shell without hardcoding buyBonus/currency, and passes intro', () => {
    const m = genMainTs(a);
    expect(m).toContain('createSlotGame');
    expect(m).toContain('shell: {}');
    expect(m).toContain('intro:');
    expect(m).not.toContain('buyBonus');     // derived from spec now
    expect(m).not.toContain("symbol: '€'");  // currency from initData now
  });
});
