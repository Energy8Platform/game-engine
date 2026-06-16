// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement, isSocial: boolean): ShellConfig {
  return {
    mount, gameInfo: {
      sections: [
        { type: 'controls' },
        { type: 'paytable', rows: [{ symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 250 }] }] },
      ],
    },
    language: 'en', isSocial,
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: {
      turbo: 0, autoplay: {},
      buyBonus: [{ id: 'b', title: 'Bonus', description: 'd', priceMultiplier: 100 }],
    },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('isSocial vocabulary', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('leaves the bar in plain English by default', () => {
    createGameShell(cfg(mount, false));
    expect(q(mount, '[data-ge="bet-value"] .ge-lbl')!.textContent).toBe('Bet');
    expect(q(mount, '[data-ge="buybonus"]')!.textContent).toContain('BUY');
  });

  it('swaps shell labels on the bar when isSocial', () => {
    createGameShell(cfg(mount, true));
    expect(q(mount, '[data-ge="bet-value"] .ge-lbl')!.textContent).toBe('Play'); // Bet → Play
    const buy = q(mount, '[data-ge="buybonus"]')!;
    expect(buy.textContent).toContain('GET'); // BUY BONUS → GET BONUS
    expect(buy.textContent).not.toContain('BUY');
    expect(buy.innerHTML).toContain('<br>'); // still two lines
  });

  it('socializes the shell-owned Game Info strings, not the game content', () => {
    const shell = createGameShell(cfg(mount, true));
    shell.openInfo();
    const controls = q(mount, '[data-ge="info-controls"]')!;
    expect(controls.textContent).toContain('Raise play'); // Raise bet → Raise play
    expect(controls.textContent).toContain('play amount'); // "Increase your stake." → "...play amount."
    expect(controls.textContent).toContain('Get bonus'); // Buy bonus → Get bonus
    // game-supplied paytable symbol name is left untouched
    expect(q(mount, '[data-ge="info-paytable"]')!.textContent).toContain('Wild');
  });

  it('socializes the buy-bonus overlay title and the card CTA', () => {
    const shell = createGameShell(cfg(mount, true));
    shell.openBuyBonus();
    expect(q(mount, '.ge-ov-title')!.textContent).toBe('Get bonus');
    expect(q(mount, '[data-ge="bonus-cta-b"]')!.textContent).toBe('Play'); // Buy → Play
  });

  it('setSocial toggles the bar at runtime', () => {
    const shell = createGameShell(cfg(mount, false));
    expect(q(mount, '[data-ge="bet-value"] .ge-lbl')!.textContent).toBe('Bet');
    shell.setSocial(true);
    expect(q(mount, '[data-ge="bet-value"] .ge-lbl')!.textContent).toBe('Play');
  });
});
