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
});
