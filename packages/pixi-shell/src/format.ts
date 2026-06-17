import type { CurrencyConfig } from './types';

/** The shared money formatter for every shell readout (balance, win, total win, bet, prices).
 *
 *  `decimals` is the MAXIMUM number of fraction digits; `minDecimals` (defaults to `decimals`)
 *  is the MINIMUM. The value is rounded to `decimals`, then trailing zeros are trimmed down to
 *  — but never past — `minDecimals`. With `minDecimals` unset both bounds are equal, so the
 *  output is always exactly `decimals` places (the classic behaviour).
 *
 *  Example with `decimals: 4, minDecimals: 2`:
 *    0.0673 → 0,0673   0.0670 → 0,067   0.0600 → 0,06
 *    0.0004 → 0,0004   0.0040 → 0,004   0.3000 → 0,30   0.0000 → 0,00
 */
export function formatCurrency(value: number, currency: CurrencyConfig): string {
  const decimals = currency.decimals ?? 2;
  const minDecimals = Math.max(0, Math.min(decimals, currency.minDecimals ?? decimals));
  const thousands = currency.separator?.thousands ?? '.';
  const decimal = currency.separator?.decimal ?? ',';
  const safe = Number.isFinite(value) ? value : 0;

  const fixed = safe.toFixed(decimals); // round at the max precision, e.g. "0.0670"
  const [intPart, rawFrac = ''] = fixed.split('.');
  // trim trailing zeros, but keep at least `minDecimals` fraction digits
  let fracPart = rawFrac;
  if (fracPart.length > minDecimals) {
    fracPart = fracPart.replace(/0+$/, '');
    if (fracPart.length < minDecimals) fracPart = fracPart.padEnd(minDecimals, '0');
  }

  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const number = fracPart.length ? `${grouped}${decimal}${fracPart}` : grouped;

  return currency.position === 'left'
    ? `${currency.symbol}${number}`
    : `${number} ${currency.symbol}`;
}
