import { describe, it, expect } from 'vitest';
import { enrichConfigWithJurisdiction } from '../src/jurisdiction';

describe('enrichConfigWithJurisdiction', () => {
  it('maps jurisdiction flags onto canonical regulatory keys', () => {
    const out: any = enrichConfigWithJurisdiction({
      jurisdiction: { disabledTurbo: true, disabledAutoplay: true, displaySessionTimer: true },
    } as any);
    expect(out.regulatory.turbo_enabled).toBe(false);
    expect(out.regulatory.autoplay_enabled).toBe(false);
    expect(out.regulatory.session_timer_enabled).toBe(true);
  });
  it('mirrors stake.maxBet (min-capped) and stake.defaultBetLevel', () => {
    const out: any = enrichConfigWithJurisdiction({
      regulatory: { max_bet_value: 50 },
      stake: { maxBet: 20, defaultBetLevel: 1 },
    } as any);
    expect(out.regulatory.max_bet_value).toBe(20);
    expect(out.defaultBet).toBe(1);
  });
  it('preserves existing regulatory when no jurisdiction present', () => {
    const out: any = enrichConfigWithJurisdiction({ regulatory: { foo: 1 } } as any);
    expect(out.regulatory.foo).toBe(1);
  });
});
