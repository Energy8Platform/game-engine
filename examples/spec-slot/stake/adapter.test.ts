import { describe, it, expect } from 'vitest';
import type { RoundContext } from '@energy8platform/stake-kit';
import { adapter } from './adapter';

const ctx: RoundContext = {
  mode: 'BASE', triggerAction: 'spin', betAmount: 2, payoutMultiplier: 0, currency: 'EUR', roundId: '1',
};

describe('spec-slot stake adapter', () => {
  it('produces a base segment from the real model + schema', () => {
    const segs = adapter.splitRound!(
      [{ stage: 'base_game', data: { total_win: 10, cascades: {} } }],
      ctx,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].action).toBe('spin');
    expect(segs[0].winThisSegment).toBe(20); // 10 × 2
    expect((segs[0].data as any).cascades).toEqual([]); // {} → [] via schema
    expect(segs[0].nextActions).toContain('spin');
    expect(segs[0].nextActions).toContain('buy_bonus');
  });
});
