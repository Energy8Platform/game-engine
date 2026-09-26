import { describe, expect, it } from 'vitest';
import { DEV_CURRENCIES } from '../src';

describe('DEV_CURRENCIES', () => {
  it('lists the eight dev currencies, each keyed by its own code', () => {
    expect(Object.keys(DEV_CURRENCIES)).toEqual(['USD', 'EUR', 'GBP', 'JPY', 'BRL', 'INR', 'TRY', 'PLN']);
    for (const [code, c] of Object.entries(DEV_CURRENCIES)) expect(c.code).toBe(code);
  });
  it('JPY has no decimals and PLN writes its symbol on the right', () => {
    expect(DEV_CURRENCIES.JPY).toEqual({ code: 'JPY', symbol: '¥', decimals: 0, position: 'left' });
    expect(DEV_CURRENCIES.PLN).toEqual({ code: 'PLN', symbol: 'zł', decimals: 2, position: 'right' });
  });
  it('is frozen', () => {
    expect(Object.isFrozen(DEV_CURRENCIES)).toBe(true);
  });
});
