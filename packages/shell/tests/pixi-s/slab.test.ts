import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Slab, SKEW, slabPoints } from '@/ui/pixi-s/slab';
import { S } from '@/ui/pixi-s/theme';

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

  it('draws a flat face over its shadow; no shadow when asked', () => {
    expect(new Slab(120, 40, { face: S.plate }).children).toHaveLength(2);
    expect(new Slab(120, 40, { face: S.yellow, shadow: false }).children).toHaveLength(1);
    const s = new Slab(120.4, 39.6, { face: S.plate });
    expect([s.w, s.h]).toEqual([120, 40]);
  });
});
