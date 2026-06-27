import { describe, it, expect, vi } from 'vitest';
import { ShellController } from '@/core/ShellController';
import { FakeRenderer } from './FakeRenderer';
import type { ShellConfig } from '@/core/types';

function make(over: Partial<ShellConfig> = {}): { c: ShellController; r: FakeRenderer } {
  const r = new FakeRenderer();
  const c = new ShellController({
    renderer: r,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.2, 0.5, 1, 2, 5],
    defaultBet: 1, currentBet: null, balance: 1000, win: 0, mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 3, autoplay: {}, buyBonus: [] },
    ...over,
  });
  return { c, r };
}

describe('ShellController', () => {
  it('mounts the renderer and renders the bar once on construct', () => {
    const { r } = make();
    expect(r.host).toBeDefined();
    expect(r.bars).toBe(1);
    expect(r.themes).toBe(1);
  });

  it('stepBet runs in the controller and emits betChange (renderer only redraws)', () => {
    const { c, r } = make();
    const spy = vi.fn();
    c.on('betChange', spy);
    r.host.actions.stepBet(1); // available [0.2,0.5,1,2,5], default 1 → 2
    expect(c.state.bet).toBe(2);
    expect(spy).toHaveBeenCalledWith(2);
    expect(r.bars).toBe(2); // one more redraw
  });

  it('setBalance animates money from the previous value', () => {
    const { c, r } = make();
    c.setBalance(1200);
    expect(c.state.balance).toBe(1200);
    expect(r.money.at(-1)).toEqual({ field: 'balance', from: 1000, to: 1200 });
  });

  it('openSettings emits settingsOpen and opens the settings overlay', () => {
    const { c, r } = make();
    const spy = vi.fn();
    c.on('settingsOpen', spy);
    c.openSettings();
    expect(spy).toHaveBeenCalled();
    expect(r.overlays.at(-1)).toEqual({ kind: 'settings' });
  });

  it('onBonusBuy override is called instead of opening the overlay', () => {
    const onBonusBuy = vi.fn();
    const { c, r } = make({ onBonusBuy });
    c.openBuyBonus();
    expect(onBonusBuy).toHaveBeenCalled();
    expect(r.overlays.find((o) => o.kind === 'buyBonus')).toBeUndefined();
  });

  it('notifyResize switches to mobile when portrait', () => {
    const { c, r } = make();
    r.host.notifyResize(400, 800);
    expect(c.layout).toBe('mobile');
    expect(r.layouts.at(-1)).toBe('mobile');
  });

  it('setSound flips shared state, emits settingChange, and refreshes the open settings icon', () => {
    const { c } = make();
    const changed = vi.fn();
    const refresh = vi.fn();
    c.on('settingChange', changed);
    c.setSoundRefresh(refresh);
    c.setSound(false);
    expect(c.soundOn).toBe(false);
    expect(changed).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(refresh).toHaveBeenCalledWith(false);
  });

  it('deactivateFeature is a no-op with no active feature', () => {
    const { c } = make();
    const spy = vi.fn();
    c.on('featureDeactivate', spy);
    c.deactivateFeature();
    expect(spy).not.toHaveBeenCalled();
  });
});
