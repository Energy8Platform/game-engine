import type { PlayParams, SessionData } from '@energy8platform/game-sdk';
import type { LuaEngineConfig, LuaPlayResult, GameDefinition } from './types';
import { LuaEngineAPI, createSeededRng, luaToJS, pushJSValue } from './LuaEngineAPI';
import { ActionRouter } from './ActionRouter';
import { SessionManager } from './SessionManager';
import { PersistentState } from './PersistentState';

// fengari — Lua 5.3 in pure JavaScript
// eslint-disable-next-line @typescript-eslint/no-var-requires
declare const require: (module: string) => any;
const fengari = require('fengari');
const { lua, lauxlib, lualib } = fengari;
const { to_luastring, to_jsstring } = fengari;

/**
 * Runs Lua game scripts locally, replicating the platform's server-side execution.
 *
 * Implements the full lifecycle: action routing → state assembly → Lua execute() →
 * result extraction → transition evaluation → session management.
 *
 * @example
 * ```ts
 * const engine = new LuaEngine({
 *   script: luaSource,
 *   gameDefinition: { id: 'my-slot', type: 'SLOT', actions: { ... } },
 * });
 *
 * const result = engine.execute({ action: 'spin', bet: 1.0 });
 * // result.data.matrix, result.totalWin, result.nextActions, etc.
 * ```
 */
export class LuaEngine {
  private L: any;
  private api: LuaEngineAPI;
  private actionRouter: ActionRouter;
  private sessionManager: SessionManager;
  private persistentState: PersistentState;
  private gameDefinition: GameDefinition;
  private variables: Record<string, number> = {};

  constructor(config: LuaEngineConfig) {
    this.gameDefinition = config.gameDefinition;

    // Set up RNG
    const rng = config.seed !== undefined
      ? createSeededRng(config.seed)
      : undefined;

    // Initialize sub-managers
    this.api = new LuaEngineAPI(config.gameDefinition, rng, config.logger);
    this.actionRouter = new ActionRouter(config.gameDefinition);
    this.sessionManager = new SessionManager();
    this.persistentState = new PersistentState(config.gameDefinition.persistent_state);

    // Create Lua state and load standard libraries
    this.L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(this.L);

    // Register engine.* API
    this.api.register(this.L);

    // Load and compile the script
    this.loadScript(config.script);
  }

  /** Current session data (if any) */
  get session(): SessionData | null {
    return this.sessionManager.current;
  }

  /** Current persistent state values */
  get persistentVars(): Record<string, number> {
    return { ...this.variables };
  }

