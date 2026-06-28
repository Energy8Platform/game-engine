// @vitest-environment jsdom
/**
 * Task 10: Two-phase keyboard navigation for the Buy Bonus overlay (DOM shell).
 *
 * Tests:
 * 1. Open Buy Bonus with ≥2 affordable options; ArrowRight moves card focus.
 * 2. Enter opens the confirm dialog for the focused card.
 * 3. Enter again emits buyBonusSelect with the FOCUSED bonus id.
 * 4. Escape from confirm returns to browse (no close).
 * 5. Escape from browse closes the overlay (modalOnKey cleared).
 * 6. Feature type: Enter in confirm calls activateFeature (not buyBonusSelect).
 * 7. Equal/Minus step the bet footer.
 * 8. No affordable cards: arrows do nothing (swallowed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig, BonusOption } from '@/core/types';

const BONUSES: BonusOption[] = [
  { id: 'ante', type: 'feature', title: 'Ante Bet', description: 'Boosts trigger', priceMultiplier: 10, volatility: 2 },
  { id: 'bonus', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 50, volatility: 4 },
];

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: BONUSES },
    ...over,
  };
}

const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const key = (code: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

describe('BuyBonus keyboard navigation (DOM shell)', () => {
  let mount: HTMLElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('ArrowRight moves focus to the next affordable card; Enter opens confirm for the focused card', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();

    // Both cards are affordable (ante: 10×2=20, bonus: 50×2=100, balance=1000)
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();

    // Default focus is on first affordable card (ante). ArrowRight → bonus (index 1)
    key('ArrowRight');

    // Enter: opens confirm for the focused card (bonus)
    key('Enter');

    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeTruthy();

    // The confirm should be for 'bonus' card
    const confirmText = q(mount, '[data-ge="bonus-confirm"]')!.textContent;
    expect(confirmText).toContain('Buy Free Spins');

    // buyBonusSelect not yet fired (still in confirm)
    expect(spy).not.toHaveBeenCalled();
  });

  it('Enter in confirm emits buyBonusSelect with the FOCUSED bonus id', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();

    // Focus is on first card (ante). Move to second (bonus)
    key('ArrowRight');
    key('Enter'); // open confirm for 'bonus'

    // Enter again: Buy
    key('Enter');

    expect(spy).toHaveBeenCalledWith({ id: 'bonus' });
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeFalsy();
  });

  it('Escape from confirm returns to browse (overlay still visible)', () => {
    const shell = createGameShell(cfg(mount));
    shell.openBuyBonus();

    // Open confirm for first card
    key('Enter');
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeTruthy();

    // Escape: back to browse
    key('Escape');
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeFalsy();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();
  });

  it('Escape from browse closes the overlay and clears modalOnKey', () => {
    const shell = createGameShell(cfg(mount));
    const spinSpy = vi.fn();
    shell.on('spin', spinSpy);
    shell.openBuyBonus();

    // Escape from browse
    key('Escape');
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeFalsy();

    // Verify modalOnKey is cleared: Space now fires spin
    key('Space');
    expect(spinSpy).toHaveBeenCalledOnce();
  });

  it('feature: Enter in confirm calls activateFeature (not buyBonusSelect)', () => {
    const shell = createGameShell(cfg(mount));
    const buySpy = vi.fn();
    const actSpy = vi.fn();
    shell.on('buyBonusSelect', buySpy);
    shell.on('featureActivate', actSpy);
    shell.openBuyBonus();

    // Focus starts at 'ante' (feature). Enter to open confirm.
    key('Enter');
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeTruthy();

    // Enter again: Activate
    key('Enter');

    expect(actSpy).toHaveBeenCalledWith({ id: 'ante' });
    expect(buySpy).not.toHaveBeenCalled();
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeFalsy();
  });

  it('Equal/Plus steps bet up, Minus steps bet down', () => {
    const shell = createGameShell(cfg(mount)); // bet=2, available=[1,2,5]
    shell.openBuyBonus();

    key('Equal'); // bet 2 → 5
    expect(shell.state.bet).toBe(5);

    key('Minus'); // bet 5 → 2
    expect(shell.state.bet).toBe(2);
  });

  it('Shift+↑/↓ and Shift+=/- step the bet (same keys as the bar)', () => {
    const shell = createGameShell(cfg(mount)); // bet=2, available=[1,2,5]
    shell.openBuyBonus();
    const shifted = (code: string) =>
      document.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey: true, bubbles: true, cancelable: true }));

    shifted('ArrowUp'); // 2 → 5
    expect(shell.state.bet).toBe(5);
    shifted('ArrowDown'); // 5 → 2
    expect(shell.state.bet).toBe(2);
    shifted('Equal'); // 2 → 5
    expect(shell.state.bet).toBe(5);
    shifted('Minus'); // 5 → 2
    expect(shell.state.bet).toBe(2);
  });

  it('bare ArrowUp/ArrowDown do NOT change the bet in wide (reserved, not bet keys)', () => {
    const shell = createGameShell(cfg(mount)); // wide layout, bet=2
    shell.openBuyBonus();
    key('ArrowUp');
    key('ArrowDown');
    expect(shell.state.bet).toBe(2);
  });

  it('ArrowLeft wraps back; Enter opens confirm for the card at new focus', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('buyBonusSelect', spy);
    shell.openBuyBonus();

    // Move right then back left to ante
    key('ArrowRight'); // focus: bonus
    key('ArrowLeft');  // focus: ante
    key('Enter');       // open confirm for ante

    const confirmText = q(mount, '[data-ge="bonus-confirm"]')!.textContent;
    expect(confirmText).toContain('Ante Bet');
  });

  it('two sequential Escapes: first from confirm → browse, second closes overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openBuyBonus();

    key('Enter');    // open confirm
    key('Escape');   // back to browse
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();

    key('Escape');   // close overlay
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeFalsy();
  });

  it('no affordable cards: arrows are swallowed, overlay stays open', () => {
    // bet=2: ante=10×2=20, bonus=50×2=100, both > balance=10
    const shell = createGameShell(cfg(mount, { balance: 10 }));
    const spinSpy = vi.fn();
    shell.on('spin', spinSpy);
    shell.openBuyBonus();

    // Arrows don't close the overlay
    key('ArrowRight');
    expect(q(mount, '[data-ge="buybonus-overlay"]')).toBeTruthy();

    key('Enter'); // no confirm opens (no affordable card focused)
    expect(q(mount, '[data-ge="bonus-confirm"]')).toBeFalsy();
  });

  it('ArrowDown/ArrowUp work in mobile layout but not in wide layout (parity with Pixi shell)', () => {
    const shell = createGameShell(cfg(mount));

    // Wide layout (default): ArrowDown does NOT move focus
    shell.openBuyBonus();
    key('ArrowDown'); // should be ignored in wide layout
    key('Enter');
    // If ArrowDown moved focus to bonus (index 1), confirm would say "Buy Free Spins"
    // In wide layout it stays at ante (index 0), so confirm says "Ante Bet"
    expect(q(mount, '[data-ge="bonus-confirm"]')!.textContent).toContain('Ante Bet');
    key('Escape'); // back to browse
    key('Escape'); // close overlay

    // Mobile layout: ArrowDown DOES move focus
    shell.setLayout('mobile');
    shell.openBuyBonus();
    key('ArrowDown'); // moves focus from ante (0) to bonus (1)
    key('Enter');     // confirm for bonus
    expect(q(mount, '[data-ge="bonus-confirm"]')!.textContent).toContain('Buy Free Spins');
    key('Escape'); // back to browse
    key('Escape'); // close overlay

    // Mobile layout: ArrowUp moves focus backward
    shell.openBuyBonus();
    key('ArrowDown'); // focus: bonus (1)
    key('ArrowUp');   // focus: ante (0)
    key('Enter');
    expect(q(mount, '[data-ge="bonus-confirm"]')!.textContent).toContain('Ante Bet');
  });
});
