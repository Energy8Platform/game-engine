import '../pixi/setup-canvas';
import { describe, it, expect } from 'vitest';
import { BottomBar, WIDE_BAR_H, MOBILE_BAR_H } from '@/ui/pixi-hb/components/BottomBar';
import { BetStrip, Readout, SpinDisc } from '@/ui/pixi-hb/primitives/widgets';
import { makeContext, defaultConfig } from '../pixi/_host';

const priv = (bar: BottomBar) => bar as unknown as { betReadout?: Readout; betUp?: unknown; spin?: SpinDisc; buy?: { iconName: string } };

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

  it('an active feature locks the stepper, names the mode and turns the bonus plaque into a cross', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: false, buyBonus: [] } }) });
    host.state.activeFeature = { id: 'ante', type: 'feature', title: 'Warrior Ante', description: '', priceMultiplier: 1.25 };
    const bar = new BottomBar(host);
    expect((priv(bar).betUp as { disabled: boolean }).disabled).toBe(true);
    expect(priv(bar).buy!.iconName).toBe('close');
    expect(priv(bar).betReadout!.valueText.text).toBe('€1.25');
  });

  it('turbo paints the bolts in per level', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 2, autoplay: false, buyBonus: false } }) });
    host.state.turbo = 2;
    const btn = (new BottomBar(host) as unknown as { turboBtn: { bolts: number; view: { colors: { boltA: string; boltB: string } } } }).turboBtn;
    expect(btn.bolts).toBe(2);
    expect(btn.view.colors.boltA).toBe(btn.view.colors.boltB);
    host.state.turbo = 1;
    const one = (new BottomBar(host) as unknown as { turboBtn: { view: { colors: { boltA: string; boltB: string } } } }).turboBtn;
    expect(one.view.colors.boltA).not.toBe(one.view.colors.boltB);
  });

  it('a halted autoplay run keeps its count on the disc and offers to resume', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    host.state.autoplay = { active: false, remaining: 4 };
    const disc = priv(new BottomBar(host)).spin!;
    expect((disc as unknown as { mode: string }).mode).toBe('resume');
    expect((disc as unknown as { countText?: { text: string } }).countText?.text).toBe('4');
  });
});