  /**
   * Execute a play action — the main entry point.
   * This is what DevBridge calls on each PLAY_REQUEST.
   */
  execute(params: PlayParams): LuaPlayResult {
    const { action: actionName, bet, params: clientParams } = params;

    // 1. Resolve the action definition
    const action = this.actionRouter.resolveAction(
      actionName,
      this.sessionManager.isActive,
    );

    // 2. Build state.variables
    const stateVars: Record<string, number> = { ...this.variables, bet };

    // Load cross-spin persistent state
    this.persistentState.loadIntoVariables(stateVars);

    // Load session persistent vars
    if (this.sessionManager.isActive) {
      const sessionParams = this.sessionManager.getPersistentParams();
      for (const [k, v] of Object.entries(sessionParams)) {
        if (typeof v === 'number') {
          stateVars[k] = v;
        }
      }
    }

    // 3. Build state.params
    const stateParams: Record<string, unknown> = { ...clientParams };
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
        stateParams.forced_scatter_count = this.pickFromDistribution(mode.scatter_distribution);
      }
    }

    // Handle ante bet
    if (clientParams?.ante_bet && this.gameDefinition.ante_bet) {
      stateParams.ante_bet = true;
    }

    // 4. Build the state table and call Lua execute()
    const luaResult = this.callLuaExecute(action.stage, stateParams, stateVars);

    // 5. Extract special fields from Lua result
    const totalWinMultiplier = typeof luaResult.total_win === 'number' ? luaResult.total_win : 0;
    const resultVariables = (luaResult.variables ?? {}) as Record<string, number>;
    const totalWin = Math.round(totalWinMultiplier * bet * 100) / 100;

    // Merge result variables into engine variables
    Object.assign(stateVars, resultVariables);
    this.variables = { ...stateVars };
    delete this.variables.bet; // bet is per-spin, not persistent

    // Build client data (everything except special keys)
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(luaResult)) {
      if (key !== 'total_win' && key !== 'variables') {
        data[key] = value;
      }
    }

    // 6. Apply max win cap
    let cappedWin = totalWin;
    if (this.gameDefinition.max_win) {
      const cap = this.calculateMaxWinCap(bet);
      if (cap !== undefined && totalWin > cap) {
        cappedWin = cap;
        this.variables.max_win_reached = 1;
        data.max_win_reached = true;
        this.sessionManager.markMaxWinReached();
      }
    }

    // 7. Handle _persist_* and _persist_game_* keys
    this.sessionManager.storePersistData(data);
    this.persistentState.storeGameData(data);

    // Save cross-spin persistent state
    this.persistentState.saveFromVariables(this.variables);

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

    // 8. Evaluate transitions
    const { rule, nextActions } = this.actionRouter.evaluateTransitions(action, this.variables);
    let creditDeferred = action.credit === 'defer' || rule.credit_override === 'defer';
    let session = this.sessionManager.current;

    // Handle session creation
    if (rule.creates_session && !this.sessionManager.isActive) {
      session = this.sessionManager.createSession(rule, this.variables, bet);
      creditDeferred = true;
    }
    // Handle session update
    else if (this.sessionManager.isActive) {
      session = this.sessionManager.updateSession(rule, this.variables, cappedWin);

      // Handle session completion
      if (rule.complete_session || session?.completed) {
        const completed = this.sessionManager.completeSession();
        session = completed.session;
        creditDeferred = false;
      }
    }

    return {
      totalWin: cappedWin,
      data,
      nextActions,
      session,
      variables: { ...this.variables },
      creditDeferred,
    };
  }

  /** Reset all state (sessions, persistent vars, variables) */
  reset(): void {
    this.variables = {};
    this.sessionManager.reset();
    this.persistentState.reset();
  }

  /** Destroy the Lua VM */
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

    // Verify that execute() function exists
    lua.lua_getglobal(this.L, to_luastring('execute'));
    if (lua.lua_type(this.L, -1) !== lua.LUA_TFUNCTION) {
      lua.lua_pop(this.L, 1);
      throw new Error('Lua script must define a global `execute(state)` function');
    }
    lua.lua_pop(this.L, 1);
  }

  private callLuaExecute(
    stage: string,
    params: Record<string, unknown>,
    variables: Record<string, number>,
  ): Record<string, unknown> {
    // Push the execute function
    lua.lua_getglobal(this.L, to_luastring('execute'));

    // Build and push the state table
    lua.lua_createtable(this.L, 0, 3);

    // state.stage
    lua.lua_pushstring(this.L, to_luastring(stage));
    lua.lua_setfield(this.L, -2, to_luastring('stage'));

    // state.params
    pushJSValue(this.L, params);
    lua.lua_setfield(this.L, -2, to_luastring('params'));

    // state.variables
    pushJSValue(this.L, variables);
    lua.lua_setfield(this.L, -2, to_luastring('variables'));

    // Call execute(state) → 1 result
    const status = lua.lua_pcall(this.L, 1, 1, 0);
    if (status !== lua.LUA_OK) {
      const err = to_jsstring(lua.lua_tostring(this.L, -1));
      lua.lua_pop(this.L, 1);
      throw new Error(`Lua execute() failed: ${err}`);
    }

    // Marshal result table to JS
    const result = luaToJS(this.L, -1);
    lua.lua_pop(this.L, 1);

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Lua execute() must return a table');
    }

    return result as Record<string, unknown>;
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
