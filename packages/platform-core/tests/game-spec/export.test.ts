import { describe, it, expect } from 'vitest';
import { defineGame, buildSpinScript, exportGameSpin } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }],
  actions: { spin: { role: 'base' } },
};
const LOGIC = 'fn execute(c: ctx, v: Vars) -> outcome { return outcome { win: 0.0, vars: Vars { n: 0 }, data: D { w: 0.0 } } }';

describe('buildSpinScript', () => {
  it('prepends the spec prelude to the math', () => {
    const m = defineGame(spec);
    const out = buildSpinScript(m, LOGIC);
    expect(out.startsWith(m.spinPrelude)).toBe(true);
    expect(out.endsWith(LOGIC)).toBe(true);
    expect(out).toContain('const SPEC = {');
    expect(out).toContain('const SYM = { A: 1 }');
    expect(out).toContain('const PAY_COUNTS: [int; 1] = [3]');
    expect(out).toContain('const PAY_A: [float; 1] = [5.0]');
  });
});

describe('exportGameSpin → E8 deliverables', () => {
  it('emits config.json (engine_mode=spin, script_path) and a self-contained script.spin', () => {
    const out = exportGameSpin(spec, { logicSpin: LOGIC });
    const config = JSON.parse(out['config.json']);
    expect(config.id).toBe('g');
    expect(config.type).toBe('SLOT');
    expect(config.engine_mode).toBe('spin');
    expect(config.script_path).toBe('script.spin');
    expect(out['script.spin']).toContain('const SPEC = {');
    expect(out['script.spin']).toContain('fn execute');
  });
  it('carries session_ttl and persistent_state when the spec declares them', () => {
    const out = exportGameSpin(
      { ...spec, sessionTtl: '2h', persistentState: { vars: ['charge'], exposed_vars: ['charge'] } },
      { logicSpin: LOGIC },
    );
    const config = JSON.parse(out['config.json']);
    expect(config.session_ttl).toBe('2h');
    expect(config.persistent_state).toEqual({ vars: ['charge'], exposed_vars: ['charge'] });
  });
  it('is deterministic', () => {
    expect(exportGameSpin(spec, { logicSpin: LOGIC })).toEqual(exportGameSpin(spec, { logicSpin: LOGIC }));
  });
  it('rejects math without an execute entry point', () => {
    expect(() => exportGameSpin(spec, { logicSpin: '-- empty' })).toThrow(/execute/);
  });
});
