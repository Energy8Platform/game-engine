import type { PlayParams, SessionData } from '@energy8platform/game-sdk';
import type { LuaEngineConfig, LuaPlayResult, GameDefinition, ActionDefinition } from './types';
import { LuaEngineAPI, createSeededRng, luaToJS, pushJSValue, cachedToLuastring } from './LuaEngineAPI';
import { ActionRouter } from './ActionRouter';
import { SessionManager } from './SessionManager';
import { PersistentState } from './PersistentState';

// fengari — Lua 5.3 in pure JavaScript
import fengari from 'fengari';

const { lua, lauxlib, lualib } = fengari;
const { to_luastring, to_jsstring } = fengari;

/** Default engine variables matching the server's NewGameState() */
const DEFAULT_VARIABLES: Record<string, number> = {
  multiplier: 1,
  total_multiplier: 1,
  global_multiplier: 1,
  last_win_amount: 0,
  free_spins_awarded: 0,
};

/**
 * Runs Lua game scripts locally, replicating the platform's server-side execution.
 *
 * Implements the full lifecycle matching `casino_platform/internal/usecase/game_usecase.go`:
 * action routing → state assembly → Lua execute() → result extraction →
 * transition evaluation → session management.
 */
export class LuaEngine {
  private L: any;
  private api: LuaEngineAPI;
  private actionRouter: ActionRouter;
  private sessionManager: SessionManager;
  private persistentState: PersistentState;
  private gameDefinition: GameDefinition;
  private variables: Record<string, number> = {};
  private simulationMode: boolean;
  /** Reusable state objects to avoid per-iteration allocation */
  private _stateVars: Record<string, number> = {};
  private _stateParams: Record<string, unknown> = {};

  constructor(config: LuaEngineConfig) {
    this.gameDefinition = config.gameDefinition;
    this.simulationMode = config.simulationMode ?? false;

    const rng = config.seed !== undefined
      ? createSeededRng(config.seed)
      : undefined;

    this.api = new LuaEngineAPI(config.gameDefinition, rng, config.logger);
    this.actionRouter = new ActionRouter(config.gameDefinition);
    this.sessionManager = new SessionManager();
    this.persistentState = new PersistentState(config.gameDefinition.persistent_state);

    this.L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(this.L);

    // Polyfill Lua 5.1/5.2 functions removed in 5.3
    lauxlib.luaL_dostring(this.L, to_luastring(`
      math.pow = function(a, b) return a ^ b end
      math.atan2 = math.atan2 or function(y, x) return math.atan(y, x) end
      math.log10 = math.log10 or function(x) return math.log(x, 10) end
      math.cosh = math.cosh or function(x) return (math.exp(x) + math.exp(-x)) / 2 end
      math.sinh = math.sinh or function(x) return (math.exp(x) - math.exp(-x)) / 2 end
      math.tanh = math.tanh or function(x) return math.sinh(x) / math.cosh(x) end
      math.frexp = math.frexp or function(x)
        if x == 0 then return 0, 0 end
        local e = math.floor(math.log(math.abs(x), 2)) + 1
        return x / (2 ^ e), e
      end
      math.ldexp = math.ldexp or function(m, e) return m * (2 ^ e) end
      unpack = unpack or table.unpack
      loadstring = loadstring or load
      table.getn = table.getn or function(t) return #t end
    `));

    this.api.register(this.L);
    this.loadScript(config.script);
  }

  get session(): SessionData | null {
    return this.sessionManager.current;
  }

  get persistentVars(): Record<string, number> {
    return { ...this.variables };
  }

