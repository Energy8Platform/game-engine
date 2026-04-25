import type { PersistentStateConfig } from './types';

/**
 * Manages cross-spin persistent state — variables that survive between base game spins.
 * Separate from session-scoped persistence (handled by SessionManager).
 *
 * Handles two mechanisms:
 * 1. Numeric vars declared in `persistent_state.vars` — stored in state.variables
 * 2. Complex data with `_persist_game_*` prefix — stored separately, injected as `_ps_*`
 */
export class PersistentState {
  private config: PersistentStateConfig | undefined;
  private vars: Record<string, number> = {};
  private gameData: Record<string, unknown> = {};

  constructor(config?: PersistentStateConfig) {
    this.config = config;
  }

  /** Load persistent vars into variables map before execute() */
  loadIntoVariables(variables: Record<string, number>): void {
    if (!this.config) return;

    for (const varName of this.config.vars) {
      if (varName in this.vars) {
        variables[varName] = this.vars[varName];
      }
    }
  }

  /** Save persistent vars from variables map after execute() */
  saveFromVariables(variables: Record<string, number>): void {
    if (!this.config) return;

    for (const varName of this.config.vars) {
      if (varName in variables) {
        this.vars[varName] = variables[varName];
      }
    }
  }

  /** Extract _persist_game_* keys from Lua return data, store them */
  storeGameData(data: Record<string, unknown>): void {
    for (const key of Object.keys(data)) {
      if (key.startsWith('_persist_game_')) {
        const cleanKey = key.slice('_persist_game_'.length);
        this.gameData[cleanKey] = data[key];
        delete data[key]; // remove from client data
      }
    }
  }

  /** Get _ps_* params for next execute() call */
  getGameDataParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.gameData)) {
      params[`_ps_${key}`] = value;
    }
    return params;
  }

  /** Get exposed vars for client data.persistent_state */
  getExposedVars(): Record<string, number> | undefined {
    if (!this.config?.exposed_vars?.length) return undefined;

    const exposed: Record<string, number> = {};
    for (const varName of this.config.exposed_vars) {
      if (varName in this.vars) {
        exposed[varName] = this.vars[varName];
      }
    }
    return exposed;
  }

  /** Reset all state */
  reset(): void {
    this.vars = {};
    this.gameData = {};
  }
}
