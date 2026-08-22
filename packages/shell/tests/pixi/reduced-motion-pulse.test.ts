import { describe, it, expect } from 'vitest';
import { Ticker } from 'pixi.js';
import { BuyBonusBadge } from '@/ui/pixi/primitives/widgets';
import { tween } from '@/ui/pixi/motion-pixi';
import { prefersReducedMotion } from '@/core/motion';
import { DEFAULT_TOKENS } from '@/core/theme';

// Regression: the buy-bonus CTA crashed the game for every player running the OS "reduce motion"
// setting. `tween` does not animate under reduced motion — it applies the final value and calls
// `onComplete` SYNCHRONOUSLY — and the badge's pulse restarted itself from that `onComplete`, so
// hovering it recursed tween → onComplete → tween → … with no unwind until
// `RangeError: Maximum call stack size exceeded`. On Stake that fired the instant the buy-bonus
// panel painted its hovered CTA, so the player could never buy the bonus.
//
// jsdom has no `matchMedia`, so `prefersReducedMotion()` is already true here — hovering the badge
// is enough to reproduce it, no media-query stubbing needed.

describe('reduced motion', () => {
  it('is what this environment reports (the precondition these tests rely on)', () => {
    expect(prefersReducedMotion()).toBe(true);
  });

  it('completes a tween synchronously — so onComplete is NOT an async boundary', () => {
    const ticker = new Ticker();
    const seen: string[] = [];
    tween(ticker, { duration: 700, onUpdate: (p) => seen.push(`update:${p}`), onComplete: () => seen.push('complete') });
    // Both already happened, before tween() returned and without the ticker ever running.
    expect(seen).toEqual(['update:1', 'complete']);
    ticker.destroy();
  });

  it('does not blow the stack when the buy-bonus CTA is hovered', () => {
    const ticker = new Ticker();
    const badge = new BuyBonusBadge({
      bg: '#8b5cf6',
      label: 'BUY',
      tokens: DEFAULT_TOKENS,
      ticker,
      onTap: () => {},
    });

    // `paint(true)` — what a pointerover does — is where startPulse() used to recurse forever.
    expect(() => badge.emit('pointerover')).not.toThrow();
    // No pulse under reduced motion: the content stays at rest instead of looping 1 → 1.16.
    expect(badge.scale.x).toBe(1);

    badge.destroy({ children: true });
    ticker.destroy();
  });
});
