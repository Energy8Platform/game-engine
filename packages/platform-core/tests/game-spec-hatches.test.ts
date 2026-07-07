// packages/platform-core/tests/game-spec-hatches.test.ts
import { describe, it, expect } from 'vitest';
import { toSpinPrelude } from '../src/game-spec/derive';
import type { GameSpec } from '../src/game-spec/types';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 6, rows: 6 }, betLevels: [1], maxWin: 1000,
  symbols: [
    { id: 'H1', kind: 'high', pay: { 3: 10 } },
    { id: 'MULT', kind: 'multiplier', value: [2, 3, 5] },
    { id: 'COIN', kind: 'multiplier', value: 100, meta: { holdAndSpin: true } },
  ],
  actions: { spin: { role: 'base' } },
  mechanic: 'cluster',
  meta: { theme: 'space' },
};

describe('game-spec hatches', () => {
  it('surfaces symbol value(s) into a VAL_<ID> spin consts', () => {
    const p = toSpinPrelude(spec);
    expect(p).toContain('const VAL_');
    expect(p).toContain('const VAL_MULT: [int; 3] = [2, 3, 5]');
    expect(p).toContain('const VAL_COIN: int = 100');
  });

  it('omits VALUES when no symbol carries a value', () => {
    const p = toSpinPrelude({ ...spec, symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }] });
    expect(p).not.toContain('const VAL_');
  });
});