  /**
   * Execute a play action — replicates server's Play() function.
   */
  execute(params: PlayParams): LuaPlayResult {
    const { action: actionName, params: clientParams } = params;

    // 1. Resolve action
    const action = this.actionRouter.resolveAction(
      actionName,
      this.sessionManager.isActive,
    );

    // 2. Determine bet — server uses session bet for session actions
    let bet = params.bet;
    if (this.sessionManager.isActive && this.sessionManager.sessionBet !== undefined) {
      bet = this.sessionManager.sessionBet;
    }

    // 3. Build state.variables (matching server's NewGameState + restore)
    // Reuse pooled object to avoid per-iteration allocation
    const stateVars = this._stateVars;
    // Clear previous keys
    for (const key in stateVars) delete stateVars[key];
    // Apply defaults, then engine vars, then bet
    Object.assign(stateVars, DEFAULT_VARIABLES, this.variables);
    stateVars.bet = bet;

    // Load cross-spin persistent state
    this.persistentState.loadIntoVariables(stateVars);

    // Load session persistent vars + restore spinsRemaining
    if (this.sessionManager.isActive) {
      const sessionParams = this.sessionManager.getPersistentParams();
      for (const [k, v] of Object.entries(sessionParams)) {
        if (typeof v === 'number') {
          stateVars[k] = v;
        }
      }
      // Restore spinsRemaining into the variable the script reads
      if (this.sessionManager.spinsVarName) {
        stateVars[this.sessionManager.spinsVarName] = this.sessionManager.spinsRemaining;
      }
      // Also set free_spins_remaining for convenience
      stateVars.free_spins_remaining = this.sessionManager.spinsRemaining;
    }

    // 4. Build state.params (reuse pooled object)
    const stateParams = this._stateParams;
    for (const key in stateParams) delete stateParams[key];
    if (clientParams) Object.assign(stateParams, clientParams);
    stateParams._action = actionName;

    // Inject session _ps_* persistent data
    if (this.sessionManager.isActive) {
      const sessionParams = this.sessionManager.getPersistentParams();
      for (const [k, v] of Object.entries(sessionParams)) {
        if (typeof v !== 'number') {
          stateParams[k] = v;
        }
      }
    }

    // Inject cross-spin _ps_* game data
    const gameDataParams = this.persistentState.getGameDataParams();
    Object.assign(stateParams, gameDataParams);

    // Handle buy bonus
    if (action.buy_bonus_mode && this.gameDefinition.buy_bonus) {
      const mode = this.gameDefinition.buy_bonus.modes[action.buy_bonus_mode];
      if (mode) {
        stateParams.buy_bonus = true;
        stateParams.buy_bonus_mode = action.buy_bonus_mode;
        if (mode.scatter_distribution) {
          stateParams.forced_scatter_count = this.pickFromDistribution(mode.scatter_distribution);
        }
      }
    }

    // Handle ante bet
    if (clientParams?.ante_bet && this.gameDefinition.ante_bet) {
      stateParams.ante_bet = true;
    }

    // 5. Execute Lua (server: executor.Execute(stage, state))
    const luaResult = this.callLuaExecute(action.stage, actionName, stateParams, stateVars);

    // 6. Process result (server: ApplyLuaResult)
    const totalWinMultiplier = typeof luaResult.total_win === 'number' ? luaResult.total_win : 0;
    const resultVariables = (luaResult.variables ?? {}) as Record<string, number>;
    const spinWin = Math.round(totalWinMultiplier * bet * 100) / 100;

    // Merge ONLY Lua return variables into engine state (not the whole stateVars).
    // On the server, state.Variables is a temporary object rebuilt each call.
    // Only the Lua result's `variables` table persists between calls.
    Object.assign(this.variables, resultVariables);
    // Also update stateVars for transition evaluation below
    Object.assign(stateVars, resultVariables);

    // Build client data (everything except special keys)
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(luaResult)) {
      if (key !== 'total_win' && key !== 'variables') {
        data[key] = value;
      }
    }

    // Apply MapState parity — server's state_mapper.go injects these
    // variable-derived keys into the client data so scripts don't have to
    // surface them manually. Lua-provided values take precedence (server
    // also overwrites variable-derived keys with state.Data on merge).
    this.applyMapStateInjection(stateVars, data);

    // 7. Handle _persist_* and _persist_game_* keys
    this.sessionManager.storePersistData(data);
    this.persistentState.storeGameData(data);

    // Save cross-spin persistent state (from stateVars which has Lua result merged)
    this.persistentState.saveFromVariables(stateVars);

    // Add exposed persistent vars to client data
    const exposedVars = this.persistentState.getExposedVars();
    if (exposedVars) {
      data.persistent_state = exposedVars;
    }

    // Remove _persist_* keys from client data
    for (const key of Object.keys(data)) {
      if (key.startsWith('_persist_')) {
        delete data[key];
      }
    }

    // 8. Evaluate transitions (server uses state.Variables which is stateVars)
    const { rule } = this.actionRouter.evaluateTransitions(action, stateVars);
    let nextActions = rule.next_actions;

    // 9. Determine credit behavior (server: creditNow logic)
    let creditDeferred = action.credit === 'defer' || rule.credit_override === 'defer';

    // 10. Session lifecycle (server: create/update/complete session)
    let session = this.sessionManager.current;
    let resultTotalWin = spinWin;
    let sessionCompleted = false;

