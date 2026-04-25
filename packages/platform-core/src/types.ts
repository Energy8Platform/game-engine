// Platform-level type re-exports.
//
// Phaser/Three/custom-engine consumers import these from
// `@energy8platform/platform-core` instead of pulling in game-engine.

// SDK types
export type {
  InitData,
  GameConfigData,
  SessionData,
  PlayParams,
  PlayResultData,
  BalanceData,
  SymbolData,
  PaylineData,
  WinLineData,
  AnywhereWinData,
} from '@energy8platform/game-sdk';

// Lua / game-definition types
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
} from './lua/types';
