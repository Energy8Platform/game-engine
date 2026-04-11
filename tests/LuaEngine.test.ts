import { describe, it, expect, afterEach } from 'vitest';
import { LuaEngine } from '../src/lua/LuaEngine';
import type { GameDefinition } from '../src/lua/types';

const SIMPLE_GAME_DEF: GameDefinition = {
  id: 'test-slot',
  type: 'SLOT',
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [
        {
          condition: 'free_spins_awarded > 0',
          creates_session: true,
          credit_override: 'defer',
          next_actions: ['free_spin'],
          session_config: { total_spins_var: 'free_spins_awarded' },
        },
        { condition: 'always', next_actions: ['spin'] },
      ],
    },
    free_spin: {
      stage: 'free_spins',
      debit: 'none',
      requires_session: true,
      transitions: [
        { condition: 'always', next_actions: ['free_spin'] },
      ],
    },
  },
  bet_levels: [0.2, 0.5, 1, 2, 5],
  max_win: { multiplier: 10000 },
};

const SIMPLE_LUA = `
function execute(state)
    local bet = state.variables.bet
    local stage = state.stage

    if stage == "base_game" then
        -- Generate a 3x3 matrix using engine.random
        local matrix = {}
        for col = 1, 3 do
            matrix[col] = {}
            for row = 1, 3 do
                matrix[col][row] = engine.random(1, 9)
            end
        end

        -- Simple win: if first column is all same symbol
        local win = 0
        if matrix[1][1] == matrix[1][2] and matrix[1][2] == matrix[1][3] then
            win = 5 -- 5x bet
        end

        return {
            total_win = win,
            matrix = matrix,
        }
    elseif stage == "free_spins" then
        return {
            total_win = 2,
            matrix = {{1,2,3},{4,5,6},{7,8,9}},
        }
    end
end
`;

const LUA_WITH_FREE_SPINS = `
function execute(state)
    if state.stage == "base_game" then
        return {
            total_win = 1,
            variables = {
                free_spins_awarded = 3,
            },
            matrix = {{1,2,3}},
        }
    elseif state.stage == "free_spins" then
        return {
            total_win = 2,
            matrix = {{4,5,6}},
        }
    end
end
`;

