import { describe, expect, it } from 'vitest';
import { snapPoint } from '../src/snap';
const design = { width: 480, height: 288 };
describe('snapPoint', () => {
  it('off → unchanged', () => expect(snapPoint({ x: 13, y: 7 }, { on: false, step: 16, design })).toEqual({ x: 13, y: 7 }));
  it('on → nearest grid line', () => expect(snapPoint({ x: 13, y: 25 }, { on: true, step: 16, design })).toEqual({ x: 16, y: 32 }));
  it('the design centre wins within the threshold even off-grid', () => {
    expect(snapPoint({ x: 243, y: 100 }, { on: true, step: 16, design })).toEqual({ x: 240, y: 96 });
    expect(snapPoint({ x: 243, y: 100 }, { on: false, step: 16, design })).toEqual({ x: 240, y: 100 });
    expect(snapPoint({ x: 243, y: 100 }, { on: false, step: 16, design, centre: false })).toEqual({ x: 243, y: 100 });
  });
});
