import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Task 10: Two-phase keyboard navigation for the Buy Bonus overlay (Pixi shell).
 *
 * Tests that BuyBonusOverlay.onKey correctly handles both browse and confirm phases:
 * 1. ArrowRight moves focus to the next affordable card.
 * 2. Enter in browse phase opens confirm for the focused card.
 * 3. Enter in confirm phase fires buyBonusSelect with the FOCUSED card id.
 * 4. Escape from confirm returns to browse.
 * 5. Escape from browse calls host.closeLayer().
 * 6. Feature type: Enter in confirm calls activateFeature.
 * 7. Equal/Minus step the bet footer.
 * 8. Unknown keys return false.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PixiComponentContext, ShellLayer } from '@/ui/pixi/context';
import type { BonusOption } from '@/core/types';
import { openBuyBonus } from '@/ui/pixi/components/BuyBonus';
import { makeContext, defaultConfig, type HostOverrides } from './_host';

const BONUSES: BonusOption[] = [
  { id: 'ante', type: 'feature', title: 'Ante Bet', description: 'Boosts trigger', priceMultiplier: 10, volatility: 2 },
  { id: 'bonus', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 50, volatility: 4 },
];

function baseConfig(over: Record<string, unknown> = {}): any {
  return defaultConfig({ availableBets: [1, 2, 5], defaultBet: 2, balance: 1000, features: { turbo: 0, autoplay: {}, buyBonus: BONUSES }, ...over });
}

function makeHost(
  emitSpy: ReturnType<typeof vi.fn>,
  closeLayerSpy: ReturnType<typeof vi.fn>,
  activateFeatureSpy: ReturnType<typeof vi.fn> = vi.fn(),
  over: HostOverrides = {},
): PixiComponentContext {
  return makeContext({
    config: over.config ?? baseConfig(),
    emit: emitSpy as never,
    closeLayer: closeLayerSpy,
    // The activateFeature spy replaces the controller's activateFeature (which would emit
    // featureActivate + re-render); the test asserts the spy is invoked.
    actions: { activateFeature: activateFeatureSpy } as never,
    ...over,
  });
}

const key = (code: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });

function requireOnKey(layer: ShellLayer): (e: KeyboardEvent) => boolean {
  if (typeof layer.onKey !== 'function') throw new Error('Layer has no onKey method');
  return layer.onKey.bind(layer);
}

