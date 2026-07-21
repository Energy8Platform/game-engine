// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import { icon } from '@/ui/html/icons';
import type { ShellConfig, ShellFeatures } from '@/core/types';

function cfg(mount: HTMLElement, features: Partial<ShellFeatures> = {}): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false, ...features },
  };
}
const q = (m: HTMLElement, sel: string) => m.querySelector(sel) as HTMLElement | null;

describe('BottomBar base mode', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders spin/bet/balance/win/menu by default', () => {
    createGameShell(cfg(mount));
    expect(q(mount, '[data-ge="spin"]')).toBeTruthy();
    expect(q(mount, '[data-ge="bet-up"]')).toBeTruthy();
    expect(q(mount, '[data-ge="bet-down"]')).toBeTruthy();
    expect(q(mount, '[data-ge="balance"]')!.textContent).toContain('€1.000');
    expect(q(mount, '[data-ge="menu"]')).toBeTruthy();
  });

  it('gates turbo/autoplay/buyBonus on features', () => {
    createGameShell(cfg(mount, { turbo: 0, autoplay: null, buyBonus: false }));
    expect(q(mount, '[data-ge="turbo"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
  });

  it('shows turbo + buyBonus when enabled', () => {
    createGameShell(cfg(mount, { turbo: 3, buyBonus: [{ id: 'b', title: 'Bonus', description: 'd', priceMultiplier: 100 }] }));
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
    expect(q(mount, '[data-ge="buybonus"]')).toBeTruthy();
  });

  it('emits spin on spin click', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    q(mount, '[data-ge="spin"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('emits betChange and updates display on bet-up', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('betChange', spy);
    q(mount, '[data-ge="bet-up"]')!.click();
    expect(spy).toHaveBeenCalledWith(5);
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€5');
  });

  it('emits turboChange cycling levels', () => {
    const shell = createGameShell(cfg(mount, { turbo: 2 }));
    const spy = vi.fn();
    shell.on('turboChange', spy);
    q(mount, '[data-ge="turbo"]')!.click();
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('turbo: glyph SWAPS per level (turboOff → turbo1 → turbo2); ge-turbo-{0,1,2} class caps at 2; wraps', () => {
    createGameShell(cfg(mount, { turbo: 3 }));
    const glyphHTML = (name: 'turboOff' | 'turbo1' | 'turbo2') => {
      const tmp = document.createElement('div');
      tmp.innerHTML = icon(name);
      return tmp.innerHTML;
    };
    const btn = () => q(mount, '[data-ge="turbo"]')!;
    const lvl = () => ['ge-turbo-0', 'ge-turbo-1', 'ge-turbo-2'].find((c) => btn().classList.contains(c));
    const expectGlyph = (name: 'turboOff' | 'turbo1' | 'turbo2') => expect(btn().innerHTML).toBe(glyphHTML(name));

    expectGlyph('turboOff'); expect(lvl()).toBe('ge-turbo-0'); expect(btn().classList.contains('ge-active')).toBe(false); // off — single bolt, muted
    btn().click(); expectGlyph('turbo1'); expect(lvl()).toBe('ge-turbo-1'); expect(btn().classList.contains('ge-active')).toBe(true); // L1 — single bolt, accent
    btn().click(); expectGlyph('turbo2'); expect(lvl()).toBe('ge-turbo-2'); // L2 — bolt + speed lines
    btn().click(); expectGlyph('turbo2'); expect(lvl()).toBe('ge-turbo-2'); // L3 caps at the L2 glyph
    btn().click(); expectGlyph('turboOff'); expect(lvl()).toBe('ge-turbo-0'); // wraps back to off
  });

  it('turbo/autoplay carry ge-active (white) only when engaged', () => {
    const shell = createGameShell(cfg(mount, { turbo: 3, autoplay: {} }));
    const turbo = () => q(mount, '[data-ge="turbo"]')!;
    const auto = () => q(mount, '[data-ge="autoplay"]')!;
    expect(turbo().classList.contains('ge-active')).toBe(false); // resting grey
    expect(auto().classList.contains('ge-active')).toBe(false);
    turbo().click();
    shell.setAutoplay({ active: true, remaining: 10 }); // engaging is now host-driven (via the picker)
    expect(turbo().classList.contains('ge-active')).toBe(true); // engaged white
    expect(auto().classList.contains('ge-active')).toBe(true);
  });

  it('disables the stepper at the bet range boundary', () => {
    const shell = createGameShell(cfg(mount)); // availableBets [1,2,5], starts at 2 (middle)
    const up = () => q(mount, '[data-ge="bet-up"]') as HTMLButtonElement;
    const down = () => q(mount, '[data-ge="bet-down"]') as HTMLButtonElement;
    expect(up().disabled).toBe(false);
    expect(down().disabled).toBe(false);
    shell.setBet(5); // top of range
    expect(up().disabled).toBe(true);
    expect(down().disabled).toBe(false);
    shell.setBet(1); // bottom of range
    expect(up().disabled).toBe(false);
    expect(down().disabled).toBe(true);
  });

  it('setBusy disables spin/bet but keeps menu enabled', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBusy(true);
    expect((q(mount, '[data-ge="spin"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(mount, '[data-ge="bet-up"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(mount, '[data-ge="menu"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('setBalance/setWin update the HUD', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBalance(250);
    shell.setWin(42);
    expect(q(mount, '[data-ge="balance"]')!.textContent).toContain('€250');
    expect(q(mount, '[data-ge="win"]')!.textContent).toContain('€42');
  });

  it('setBuyBonusEnabled(false) disables the bottom-bar buy bonus button', () => {
    const shell = createGameShell(cfg(mount, { buyBonus: [{ id: 'b', title: 'Bonus', description: 'd', priceMultiplier: 100 }] }));
    expect((q(mount, '[data-ge="buybonus"]') as HTMLButtonElement).disabled).toBe(false);
    shell.setBuyBonusEnabled(false);
    expect((q(mount, '[data-ge="buybonus"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('buy bonus button stays enabled when buyBonusEnabled is true and not busy', () => {
    const shell = createGameShell(cfg(mount, { buyBonus: [{ id: 'b', title: 'Bonus', description: 'd', priceMultiplier: 100 }] }));
    expect((q(mount, '[data-ge="buybonus"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders SVG icons for icon controls (not text glyphs)', () => {
    createGameShell(cfg(mount, { turbo: 2, buyBonus: [{ id: 'b', title: 'B', description: 'd', priceMultiplier: 1 }] }));
    expect(q(mount, '[data-ge="menu"]')!.querySelector('svg')).toBeTruthy();
    expect(q(mount, '[data-ge="turbo"]')!.querySelector('svg')).toBeTruthy();
    expect(q(mount, '[data-ge="spin"]')!.querySelector('svg')).toBeTruthy();
  });
});
