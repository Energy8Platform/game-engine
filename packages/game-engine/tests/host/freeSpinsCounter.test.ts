import { describe, it, expect } from 'vitest';
import { createFreeSpinsCounter } from '@/host/freeSpinsCounter';

describe('createFreeSpinsCounter', () => {
  it('seeds total from the trigger award and counts each spin', () => {
    const c = createFreeSpinsCounter();
    expect(c.enter(10)).toEqual({ current: 0, total: 10, totalWin: 0 });
    expect(c.spin(0, 1.5)).toEqual({ current: 1, total: 10, totalWin: 1.5 });
    expect(c.spin(0, 4)).toEqual({ current: 2, total: 10, totalWin: 4 });
  });

  it('grows the total on a retrigger (the canonical 10 → 15 case)', () => {
    const c = createFreeSpinsCounter();
    c.enter(10);
    c.spin(0, 1);
    c.spin(0, 2);
    // third spin retriggers +5 → 3 played of 15 total (i.e. 12 remaining), as the user described.
    const v = c.spin(5, 3);
    expect(v).toEqual({ current: 3, total: 15, totalWin: 3 });
    expect(v.total - v.current).toBe(12); // remaining
  });

  it('handles multiple retriggers cumulatively', () => {
    const c = createFreeSpinsCounter();
    c.enter(8);
    c.spin(0, 0);
    const a = c.spin(5, 10); // +5 → 13
    expect(a).toEqual({ current: 2, total: 13, totalWin: 10 });
    const b = c.spin(5, 25); // +5 → 18
    expect(b).toEqual({ current: 3, total: 18, totalWin: 25 });
  });

  it('enter() resets a previous bonus run', () => {
    const c = createFreeSpinsCounter();
    c.enter(10); c.spin(5, 50);
    expect(c.enter(6)).toEqual({ current: 0, total: 6, totalWin: 0 });
    expect(c.spin(0, 2)).toEqual({ current: 1, total: 6, totalWin: 2 });
  });
});
