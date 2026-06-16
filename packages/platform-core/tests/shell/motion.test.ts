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
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0); // origin = 0
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; };
    const el = document.createElement('div');
    countUp(el, 0, 100, (n) => `${Math.round(n)}`, 100);
    frames.forEach((f) => f(1000));         // 1000ms >> 100ms duration → completes
    expect(el.textContent).toBe('100');
    (globalThis as any).requestAnimationFrame = realRaf;
    perfSpy.mockRestore();
    delete (globalThis as any).matchMedia;
  });

  it('the returned canceler stops the loop — no further writes to the (possibly detached) node', () => {
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({ matches: false });
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; };
    const el = document.createElement('div');
    el.textContent = 'start';
    const cancel = countUp(el, 0, 100, (n) => `${Math.round(n)}`, 100);
    cancel();                       // stop before any frame runs
    frames.forEach((f) => f(50));   // queued ticks must be no-ops now
    expect(el.textContent).toBe('start');
    (globalThis as any).requestAnimationFrame = realRaf;
    perfSpy.mockRestore();
    delete (globalThis as any).matchMedia;
  });
});
