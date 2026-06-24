import type { GameConfigData } from '@energy8platform/game-sdk';

export type RegulatoryMapping = (
  jurisdiction: Record<string, unknown>,
  regulatory: Record<string, unknown>,
) => void;

/** kitsune's canonical mapping — matches the existing RuntimeFeatureFlags reader. */
const CANONICAL: RegulatoryMapping = (j, reg) => {
  if (j.disabledTurbo === true) reg.turbo_enabled = false;
  if (j.disabledAutoplay === true) reg.autoplay_enabled = false;
  if (j.disabledBuyFeature === true) reg.feature_buy_enabled = false;
  if (typeof j.minimumRoundDuration === 'number') {
    reg.min_spin_duration_ms = Math.max(Number(reg.min_spin_duration_ms ?? 0), j.minimumRoundDuration);
  }
  if (j.displaySessionTimer === true) reg.session_timer_enabled = true;
  if (j.displayNetPosition === true) reg.net_loss_display = true;
};

/**
 * Map Stake's jurisdiction flags onto our `regulatory.*` shape, and mirror
 * Stake's `maxBet` / `defaultBetLevel`. Preserves any existing `regulatory`
 * (DevBridge / Energy8 builds stay authoritative). Conservative: a flag only
 * ever disables a feature.
 */
export function enrichConfigWithJurisdiction(
  config: GameConfigData,
  mapping: RegulatoryMapping = CANONICAL,
): GameConfigData {
  const c = config as Record<string, any>;
  const reg: Record<string, unknown> = { ...(c.regulatory ?? {}) };
  if (c.jurisdiction && typeof c.jurisdiction === 'object') mapping(c.jurisdiction, reg);

  const out: Record<string, any> = { ...c, regulatory: reg };

  const maxBet = c.stake?.maxBet;
  if (typeof maxBet === 'number' && maxBet > 0) {
    const cur = reg.max_bet_value;
    reg.max_bet_value = cur == null ? maxBet : Math.min(Number(cur), maxBet);
  }
  const defBet = c.stake?.defaultBetLevel;
  if (typeof defBet === 'number' && defBet > 0) out.defaultBet = defBet;

  return out as GameConfigData;
}
