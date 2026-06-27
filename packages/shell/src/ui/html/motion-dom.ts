import { prefersReducedMotion } from '@/core/motion';

/** Animate el's text from→to via fmt on requestAnimationFrame; jumps to final when motion is
 *  reduced/unavailable. Returns a canceler. (Verbatim behavior of platform-core motion.ts countUp.) */
export function countUp(el: HTMLElement, from: number, to: number, fmt: (n: number) => string, durationMs = 450): () => void {
  const raf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
  const caf = (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
  if (prefersReducedMotion() || typeof raf !== 'function') {
    el.textContent = fmt(to);
    return () => {};
  }
  let handle = 0;
  let cancelled = false;
  const origin = (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
  const tick = (t: number) => {
    if (cancelled) return;
    const start = origin;
    const p = Math.min(1, (t - start) / durationMs);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) handle = raf(tick);
    else el.textContent = fmt(to);
  };
  handle = raf(tick);
  return () => {
    cancelled = true;
    if (typeof caf === 'function') caf(handle);
  };
}
