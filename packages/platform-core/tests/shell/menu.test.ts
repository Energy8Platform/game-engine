// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('Menu + Settings', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('opens menu modal and emits menuOpen', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('menuOpen', spy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="menu-modal"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-settings"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-info"]')).toBeTruthy();
  });

  it('menu → settings opens settings modal and emits settingsOpen', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingsOpen', spy);
    q(mount, '[data-ge="menu"]')!.click();
    q(mount, '[data-ge="menu-settings"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });

  it('settings slider emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openSettings();
    const slider = q(mount, '[data-ge="setting-master"]') as HTMLInputElement;
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'master', value: 0.3 });
  });

  it('quick-spin toggle emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openSettings();
    q(mount, '[data-ge="setting-quickspin"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'quickSpin', value: true });
  });
});
