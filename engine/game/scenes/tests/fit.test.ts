import { describe, expect, it } from 'vitest';
import { fitStage } from '../src/fit';

describe('fitStage: contain', () => {
  it('scales by height and letterboxes left/right when the viewport is wider than the design aspect', () => {
    // design 800x600 (4:3), viewport 1600x600 (much wider) -> limited by height
    const fit = fitStage({ width: 1600, height: 600 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(1); // 600/600
    expect(fit.y).toBe(0);
    expect(fit.x).toBe((1600 - 800 * 1) / 2); // 400
  });

  it('scales by width and letterboxes top/bottom when the viewport is taller than the design aspect', () => {
    const fit = fitStage({ width: 800, height: 1600 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(1); // 800/800
    expect(fit.x).toBe(0);
    expect(fit.y).toBe((1600 - 600 * 1) / 2); // 500
  });

  it('scales down uniformly when the viewport is smaller than the design in both axes', () => {
    const fit = fitStage({ width: 400, height: 300 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(0.5);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
  });
});

describe('fitStage: cover', () => {
  it('picks the LARGER of the two axis scales, opposite of contain', () => {
    const containFit = fitStage(
      { width: 1600, height: 600 },
      { width: 800, height: 600 },
      'contain',
    );
    const coverFit = fitStage({ width: 1600, height: 600 }, { width: 800, height: 600 }, 'cover');
    expect(containFit.scale).toBe(1); // limited by height
    expect(coverFit.scale).toBe(2); // limited by width: 1600/800
    // cover overflows the shorter axis rather than letterboxing it
    expect(coverFit.y).toBeLessThan(0);
  });
});

describe('fitStage: the safe rect', () => {
  const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

  it('zero insets are exactly the fit of old, and the viewport edges are the letterboxed design frame', () => {
    const fit = fitStage({ width: 1600, height: 600 }, { width: 800, height: 600 }, 'contain', ZERO);
    expect([fit.scale, fit.x, fit.y]).toEqual([1, 400, 0]);
    // 1600 wide at scale 1 around an 800-wide design: 400 px of letterbox each side, in design units.
    expect(fit.viewport).toEqual({ left: -400, top: 0, right: 1200, bottom: 600 });
    const small = fitStage({ width: 400, height: 300 }, { width: 800, height: 600 });
    expect([small.scale, small.x, small.y]).toEqual([0.5, 0, 0]);
    expect(small.viewport).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
  });

  it('contain: fits into viewport − insets, offsets by (left, top), and the edges are the SAFE rect in design units', () => {
    // A 100 px bar at the bottom: safe = 1600×600 → scale 1 (600/600), centred in the safe rect.
    const bar = fitStage({ width: 1600, height: 700 }, { width: 800, height: 600 }, 'contain', { ...ZERO, bottom: 100 });
    expect([bar.scale, bar.x, bar.y]).toEqual([1, 400, 0]);
    expect(bar.viewport).toEqual({ left: -400, top: 0, right: 1200, bottom: 600 });
    // The same bar on TOP moves the design down by 100 px; the safe rect still starts at design y 0.
    const top = fitStage({ width: 1600, height: 700 }, { width: 800, height: 600 }, 'contain', { ...ZERO, top: 100 });
    expect([top.scale, top.x, top.y]).toEqual([1, 400, 100]);
    expect(top.viewport).toEqual({ left: -400, top: 0, right: 1200, bottom: 600 });
    // Insets on every side, at a scale ≠ 1: viewport 500×400 − {50,50,50,50} = safe 400×300 → scale 0.5;
    // x = (400 − 400)/2 + 50 = 50, y = (300 − 300)/2 + 50 = 50; the safe rect IS the design.
    const all = fitStage({ width: 500, height: 400 }, { width: 800, height: 600 }, 'contain', { top: 50, right: 50, bottom: 50, left: 50 });
    expect([all.scale, all.x, all.y]).toEqual([0.5, 50, 50]);
    expect(all.viewport).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
    // Asymmetric: left 200 on a 1000×600 viewport → safe 800×600, scale 1, x = 0 + 200.
    const left = fitStage({ width: 1000, height: 600 }, { width: 800, height: 600 }, 'contain', { ...ZERO, left: 200 });
    expect([left.scale, left.x, left.y]).toEqual([1, 200, 0]);
    expect(left.viewport).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
  });

  it('cover: the safe rect is the band of the design the viewport actually shows', () => {
    // safe 1600×600, design 800×600 → scale 2 (by width); y = (600 − 1200)/2 = −300.
    // In design units the safe rect runs from y = 300/2 = 150 to 150 + 600/2 = 450 — the centre band.
    const fit = fitStage({ width: 1600, height: 700 }, { width: 800, height: 600 }, 'cover', { ...ZERO, bottom: 100 });
    expect([fit.scale, fit.x, fit.y]).toEqual([2, 0, -300]);
    expect(fit.viewport).toEqual({ left: 0, top: 150, right: 800, bottom: 450 });
  });

  it('the safe rect centre is the design centre under contain, whatever the insets', () => {
    const fit = fitStage({ width: 1280, height: 720 }, { width: 480, height: 288 }, 'contain', { ...ZERO, bottom: 100 });
    // safe 1280×620 → scale 620/288; x = (1280 − 480·s)/2; left = −x/s = 240 − 640/s = 240 − 640·288/620.
    expect(fit.scale).toBeCloseTo(620 / 288, 10);
    expect(fit.viewport.left).toBeCloseTo(-8880 / 155, 10);
    expect(fit.viewport.right).toBeCloseTo(83280 / 155, 10);
    expect(fit.viewport.top).toBeCloseTo(0, 10);
    expect(fit.viewport.bottom).toBeCloseTo(288, 10);
    expect((fit.viewport.left + fit.viewport.right) / 2).toBeCloseTo(240, 10);
    expect((fit.viewport.top + fit.viewport.bottom) / 2).toBeCloseTo(144, 10);
  });

  it('insets larger than the viewport clamp the safe rect to 1×1 rather than a negative scale', () => {
    const fit = fitStage({ width: 100, height: 100 }, { width: 800, height: 600 }, 'contain', { ...ZERO, bottom: 200 });
    expect(fit.scale).toBeGreaterThan(0);
  });
});
