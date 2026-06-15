// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: {
      rtp: 96.5,
      rules: 'Match symbols left to right.',
      symbols: [{ name: 'Wild', payouts: '5x = 100' }],
      features: [{ name: 'Free Spins', description: '3 scatters trigger 10 spins.' }],
    },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('GameInfo', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders rtp, rules, symbols and features from gameInfo', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('96.5');
    expect(modal.textContent).toContain('Match symbols left to right.');
    expect(modal.textContent).toContain('Wild');
    expect(modal.textContent).toContain('Free Spins');
  });

  it('omits sections that are not provided', () => {
    const c = cfg(mount);
    c.gameInfo = { rtp: 96 };
    const shell = createGameShell(c);
    shell.openInfo();
    expect(q(mount, '[data-ge="info-rules"]')).toBeNull();
    expect(q(mount, '[data-ge="info-symbols"]')).toBeNull();
    expect(q(mount, '[data-ge="info-rtp"]')).toBeTruthy();
  });

  it('has a back control that returns to Settings', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const back = q(mount, '[data-ge="info-back"]')!;
    expect(back).toBeTruthy();
    back.click();
    expect(q(mount, '[data-ge="settings-modal"]')).toBeTruthy();
  });
});
