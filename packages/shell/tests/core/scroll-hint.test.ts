/**
 * scrollHint() — the shared maths behind every scroll affordance in the shell.
 *
 * Stake rejected a build in Popout S (400×225): overlays there scroll, but nothing said so. Both
 * renderers now draw a thumb, an edge fade and a "more below" chevron; this module decides WHAT to
 * draw so the DOM and Pixi shells can never disagree about it.
 */
import { describe, it, expect } from 'vitest';
import { scrollHint, SCROLL_THUMB_MIN } from '@/core/scrollHint';

describe('scrollHint — overflow detection', () => {
  it('reports no overflow when the content fits', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 });
    expect(h.overflowing).toBe(false);
    expect(h.maxScroll).toBe(0);
  });

  it('treats a sub-pixel excess as fitting (a rounded-up scrollHeight is not real content)', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 200.4, clientHeight: 200 });
    expect(h.overflowing).toBe(false);
  });

  it('reports overflow once there is a meaningful amount of content below', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 });
    expect(h.overflowing).toBe(true);
    expect(h.maxScroll).toBe(200);
  });

  it('survives a zero-height viewport (measured before layout) without dividing by zero', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
    expect(h.overflowing).toBe(false);
    expect(Number.isFinite(h.thumbSize)).toBe(true);
    expect(Number.isFinite(h.thumbOffset)).toBe(true);
  });
});

describe('scrollHint — edge state', () => {
  it('is at the start before any scrolling', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 });
    expect(h.atStart).toBe(true);
    expect(h.atEnd).toBe(false);
  });

  it('is at neither edge mid-scroll', () => {
    const h = scrollHint({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
    expect(h.atStart).toBe(false);
    expect(h.atEnd).toBe(false);
  });

  it('is at the end once scrolled to the bottom', () => {
    const h = scrollHint({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 });
    expect(h.atStart).toBe(false);
    expect(h.atEnd).toBe(true);
  });

  it('counts a near-bottom fractional scrollTop as the end (browsers land on 199.5, not 200)', () => {
    const h = scrollHint({ scrollTop: 199.5, scrollHeight: 400, clientHeight: 200 });
    expect(h.atEnd).toBe(true);
  });

  it('is at BOTH edges when the content fits — no fade at either end', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 });
    expect(h.atStart).toBe(true);
    expect(h.atEnd).toBe(true);
  });

  it('clamps an over-scrolled position (rubber-banding) instead of reporting past the end', () => {
    const h = scrollHint({ scrollTop: 999, scrollHeight: 400, clientHeight: 200 });
    expect(h.atEnd).toBe(true);
    expect(h.thumbOffset).toBeCloseTo(1 - h.thumbSize, 5);
  });

  it('clamps a negative scrollTop (elastic overscroll at the top) to the start', () => {
    const h = scrollHint({ scrollTop: -40, scrollHeight: 400, clientHeight: 200 });
    expect(h.atStart).toBe(true);
    expect(h.thumbOffset).toBe(0);
  });
});

describe('scrollHint — thumb geometry (fractions of the track)', () => {
  it('sizes the thumb to the visible fraction of the content', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 });
    expect(h.thumbSize).toBeCloseTo(0.5, 5);
  });

  it('never shrinks the thumb below the minimum, however deep the content', () => {
    // Game Info at Popout S: 2843px of content in a 226px window — a true-ratio thumb is 8% of a
    // 226px track, i.e. 18px. Below the floor it reads as a speck rather than a scrollbar.
    const h = scrollHint({ scrollTop: 0, scrollHeight: 2843, clientHeight: 226 });
    expect(h.thumbSize).toBe(SCROLL_THUMB_MIN);
    expect(SCROLL_THUMB_MIN).toBeGreaterThan(0.08);
  });

  it('still travels the full track when the thumb is floored', () => {
    const bottom = scrollHint({ scrollTop: 2843 - 226, scrollHeight: 2843, clientHeight: 226 });
    expect(bottom.thumbOffset).toBeCloseTo(1 - SCROLL_THUMB_MIN, 5);
    expect(bottom.thumbOffset + bottom.thumbSize).toBeCloseTo(1, 5);
  });

  it('places the thumb proportionally mid-scroll', () => {
    const h = scrollHint({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
    // 50%-tall thumb, halfway down 200px of travel → top of the remaining 50% track
    expect(h.thumbOffset).toBeCloseTo(0.25, 5);
  });

  it('reports a full-length thumb at rest when nothing overflows', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 });
    expect(h.thumbSize).toBe(1);
    expect(h.thumbOffset).toBe(0);
  });
});

describe('scrollHint — horizontal use (the buy-bonus card strip)', () => {
  it('works unchanged on the X axis — the caller passes width metrics', () => {
    const h = scrollHint({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    expect(h.overflowing).toBe(true);
    expect(h.thumbSize).toBeCloseTo(1 / 3, 5);
  });
});
