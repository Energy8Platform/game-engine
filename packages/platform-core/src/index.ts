/**
 * @energy8platform/platform-core — Energy8 platform core.
 *
 * Renderer-agnostic. Pair with PixiJS, Phaser, Three.js, or any custom
 * engine.
 *
 * Sub-paths for fine-grained imports:
 *   - `@energy8platform/platform-core/lua`        — Lua engine + simulation
 *   - `@energy8platform/platform-core/dev-bridge` — DevBridge mock host
 *   - `@energy8platform/platform-core/vite`       — Vite plugins
 */

// ─── Session ────────────────────────────────────────────
export {
  PlatformSession,
  createPlatformSession,
} from './PlatformSession';
export type {
  PlatformSessionConfig,
  PlatformSessionEvents,
  SDKOptions,
} from './PlatformSession';

// ─── Lua ────────────────────────────────────────────────
export {
  LuaEngine,
  LuaEngineAPI,
  createSeededRng,
  ActionRouter,
  evaluateCondition,
  SessionManager,
  PersistentState,
  SimulationRunner,
  formatSimulationResult,
  ParallelSimulationRunner,
  NativeSimulationRunner,
  findNativeBinary,
  formatNativeResult,
} from './lua';

// ─── DevBridge ──────────────────────────────────────────
export { DevBridge } from './dev-bridge';
export type { DevBridgeConfig } from './dev-bridge';

// ─── Branded loading screen ─────────────────────────────
// Renderer-agnostic CSS preloader showing the Energy8 platform logo.
// Use this in any host (Pixi, Phaser, Three.js, custom) to keep the
// brand consistent across games on the platform.
export {
  createCSSPreloader,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from './loading';

// ─── Utility ────────────────────────────────────────────
export { EventEmitter } from './EventEmitter';

// ─── Types ──────────────────────────────────────────────
export type {
  // SDK types
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
  // Lua / game-definition types
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
  // Asset / loading types
  AssetManifest,
  AssetBundle,
  AssetEntry,
  LoadingScreenConfig,
} from './types';

// ─── Native simulation types ────────────────────────────
export type {
  NativeSimulationConfig,
  NativeSimulationResult,
  StageStats,
  DistributionBucket,
} from './lua';
