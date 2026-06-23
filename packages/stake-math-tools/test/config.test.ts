import { describe, it, expect } from 'vitest';
import { resolveModes } from '../src/mathConfig';

const model = {
  spec: { maxWin: 5000 },
  mathModes: [
    { action: 'spin', mode: 'BASE', costMultiplier: 1 },
    { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 100 },
  ],
} as any;

describe('resolveModes', () => {
  it('lists every spec mode, merging per-mode overrides over seeded defaults', () => {
    const resolved = resolveModes({
      model,
      luaScript: '-- lua',
      modes: { BASE: { sim: { iterations: 5000 }, curate: { targetRTP: 0.96 } } },
    });
    const base = resolved.find((m) => m.mode === 'BASE')!;
    expect(base.action).toBe('spin');
    expect(base.sim.iterations).toBe(5000);            // override
    expect(base.curate.capMaxWin).toBe(500000);        // spec.maxWin × 100 (cents)
    expect(base.curate.targetRTP).toBe(0.96);          // override
    const buy = resolved.find((m) => m.mode === 'BUY_BONUS')!;
    expect(buy.action).toBe('buy_bonus');              // present even with no modes block
    expect(buy.curate.capMaxWin).toBe(500000);
  });
});
