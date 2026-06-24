import { describe, it, expect } from 'vitest';
import { genNormalize } from '../src/codegen/normalize';

const base = { id: 'g', title: 'G', grid: { cols: 6, rows: 6 }, stake: true } as const;

describe('genNormalize', () => {
  it('cascade: declares SpinData with steps + a normalize that maps cascades', () => {
    const s = genNormalize({ ...base, mechanic: 'cluster', cascades: true });
    expect(s).toContain('export interface SpinData extends SlotSpinResultBase');
    expect(s).toContain('steps: CascadeStepData[]');
    expect(s).toContain('export const normalize: SlotResultNormalizer<SpinData>');
    expect(s).toContain('winningCells');
  });
  it('ways: maps a targetGrid instead of steps', () => {
    const s = genNormalize({ ...base, mechanic: 'ways', cascades: false });
    expect(s).toContain('targetGrid');
    expect(s).not.toContain('steps: CascadeStepData[]');
  });

  const s = genNormalize({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  it('coerces via the schema array fields and never uses `?? []` on an array', () => {
    expect(s).toContain("import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit'");
    expect(s).toContain("import { spinSchema, type SpinDataRaw } from './schema'");
    expect(s).toContain('deriveArrayFields(spinSchema)');
    expect(s).toContain('coerceLuaArrays(');
    expect(s).toContain('spinSchema.safeParse(');
    expect(s).not.toContain('?? []).map');             // the crash idiom must be gone
  });
});
