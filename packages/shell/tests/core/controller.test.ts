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

  it('setWin count-up: default length, per-call durationMs, and snap', () => {
    const { c, r } = make();
    c.setWin(0.4);
    expect(r.money.at(-1)).toEqual({ field: 'win', from: 0, to: 0.4, durationMs: undefined });
    // A cascade step passes its own length so the count-up fits inside the step.
    c.setWin(1.2, { durationMs: 220 });
    expect(r.money.at(-1)).toEqual({ field: 'win', from: 0.4, to: 1.2, durationMs: 220 });
    const anims = r.money.length;
    c.setWin(0, { animate: false });
    expect(r.money.length).toBe(anims); // snapped: repaint only, no count-up
    expect(c.state.win).toBe(0);
  });

  it('setWin does not re-animate when the value already matches (host final == last report)', () => {
    const { c, r } = make();
    c.setWin(3.8, { durationMs: 220 }); // the scene's last cascade report
    const anims = r.money.length;
    c.setWin(3.8); // the host's authoritative segment value — same number, no visual jump
    expect(r.money.length).toBe(anims);
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

  it('closeModal tears the overlay down exactly once and is a no-op when nothing is open', () => {
    const { c, r } = make();
    c.openSettings();
    expect(r.closed).toBe(0);   // opening the first overlay must not fire closeOverlay
    c.closeModal();
    expect(r.closed).toBe(1);   // closed exactly once
    c.closeModal();
    expect(r.closed).toBe(1);   // no-op when nothing is open
  });
});
