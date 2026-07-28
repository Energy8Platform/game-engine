import { describe, it, expect } from 'vitest';
import { createInitialState, stepBet, nextTurbo } from '@/core/state';
import type { ShellConfig, ShellState } from '@/core/types';

function cfg(overrides: Partial<ShellConfig> = {}): ShellConfig {
  return {
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5],
    defaultBet: 2,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
    ...overrides,
  };
}

describe('createInitialState', () => {
  it('falls back to defaultBet when currentBet is null', () => {
    expect(createInitialState(cfg()).bet).toBe(2);
  });

  it('uses currentBet when provided (mid-session restore)', () => {
    expect(createInitialState(cfg({ currentBet: 5 })).bet).toBe(5);
  });

  it('seeds balance/win/mode and defaults', () => {
    const s = createInitialState(cfg({ balance: 50, win: 9, mode: 'replay' }));
    expect(s.balance).toBe(50);
    expect(s.win).toBe(9);
    expect(s.mode).toBe('replay');
    expect(s.busy).toBe(false);
    expect(s.turbo).toBe(0);
    expect(s.buyBonusEnabled).toBe(true);
    expect(s.autoplay).toEqual({ active: false, remaining: 0 });
    expect(s.freeSpins).toEqual({ current: 0, total: 0, totalWin: 0 });
  });

  it('seeds volumes without master and menu values from the item list', () => {
    const s = createInitialState({
      language: 'en', currency: { symbol: '€', position: 'left' },
      availableBets: [1], defaultBet: 1, currentBet: null, balance: 0, win: 0,
      mode: 'base', gameInfo: {}, features: { turbo: 0, autoplay: null, buyBonus: false },
      volumes: { music: 0.4 },
      menu: [{ id: 'sound' }, { id: 'lefty', type: 'toggle', label: 'L', value: true }],
    } as never);
    expect(s.volumes).toEqual({ music: 0.4, sfx: 1 });
    expect(s.menu).toEqual({ lefty: true });
  });
});

describe('stepBet', () => {
  const base = { availableBets: [1, 2, 5], bet: 2 } as ShellState;
  it('steps up', () => expect(stepBet(base, 1)).toBe(5));
  it('steps down', () => expect(stepBet(base, -1)).toBe(1));
  it('clamps at top', () => expect(stepBet({ ...base, bet: 5 }, 1)).toBe(5));
  it('clamps at bottom', () => expect(stepBet({ ...base, bet: 1 }, -1)).toBe(1));
});

describe('nextTurbo', () => {
  it('returns 0 when no levels', () => expect(nextTurbo(0, 0)).toBe(0));
  it('increments', () => expect(nextTurbo(1, 3)).toBe(2));
  it('wraps at max', () => expect(nextTurbo(3, 3)).toBe(0));
});
