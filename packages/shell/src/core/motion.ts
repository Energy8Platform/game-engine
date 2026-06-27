/** True when the user (or environment) prefers no motion. Missing matchMedia (jsdom/SSR) is
 *  treated as reduced so animations never block. */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return true;
  return mm('(prefers-reduced-motion: reduce)').matches;
}

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
export const easeInOutQuad = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
