import type { CurrencyConfig } from './types';

/** The shared money formatter for every shell readout (balance, win, total win, bet, prices).
 *
 *  `maxDecimals` is the MAXIMUM fraction digits (default 2); `minDecimals` (defaults to
 *  `maxDecimals`) is the MINIMUM. By default the value is shown at exactly `minDecimals` places.
 *  With `variableDecimals` — used only for win / total-win — it is rounded to `maxDecimals`, then
 *  trailing zeros are trimmed down to (but never past) `minDecimals`, so small wins keep their
 *  significant digits. Balance / bet / prices stay fixed at `minDecimals`.
 *
 *  Example with `maxDecimals: 4, minDecimals: 2`:
 *    fixed    → 0.0673 → 0,07     0.3 → 0,30
 *    variable → 0.0673 → 0,0673   0.067 → 0,067   0.3 → 0,30   0 → 0,00
 */
export function formatCurrency(value: number, currency: CurrencyConfig, variableDecimals = false): string {
  const maxDecimals = currency.maxDecimals ?? 2;
  const minDecimals = Math.max(0, Math.min(maxDecimals, currency.minDecimals ?? maxDecimals));
  const thousands = currency.separator?.thousands ?? '.';
  const decimal = currency.separator?.decimal ?? ',';
  const safe = Number.isFinite(value) ? value : 0;

  // fixed callers round at minDecimals; variable callers round at maxDecimals then trim back down.
  const places = variableDecimals ? maxDecimals : minDecimals;
  const fixed = safe.toFixed(places);
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
