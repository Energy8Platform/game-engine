import { describe, it, expect } from 'vitest';
import { defineGame, GameSpecError } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }, { id: 'WILD', kind: 'wild' }],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' } },
};

describe('defineGame', () => {
  it('returns a model with all derived views', () => {
    const m = defineGame(spec);
    expect(m.spec).toBe(spec);
    expect(m.gameDefinition.id).toBe('g');
    expect(m.luaPrelude).toMatch(/PAYTABLE/);
    expect(m.modeMap).toEqual({ spin: 'SPIN' });
    expect(m.mathModes).toEqual([{ action: 'spin', mode: 'SPIN', costMultiplier: 1 }]);
    expect(m.paytable.symbols.map((s) => s.id)).toEqual(['A']);
    expect(m.symbols).toBe(spec.symbols);
  });
  it('validates before deriving', () => {
    const bad: GameSpec = { ...spec, betLevels: [] };
    expect(() => defineGame(bad)).toThrow(GameSpecError);
  });
});
