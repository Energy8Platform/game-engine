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

    // Play free spins (initial spin already counted as spinsPlayed=1)
    const fs1 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs1.session).toBeDefined();
    expect(fs1.session!.spinsRemaining).toBe(2);
    expect(fs1.session!.spinsPlayed).toBe(2); // initial + this one

    const fs2 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs2.session!.spinsRemaining).toBe(1);
    expect(fs2.session!.spinsPlayed).toBe(3);

    // Last free spin — session completes
    const fs3 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs3.session!.completed).toBe(true);
    expect(fs3.session!.spinsRemaining).toBe(0);
    // totalWin should be cumulative session win, not just last spin
    expect(fs3.totalWin).toBeGreaterThan(0);
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

// ─── Stage 2: server-parity contract checks ────────────────────────────

describe('LuaEngine session.history (server SessionInfo.History parity)', () => {
  let engine: LuaEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('createSession seeds history with the trigger spin', () => {
    engine = new LuaEngine({
      script: LUA_WITH_FREE_SPINS,
      gameDefinition: SIMPLE_GAME_DEF,
    });

    const baseResult = engine.execute({ action: 'spin', bet: 1.0 });

    // Server's createSession appends an initial round with spin_index=0,
    // win=state.TotalWin, data=MapStateForHistory(state). DevBridge's
    // GET_STATE relays SessionInfo.History so the client can rebuild the
    // screen on reload — without it, the history field is just missing.
    expect(baseResult.session?.history).toBeDefined();
    expect(baseResult.session?.history).toHaveLength(1);
    expect(baseResult.session?.history?.[0]).toMatchObject({
      spinIndex: 0,
      data: expect.objectContaining({ matrix: expect.any(Array) }),
    });
  });

  it('updateSession appends a round per session play', () => {
    engine = new LuaEngine({
      script: LUA_WITH_FREE_SPINS,
      gameDefinition: SIMPLE_GAME_DEF,
    });

    engine.execute({ action: 'spin', bet: 1.0 }); // creates session, history len=1
    const fs1 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs1.session?.history).toHaveLength(2);
    expect(fs1.session?.history?.[1].spinIndex).toBe(1);

    const fs2 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs2.session?.history).toHaveLength(3);

    const fs3 = engine.execute({ action: 'free_spin', bet: 1.0 });
    // Final completed session also carries history.
    expect(fs3.session?.completed).toBe(true);
    expect(fs3.session?.history).toHaveLength(4);
    expect(fs3.session?.history?.[3].spinIndex).toBe(3);
  });
});

describe('LuaEngine MapState parity (auto-injected variable-derived data fields)', () => {
  let engine: LuaEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('exposes multiplier from variables when > 1 (Lua-return key not required)', () => {
    // Server's MapState injects data["multiplier"] when state.Variables[multiplier] > 1,
    // even if the Lua script didn't put it into the return table.
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          variables = { multiplier = 3 },
          matrix = {{1}},
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });

    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.multiplier).toBe(3);
  });

  it('does NOT expose multiplier when value is <= 1 (server omits it)', () => {
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          variables = { multiplier = 1 },
          matrix = {{1}},
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });

    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.multiplier).toBeUndefined();
  });

  it('exposes global_multiplier from variables when > 1', () => {
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          variables = { global_multiplier = 5 },
          matrix = {{1}},
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });

    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.global_multiplier).toBe(5);
  });

  it('exposes free_spins_total from free_spins_remaining when > 0', () => {
    // Server's MapState: data["free_spins_total"] = int(VarFreeSpinsRemaining)
    // when free_spins_remaining > 0. A trigger spin that sets
    // free_spins_remaining must surface that count in data.
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          variables = { free_spins_remaining = 8 },
          matrix = {{1}},
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });

    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.free_spins_total).toBe(8);
  });
});

