import { describe, it, expect } from 'vitest';
import { defineGame, buildLuaScript, exportGame, validateE8Bundle } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';
import { LuaEngine } from '../../src/lua';

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

describe('exportGame → E8 deliverables', () => {
  it('emits config.json (with script_path) and a self-contained script.lua', () => {
    const out = exportGame(spec, { logicLua: LOGIC });
    const config = JSON.parse(out['config.json']);
    expect(config.id).toBe('g');
    expect(config.type).toBe('SLOT');
    expect(config.script_path).toBe('script.lua'); // platform resolves to games/g/script.lua
    expect(out['script.lua']).toContain('PAYTABLE');
    expect(out['script.lua']).toContain('function execute');
  });
  it('carries session_ttl and persistent_state when the spec declares them', () => {
    const out = exportGame(
      { ...spec, sessionTtl: '2h', persistentState: { vars: ['charge'], exposed_vars: ['charge'] }, scriptPath: 'games/g/script.lua' },
      { logicLua: LOGIC },
    );
    const config = JSON.parse(out['config.json']);
    expect(config.session_ttl).toBe('2h');
    expect(config.persistent_state).toEqual({ vars: ['charge'], exposed_vars: ['charge'] });
    expect(config.script_path).toBe('games/g/script.lua'); // explicit override respected
  });
  it('omits session_ttl / persistent_state when unset', () => {
    const config = JSON.parse(exportGame(spec, { logicLua: LOGIC })['config.json']);
    expect('session_ttl' in config).toBe(false);
    expect('persistent_state' in config).toBe(false);
  });
  it('is deterministic', () => {
    expect(exportGame(spec, { logicLua: LOGIC })).toEqual(exportGame(spec, { logicLua: LOGIC }));
  });
  it('the exported script.lua boots in a clean LuaEngine and runs a spin', () => {
    const out = exportGame(spec, { logicLua: LOGIC });
    const engine = new LuaEngine({
      script: out['script.lua'],
      gameDefinition: JSON.parse(out['config.json']),
      seed: 1,
    });
    const result = engine.execute({ action: 'spin', bet: 1 });
    engine.destroy();
    expect(typeof result.totalWin).toBe('number');
  });
});

describe('validateE8Bundle', () => {
  it('rejects a script with no execute() entry point', () => {
    expect(() => validateE8Bundle({ 'config.json': JSON.stringify({ id: 'g', type: 'SLOT', script_path: 'script.lua', actions: { spin: {} } }), 'script.lua': '-- nothing here' }))
      .toThrow(/execute/);
  });
  it('rejects a config missing script_path', () => {
    expect(() => validateE8Bundle({ 'config.json': JSON.stringify({ id: 'g', type: 'SLOT', actions: { spin: {} } }), 'script.lua': 'function execute(state) end' }))
      .toThrow(/script_path/);
  });
  it('rejects a config with no actions', () => {
    expect(() => validateE8Bundle({ 'config.json': JSON.stringify({ id: 'g', type: 'SLOT', script_path: 'script.lua', actions: {} }), 'script.lua': 'function execute(state) end' }))
      .toThrow(/actions/);
  });
});
