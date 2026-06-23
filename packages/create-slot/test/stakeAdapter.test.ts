import { describe, it, expect } from 'vitest';
import { genStakeAdapter } from '../src/codegen/stakeAdapter';
import { genMainTs } from '../src/codegen/mainTs';

const a = { id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true } as const;

describe('genStakeAdapter', () => {
  const { adapter, schema } = genStakeAdapter(a);
  it('builds createGameAdapter with the model + schema + segmentOf', () => {
    expect(adapter).toContain('createGameAdapter');
    expect(adapter).toContain('segmentOf');
    expect(adapter).toContain("import { model } from '../game.spec'");
  });
  it('schema is a zod object', () => {
    expect(schema).toContain("import { z } from 'zod'");
    expect(schema).toContain('z.object');
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
