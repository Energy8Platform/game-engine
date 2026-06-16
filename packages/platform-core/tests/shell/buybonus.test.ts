// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, BonusOption } from '@/shell/types';

const BONUSES: BonusOption[] = [
  { id: 'ante', type: 'feature', title: 'Ante Bet', description: 'Boosts trigger', priceMultiplier: 25, volatility: 3 },
  { id: 'bonus', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 5 },
];

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: BONUSES },
    ...over,
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
    createGameShell(cfg(mount));
    q(mount, '[data-ge="buybonus"]')!.click();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();
    expect(qa(mount, '[data-ge^="bonus-card-"]').length).toBe(2);
    // bet defaults to 2 → ante 25×2 = 50, bonus 100×2 = 200
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€50');
    expect(q(mount, '[data-ge="bonus-card-bonus"]')!.textContent).toContain('€200');
  });

  it('clicking a card opens the confirmation modal (does not buy directly)', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('confirm → Buy emits buyBonusSelect and closes the overlay', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    q(mount, '[data-ge="bonus-confirm-buy"]')!.click();
    expect(spy).toHaveBeenCalledWith({ id: 'bonus' });
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeFalsy();
  });

  it('confirm → Cancel closes the confirm, keeps the grid, buys nothing', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    q(mount, '[data-ge="bonus-confirm-cancel"]')!.click();
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeFalsy();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('recomputes price after setBet', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBet(1);
    shell.openBuyBonus();
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€25');
  });

  it('the overlay bet stepper re-prices every card and updates the bar', () => {
    const shell = createGameShell(cfg(mount)); // bet 2 → ante 25×2 = 50
    shell.openBuyBonus();
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€50');
    q(mount, '[data-ge="bb-bet-down"]')!.click(); // 2 → 1
    expect(shell.state.bet).toBe(1);
    expect(q(mount, '[data-ge="bonus-card-ante"]')!.textContent).toContain('€25'); // 25×1
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€1'); // control bar updated too
  });

  it('confirm → Buy is blocked when the shell goes busy while the modal is open', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    shell.setBusy(true); // a spin starts while the confirm sheet is still up
    q(mount, '[data-ge="bonus-confirm-buy"]')!.click();
    expect(spy).not.toHaveBeenCalled();
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeTruthy(); // not dismissed by the blocked click
  });

  it('confirm → Buy is blocked when buy-bonus is disabled while the modal is open', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-bonus"]')!.click();
    shell.setBuyBonusEnabled(false);
    q(mount, '[data-ge="bonus-confirm-buy"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it('overlay bet steppers disable at the range boundaries (like the control bar)', () => {
    const shell = createGameShell(cfg(mount)); // availableBets [1, 2], bet 2 (max)
    shell.openBuyBonus();
    expect((q(mount, '[data-ge="bb-bet-up"]') as HTMLButtonElement).disabled).toBe(true); // at max
    expect((q(mount, '[data-ge="bb-bet-down"]') as HTMLButtonElement).disabled).toBe(false);
    q(mount, '[data-ge="bb-bet-down"]')!.click(); // 2 → 1 (min)
    expect((q(mount, '[data-ge="bb-bet-down"]') as HTMLButtonElement).disabled).toBe(true); // at min
    expect((q(mount, '[data-ge="bb-bet-up"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an unaffordable card is disabled and does not open the confirm', () => {
    createGameShell(cfg(mount, { balance: 100 })); // bonus 100×2 = 200 > 100
    q(mount, '[data-ge="buybonus"]')!.click();
    const card = q(mount, '[data-ge="bonus-card-bonus"]')!;
    expect(card.classList.contains('ge-bonus-off')).toBe(true);
    expect((q(mount, '[data-ge="bonus-cta-bonus"]') as HTMLButtonElement).disabled).toBe(true);
    card.click();
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeFalsy();
  });
});

describe('Feature activation', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('confirming a feature shows the effective bet, tints it, and turns BUY BONUS into DISABLE', () => {
    const shell = createGameShell(cfg(mount));
    const onAct = vi.fn(); shell.on('featureActivate', onAct);
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-ante"]')!.click();      // feature
    q(mount, '[data-ge="bonus-confirm-buy"]')!.click();    // Activate
    expect(onAct).toHaveBeenCalledWith({ id: 'ante' });

    const betVal = q(mount, '[data-ge="bet-value"]')!;
    expect(betVal.classList.contains('ge-bet-feature')).toBe(true);
    expect(betVal.textContent).toContain('€50');           // 2 × 25
    expect(betVal.style.color).toBeTruthy();               // tinted
    expect(q(mount, '[data-ge="buybonus"]')!.textContent).toContain('DISABLE');
  });

  it('clicking DISABLE deactivates the feature and reverts the bet', () => {
    const shell = createGameShell(cfg(mount));
    shell.openBuyBonus();
    q(mount, '[data-ge="bonus-card-ante"]')!.click();
    q(mount, '[data-ge="bonus-confirm-buy"]')!.click();

    const onDeact = vi.fn(); shell.on('featureDeactivate', onDeact);
    q(mount, '[data-ge="buybonus"]')!.click();             // DISABLE
    expect(onDeact).toHaveBeenCalledWith({ id: 'ante' });
    expect(shell.state.activeFeature).toBeNull();
    const betVal = q(mount, '[data-ge="bet-value"]')!;
    expect(betVal.classList.contains('ge-bet-feature')).toBe(false);
    expect(q(mount, '[data-ge="buybonus"]')!.textContent).toContain('BUY');
  });
});
