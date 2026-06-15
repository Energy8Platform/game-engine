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
});
