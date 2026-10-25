import type { Container, Ticker } from 'pixi.js';
import { MOTION } from './theme';

/** §7: the OS reduced-motion setting (or no matchMedia at all) — no shake, squash or glyph spin. */
export function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const ease = {
  linear: (p: number) => p,
  power1Out: (p: number) => 1 - (1 - p) * (1 - p),
  power2In: (p: number) => p * p * p,
  power2Out: (p: number) => 1 - Math.pow(1 - p, 3),
  power3Out: (p: number) => 1 - Math.pow(1 - p, 4),
  backOut: (s: number) => (p: number) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
};

export interface TweenOpts {
  duration: number;
  delay?: number;
  ease?: (p: number) => number;
  onUpdate: (v: number) => void;
  onComplete?: () => void;
}

/** Tween 0→1 on the ticker; returns a canceler. Reduced motion (or duration ≤ 0) jumps to the end
 *  SYNCHRONOUSLY — so a looping animation must not restart itself from `onComplete`. */
export function tween(ticker: Ticker, o: TweenOpts): () => void {
  if (reducedMotion() || o.duration <= 0) {
    o.onUpdate(1);
    o.onComplete?.();
    return () => {};
  }
  const f = o.ease ?? ease.power2Out;
  let t = -(o.delay ?? 0);
  let done = false;
  const tick = (tk: Ticker): void => {
    t += tk.deltaMS;
    if (t < 0) return;
    const p = Math.min(1, t / o.duration);
    o.onUpdate(f(p));
    if (p >= 1) {
      done = true;
      ticker.remove(tick);
      o.onComplete?.();
    }
  };
  ticker.add(tick);
  return () => {
    if (!done) ticker.remove(tick);
    done = true;
  };
}

/** "Everything that talks appears from its tail tip" (§7): scale 0 → 1, back.out(2.2). The node's
 *  pivot must already sit at the tail tip. */
export function bubblePop(ticker: Ticker, node: Container, delay = 0): () => void {
  node.scale.set(0);
  return tween(ticker, {
    duration: MOTION.bubblePop.dur,
    delay,
    ease: ease.backOut(2.2),
    onUpdate: (p) => {
      if (!node.destroyed) node.scale.set(p);
    },
  });
}
