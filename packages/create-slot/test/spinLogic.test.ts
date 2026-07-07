import { describe, it, expect } from 'vitest';
import { genSpinLogic } from '../src/codegen/spinLogic';

describe('genSpinLogic', () => {
  const s = genSpinLogic({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });

  it('declares the typed contract: Vars/Feat/Data records + game/actions', () => {
    expect(s).toContain('record Vars {');
    expect(s).toContain('record Feat {');
    expect(s).toContain('record Data {');
    expect(s).toContain('game "g" {');
    expect(s).toContain('action spin {');
    expect(s).toContain('action ante {');
    expect(s).toContain('action buy_bonus {');
    expect(s).toContain('action free_spin {');
  });

  it('free spins open/extend/end declaratively (no manual session calls)', () => {
    expect(s).toContain('opens = free_spin count free_spins_awarded');
    expect(s).toContain('extends = retrigger_spins');
    expect(s).toContain('ends when max_win_reached');
  });

  it('defines execute returning outcome and reads the spec prelude consts', () => {
    expect(s).toContain('fn execute(c: ctx, v: Vars) -> outcome {');
    expect(s).toContain('SPEC.cells');
    expect(s).toContain('N_SYMBOLS');
    expect(s).not.toContain('function execute'); // не Lua
  });
});
