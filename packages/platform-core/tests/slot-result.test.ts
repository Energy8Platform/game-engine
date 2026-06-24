import { describe, it, expect } from 'vitest';
import { asArray, coerceLuaArrays } from '../src/slot-result';

describe('asArray', () => {
  it('passes arrays through and turns the Lua empty-table {} into []', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray({})).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});

describe('coerceLuaArrays', () => {
  it('coerces the named fields to arrays, leaving others intact', () => {
    const raw = { cascades: {}, jars: [{ x: 1 }], total_win: 5 };
    expect(coerceLuaArrays(raw, ['cascades', 'jars'])).toEqual({ cascades: [], jars: [{ x: 1 }], total_win: 5 });
  });
});
