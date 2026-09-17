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
