// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { prefersReducedMotion, countUp } from '@/shell/motion';

describe('prefersReducedMotion', () => {
  it('treats missing matchMedia (jsdom) as reduced', () => {
    // jsdom has no matchMedia by default
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('countUp', () => {
  it('with reduced motion, sets the final formatted text immediately', () => {
    const el = document.createElement('div');
    countUp(el, 0, 250, (n) => `€${n.toFixed(0)}`);
    expect(el.textContent).toBe('€250');
  });

  it('animates when motion is allowed (matchMedia stub + fake rAF)', () => {
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({ matches: false });
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; };
    const el = document.createElement('div');
    countUp(el, 0, 100, (n) => `${Math.round(n)}`, 100);
    frames.forEach((f) => f(1000));         // advance past duration
    expect(el.textContent).toBe('100');
    (globalThis as any).requestAnimationFrame = realRaf;
    delete (globalThis as any).matchMedia;
  });
});
