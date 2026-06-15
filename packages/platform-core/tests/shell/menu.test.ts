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

  it('menu has a sound toggle that emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    q(mount, '[data-ge="menu"]')!.click();
    const sound = q(mount, '[data-ge="menu-sound"]') as HTMLButtonElement;
    expect(sound).toBeTruthy();
    sound.click();
    // sound starts enabled (true) → first click mutes (false)
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
  });

  it('menu has a fullscreen entry that is clickable without throwing', () => {
    const shell = createGameShell(cfg(mount));
    q(mount, '[data-ge="menu"]')!.click();
    const fs = q(mount, '[data-ge="menu-fullscreen"]') as HTMLButtonElement;
    expect(fs).toBeTruthy();
    // jsdom has no Fullscreen API; the handler must guard and not throw
    expect(() => fs.click()).not.toThrow();
  });
});
