import type { SessionData, PlayParams } from '@energy8platform/game-sdk';

// ─── Game Definition (Platform JSON Config) ─────────────

export interface GameDefinition {
  id: string;
  type: 'SLOT' | 'TABLE';
  actions: Record<string, ActionDefinition>;
  bet_levels?: number[] | BetLevelsConfig;
  max_win?: MaxWinConfig;
  persistent_state?: PersistentStateConfig;
  /**
   * Session expiry duration as a Go-style duration string ("24h", "2h", "5ms").
   * Mirrors the platform's GameDefinition.SessionTTL — defaults to 24h on
   * the server when absent. Used by DevBridge to surface SESSION_EXPIRED.
   */
  session_ttl?: string;
}

export interface BetLevelsConfig {
  levels?: number[];
  min?: number;
  max?: number;
}

export interface MaxWinConfig {
  multiplier?: number;
  fixed?: number;
}

export interface PersistentStateConfig {
  vars: string[];
  exposed_vars: string[];
}

// ─── Actions & Transitions ──────────────────────────────

/**
 * v5 action contract — cost_multiplier and feature_data live on the action
 * itself. Removed in v5: top-level `buy_bonus`/`ante_bet` blocks, debit modes
 * `'buy_bonus_cost'`/`'ante_bet_cost'`, action.buy_bonus_mode, params.ante_bet/
 * params.buy_bonus flags. Lua reads action context via `state.action` and
 * `state.action_config = { cost_multiplier, feature_data }`.
 */
export interface ActionDefinition {
  stage: string;
  /** Either 'bet' (debit = bet × cost_multiplier) or 'none'/empty (no debit). */
  debit: 'bet' | 'none';
  /** Multiplier on `bet` when debit==='bet'. Defaults to 1.0. */
  cost_multiplier?: number;
  /**
   * Opaque action-specific configuration exposed to Lua as
   * `state.action_config.feature_data`. Common keys: `scatter_distribution`
   * for buy-bonus actions, forced symbol counts, etc.
   */
  feature_data?: Record<string, unknown>;
  credit?: 'win' | 'none' | 'defer';
  requires_session?: boolean;
  transitions: TransitionRule[];
  input_schema?: Record<string, unknown>;
}

export interface TransitionRule {
  condition: string;
  creates_session?: boolean;
  complete_session?: boolean;
  credit_override?: 'defer';
  next_actions: string[];
  session_config?: SessionConfig;
  add_spins_var?: string;
}

export interface SessionConfig {
  total_spins_var: string;
  persistent_vars?: string[];
}

// ─── Lua Engine Config & Results ────────────────────────

export interface LuaEngineConfig {
  /** Lua script source code */
  script: string;
  /** Platform game definition (actions, transitions, bet levels, etc.) */
  gameDefinition: GameDefinition;
  /** Seed for deterministic RNG (for simulation/replay) */
  seed?: number;
  /** Custom logger function */
  logger?: (level: string, msg: string) => void;
  /** Skip marshalling data fields (matrix, wins, etc.) for faster simulation */
  simulationMode?: boolean;
}

export interface LuaPlayResult {
  totalWin: number;
  data: Record<string, unknown>;
  nextActions: string[];
  session: SessionData | null;
  variables: Record<string, number>;
  creditDeferred: boolean;
}

// ─── Simulation ─────────────────────────────────────────

export interface SimulationConfig {
  /** Lua script source code */
  script: string;
  /** Platform game definition */
  gameDefinition: GameDefinition;
  /** Number of iterations to run */
  iterations: number;
  /** Bet amount per spin */
  bet: number;
  /** RNG seed for deterministic results */
  seed?: number;
  /** Which action to simulate (default: 'spin') */
  action?: string;
  /** Params for the action (buy_bonus mode, ante_bet, etc.) */
  params?: Record<string, unknown>;
  /** Report progress every N iterations (default: 100_000) */
  progressInterval?: number;
  /** Progress callback */
  onProgress?: (completed: number, total: number) => void;
  /** Number of worker threads for parallel simulation (default: os.cpus().length) */
  workerCount?: number;
}

export interface SimulationResult {
  gameId: string;
  action: string;
  iterations: number;
  durationMs: number;
  totalRtp: number;
  baseGameRtp: number;
  bonusRtp: number;
  hitFrequency: number;
  maxWin: number;
  maxWinHits: number;
  bonusTriggered: number;
  bonusSpinsPlayed: number;
  /** Raw accumulators for aggregation across workers */
  _raw?: SimulationRawAccumulators;
}

export interface SimulationRawAccumulators {
  totalWagered: number;
  totalWon: number;
  baseGameWin: number;
  bonusWin: number;
  hits: number;
}

export type { SessionData, PlayParams };
