import { describe, it, expect } from 'vitest';
import { toGameDefinition, toModeMap, toMathModes } from '../src/game-spec/derive';
import type { GameSpec } from '../src/game-spec/types';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 6, rows: 6 }, betLevels: [1], maxWin: 1000,
  symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }],
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY', description: 'Buy spins', feature: { spins: 10 } },
  },
};

describe('feature role (ante = paid spin)', () => {
  it('derives like base: debit bet, credit win, its own cost_multiplier, no session', () => {
    const def = toGameDefinition(spec);
    const ante = def.actions.ante;
    expect(ante.debit).toBe('bet');
    expect(ante.credit).toBe('win');
    expect(ante.cost_multiplier).toBe(1.5);
    expect(ante.stage).toBe('base_game');
    // base-like transitions: can award free spins, plus an always-fallback
    expect(ante.transitions.some((t) => t.condition === 'always')).toBe(true);
  });
  it('buy stays a session purchase (credit none)', () => {
    expect(toGameDefinition(spec).actions.buy_bonus.credit).toBe('none');
  });
  it('feature + buy both appear in modeMap and mathModes (free excluded)', () => {
    expect(toModeMap(spec)).toMatchObject({ spin: 'SPIN', ante: 'ANTE', buy_bonus: 'BUY_BONUS' });
    expect(toModeMap(spec).free_spin).toBeUndefined();
    const modes = toMathModes(spec).map((m) => m.action);
    expect(modes).toEqual(expect.arrayContaining(['spin', 'ante', 'buy_bonus']));
    expect(modes).not.toContain('free_spin');
  });
});
