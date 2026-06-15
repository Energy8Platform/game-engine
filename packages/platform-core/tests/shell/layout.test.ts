// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('GameShell layout', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('defaults to wide layout (no ResizeObserver dimensions in jsdom)', () => {
    const shell = createGameShell(cfg(mount));
    expect(shell.layout).toBe('wide');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-narrow')).toBe(false);
  });

  it('setLayout("narrow") adds the ge-narrow class and re-renders', () => {
    const shell = createGameShell(cfg(mount));
    shell.setLayout('narrow');
    expect(shell.layout).toBe('narrow');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-narrow')).toBe(true);
  });

  it('opening the menu opens the Settings overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    expect(mount.querySelector('[data-ge="settings-modal"]')).toBeTruthy();
  });
});
