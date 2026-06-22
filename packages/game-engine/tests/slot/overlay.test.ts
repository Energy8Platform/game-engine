import { describe, it, expect } from 'vitest';
import { pickTier, tierIndexAtValue, type WinTier } from '../../src/slot/overlay/tiers';
import { valueAt, CountUpDisplay } from '../../src/slot/overlay/CountUpDisplay';

const tiers: WinTier[] = [
  { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0x00ff00 },
  { id: 'mega', minMultiplier: 30, title: 'MEGA WIN', accentColor: 0x00ffff },
  { id: 'epic', minMultiplier: 100, title: 'EPIC WIN', accentColor: 0xff00ff },
];

describe('pickTier', () => {
  it('picks the highest tier whose minMultiplier <= win/bet', () => {
    expect(pickTier(tiers, 50, 1)!.id).toBe('mega');   // 50× → mega (>=30, <100)
    expect(pickTier(tiers, 10, 1)!.id).toBe('big');    // boundary
    expect(pickTier(tiers, 9, 1)).toBeNull();          // below lowest
    expect(pickTier(tiers, 1000, 1)!.id).toBe('epic'); // top
  });
});

describe('tierIndexAtValue', () => {
  it('returns the tier index for the running value (or -1 below lowest)', () => {
    expect(tierIndexAtValue(tiers, 5, 1)).toBe(-1);
    expect(tierIndexAtValue(tiers, 15, 1)).toBe(0);
    expect(tierIndexAtValue(tiers, 120, 1)).toBe(2);
  });
});

describe('valueAt', () => {
  it('is 0 at t=0, target at t>=duration, monotonic', () => {
    expect(valueAt(0, 100, 1000)).toBe(0);
    expect(valueAt(1000, 100, 1000)).toBe(100);
    expect(valueAt(2000, 100, 1000)).toBe(100);
    expect(valueAt(500, 100, 1000)).toBeGreaterThan(0);
    expect(valueAt(500, 100, 1000)).toBeLessThan(100);
  });
});

describe('CountUpDisplay', () => {
  it('formats the value via the provided formatter', () => {
    const d = new CountUpDisplay({ format: (v) => `$${Math.round(v)}` });
    d.setValue(42);
    expect(d.text).toBe('$42');
  });
});

import { BigWinOverlay } from '../../src/slot/overlay/BigWinOverlay';

describe('BigWinOverlay', () => {
  const cfg = { tiers, formatMoney: (v: number) => `$${Math.round(v)}`, width: 1920, height: 1080 };
  it('constructs and exposes the chosen tier title for a win', () => {
    const o = new BigWinOverlay(cfg);
    expect(o.tierTitleFor(50, 1)).toBe('MEGA WIN');
    expect(o.tierTitleFor(5, 1)).toBeNull();
  });
  it('hide() makes it invisible', () => {
    const o = new BigWinOverlay(cfg);
    o.hide();
    expect(o.visible).toBe(false);
  });
});
