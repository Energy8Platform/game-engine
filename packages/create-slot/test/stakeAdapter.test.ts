import { describe, it, expect } from 'vitest';
import { genStakeAdapter } from '../src/codegen/stakeAdapter';
import { genMainTs } from '../src/codegen/mainTs';

const a = { id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true } as const;

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
  it('calls createSlotGame with a shell config', () => {
    const m = genMainTs(a);
    expect(m).toContain('createSlotGame');
    expect(m).toContain('shell:');
    expect(m).toContain('buyBonus');
  });
});
