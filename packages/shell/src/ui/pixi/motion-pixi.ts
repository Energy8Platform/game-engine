import type { Text, Ticker } from 'pixi.js';
import { prefersReducedMotion, easeOutCubic } from '@/core/motion';
import { setText } from './text';

export interface TweenOpts {
  duration: number;
  ease?: (p: number) => number;
  onUpdate: (v: number) => void;
  onComplete?: () => void;
}

/**
 * Tween 0→1 on the Pixi ticker. Returns a canceler. Skips to the end when motion is reduced.
 *
 * CONTRACT — when motion is reduced (or `duration <= 0`) this tween does NOT animate: it applies
 * the final value and calls `onComplete` SYNCHRONOUSLY, before returning. Callers depend on that
 * (`PixiRenderer.destroy` resolves its teardown promise from `onComplete`, and must not wait on a
 * ticker that may already be stopped), so it must stay synchronous.
 *
 * The consequence for callers: `onComplete` is NOT an async boundary. An `onComplete` that starts
 * another tween is then direct recursion with no unwind — tween → onComplete → tween → … until
 * `RangeError: Maximum call stack size exceeded`. That shipped once: the CTA pulse loop
 * (`widgets.ts` startPulse) restarted itself from `onComplete`, so every player running the OS
 * "reduce motion" setting crashed the instant the buy-bonus panel painted its hovered CTA. Any
 * looping animation must therefore check `prefersReducedMotion()` and not loop — which is also
 * what reduced motion is asking for.
 */
export function tween(ticker: Ticker, opts: TweenOpts): () => void {
  const ease = opts.ease ?? easeOutCubic;
  if (prefersReducedMotion() || opts.duration <= 0) {
    opts.onUpdate(1);
    opts.onComplete?.();
    return () => {};
  }
  let elapsed = 0;
  let done = false;
  const tick = (t: Ticker): void => {
    if (done) return;
    elapsed += t.deltaMS;
    const p = Math.min(1, elapsed / opts.duration);
    opts.onUpdate(ease(p));
    if (p >= 1) {
      done = true;
      ticker.remove(tick);
      opts.onComplete?.();
    }
  };
  ticker.add(tick);
  return () => {
    if (done) return;
    done = true;
    ticker.remove(tick);
  };
}

/** Count a Text's numeric value from→to via `fmt`. Returns a canceler — call it before the Text
 *  is destroyed so the loop can't keep writing to a dead node. Mirrors the DOM shell's countUp
 *  (easeOutCubic, 450ms default, jumps to final when motion is reduced). */
export function countUpText(
  ticker: Ticker,
  text: Text,
  from: number,
  to: number,
  fmt: (n: number) => string,
  durationMs = 450,
): () => void {
  return tween(ticker, {
    duration: durationMs,
    ease: easeOutCubic,
    onUpdate: (p) => setText(text, fmt(from + (to - from) * p)),
    onComplete: () => setText(text, fmt(to)),
  });
}
