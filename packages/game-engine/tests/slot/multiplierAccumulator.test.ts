import { describe, it, expect } from 'vitest';
import { MultiplierAccumulator } from '../../src/slot/multiplier/MultiplierAccumulator';

describe('MultiplierAccumulator', () => {
  it('add/set adjust value; base defaults to 1', () => {
    const m = new MultiplierAccumulator({ policy: 'cascade' });
    expect(m.value).toBe(1);
    m.add(2); expect(m.value).toBe(3);
    m.set(10); expect(m.value).toBe(10);
  });

  it('session policy survives spin/cascade resets, clears on session boundary', () => {
    const m = new MultiplierAccumulator({ policy: 'session', base: 1 });
    m.set(8);
    m.reset('cascade'); expect(m.value).toBe(8);
    m.reset('spin');    expect(m.value).toBe(8);
    m.reset('session'); expect(m.value).toBe(1);
  });

  it('spin policy survives cascade but clears on spin', () => {
    const m = new MultiplierAccumulator({ policy: 'spin' });
    m.set(4);
    m.reset('cascade'); expect(m.value).toBe(4);
    m.reset('spin');    expect(m.value).toBe(1);
  });

  it('cascade policy clears on every boundary', () => {
    const m = new MultiplierAccumulator({ policy: 'cascade' });
    m.set(5); m.reset('cascade'); expect(m.value).toBe(1);
  });
});
