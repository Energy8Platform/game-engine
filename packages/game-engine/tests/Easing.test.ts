import { describe, it, expect } from 'vitest';
import { Easing } from '../src/animation/Easing';

describe('Easing', () => {
  const fns = Object.entries(Easing);

  describe('all easing functions', () => {
    it.each(fns)('%s returns 0 at t=0', (name, fn) => {
      const val = fn(0);
      // Most easings return 0 at t=0 (some elastic/back might not be exact)
      expect(val).toBeCloseTo(0, 1);
    });

    it.each(fns)('%s returns 1 at t=1', (name, fn) => {
      const val = fn(1);
      expect(val).toBeCloseTo(1, 1);
    });

    it.each(fns)('%s returns a number for 0..1', (name, fn) => {
      for (let t = 0; t <= 1; t += 0.1) {
        expect(typeof fn(t)).toBe('number');
        expect(Number.isFinite(fn(t))).toBe(true);
      }
    });
  });

  describe('linear', () => {
    it('returns input unchanged', () => {
      expect(Easing.linear(0)).toBe(0);
      expect(Easing.linear(0.5)).toBe(0.5);
      expect(Easing.linear(1)).toBe(1);
    });
  });

  describe('easeInQuad', () => {
    it('produces squared curve', () => {
      expect(Easing.easeInQuad(0.5)).toBeCloseTo(0.25);
    });
  });

  describe('easeOutQuad', () => {
    it('decelerates', () => {
      const mid = Easing.easeOutQuad(0.5);
      expect(mid).toBeGreaterThan(0.5);
    });
  });

  describe('bounce', () => {
    it('easeOutBounce stays in 0..1 range for most values', () => {
      for (let t = 0; t <= 1; t += 0.05) {
        const val = Easing.easeOutBounce(t);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1.001);
      }
    });

    it('easeInBounce is complement of easeOutBounce', () => {
      const t = 0.3;
      expect(Easing.easeInBounce(t)).toBeCloseTo(1 - Easing.easeOutBounce(1 - t));
    });
  });

  describe('back easing overshoots', () => {
    it('easeInBack goes slightly negative', () => {
      const val = Easing.easeInBack(0.2);
      expect(val).toBeLessThan(0);
    });

    it('easeOutBack goes slightly above 1 before settling', () => {
      const val = Easing.easeOutBack(0.8);
      expect(val).toBeGreaterThan(1);
    });
  });
});
