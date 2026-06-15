/** True when the user (or environment) prefers no motion. Missing matchMedia
 *  — e.g. jsdom / SSR — is treated as reduced so animations never block. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true;
  return mm('(prefers-reduced-motion: reduce)').matches;
}

/** Animate el's text from `from` to `to` via `fmt`. Skips to final value when
 *  motion is reduced or rAF is unavailable. */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  fmt: (n: number) => string,
  durationMs = 450,
): void {
  const raf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
  if (prefersReducedMotion() || typeof raf !== 'function') {
    el.textContent = fmt(to);
    return;
  }
  const origin = (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
  const tick = (t: number) => {
    const start = origin;
    const p = Math.min(1, (t - start) / durationMs);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) raf(tick);
    else el.textContent = fmt(to);
  };
  raf(tick);
}