    // Calculate max win cap for session
    const maxWinCap = this.calculateMaxWinCap(bet);

    // Snapshot the round data for history (matches server's MapStateForHistory:
    // strip _persist_* keys, but those are already removed below before
    // returning — at this point in the flow they may still be in `data`,
    // so we filter inline).
    const roundData = stripPersistKeys(data);

    if (rule.creates_session && !this.sessionManager.isActive) {
      // CREATE SESSION — initial spin counted (server: createSession includes spinWin)
      session = this.sessionManager.createSession(rule, stateVars, bet, spinWin, maxWinCap, roundData);
      creditDeferred = true;
      resultTotalWin = spinWin;

      // Clear the trigger variable — it was consumed to set spinsRemaining
      if (rule.session_config?.total_spins_var) {
        delete this.variables[rule.session_config.total_spins_var];
      }
    } else if (this.sessionManager.isActive) {
      // UPDATE SESSION — accumulate win, check completion
      session = this.sessionManager.updateSession(rule, stateVars, spinWin, roundData);

      if (session?.completed) {
        // SESSION COMPLETED — server returns session.TotalWin as result.TotalWin,
        // and pulls next_actions from the explicit completion transition
        // (findCompletionNextActions) rather than the matched 'continue' rule.
        const completed = this.sessionManager.completeSession();
        session = completed.session;
        resultTotalWin = completed.totalWin;
        sessionCompleted = true;
        creditDeferred = false;

        const completionNext = findCompletionNextActions(action);
        if (completionNext) {
          nextActions = completionNext;
        }

        // Clean up session-scoped variables
        for (const varName of completed.sessionVarNames) {
          delete this.variables[varName];
        }
      } else {
        // Mid-session: totalWin = spinWin, credit deferred
        resultTotalWin = spinWin;
        creditDeferred = true;
      }
    }
    // No session: resultTotalWin = spinWin (already set)

    // Apply max win cap for non-session spins
    if (!this.sessionManager.isActive && !sessionCompleted && maxWinCap !== undefined && resultTotalWin > maxWinCap) {
      resultTotalWin = maxWinCap;
      this.variables.max_win_reached = 1;
      data.max_win_reached = true;
    }

