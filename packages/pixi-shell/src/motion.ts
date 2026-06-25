import type { Text, Ticker } from 'pixi.js';
import { setText } from './text';

/** True when the user (or environment) prefers no motion. Missing matchMedia is treated as
 *  reduced so animations never block — same rule as the DOM shell's motion.ts. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true; // no matchMedia (jsdom/SSR) → reduced, like the DOM shell
  return mm('(prefers-reduced-motion: reduce)').matches;
}

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
export const easeInOutQuad = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export interface TweenOpts {
  duration: number;
  ease?: (p: number) => number;
  onUpdate: (v: number) => void;
  onComplete?: () => void;
}

/** Tween 0→1 on the Pixi ticker. Returns a canceler. Skips to the end when motion is reduced. */
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
