import type { SessionData, PlayParams } from '@energy8platform/game-sdk';

// ─── Game Definition (Platform JSON Config) ─────────────

export interface GameDefinition {
  id: string;
  type: 'SLOT' | 'TABLE';
  actions: Record<string, ActionDefinition>;
  bet_levels?: number[] | BetLevelsConfig;
  max_win?: MaxWinConfig;
  buy_bonus?: BuyBonusConfig;
  ante_bet?: AnteBetConfig;
  persistent_state?: PersistentStateConfig;
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

export interface BuyBonusConfig {
  modes: Record<string, BuyBonusMode>;
}

export interface BuyBonusMode {
  cost_multiplier: number;
  scatter_distribution: Record<string, number>;
}

export interface AnteBetConfig {
  cost_multiplier: number;
}

export interface PersistentStateConfig {
  vars: string[];
  exposed_vars: string[];
}

// ─── Actions & Transitions ──────────────────────────────

export interface ActionDefinition {
  stage: string;
  debit: 'bet' | 'buy_bonus_cost' | 'ante_bet_cost' | 'none';
  credit?: 'win' | 'none' | 'defer';
  requires_session?: boolean;
  buy_bonus_mode?: string;
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
}

export interface LuaPlayResult {
  totalWin: number;
  data: Record<string, unknown>;
  nextActions: string[];
  session: SessionData | null;
  variables: Record<string, number>;
  creditDeferred: boolean;
}

export type { SessionData, PlayParams };
