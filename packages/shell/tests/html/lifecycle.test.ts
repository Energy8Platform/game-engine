// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig & { mount: HTMLElement } {
  return {
    mount,
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5],
    defaultBet: 2,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}

describe('GameShell lifecycle', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('mounts a single overlay root into the mount element', () => {
    createGameShell(cfg(mount));
    expect(mount.querySelectorAll('#__ge-game-shell__').length).toBe(1);
  });

  it('injects the theme vars and stylesheet', () => {
    createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    expect(root.getAttribute('style')).toContain('--shell-accent');
    expect(mount.querySelector('style')).toBeTruthy();
  });

  it('removeGameShell() resolves and removes the root (idempotent)', async () => {
    createGameShell(cfg(mount));
    await removeGameShell();
    expect(mount.querySelector('#__ge-game-shell__')).toBeNull();
    await expect(removeGameShell()).resolves.toBeUndefined();
  });

  it('createGameShell twice does not duplicate the root', () => {
    createGameShell(cfg(mount));
    createGameShell(cfg(mount));
    expect(document.querySelectorAll('#__ge-game-shell__').length).toBe(1);
  });
});
