import type { ShellConfig, ShellState } from './types';

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
  };
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
