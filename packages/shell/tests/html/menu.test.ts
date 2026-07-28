// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('Settings overlay (opened from menu)', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('menu button opens the Settings overlay and emits menuOpen (not the deprecated settingsOpen)', () => {
    const shell = createGameShell(cfg(mount));
    const menuSpy = vi.fn(); const setSpy = vi.fn();
    shell.on('menuOpen', menuSpy); shell.on('settingsOpen', setSpy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(menuSpy).toHaveBeenCalledOnce();
    expect(setSpy).not.toHaveBeenCalled(); // settingsOpen is only emitted by the deprecated openSettings() alias
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });

  it('Settings has Sound toggle + music/sfx sliders, no quickspin', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    expect(q(mount, '[data-ge="setting-sound"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-music"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-sfx"]')).toBeTruthy();
    expect(q(mount, '[data-ge="setting-quickspin"]')).toBeNull();
  });

  it('sound toggle emits settingChange', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('settingChange', spy);
    shell.openSettings();
    q(mount, '[data-ge="setting-sound"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
  });

  it('Game info button opens the Game info overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    const btn = q(mount, '[data-ge="game-info-btn"]')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
  });
});
