import type { CurrencyConfig } from './types';

export function formatCurrency(value: number, currency: CurrencyConfig): string {
  const decimals = currency.decimals ?? 2;
  const thousands = currency.separator?.thousands ?? '.';
  const decimal = currency.separator?.decimal ?? ',';
  const safe = Number.isFinite(value) ? value : 0;

  const fixed = safe.toFixed(decimals); // e.g. "1234567.89"
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const number = fracPart !== undefined ? `${grouped}${decimal}${fracPart}` : grouped;

  return currency.position === 'left'
    ? `${currency.symbol}${number}`
    : `${number} ${currency.symbol}`;
}