describe('BuyBonusOverlay keyboard navigation (Pixi shell)', () => {
  it('ArrowRight moves focus; Enter opens confirm for the focused card', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    // Both bonuses affordable (ante: 10×2=20, bonus: 50×2=100, balance=1000)
    // Default focus: index 0 (ante). ArrowRight → index 1 (bonus)
    expect(onKey(key('ArrowRight'))).toBe(true);

    // Enter: open confirm for bonus
    expect(onKey(key('Enter'))).toBe(true);

    // Confirm should now be showing (this.confirm set)
    // buyBonusSelect not yet fired
    expect(emitSpy).not.toHaveBeenCalledWith('buyBonusSelect', expect.anything());
  });

  it('Enter in confirm phase emits buyBonusSelect with the FOCUSED card id', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    // Focus on bonus (index 1)
    onKey(key('ArrowRight'));
    onKey(key('Enter')); // open confirm for bonus

    // Enter again: Buy
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('buyBonusSelect', { id: 'bonus' });
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('Escape from confirm returns to browse (no closeLayer called)', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    // Open confirm for first card
    onKey(key('Enter'));

    // Escape: back to browse
    expect(onKey(key('Escape'))).toBe(true);

    // closeLayer not called yet
    expect(closeLayerSpy).not.toHaveBeenCalled();

    // Now in browse phase: another Escape closes
    expect(onKey(key('Escape'))).toBe(true);
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('Escape from browse calls closeLayer', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    expect(onKey(key('Escape'))).toBe(true);
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('feature: Enter in confirm calls activateFeature (not buyBonusSelect)', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const activateSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy, activateSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    // Focus on ante (index 0, feature type). Enter opens confirm.
    onKey(key('Enter'));

    // Enter again: Activate
    onKey(key('Enter'));

    expect(activateSpy).toHaveBeenCalledOnce();
    expect(emitSpy).not.toHaveBeenCalledWith('buyBonusSelect', expect.anything());
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('Equal steps bet up; Minus steps bet down', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    // bet=2, availableBets=[1,2,5]
    expect(onKey(key('Equal'))).toBe(true); // 2 → 5
    expect(host.state.bet).toBe(5);

    expect(onKey(key('Minus'))).toBe(true); // 5 → 2
    expect(host.state.bet).toBe(2);
  });

  it('NumpadAdd and NumpadSubtract also step the bet', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    expect(onKey(key('NumpadAdd'))).toBe(true); // 2 → 5
    expect(host.state.bet).toBe(5);

    expect(onKey(key('NumpadSubtract'))).toBe(true); // 5 → 2
    expect(host.state.bet).toBe(2);
  });

  it('Shift+↑/↓ and Shift+=/- step the bet (same keys as the bar)', () => {
    const host = makeHost(vi.fn(), vi.fn());
    const onKey = requireOnKey(openBuyBonus(host)!);
    const shifted = (code: string) =>
      new KeyboardEvent('keydown', { code, shiftKey: true, bubbles: true, cancelable: true });
    // bet=2, availableBets=[1,2,5]
    expect(onKey(shifted('ArrowUp'))).toBe(true); // 2 → 5
    expect(host.state.bet).toBe(5);
    expect(onKey(shifted('ArrowDown'))).toBe(true); // 5 → 2
    expect(host.state.bet).toBe(2);
    expect(onKey(shifted('Equal'))).toBe(true); // 2 → 5
    expect(host.state.bet).toBe(5);
    expect(onKey(shifted('Minus'))).toBe(true); // 5 → 2
    expect(host.state.bet).toBe(2);
  });

  it('Shift+↓ steps the bet in mobile too (does not get hijacked by card nav)', () => {
    const host = makeHost(vi.fn(), vi.fn(), vi.fn(), { layout: 'mobile' });
    const onKey = requireOnKey(openBuyBonus(host)!);
    // bare ArrowDown navigates cards (bet unchanged); Shift+ArrowDown steps the bet.
    onKey(key('ArrowDown'));
    expect(host.state.bet).toBe(2);
    onKey(new KeyboardEvent('keydown', { code: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
    expect(host.state.bet).toBe(1); // 2 → 1
  });

  it('bare ArrowUp/ArrowDown do NOT change the bet in wide (reserved, not bet keys)', () => {
    const host = makeHost(vi.fn(), vi.fn(), vi.fn(), { layout: 'wide' });
    const onKey = requireOnKey(openBuyBonus(host)!);
    onKey(key('ArrowUp'));
    onKey(key('ArrowDown'));
    expect(host.state.bet).toBe(2);
  });

  it('ArrowLeft moves focus backward', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // index 0 → 1 (bonus)
    onKey(key('ArrowLeft'));  // index 1 → 0 (ante)
    onKey(key('Enter'));       // open confirm for ante

    // Now confirm is open; Enter fires activateFeature (ante is feature type)
    onKey(key('Enter'));
    expect(emitSpy).not.toHaveBeenCalledWith('buyBonusSelect', expect.anything());
    // activateFeature called via host
  });

  it('unknown key returns false', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    expect(onKey(key('KeyX'))).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(closeLayerSpy).not.toHaveBeenCalled();
  });

  it('Space also opens confirm in browse and fires buyBonusSelect in confirm', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // focus: bonus
    expect(onKey(key('Space'))).toBe(true); // open confirm for bonus

    expect(onKey(key('Space'))).toBe(true); // Buy
    expect(emitSpy).toHaveBeenCalledWith('buyBonusSelect', { id: 'bonus' });
  });

  it('no affordable cards: arrows swallowed, Enter does not open confirm', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    // balance=10, ante=10×2=20, bonus=50×2=100 — both unaffordable
    const config = baseConfig({ balance: 10 });
    const host = makeHost(emitSpy, closeLayerSpy, vi.fn(), { config });
    host.state.balance = 10;
    const layer = openBuyBonus(host)!;
    const onKey = requireOnKey(layer);

    expect(onKey(key('ArrowRight'))).toBe(true); // swallowed, no crash
    expect(onKey(key('Enter'))).toBe(true); // no confirm opens
    expect(closeLayerSpy).not.toHaveBeenCalled();
  });

  it('ArrowDown/ArrowUp work in mobile layout but not in wide layout (parity with DOM shell)', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();

    // Wide layout (default in makeHost): ArrowDown does NOT move focus
    const hostWide = makeHost(emitSpy, closeLayerSpy, vi.fn(), { layout: 'wide' });
    const layerWide = openBuyBonus(hostWide)!;
    const onKeyWide = requireOnKey(layerWide);

    // focus starts at ante (0); ArrowDown ignored in wide → confirm should be for ante
    onKeyWide(key('ArrowDown'));
    onKeyWide(key('Enter'));
    // In wide layout ArrowDown does nothing — confirm opened for ante (feature type)
    // If it had moved to bonus, activateFeature would NOT have been called with ante
    // We verify by checking emitSpy was not called with buyBonusSelect for ante
    // (ante is feature type so Enter fires activateFeature, not buyBonusSelect)
    onKeyWide(key('Enter')); // confirm → activate
    expect(emitSpy).not.toHaveBeenCalledWith('buyBonusSelect', expect.anything());

    // Mobile layout: ArrowDown DOES move focus
    const emitSpy2 = vi.fn();
    const closeLayerSpy2 = vi.fn();
    const hostMobile = makeHost(emitSpy2, closeLayerSpy2, vi.fn(), { layout: 'mobile' });
    const layerMobile = openBuyBonus(hostMobile)!;
    const onKeyMobile = requireOnKey(layerMobile);

    onKeyMobile(key('ArrowDown')); // focus: ante(0) → bonus(1)
    onKeyMobile(key('Enter'));     // confirm for bonus
    onKeyMobile(key('Enter'));     // buy
    expect(emitSpy2).toHaveBeenCalledWith('buyBonusSelect', { id: 'bonus' });

    // ArrowUp moves backward in mobile
    const emitSpy3 = vi.fn();
    const closeLayerSpy3 = vi.fn();
    const hostMobile2 = makeHost(emitSpy3, closeLayerSpy3, vi.fn(), { layout: 'mobile' });
    const layerMobile2 = openBuyBonus(hostMobile2)!;
    const onKeyMobile2 = requireOnKey(layerMobile2);

    onKeyMobile2(key('ArrowDown')); // focus: bonus (1)
    onKeyMobile2(key('ArrowUp'));   // focus: ante (0)
    onKeyMobile2(key('Enter'));     // confirm for ante (feature)
    onKeyMobile2(key('Enter'));     // activate
    expect(emitSpy3).not.toHaveBeenCalledWith('buyBonusSelect', expect.anything());
  });
});
