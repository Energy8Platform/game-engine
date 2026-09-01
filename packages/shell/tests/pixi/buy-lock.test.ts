import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * The buy-bonus coin must be inert while a round is in flight.
 *
 * Written to answer the QA report "press spin and you can still hit buy bonus" — specifically, to
 * establish whether the POINTER path has a window. It does not: the bar is rebuilt synchronously
 * inside setBusy() and each builder ends in applyBusy(). Keeping the check means a future refactor
 * that drops one of those applyBusy() calls, or makes renderBar() deferred, fails here rather than
 * in a submission review.
 */
import { describe, it, expect } from 'vitest';
import { BottomBar } from '@/ui/pixi/components/BottomBar';
import type { BonusOption } from '@/core/types';
import { makeContext, defaultConfig } from './_host';

const BONUS: BonusOption[] = [
  { id: 'buy10', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 4 },
];

/** The coin, reached through the bar's own field — it has no label to query by. Asserted on
 *  `eventMode`, not on `disabled`: BuyBonusBadge declares a `disabled` setter with no getter, so
 *  reading it back says nothing. `eventMode` is what actually decides whether a tap lands. */
function coinOf(bar: BottomBar): { eventMode: string } {
  const buy = (bar as unknown as { buy?: { eventMode: string } }).buy;
  expect(buy, 'the bar should have built a buy-bonus coin').toBeTruthy();
  return buy!;
}

function barWith(state: Record<string, unknown>, layout: 'wide' | 'mobile' = 'wide'): BottomBar {
  const host = makeContext({
    config: defaultConfig({ balance: 1_000_000, features: { turbo: 0, autoplay: {}, buyBonus: BONUS } }),
    ...(layout === 'mobile' ? { screenW: 390, screenH: 844, layout } : { screenW: 1200, screenH: 675, layout }),
  });
  Object.assign(host.state, state);
  return new BottomBar(host);
}

describe('buy-bonus coin locks (pointer path)', () => {
  it('is live when the game is idle', () => {
    expect(coinOf(barWith({ busy: false })).eventMode).not.toBe('none');
  });

  it('is inert while a round is playing', () => {
    // not merely dimmed — taps must not reach it
    expect(coinOf(barWith({ busy: true })).eventMode).toBe('none');
  });

  it('is inert during an autoplay run', () => {
    expect(coinOf(barWith({ autoplay: { active: true, remaining: 5 } })).eventMode).toBe('none');
  });

  it('is inert when the host has turned buying off at runtime', () => {
    expect(coinOf(barWith({ buyBonusEnabled: false })).eventMode).toBe('none');
  });
});

/**
 * The same four locks in the PORTRAIT bar.
 *
 * This is the layout the bug was actually reported against — a phone, spin tapped, buy-bonus opened
 * straight after. `buildWide()` stored its coin on `this.buy`; `buildMobile()` kept it in a local,
 * so `applyBusy()` — which guards every line with `if (this.buy)` — silently did nothing on mobile.
 * The coin was drawn, laid out and tappable, and no state change could ever dim it.
 */
describe('buy-bonus coin locks (portrait bar)', () => {
  it('is live when the game is idle', () => {
    expect(coinOf(barWith({ busy: false }, 'mobile')).eventMode).not.toBe('none');
  });

  it('is inert while a round is playing — the reported bug', () => {
    expect(coinOf(barWith({ busy: true }, 'mobile')).eventMode).toBe('none');
  });

  it('is inert during an autoplay run', () => {
    expect(coinOf(barWith({ autoplay: { active: true, remaining: 5 } }, 'mobile')).eventMode).toBe('none');
  });

  it('is inert when the host has turned buying off at runtime', () => {
    expect(coinOf(barWith({ buyBonusEnabled: false }, 'mobile')).eventMode).toBe('none');
  });
});
