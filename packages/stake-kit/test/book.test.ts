import { describe, it, expect } from 'vitest';
import { ensureBook, coerceLuaArrays, progressMarker, parseProgressMarker, roundMoney } from '../src/book';

describe('ensureBook', () => {
  it('wraps a bare events array', () => {
    expect(ensureBook([{ a: 1 }], 'spin')).toEqual({ trigger: 'spin', events: [{ a: 1 }] });
  });
  it('passes through a { trigger, events } object', () => {
    expect(ensureBook({ trigger: 'BONUS', events: [1, 2] }, 'spin')).toEqual({ trigger: 'BONUS', events: [1, 2] });
  });
  it('parses a JSON string', () => {
    expect(ensureBook('[{"a":1}]', 'spin')).toEqual({ trigger: 'spin', events: [{ a: 1 }] });
  });
  it('returns empty events on garbage', () => {
    expect(ensureBook(42, 'spin')).toEqual({ trigger: 'spin', events: [] });
    expect(ensureBook('not json', 'spin')).toEqual({ trigger: 'spin', events: [] });
  });
});

describe('coerceLuaArrays', () => {
  const fields = new Set(['cascades', 'wins', 'positions']);
  it('coerces empty {} to [] for listed keys at any depth', () => {
    const input = { cascades: {}, wins: [{ positions: {} }], keep: {} };
    const out = coerceLuaArrays(input, fields);
    expect(out.cascades).toEqual([]);
    expect((out.wins as any)[0].positions).toEqual([]);
    expect(out.keep).toEqual({}); // not in the set → untouched
  });
  it('leaves non-empty listed values alone (recursing in)', () => {
    const out = coerceLuaArrays({ cascades: [{ wins: {} }] }, fields);
    expect((out.cascades as any)[0].wins).toEqual([]);
  });
});

describe('markers + money', () => {
  it('progressMarker / parseProgressMarker round-trip', () => {
    expect(progressMarker(3)).toBe('seg-3');
    expect(parseProgressMarker('seg-3')).toBe(3);
    expect(parseProgressMarker('nope')).toBeNull();
  });
  it('roundMoney cents + microUnits', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.0000004, 'microUnits')).toBe(0);
    expect(roundMoney(2.0000005, 'microUnits')).toBe(2.000001);
  });
});
