import '../pixi/setup-canvas';
import { describe, it, expect } from 'vitest';
import { BottomBar, WIDE_BAR_H, MOBILE_BAR_H } from '@/ui/pixi-hb/components/BottomBar';
import { BetStrip, Readout, SpinDisc } from '@/ui/pixi-hb/primitives/widgets';
import { makeContext, defaultConfig } from '../pixi/_host';

const priv = (bar: BottomBar) => bar as unknown as { betReadout?: Readout; betUp?: unknown; spin?: SpinDisc; buy?: { iconName: string } };
function find(n: any, pred: (c: any) => boolean): any {
  if (pred(n)) return n;
  for (const c of n.children ?? []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}

describe('hb bottom bar', () => {
  it('reports the safe-area heights per layout', () => {
    expect(new BottomBar(makeContext({ layout: 'wide' })).height).toBe(WIDE_BAR_H);
    expect(new BottomBar(makeContext({ layout: 'mobile', screenW: 375, screenH: 667 })).height).toBe(MOBILE_BAR_H);
  });

  it('the bet strip fills index + 1 segments', () => {
    const host = makeContext({ config: defaultConfig({ availableBets: [1, 2, 3, 4, 5], defaultBet: 3 }) });
    const bar = new BottomBar(host);
    expect(priv(bar).betReadout!.strip!.filled).toBe(3);
    expect(new BetStrip(100, 1, 0).filled).toBe(0); // a single bet draws nothing
  });

  it('an active feature swaps the stepper for a cross and names the mode', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: false, buyBonus: [] } }) });
    host.state.activeFeature = { id: 'ante', type: 'feature', title: 'Warrior Ante', description: '', priceMultiplier: 1.25 };
    const bar = new BottomBar(host);
    expect(priv(bar).betUp).toBeUndefined();
    expect(find(bar, (c) => c.label === 'bet-locked')).not.toBeNull();
    expect(priv(bar).betReadout!.valueText.text).toBe('€1.25');
  });

  it('a halted autoplay run keeps its count on the disc and offers to resume', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    host.state.autoplay = { active: false, remaining: 4 };
    const disc = priv(new BottomBar(host)).spin!;
    expect((disc as unknown as { mode: string }).mode).toBe('resume');
    expect((disc as unknown as { countText?: { text: string } }).countText?.text).toBe('4');
  });
});