    return {
      totalWin: Math.round(resultTotalWin * 100) / 100,
      data,
      nextActions,
      session,
      // In simulation mode, return reference directly (caller only reads, never mutates)
      variables: this.simulationMode ? this.variables : { ...this.variables },
      creditDeferred,
    };
  }

  reset(): void {
    this.variables = {};
    this.sessionManager.reset();
    this.persistentState.reset();
  }

  destroy(): void {
    if (this.L) {
      lua.lua_close(this.L);
      this.L = null;
    }
  }

  // ─── Private ──────────────────────────────────────────

  private loadScript(source: string): void {
    const status = lauxlib.luaL_dostring(this.L, to_luastring(source));
    if (status !== lua.LUA_OK) {
      const err = to_jsstring(lua.lua_tostring(this.L, -1));
      lua.lua_pop(this.L, 1);
      throw new Error(`Failed to load Lua script: ${err}`);
    }

    lua.lua_getglobal(this.L, cachedToLuastring('execute'));
    if (lua.lua_type(this.L, -1) !== lua.LUA_TFUNCTION) {
      lua.lua_pop(this.L, 1);
      throw new Error('Lua script must define a global `execute(state)` function');
    }
    lua.lua_pop(this.L, 1);
  }

  private callLuaExecute(
    stage: string,
    action: string,
    params: Record<string, unknown>,
    variables: Record<string, number>,
  ): Record<string, unknown> {
    lua.lua_getglobal(this.L, cachedToLuastring('execute'));

    // Build state table: {stage, action, params, variables}
    lua.lua_createtable(this.L, 0, 4);

    // state.stage
    lua.lua_pushstring(this.L, cachedToLuastring(stage));
    lua.lua_setfield(this.L, -2, cachedToLuastring('stage'));

    // state.action (server sets this at top level)
    lua.lua_pushstring(this.L, cachedToLuastring(action));
    lua.lua_setfield(this.L, -2, cachedToLuastring('action'));

    // state.params
    pushJSValue(this.L, params);
    lua.lua_setfield(this.L, -2, cachedToLuastring('params'));

    // state.variables
    pushJSValue(this.L, variables);
    lua.lua_setfield(this.L, -2, cachedToLuastring('variables'));

    const status = lua.lua_pcall(this.L, 1, 1, 0);
    if (status !== lua.LUA_OK) {
      const err = to_jsstring(lua.lua_tostring(this.L, -1));
      lua.lua_pop(this.L, 1);
      throw new Error(`Lua execute() failed: ${err}`);
    }

    if (this.simulationMode) {
      // Fast path: extract only total_win, variables, _persist_* keys
      const result: Record<string, unknown> = {};

      lua.lua_getfield(this.L, -1, cachedToLuastring('total_win'));
      result.total_win = lua.lua_type(this.L, -1) === lua.LUA_TNUMBER
        ? lua.lua_tonumber(this.L, -1) : 0;
      lua.lua_pop(this.L, 1);

      lua.lua_getfield(this.L, -1, cachedToLuastring('variables'));
      if (lua.lua_type(this.L, -1) === lua.LUA_TTABLE) {
        result.variables = luaToJS(this.L, -1);
      }
      lua.lua_pop(this.L, 1);

      // Scan for _persist_* keys (different stages may or may not have them)
      lua.lua_pushnil(this.L);
      while (lua.lua_next(this.L, -2) !== 0) {
        if (lua.lua_type(this.L, -2) === lua.LUA_TSTRING) {
          const key = to_jsstring(lua.lua_tostring(this.L, -2));
          if (key.startsWith('_persist_')) {
            result[key] = luaToJS(this.L, -1);
          }
        }
        lua.lua_pop(this.L, 1);
      }

      lua.lua_pop(this.L, 1);
      return result;
    }

    // Full path
    const result = luaToJS(this.L, -1);
    lua.lua_pop(this.L, 1);

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Lua execute() must return a table');
    }

    return result as Record<string, unknown>;
  }

  /**
   * Mirror server's state_mapper.go MapState — surface variable-derived
   * fields so scripts that don't manually echo them in the result table
   * still produce a server-shaped data map. Lua keys win on conflict.
   */
  private applyMapStateInjection(
    vars: Record<string, number>,
    data: Record<string, unknown>,
  ): void {
    const m = vars.multiplier;
    if (typeof m === 'number' && m > 1 && data.multiplier === undefined) {
      data.multiplier = m;
    }

    const gm = vars.global_multiplier;
    if (typeof gm === 'number' && gm > 1 && data.global_multiplier === undefined) {
      data.global_multiplier = gm;
    }

    const fs = vars.free_spins_remaining;
    if (typeof fs === 'number' && fs > 0 && data.free_spins_total === undefined) {
      data.free_spins_total = Math.trunc(fs);
    }

    if (vars.max_win_reached === 1 && data.max_win_reached === undefined) {
      data.max_win_reached = true;
    }
  }

  private calculateMaxWinCap(bet: number): number | undefined {
    const mw = this.gameDefinition.max_win;
    if (!mw) return undefined;

    const caps: number[] = [];
    if (mw.multiplier !== undefined) caps.push(bet * mw.multiplier);
    if (mw.fixed !== undefined) caps.push(mw.fixed);

    return caps.length > 0 ? Math.min(...caps) : undefined;
  }

  private pickFromDistribution(distribution: Record<string, number>): number {
    const entries = Object.entries(distribution);
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.api.randomFloat() * totalWeight;

    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return parseInt(value, 10);
    }

    return parseInt(entries[entries.length - 1][0], 10);
  }
}

// ─── Module helpers ─────────────────────────────────────

/**
 * Strip _persist_* and _persist_game_* keys from a data map — matches
 * server's MapStateForHistory used when recording session round history.
 */
function stripPersistKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    if (k.startsWith('_persist_') || k.startsWith('_persist_game_')) continue;
    out[k] = data[k];
  }
  return out;
}

/**
 * Mirror server's findCompletionNextActions: when a session naturally
 * completes, the matched 'continue' rule's next_actions are NOT what
 * the client should see — the explicit complete_session transition wins,
 * with a fallback to the 'always' transition.
 */
function findCompletionNextActions(action: ActionDefinition): string[] | null {
  let alwaysFallback: string[] | null = null;
  for (const t of action.transitions) {
    if (t.complete_session && t.next_actions && t.next_actions.length > 0) {
      return t.next_actions;
    }
    if (t.condition.trim() === 'always' && t.next_actions && t.next_actions.length > 0 && alwaysFallback === null) {
      alwaysFallback = t.next_actions;
    }
  }
  return alwaysFallback;
}
