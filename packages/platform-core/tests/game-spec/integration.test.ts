// game-spec → .spin prelude → e8 engine, end-to-end. Gated on the e8 binary
// (fetched by postinstall); skips cleanly when it is absent.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { defineGame, buildSpinScript } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';
import { findE8Binary } from '../../src/simulation';

const spec: GameSpec = {
  id: 'spec-integration', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 5 } },
    { id: 'B', kind: 'low', pay: { 3: 2 } },
  ],
  actions: { spin: { role: 'base' } },
};

const logic = readFileSync(resolve(__dirname, 'fixtures/logic.spin'), 'utf8');
const e8 = findE8Binary();

describe.skipIf(!e8)('game-spec + e8 engine integration', () => {
  it('compiles the generated prelude and plays a round off PAY_A/SYM', () => {
    const model = defineGame(spec);
    const script = buildSpinScript(model, logic);

    const dir = mkdtempSync(join(tmpdir(), 'spec-int-'));
    try {
      const scriptPath = join(dir, 'g.spin');
      const cfgPath = join(dir, 'cfg.json');
      const dumpPath = join(dir, 'r.jsonl');
      writeFileSync(scriptPath, script);
      writeFileSync(cfgPath, JSON.stringify({ id: 'spec-integration', script_path: scriptPath }));
      execFileSync(e8!, ['simulate', '-config', cfgPath, '-iterations', '1', '-bet', '2',
        '-format', 'json', '-action', 'spin', '-rng', 'fast', '-dump', dumpPath]);
      const rec = JSON.parse(readFileSync(dumpPath, 'utf8').split('\n')[0]);
      // PAY_A[0] = 5.0 из прелюдии; bet 2 → total_win (валюта) = 10
      expect(rec.total_win_x).toBe(5);
      expect(rec.total_win).toBe(10);
      expect(rec.spins[0].data.sym_a).toBe(1); // SYM.A = 1 (1-based)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
