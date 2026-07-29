import { describe, it, expect, vi } from 'vitest';
import { ShellController } from '@/core/ShellController';
import { FakeRenderer } from './FakeRenderer';
import type { ShellConfig } from '@/core/types';
import { DEFAULT_MENU } from '@/core/menu';

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

  it('openSettings emits settingsOpen and opens the menu overlay (deprecated alias)', () => {
    const { c, r } = make();
    const spy = vi.fn();
    c.on('settingsOpen', spy);
    c.openSettings();
    expect(spy).toHaveBeenCalled();
    expect(r.overlays.at(-1)).toEqual({ kind: 'menu' });
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

  it('setSound flips shared state, emits settingChange, and refreshes the open menu', () => {
    const { c } = make();
    const changed = vi.fn();
    const refresh = vi.fn();
    c.on('settingChange', changed);
    c.setMenuRefresh(refresh);
    c.setSound(false);
    expect(c.soundOn).toBe(false);
    expect(changed).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(refresh).toHaveBeenCalledWith('sound', false);
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

describe('menu', () => {
  it('opens the menu overlay and toggles it closed on a second call', () => {
    const { c: shell, r } = make();
    const opened = vi.fn();
    shell.on('menuOpen', opened);
    shell.openMenu();
    expect(r.overlays.at(-1)).toEqual({ kind: 'menu' });
    expect(opened).toHaveBeenCalledOnce();
    const closedBefore = r.closed;
    shell.openMenu();
    expect(r.closed).toBe(closedBefore + 1);
    expect(opened).toHaveBeenCalledOnce(); // the second call closed, it did not re-open
  });

  it('openSettings stays as a deprecated alias', () => {
    const { c: shell, r } = make();
    const settings = vi.fn();
    shell.on('settingsOpen', settings);
    shell.openSettings();
    expect(settings).toHaveBeenCalledOnce();
    expect(r.overlays.at(-1)).toEqual({ kind: 'menu' });
  });

  it('defaults to DEFAULT_MENU and swaps the list with setMenu', () => {
    const { c: shell } = make();
    expect(shell.menu).toEqual(DEFAULT_MENU);
    shell.setMenu([{ id: 'sound' }, { id: 'speed', type: 'range', label: 'S', min: 1, max: 5, value: 3 }]);
    expect(shell.getMenuValue('speed')).toBe(3);
  });

  it('routes menu values to sound, volumes and the custom map', () => {
    const { c: shell } = make({
      menu: [{ id: 'sound' }, { id: 'music' }, { id: 'lefty', type: 'toggle', label: 'L' }],
    });
    const changes: Array<{ key: string; value: unknown }> = [];
    shell.on('settingChange', (e) => changes.push(e));

    shell.setMenuValue('sound', false);
    expect(shell.soundOn).toBe(false);
    expect(shell.getMenuValue('sound')).toBe(false);

    shell.setMenuValue('music', 5); // out of range → clamped
    expect(shell.getVolume('music')).toBe(1);
    expect(shell.getMenuValue('music')).toBe(1);

    shell.setMenuValue('lefty', true);
    expect(shell.state.menu.lefty).toBe(true);
    expect(shell.getMenuValue('lefty')).toBe(true);

    expect(changes).toEqual([
      { key: 'sound', value: false },
      { key: 'music', value: 1 },
      { key: 'lefty', value: true },
    ]);
  });

  it('clamps a custom range to its declared bounds', () => {
    const { c: shell } = make({
      menu: [{ id: 'speed', type: 'range', label: 'S', min: 1, max: 5, value: 2 }],
    });
    shell.setMenuValue('speed', 99);
    expect(shell.getMenuValue('speed')).toBe(5);
    shell.setMenuValue('speed', -3);
    expect(shell.getMenuValue('speed')).toBe(1);
  });

  it('pushes every value change to a registered refresher', () => {
    const { c: shell } = make();
    const seen: Array<[string, unknown]> = [];
    shell.setMenuRefresh((id, v) => seen.push([id, v]));
    shell.setSound(false);
    shell.setVolume('sfx', 0.25);
    expect(seen).toEqual([['sound', false], ['sfx', 0.25]]);
    shell.setMenuRefresh(null);
    shell.setVolume('sfx', 0.5);
    expect(seen).toHaveLength(2);
  });

  // Regression: destroy() left an open menu's overlay/overlayKind/menuRefresh untouched, so a
  // stale refresher survived teardown — a later setVolume()/setSound() call (e.g. from game code
  // that doesn't know the shell was torn down) would invoke it against an already-destroyed
  // renderer control (Pixi Graphics) and throw.
  it('destroy() closes an open menu first, so a stale refresher never fires after teardown', async () => {
    const { c: shell, r } = make();
    const refresh = vi.fn();
    shell.openMenu();
    shell.setMenuRefresh(refresh);
    expect(r.closed).toBe(0);

    await shell.destroy();
    expect(r.closed).toBe(1); // closeModal() ran and told the renderer to close

    shell.setVolume('music', 0.4);
    shell.setSound(false);
    expect(refresh).not.toHaveBeenCalled(); // the stale refresher was cleared, not just orphaned
  });
});