describe('LuaEngine', () => {
  let engine: LuaEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('should initialize and execute a simple Lua script', () => {
    engine = new LuaEngine({
      script: SIMPLE_LUA,
      gameDefinition: SIMPLE_GAME_DEF,
      seed: 42,
    });

    const result = engine.execute({
      action: 'spin',
      bet: 1.0,
    });

    expect(result).toBeDefined();
    expect(result.data.matrix).toBeDefined();
    expect(Array.isArray(result.data.matrix)).toBe(true);
    expect((result.data.matrix as number[][]).length).toBe(3);
    expect(result.nextActions).toEqual(['spin']);
    expect(result.session).toBeNull();
    expect(typeof result.totalWin).toBe('number');
  });

  it('should produce deterministic results with seed', () => {
    engine = new LuaEngine({
      script: SIMPLE_LUA,
      gameDefinition: SIMPLE_GAME_DEF,
      seed: 12345,
    });

    const result1 = engine.execute({ action: 'spin', bet: 1.0 });
    engine.destroy();

    engine = new LuaEngine({
      script: SIMPLE_LUA,
      gameDefinition: SIMPLE_GAME_DEF,
      seed: 12345,
    });

    const result2 = engine.execute({ action: 'spin', bet: 1.0 });

    expect(result1.data.matrix).toEqual(result2.data.matrix);
    expect(result1.totalWin).toBe(result2.totalWin);
  });

  it('should throw on invalid script', () => {
    expect(() => {
      engine = new LuaEngine({
        script: 'this is not valid lua!!!',
        gameDefinition: SIMPLE_GAME_DEF,
      });
    }).toThrow('Failed to load Lua script');
  });

  it('should throw if execute function is missing', () => {
    expect(() => {
      engine = new LuaEngine({
        script: 'local x = 1',
        gameDefinition: SIMPLE_GAME_DEF,
      });
    }).toThrow('must define a global `execute(state)` function');
  });

  it('should throw on unknown action', () => {
    engine = new LuaEngine({
      script: SIMPLE_LUA,
      gameDefinition: SIMPLE_GAME_DEF,
    });

    expect(() => {
      engine.execute({ action: 'unknown_action', bet: 1.0 });
    }).toThrow('Unknown action');
  });

  it('should handle free spins session lifecycle', () => {
    engine = new LuaEngine({
      script: LUA_WITH_FREE_SPINS,
      gameDefinition: SIMPLE_GAME_DEF,
    });

    // Base game triggers free spins
    const baseResult = engine.execute({ action: 'spin', bet: 1.0 });
    expect(baseResult.nextActions).toEqual(['free_spin']);
    expect(baseResult.session).toBeDefined();
    expect(baseResult.session!.spinsRemaining).toBe(3);
    expect(baseResult.creditDeferred).toBe(true);

    // Play free spins
    const fs1 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs1.session).toBeDefined();
    expect(fs1.session!.spinsRemaining).toBe(2);
    expect(fs1.session!.spinsPlayed).toBe(1);

    const fs2 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs2.session!.spinsRemaining).toBe(1);

    // Last free spin — session completes
    const fs3 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs3.session!.completed).toBe(true);
    expect(fs3.session!.spinsRemaining).toBe(0);
  });

  it('should apply max win cap', () => {
    const luaScript = `
function execute(state)
    return {
        total_win = 99999,
        matrix = {{1}},
    }
end
`;
    engine = new LuaEngine({
      script: luaScript,
      gameDefinition: { ...SIMPLE_GAME_DEF, max_win: { multiplier: 100 } },
    });

    const result = engine.execute({ action: 'spin', bet: 1.0 });
    // max win = bet * 100 = 100
    expect(result.totalWin).toBe(100);
    expect(result.data.max_win_reached).toBe(true);
  });

  it('should pass engine.* API functions to Lua', () => {
    const luaScript = `
function execute(state)
    -- Test engine.random
    local r = engine.random(1, 10)

    -- Test engine.random_float
    local rf = engine.random_float()

    -- Test engine.random_weighted
    local idx = engine.random_weighted({10, 20, 30})

    -- Test engine.shuffle
    local shuffled = engine.shuffle({1, 2, 3, 4, 5})

    -- Test engine.get_config
    local config = engine.get_config()

    -- Test engine.log
    engine.log("debug", "test message")

    return {
        total_win = 0,
        random_int = r,
        random_float = rf,
        weighted_idx = idx,
        shuffled = shuffled,
        config_id = config.id,
    }
end
`;
    engine = new LuaEngine({
      script: luaScript,
      gameDefinition: SIMPLE_GAME_DEF,
      seed: 42,
    });

    const result = engine.execute({ action: 'spin', bet: 1.0 });

    expect(result.data.random_int).toBeGreaterThanOrEqual(1);
    expect(result.data.random_int).toBeLessThanOrEqual(10);
    expect(result.data.random_float).toBeGreaterThanOrEqual(0);
    expect(result.data.random_float).toBeLessThan(1);
    expect(result.data.weighted_idx).toBeGreaterThanOrEqual(1);
    expect(result.data.weighted_idx).toBeLessThanOrEqual(3);
    expect(Array.isArray(result.data.shuffled)).toBe(true);
    expect((result.data.shuffled as number[]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(result.data.config_id).toBe('test-slot');
  });

  it('should reset state', () => {
    engine = new LuaEngine({
      script: LUA_WITH_FREE_SPINS,
      gameDefinition: SIMPLE_GAME_DEF,
    });

    engine.execute({ action: 'spin', bet: 1.0 });
    expect(engine.session).not.toBeNull();

    engine.reset();
    expect(engine.session).toBeNull();
  });
});
