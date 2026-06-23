// packages/platform-core/tests/game-spec-hatches.test.ts
import { describe, it, expect } from 'vitest';
import { toLuaPrelude } from '../src/game-spec/derive';
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
  it('surfaces symbol value(s) into a VALUES Lua table', () => {
    const p = toLuaPrelude(spec);
    expect(p).toContain('VALUES = {');
    expect(p).toContain('MULT = {2, 3, 5}');
    expect(p).toContain('COIN = 100');
  });

  it('omits VALUES when no symbol carries a value', () => {
    const p = toLuaPrelude({ ...spec, symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }] });
    expect(p).not.toContain('VALUES');
  });
});
