import { describe, it, expect } from 'vitest';
import { prefersReducedMotion, easeOutCubic } from '@/core/motion';

describe('prefersReducedMotion', () => {
  it('treats a missing matchMedia (jsdom) as reduced', () => {
    const orig = (globalThis as any).matchMedia;
    (globalThis as any).matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(true);
    (globalThis as any).matchMedia = orig;
  });
});
describe('easeOutCubic', () => {
  it('is 0 at 0 and 1 at 1', () => { expect(easeOutCubic(0)).toBe(0); expect(easeOutCubic(1)).toBe(1); });
});
