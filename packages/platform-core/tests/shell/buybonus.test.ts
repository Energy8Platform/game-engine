// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, BonusOption } from '@/shell/types';

const BONUSES: BonusOption[] = [
  { id: 'ante', name: 'Ante Bet', description: 'Boosts trigger', priceMultiplier: 25, volatility: 3, accentColor: '#ff0' },
  { id: 'bonus', name: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 5 },
];

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: BONUSES },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const qa = (m: HTMLElement, s: string) => Array.from(m.querySelectorAll(s)) as HTMLElement[];

describe('BuyBonus overlay', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('opens overlay with a card per bonus and live price = priceMultiplier × bet', () => {
    const shell = createGameShell(cfg(mount));
    q(mount, '[data-ge="buybonus"]')!.click();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();
    const cards = qa(mount, '[data-ge^="bonus-card-"]');
    expect(cards.length).toBe(2);
    // bet defaults to 2 → ante 25×2 = 50, bonus 100×2 = 200
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€50');
    expect(q(mount, '[data-ge="bonus-card-bonus"]')!.textContent).toContain('€200');
  });

  it('emits buyBonusSelect with id on card click', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    expect(spy).toHaveBeenCalledWith({ id: 'bonus' });
  });

  it('recomputes price after setBet', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBet(1);
    shell.openBuyBonus();
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€25');
  });
});
