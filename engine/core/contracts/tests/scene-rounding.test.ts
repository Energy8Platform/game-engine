import { describe, expect, it } from 'vitest';
import { sceneRounding } from '../src/index';

describe('sceneRounding', () => {
  it('rounds positions and sizes to whole design px, scale to 0.01, rotation to 0.0001', () => {
    expect(sceneRounding).toEqual({ x: 1, y: 1, width: 1, height: 1, scale: 100, rotation: 10_000 });
    const round = (key: string, v: number) => Math.round(v * sceneRounding[key]) / sceneRounding[key];
    expect(round('x', 279.99998474121094)).toBe(280);
    expect(round('width', 40.4)).toBe(40);
    expect(round('scale', 0.123456)).toBe(0.12);
    expect(round('rotation', 0.123456)).toBe(0.1235);
  });
});
