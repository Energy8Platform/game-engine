// packages/platform-core/tests/game-spec/integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineGame, buildLuaScript } from '../../src/game-spec';
import type { GameSpec } from '../../src/game-spec';
import { LuaEngine } from '../../src/lua';

const spec: GameSpec = {
  id: 'spec-integration', type: 'slot', grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 1], maxWin: 1000,
  symbols: [
    { id: 'A', kind: 'high', pay: { 3: 5 } },
    { id: 'B', kind: 'low', pay: { 3: 2 } },
  ],
  actions: { spin: { role: 'base' } },
};

const logic = readFileSync(resolve(__dirname, 'fixtures/logic.lua'), 'utf8');

describe('game-spec + LuaEngine integration', () => {
  let engine: LuaEngine;
  afterEach(() => engine?.destroy());

  it('runs a spin using the generated prelude', () => {
    const model = defineGame(spec);
    engine = new LuaEngine({
      script: buildLuaScript(model, logic),
      gameDefinition: model.gameDefinition,
      seed: 1,
    });
    const result = engine.execute({ action: 'spin', bet: 2 });
    // PAYTABLE.A[3] = 5, bet 2 -> 10
    expect(result.totalWin).toBe(10);
    expect(Array.isArray(result.data.matrix)).toBe(true);
  });
});
