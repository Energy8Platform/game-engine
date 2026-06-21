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

  it('free action default transitions include an always fallback so in-session free spins never throw', () => {
    // Regression: defaultTransitions for role='free' was missing the always fallback.
    // ActionRouter.evaluateTransitions throws "No matching transition" when no rule
    // matches — which happened on every in-session free spin because only the
    // retrigger-guarded rule existed.
    const freeSpec: GameSpec = {
      id: 'spec-integration-free', type: 'slot', grid: { cols: 3, rows: 3 },
      betLevels: [1], maxWin: 1000,
      symbols: [{ id: 'A', kind: 'high', pay: { 3: 5 } }],
      actions: {
        spin: { role: 'base' },
        free_spin: { role: 'free' },
      },
    };

    // Lua that awards 3 free spins on the base spin and returns a plain win
    // on each free spin (no retrigger), modelled on LUA_WITH_FREE_SPINS in
    // LuaEngine.test.ts.
    const freeLogic = `
function execute(state)
  if state.stage == "base_game" then
    return {
      total_win = 1,
      variables = { free_spins_awarded = 3 },
      matrix = { { SYM.A, SYM.A, SYM.A } },
    }
  elseif state.stage == "free_spins" then
    return {
      total_win = 2,
      matrix = { { SYM.A, SYM.A, SYM.A } },
    }
  end
end
`;

    const model = defineGame(freeSpec);
    engine = new LuaEngine({
      script: buildLuaScript(model, freeLogic),
      gameDefinition: model.gameDefinition,
      seed: 1,
    });

    // Base spin should create a free-spin session
    const base = engine.execute({ action: 'spin', bet: 1 });
    expect(base.nextActions).toEqual(['free_spin']);
    expect(base.session).toBeDefined();
    expect(base.session!.spinsRemaining).toBe(3);

    // Play all free spins — each must NOT throw
    const fs1 = engine.execute({ action: 'free_spin', bet: 1 });
    expect(fs1.session!.spinsRemaining).toBe(2);

    const fs2 = engine.execute({ action: 'free_spin', bet: 1 });
    expect(fs2.session!.spinsRemaining).toBe(1);

    // Last free spin — session completes
    const fs3 = engine.execute({ action: 'free_spin', bet: 1 });
    expect(fs3.session!.completed).toBe(true);
    expect(fs3.session!.spinsRemaining).toBe(0);
  });
});
