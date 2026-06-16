/** True when the user (or environment) prefers no motion. Missing matchMedia
 *  — e.g. jsdom / SSR — is treated as reduced so animations never block. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true;
  return mm('(prefers-reduced-motion: reduce)').matches;
}

/** Animate el's text from `from` to `to` via `fmt`. Skips to final value when
 *  motion is reduced or rAF is unavailable. Returns a canceler that stops the loop —
 *  call it before the target node is detached so the rAF chain can't keep writing to
 *  (and pinning) a dead node, or stack up overlapping loops on rapid updates. */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  fmt: (n: number) => string,
  durationMs = 450,
): () => void {
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
