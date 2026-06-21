// packages/platform-core/tests/game-spec/derive.test.ts
import { describe, it, expect } from 'vitest';
import {
  toGameDefinition, toLuaPrelude, toModeMap, toMathModes, toPaytableView,
} from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 1], maxWin: 1000, currency: 'EUR',
  symbols: [
    { id: 'A', name: 'Ace', kind: 'high', pay: { 3: 5, 4: 20 } },
    { id: 'WILD', kind: 'wild' },
  ],
  actions: {
    spin: { role: 'base' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 50, feature: { spins: 8 } },
  },
};

describe('toGameDefinition', () => {
  const gd = toGameDefinition(spec);
  it('sets SLOT type, bet levels and max win', () => {
    expect(gd.type).toBe('SLOT');
    expect(gd.bet_levels).toEqual([0.1, 0.2, 1]);
    expect(gd.max_win).toEqual({ multiplier: 1000 });
  });
  it('maps base action with default FS-trigger transition', () => {
    expect(gd.actions.spin.debit).toBe('bet');
    expect(gd.actions.spin.credit).toBe('win');
    expect(gd.actions.spin.transitions[0].next_actions).toEqual(['free_spin']);
    expect(gd.actions.spin.transitions[0].creates_session).toBe(true);
  });
  it('maps free action as session spin', () => {
    expect(gd.actions.free_spin.debit).toBe('none');
    expect(gd.actions.free_spin.requires_session).toBe(true);
  });
  it('maps buy action cost_multiplier and feature_data', () => {
    expect(gd.actions.buy_bonus.cost_multiplier).toBe(50);
    expect(gd.actions.buy_bonus.feature_data).toEqual({ spins: 8 });
  });
});

describe('toLuaPrelude', () => {
  const lua = toLuaPrelude(spec);
  it('emits SYM index table and PAYTABLE', () => {
    expect(lua).toMatch(/SYM\s*=\s*\{/);
    expect(lua).toMatch(/A\s*=\s*1/);
    expect(lua).toMatch(/PAYTABLE/);
    expect(lua).toMatch(/\[3\]\s*=\s*5/);
  });
});

describe('toModeMap / toMathModes', () => {
  it('excludes free actions and defaults mode to UPPER(key)', () => {
    expect(toModeMap(spec)).toEqual({ spin: 'SPIN', buy_bonus: 'BUY_BONUS' });
    expect(toMathModes(spec)).toEqual([
      { action: 'spin', mode: 'SPIN', costMultiplier: 1 },
      { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 50 },
    ]);
  });
});

describe('toPaytableView', () => {
  it('includes only paying symbols', () => {
    expect(toPaytableView(spec).symbols).toEqual([
      { id: 'A', name: 'Ace', kind: 'high', pay: { 3: 5, 4: 20 } },
    ]);
  });
});
