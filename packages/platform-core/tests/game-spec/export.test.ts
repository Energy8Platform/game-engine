import { describe, it, expect } from 'vitest';
import { defineGame, buildLuaScript, exportGame } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }],
  actions: { spin: { role: 'base' } },
};
const LOGIC = 'function execute(state) return { total_win = 0, matrix = {{1}} } end';

describe('buildLuaScript', () => {
  it('prepends the prelude to logic', () => {
    const m = defineGame(spec);
    const out = buildLuaScript(m, LOGIC);
    expect(out.startsWith(m.luaPrelude)).toBe(true);
    expect(out.endsWith(LOGIC)).toBe(true);
    expect(out).toContain('PAYTABLE');
  });
});

describe('exportGame', () => {
  it('emits gameDefinition.json and a self-contained script.lua', () => {
    const out = exportGame(spec, { logicLua: LOGIC });
    const gd = JSON.parse(out['gameDefinition.json']);
    expect(gd.id).toBe('g');
    expect(gd.type).toBe('SLOT');
    expect(out['script.lua']).toContain('PAYTABLE');
    expect(out['script.lua']).toContain('function execute');
  });
  it('is deterministic', () => {
    const a = exportGame(spec, { logicLua: LOGIC });
    const b = exportGame(spec, { logicLua: LOGIC });
    expect(a).toEqual(b);
  });
});
