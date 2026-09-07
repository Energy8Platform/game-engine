import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * The wheel scrolls the buy-bonus cards (Pixi shell).
 *
 * Stake reviewed a Popout S (400×225) build and asked for the Get Bonus menu to be "scrollable, not
 * only draggable": there the cards stack taller than the frame, and the overlay moved them on a
 * pointer DRAG alone. Every other scroll region in this shell (game info, the menu popover — all
 * ScrollBox) already takes the wheel; the buy-bonus strip rolls its own scroll and did not.
 *
 * The same handler also has to swallow the gesture: on Stake the game runs in an iframe, and an
 * un-prevented wheel scrolls the casino page behind it.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from 'pixi.js';
import { openBuyBonus } from '@/ui/pixi/components/BuyBonus';
import type { BonusOption } from '@/core/types';
import { makeContext, defaultConfig } from './_host';

const BONUSES: BonusOption[] = [
  { id: 'ante', type: 'feature', title: 'Ante bet', description: '+25% to trigger frequency', priceMultiplier: 1.5, volatility: 2 },
  { id: 'buy10', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 4 },
  { id: 'buy20', type: 'bonus', title: 'Super Free Spins', description: '20 spins', priceMultiplier: 400, volatility: 5 },
  { id: 'buy50', type: 'bonus', title: 'Mega Free Spins', description: '50 spins', priceMultiplier: 900, volatility: 5 },
];

/** Eight options: enough that the row can't shrink to fit and scrolls sideways instead. */
const MANY: BonusOption[] = Array.from({ length: 8 }, (_, i) => ({
  id: `buy${i}`, type: 'bonus', title: `Buy ${i}`, description: `${i * 10} spins`,
  priceMultiplier: 50 * (i + 1), volatility: 4,
}));

/** The overlay's internals this test reads: where the card strip actually sits. */
interface Opened {
  strip: Container;
  onRemove?(): void;
}

function open(w: number, h: number, canvas: HTMLCanvasElement, bonuses: BonusOption[] = BONUSES): Opened {
  const host = makeContext({
    config: defaultConfig({
      availableBets: [1, 2, 5], defaultBet: 1, balance: 1_000_000,
      features: { turbo: 0, autoplay: {}, buyBonus: bonuses },
    }),
    screenW: w,
    screenH: h,
    canvas,
  });
  const layer = openBuyBonus(host);
  if (!layer) throw new Error('no buy-bonus overlay');
  return layer as unknown as Opened;
}

const wheel = (canvas: HTMLCanvasElement, deltaY: number): WheelEvent => {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
  canvas.dispatchEvent(e);
  return e;
};

describe('buy-bonus wheel scrolling (Pixi shell)', () => {
  it('scrolls the stacked cards on a Popout S frame', () => {
    const canvas = document.createElement('canvas');
    const { strip } = open(400, 225, canvas);
    const top = strip.position.y;
    wheel(canvas, 120);
    expect(strip.position.y).toBeLessThan(top);
  });

  it('scrolls back up and stops at both ends', () => {
    const canvas = document.createElement('canvas');
    const { strip } = open(400, 225, canvas);
    const top = strip.position.y;
    wheel(canvas, 100_000); // far past the last card
    const bottom = strip.position.y;
    expect(bottom).toBeLessThan(top);
    wheel(canvas, 100_000); // already at the end — nothing left to give
    expect(strip.position.y).toBe(bottom);
    wheel(canvas, -100_000);
    expect(strip.position.y).toBe(top); // back to the first card, not past it
  });

  it('moves the horizontal strip too, from a plain vertical wheel', () => {
    // Tall enough for the centred row (not the Popout S stack) and narrow enough that eight cards
    // hit the em floor and run off the sides — the only way the row overflows at all.
    const canvas = document.createElement('canvas');
    const { strip } = open(480, 400, canvas, MANY);
    const start = strip.position.x;
    wheel(canvas, 120);
    expect(strip.position.x).toBeLessThan(start);
  });

  it('swallows the gesture so it never scrolls the casino page behind the iframe', () => {
    const canvas = document.createElement('canvas');
    open(400, 225, canvas);
    expect(wheel(canvas, 120).defaultPrevented).toBe(true);
    // …including on a desktop frame where the cards fit and there is nothing to scroll.
    const canvas2 = document.createElement('canvas');
    open(1200, 675, canvas2);
    expect(wheel(canvas2, 120).defaultPrevented).toBe(true);
  });

  it('lets go of the canvas once the overlay is closed', () => {
    const canvas = document.createElement('canvas');
    const layer = open(400, 225, canvas);
    wheel(canvas, 120);
    const scrolled = layer.strip.position.y;
    layer.onRemove?.();
    const after = wheel(canvas, 120);
    expect(layer.strip.position.y).toBe(scrolled);
    expect(after.defaultPrevented).toBe(false);
  });
});
