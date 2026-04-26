// Browser-safe Lua engine surface. Only depends on `fengari`, no Node built-ins.
//
// For the Node-only runners (NativeSimulationRunner backed by a Go binary,
// ParallelSimulationRunner backed by worker_threads), import from
// `@energy8platform/platform-core/simulation` instead.
export { LuaEngine } from './LuaEngine';
export { LuaEngineAPI, createSeededRng } from './LuaEngineAPI';
export { ActionRouter, evaluateCondition } from './ActionRouter';
export { SessionManager } from './SessionManager';
export { PersistentState } from './PersistentState';
export { SimulationRunner, formatSimulationResult } from './SimulationRunner';
export type {
  GameDefinition,
  ActionDefinition,
  TransitionRule,
  SessionConfig,
  LuaEngineConfig,
  LuaPlayResult,
  MaxWinConfig,
  BuyBonusConfig,
  BuyBonusMode,
  AnteBetConfig,
  PersistentStateConfig,
  BetLevelsConfig,
  SimulationConfig,
  SimulationResult,
  SimulationRawAccumulators,
} from './types';
