import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/shell/format';

// Documented defaults: thousands separator '.', decimal separator ','.
describe('formatCurrency', () => {
  const eur = { symbol: '€', position: 'left' as const };
  const kr = { symbol: 'kr', position: 'right' as const };

  it('places symbol left with default 2 decimals and default separators', () => {
    expect(formatCurrency(500, eur)).toBe('€500,00');
  });

  it('places symbol right', () => {
    expect(formatCurrency(500, kr)).toBe('500,00 kr');
  });

  it('groups thousands with the default separator', () => {
    expect(formatCurrency(1234.5, eur)).toBe('€1.234,50');
  });

  it('respects custom decimals', () => {
    expect(formatCurrency(1.5, { ...eur, decimals: 0 })).toBe('€2');
  });

  it('applies custom thousands + decimal separators', () => {
    expect(
      formatCurrency(1234567.89, { ...eur, separator: { thousands: ' ', decimal: ',' } }),
    ).toBe('€1 234 567,89');
  });

  it('handles non-finite input as zero', () => {
    expect(formatCurrency(NaN, eur)).toBe('€0,00');
  });

  it('minDecimals defaults to decimals (exactly `decimals` places)', () => {
    expect(formatCurrency(0.067, { ...eur, decimals: 4 })).toBe('€0,0670');
    expect(formatCurrency(0.3, { ...eur, decimals: 4 })).toBe('€0,3000');
  });

  it('keeps significant digits up to `decimals`, trims trailing zeros down to `minDecimals`', () => {
    const c = { ...eur, decimals: 4, minDecimals: 2 };
    expect(formatCurrency(0.0673, c)).toBe('€0,0673'); // not rounded to 0,07
    expect(formatCurrency(0.067, c)).toBe('€0,067');
    expect(formatCurrency(0.06, c)).toBe('€0,06');
    expect(formatCurrency(0.0004, c)).toBe('€0,0004');
    expect(formatCurrency(0.004, c)).toBe('€0,004');
    expect(formatCurrency(0.3, c)).toBe('€0,30');
    expect(formatCurrency(0, c)).toBe('€0,00');
  });

  it('rounds at the max precision (`decimals`) before trimming', () => {
    const c = { ...eur, decimals: 4, minDecimals: 2 };
    expect(formatCurrency(0.06734, c)).toBe('€0,0673'); // 5th digit rounded away
    expect(formatCurrency(1234.5, c)).toBe('€1.234,50'); // grouping + trim to minDecimals
  });

  it('minDecimals: 0 drops the fraction entirely for whole amounts', () => {
    const c = { ...eur, decimals: 4, minDecimals: 0 };
    expect(formatCurrency(0.3, c)).toBe('€0,3');
    expect(formatCurrency(5, c)).toBe('€5');
  });
});
