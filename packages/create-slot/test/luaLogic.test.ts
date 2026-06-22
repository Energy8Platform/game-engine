import { describe, it, expect } from 'vitest';
import { genLuaLogic } from '../src/codegen/luaLogic';

describe('genLuaLogic', () => {
  it('cascade skeleton returns a cascades field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true });
    expect(lua).toContain('function execute(state)');
    expect(lua).toContain('cascades');
    expect(lua).toContain('total_win');
  });
  it('lines skeleton returns a matrix field', () => {
    const lua = genLuaLogic({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(lua).toContain('matrix');
  });
});
