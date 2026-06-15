// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, ShellFeatures } from '@/shell/types';

function cfg(mount: HTMLElement, features: Partial<ShellFeatures> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: true, buyBonus: false, ...features },
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
    createGameShell(cfg(mount, { turbo: 0, autoplay: false, buyBonus: false }));
    expect(q(mount, '[data-ge="turbo"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
  });

  it('shows turbo + buyBonus when enabled', () => {
    createGameShell(cfg(mount, { turbo: 3, buyBonus: [{ id: 'b', name: 'Bonus', description: 'd', priceMultiplier: 100 }] }));
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
});
