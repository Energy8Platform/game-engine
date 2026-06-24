import { describe, it, expect } from 'vitest';
import { genLuaLogic } from '../src/codegen/luaLogic';

describe('genLuaLogic', () => {
  it('cascade skeleton returns a cascades field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(lua).toContain('function execute(state)');
    expect(lua).toContain('cascades');
    expect(lua).toContain('total_win');
  });
  it('lines skeleton returns a matrix field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain('matrix');
  });
  it('branches on state.action', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain('state.action');
  });
  it('has a buy_bonus branch that always awards free spins', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain("action == 'buy_bonus'");
    // buy_bonus unconditionally sets free_spins_result (no random roll guarding it)
    expect(lua).toContain('awarded = 10');
  });
  it('has a free_spin branch', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain("action == 'free_spin'");
  });
  it('returns free_spins nested object for the normalize path', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    // normalize reads d.free_spins.awarded / d.free_spins.total
    expect(lua).toContain('free_spins = free_spins_result');
    expect(lua).toContain('awarded =');
    expect(lua).toContain('total =');
  });
  it('same assertions hold for cascade variant', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(lua).toContain('state.action');
    expect(lua).toContain("action == 'buy_bonus'");
    expect(lua).toContain('free_spins = free_spins_result');
  });
});
