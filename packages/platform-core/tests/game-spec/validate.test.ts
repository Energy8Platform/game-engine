import { describe, it, expect } from 'vitest';
import { validateSpec, GameSpecError } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const base = (): GameSpec => ({
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 1], maxWin: 1000,
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 5 } },
    { id: 'WILD', kind: 'wild' },
  ],
  actions: { spin: { role: 'base' }, free_spin: { role: 'free' } },
});

describe('validateSpec', () => {
  it('accepts a valid spec', () => {
    expect(() => validateSpec(base())).not.toThrow();
  });
  it('accepts paylines that fit the grid, rejects ones that do not', () => {
    const s = base(); s.paylines = [[1, 1, 1], [0, 1, 2]];
    expect(() => validateSpec(s)).not.toThrow();
    s.paylines = [[1, 1]]; // too short for 3 columns
    expect(() => validateSpec(s)).toThrow(/paylines\[0\]/);
    s.paylines = [[0, 1, 3]]; // row 3 on a 3-row grid
    expect(() => validateSpec(s)).toThrow(/paylines/);
  });
  it('rejects duplicate symbol ids', () => {
    const s = base(); s.symbols.push({ id: 'A', kind: 'low', pay: { 3: 2 } });
    expect(() => validateSpec(s)).toThrow(GameSpecError);
  });
  it('rejects cost <= 0', () => {
    const s = base(); s.actions.buy = { role: 'buy', cost: 0 };
    expect(() => validateSpec(s)).toThrow(/cost/);
  });
  it('rejects unsorted bet levels', () => {
    const s = base(); s.betLevels = [1, 0.2, 0.1];
    expect(() => validateSpec(s)).toThrow(/bet/i);
  });
  it('rejects empty bet levels', () => {
    const s = base(); s.betLevels = [];
    expect(() => validateSpec(s)).toThrow(/bet/i);
  });
  it('rejects maxWin <= 0', () => {
    const s = base(); s.maxWin = 0;
    expect(() => validateSpec(s)).toThrow(/maxWin/);
  });
  it('rejects pay with non-positive multiplier', () => {
    const s = base(); s.symbols[0].pay = { 3: 0 };
    expect(() => validateSpec(s)).toThrow(/pay/);
  });
  it('rejects a transition referencing an unknown action', () => {
    const s = base();
    s.actions.spin = { role: 'base', transitions: [{ condition: 'always', next_actions: ['nope'] }] };
    expect(() => validateSpec(s)).toThrow(/next_actions|unknown action/i);
  });
  it('rejects non-positive grid dimensions', () => {
    const s = base(); s.grid = { cols: 0, rows: 3 };
    expect(() => validateSpec(s)).toThrow(/grid/);
  });
  it('rejects blank id', () => {
    const s = base(); s.id = '  ';
    expect(() => validateSpec(s)).toThrow(/id/);
  });
});
