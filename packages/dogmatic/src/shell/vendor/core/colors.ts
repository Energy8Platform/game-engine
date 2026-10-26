import type { BonusOption } from './types';

/** The single brand accent (purple). The bar accent default (theme.ts) and the buy-a-bonus
 *  card default both derive from this, so a rebrand only touches one constant. */
export const BRAND_ACCENT = '#8b5cf6';

/** Type-default accents for bonus options. A per-option `accentColor` overrides these. */
export const ACCENT_BONUS = BRAND_ACCENT; // brand purple — buy a bonus round
export const ACCENT_FEATURE = '#f0b429'; // gold — activate a base-game feature (e.g. Ante)

/** The accent a card/button/bet-tint uses: explicit override, else the type default. */
export function effectiveAccent(b: Pick<BonusOption, 'type' | 'accentColor'>): string {
  return b.accentColor ?? (b.type === 'feature' ? ACCENT_FEATURE : ACCENT_BONUS);
}

/** Readable text colour for a solid accent button: dark on light accents, white on dark.
 *  Only #rgb / #rrggbb are measured; anything else (named, var(), etc.) → white. */
export function contrastText(accent: string): string {
  const rgb = parseHex(accent);
  if (!rgb) return '#ffffff';
  // Relative luminance (sRGB, perceptual-ish). >0.6 → use dark ink.
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6 ? '#1a1205' : '#ffffff';
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