describe('LuaEngine v5 action_config + feature_data (state.action_config parity)', () => {
  let engine: LuaEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('exposes state.action_config.cost_multiplier (defaults to 1 when unset)', () => {
    // Server's lua_runtime.go puts cost_multiplier into state.action_config
    // and substitutes 1.0 when the action doesn't set it. Lua scripts read
    // it via state.action_config.cost_multiplier — no parallel `params` flag.
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          cost = state.action_config and state.action_config.cost_multiplier or -1,
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });
    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.cost).toBe(1);
  });

  it('exposes state.action_config.cost_multiplier when set on the action', () => {
    const def: GameDefinition = {
      id: 'cost-mult',
      type: 'SLOT',
      bet_levels: [1],
      actions: {
        buy_bonus: {
          stage: 'base_game',
          debit: 'bet',
          cost_multiplier: 100,
          transitions: [{ condition: 'always', next_actions: ['spin'] }],
        },
      },
    };
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          cost = state.action_config.cost_multiplier,
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: def });
    const r = engine.execute({ action: 'buy_bonus', bet: 1.0 });
    expect(r.data.cost).toBe(100);
  });

  it('exposes state.action_config.feature_data verbatim', () => {
    const def: GameDefinition = {
      id: 'feature-data',
      type: 'SLOT',
      bet_levels: [1],
      actions: {
        buy_bonus: {
          stage: 'base_game',
          debit: 'bet',
          cost_multiplier: 100,
          feature_data: { scatter_distribution: { '4': 60, '5': 40 } },
          transitions: [{ condition: 'always', next_actions: ['spin'] }],
        },
      },
    };
    const lua = `
      function execute(state)
        local fd = state.action_config.feature_data
        return {
          total_win = 0,
          dist_4 = fd.scatter_distribution["4"],
          dist_5 = fd.scatter_distribution["5"],
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: def });
    const r = engine.execute({ action: 'buy_bonus', bet: 1.0 });
    expect(r.data.dist_4).toBe(60);
    expect(r.data.dist_5).toBe(40);
  });

  it('rolls forced_scatter_count from feature_data.scatter_distribution and puts it in state.params', () => {
    // Server: when actionDef.feature_data.scatter_distribution is present,
    // platform rolls a count via the weighted distribution and exposes it
    // as state.params.forced_scatter_count. The roll itself stays in
    // params (random output), not in the static action_config.
    const def: GameDefinition = {
      id: 'forced-scatter',
      type: 'SLOT',
      bet_levels: [1],
      actions: {
        buy_bonus: {
          stage: 'base_game',
          debit: 'bet',
          cost_multiplier: 100,
          // Single-bucket distribution → roll is deterministic.
          feature_data: { scatter_distribution: { '5': 100 } },
          transitions: [{ condition: 'always', next_actions: ['spin'] }],
        },
      },
    };
    const lua = `
      function execute(state)
        return {
          total_win = 0,
          forced = state.params.forced_scatter_count,
        }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: def });
    const r = engine.execute({ action: 'buy_bonus', bet: 1.0 });
    expect(r.data.forced).toBe(5);
  });

  it('exposes state.action with the invoked action name', () => {
    const lua = `
      function execute(state)
        return { total_win = 0, action_name = state.action }
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: SIMPLE_GAME_DEF });
    const r = engine.execute({ action: 'spin', bet: 1.0 });
    expect(r.data.action_name).toBe('spin');
  });
});

describe('LuaEngine completion next_actions (findCompletionNextActions parity)', () => {
  let engine: LuaEngine;

  afterEach(() => {
    engine?.destroy();
  });

  it('returns the complete_session transition next_actions on natural completion', () => {
    // Real-world free-spin layout: continue while remaining > 0; on the
    // last spin the matched rule is still the "continue" rule, but session
    // completes via decrement. Server's findCompletionNextActions pulls
    // next_actions from the explicit complete_session transition, not from
    // the matched continue rule.
    const gameDef: GameDefinition = {
      id: 'completion-test',
      type: 'SLOT',
      bet_levels: [1],
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
            // Continue rule — matches every free spin including the last one.
            { condition: 'free_spins_remaining > 0', next_actions: ['free_spin'] },
            // Completion rule — server's findCompletionNextActions picks
            // *this* transition's next_actions on the spin where the session
            // ends. Without the fix, LuaEngine returns ['free_spin'] from
            // the matched continue rule.
            { condition: 'always', complete_session: true, next_actions: ['spin'] },
          ],
        },
      },
    };

    const lua = `
      function execute(state)
        if state.stage == "base_game" then
          return {
            total_win = 0,
            variables = { free_spins_awarded = 2 },
            matrix = {{1}},
          }
        else
          return { total_win = 0, matrix = {{2}} }
        end
      end
    `;
    engine = new LuaEngine({ script: lua, gameDefinition: gameDef });

    engine.execute({ action: 'spin', bet: 1.0 }); // triggers session, 2 free spins
    const fs1 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs1.session?.completed).toBe(false);
    expect(fs1.nextActions).toEqual(['free_spin']);

    const fs2 = engine.execute({ action: 'free_spin', bet: 1.0 });
    expect(fs2.session?.completed).toBe(true);
    // BUG fix: must come from the complete_session transition, not the
    // matched 'continue' rule.
    expect(fs2.nextActions).toEqual(['spin']);
  });
});
