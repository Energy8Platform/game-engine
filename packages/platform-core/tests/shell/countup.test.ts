// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return { mount, gameInfo: {}, language: 'en', currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null, balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false } };
}

describe('count-up (reduced motion in jsdom → final value immediately)', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('setWin shows the final formatted value synchronously under reduced motion', () => {
    const shell = createGameShell(cfg(mount));
    shell.setWin(42);
    expect((mount.querySelector('[data-ge="win"]') as HTMLElement).textContent).toContain('€42');
  });

  it('setBalance shows the final formatted value synchronously', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBalance(250);
    expect((mount.querySelector('[data-ge="balance"]') as HTMLElement).textContent).toContain('€250');
  });
});
