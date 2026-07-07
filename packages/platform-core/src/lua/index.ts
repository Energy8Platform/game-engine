// Shared game-definition types. The fengari Lua engine that used to live
// here is GONE — the math runtime is SpinML (e8): dev rounds via spinPlugin
// + e8-server, simulation via `e8 simulate` (stake-math-tools). Legacy Lua
// games stay on platform-core <= 0.28.x.
export type {
  GameDefinition,
  ActionDefinition,
  TransitionRule,
  SessionConfig,
  LuaEngineConfig,
  LuaPlayResult,
  MaxWinConfig,
  PersistentStateConfig,
  BetLevelsConfig,
  SimulationConfig,
  SimulationResult,
  SimulationRawAccumulators,
} from './types';
