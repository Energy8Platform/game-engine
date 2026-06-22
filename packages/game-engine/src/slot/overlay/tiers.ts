import type { Texture } from 'pixi.js';

export interface WinTier {
  id: string;
  minMultiplier: number;
  title: string;
  accentColor: number;
  bannerTexture?: Texture;
}

/** Highest tier whose minMultiplier <= win/bet, or null if below the lowest. */
export function pickTier(tiers: WinTier[], win: number, bet: number): WinTier | null {
  if (bet <= 0) return null;
  const mult = win / bet;
  let chosen: WinTier | null = null;
  for (const t of tiers) {
    if (mult >= t.minMultiplier && (!chosen || t.minMultiplier >= chosen.minMultiplier)) chosen = t;
  }
  return chosen;
}

/** Index into `tiers` for the running value (or -1 below the lowest tier). */
export function tierIndexAtValue(tiers: WinTier[], runningValue: number, bet: number): number {
  if (bet <= 0) return -1;
  const mult = runningValue / bet;
  let idx = -1;
  for (let i = 0; i < tiers.length; i++) if (mult >= tiers[i].minMultiplier) idx = i;
  return idx;
}
