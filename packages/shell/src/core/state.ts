import type { ShellConfig, ShellState } from './types';
import { DEFAULT_MENU, seedMenuValues } from './menu';

export function createInitialState(config: ShellConfig): ShellState {
  return {
    mode: config.mode,
    replay: config.replay ?? config.mode === 'replay',
    balance: config.balance,
    win: config.win,
    bet: config.currentBet ?? config.defaultBet,
    availableBets: [...config.availableBets],
    busy: false,
    autoplay: { active: false, remaining: 0 },
    turbo: 0,
    buyBonusEnabled: true,
    freeSpins: { current: 0, total: 0, totalWin: 0 },
    bonus: null,
    activeFeature: null,
    volumes: {
      music: clampVolume(config.volumes?.music),
      sfx: clampVolume(config.volumes?.sfx),
    },
    menu: seedMenuValues(config.menu ?? DEFAULT_MENU),
  };
}

/** Clamp a configured volume to 0..1, defaulting to full (1) when unset/invalid. */
export function clampVolume(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/** Step bet up/down within availableBets, clamped at the ends. */
export function stepBet(state: ShellState, direction: 1 | -1): number {
  const idx = state.availableBets.indexOf(state.bet);
  const next = Math.max(0, Math.min(state.availableBets.length - 1, idx + direction));
  return state.availableBets[next];
}

/** Cycle turbo level 0..maxLevels (wraps back to 0). */
export function nextTurbo(current: number, maxLevels: number): number {
  if (maxLevels <= 0) return 0;
  return current >= maxLevels ? 0 : current + 1;
}

/**
 * Is a bonus buy unavailable right now?
 *
 * The three RUNTIME locks, in one place because they used to be in three: both bottom bars spelled
 * them out for the coin, and the Shift+B hotkey spelled out a different, shorter set — so the
 * keyboard opened the buy-bonus overlay mid-round and let a player stake a second bet on top of a
 * round already in flight. A predicate the bars and the hotkey share cannot drift apart again.
 *
 * Runtime only. Whether the feature EXISTS at all is a config question (`features.buyBonus`), and
 * whether this particular surface should offer it (mode, replay) belongs to the caller.
 */
export function bonusBuyLocked(s: ShellState): boolean {
  return s.busy || s.autoplay.active || !s.buyBonusEnabled;
}
