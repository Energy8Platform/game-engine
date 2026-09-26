/**
 * The currencies the IDE's Preview toolbar offers and the dev host's
 * `GET /api/session` accepts (slice 39) — pure data, browser-safe, read by
 * both. A real platform answers its own currency; this table is only what
 * a developer can pick while playing the dev wallet.
 */
import type { SessionInit } from './session';

export const DEV_CURRENCIES: Readonly<Record<string, SessionInit['currency']>> = Object.freeze({
  USD: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, position: 'left' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, position: 'left' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, position: 'left' },
  BRL: { code: 'BRL', symbol: 'R$', decimals: 2, position: 'left' },
  INR: { code: 'INR', symbol: '₹', decimals: 2, position: 'left' },
  TRY: { code: 'TRY', symbol: '₺', decimals: 2, position: 'left' },
  PLN: { code: 'PLN', symbol: 'zł', decimals: 2, position: 'right' },
});
