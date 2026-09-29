import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Graphics } from 'pixi.js';
import { Slab, SKEW, FLAT, TOOTH_D, DOT_R, slabPoints, halftone } from '@/ui/pixi-s/slab';
import { S } from '@/ui/pixi-s/theme';

const dotsOf = (s: Slab) => s.children[s.children.length - 1] as Graphics;

describe('slab', () => {
  it('every skew preset keeps the quad inside its box', () => {
    for (const corners of Object.values(SKEW)) {
      const p = slabPoints(100, 40, corners);
      expect(p).toHaveLength(8);
      for (let i = 0; i < p.length; i += 2) {
        expect(p[i]).toBeGreaterThanOrEqual(0);
        expect(p[i]).toBeLessThanOrEqual(100);
        expect(p[i + 1]).toBeGreaterThanOrEqual(0);
        expect(p[i + 1]).toBeLessThanOrEqual(40);
      }
    }
  });

  it('the sawtooth hangs its teeth to the box bottom and ends on the base line at bottom-left', () => {
    const p = slabPoints(200, 100, FLAT, true);
    const ys = p.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBe(100);
    expect(p.slice(-2)).toEqual([0, 100 - TOOTH_D]);
    expect(p.length / 2).toBeGreaterThan(20);
  });

  it('halftone dots lie inside the quad; on black they thin out toward the top-right', () => {
    const dots = halftone(240, 60, SKEW.readout, false, true);
    expect(dots.length).toBeGreaterThan(50);
    for (const [x, y, r] of dots) {
      expect(x - r).toBeGreaterThanOrEqual(0);
      expect(x + r).toBeLessThanOrEqual(240);
      expect(y - r).toBeGreaterThanOrEqual(0);
      expect(y + r).toBeLessThanOrEqual(60);
    }
    const mass = (pick: (x: number, y: number) => boolean) =>
      dots.filter(([x, y]) => pick(x, y)).reduce((a, d) => a + d[2] * d[2], 0);
    expect(mass((x, y) => x < 120 && y > 30)).toBeGreaterThan(2 * mass((x, y) => x >= 120 && y <= 30));
  });

  it('uniform halftone (SPIN) uses one radius and skips the teeth', () => {
    const dots = halftone(200, 100, SKEW.spin, true, false);
    expect(dots.every(([, , r]) => r === DOT_R)).toBe(true);
    expect(dots.every(([, y, r]) => y + r <= 100 - TOOTH_D)).toBe(true);
  });

  it('draws shadow, face and dots; no shadow and no dots when asked', () => {
    expect(new Slab(120, 40, { face: S.plate, dots: S.plateDot }).children).toHaveLength(3);
    expect(new Slab(120, 40, { face: S.yellow, shadow: false }).children).toHaveLength(1);
    const s = new Slab(120.4, 39.6, { face: S.plate });
    expect([s.w, s.h]).toEqual([120, 40]);
  });

  it('identical slabs share one dot context, and it survives a rebuild (destroy with children)', () => {
    const opts = { face: S.plate, dots: S.plateDot, corners: SKEW.readout };
    const a = new Slab(200, 50, opts);
    const b = new Slab(200, 50, opts);
    expect(dotsOf(a).context).toBe(dotsOf(b).context);
    a.destroy({ children: true });
    const c = new Slab(200, 50, opts);
    expect(dotsOf(c).context).toBe(dotsOf(b).context);
    expect(dotsOf(c).context.destroyed).toBe(false);
  });
});
