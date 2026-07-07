/**
 * @energy8platform/platform-core — Energy8 platform core.
 *
 * Renderer-agnostic. Pair with PixiJS, Phaser, Three.js, or any custom
 * engine.
 *
 * Sub-paths for fine-grained imports:
 *   - `@energy8platform/platform-core/lua`        — shared game-definition types
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

// ─── Math runtime ───────────────────────────────────────
// The math runtime is SpinML (the Rust e8 engine): dev rounds via the
// `spinPlugin` vite plugin + e8-server, simulation via `e8 simulate`
// (see '@energy8platform/platform-core/simulation'). The fengari Lua
// engine was removed — legacy Lua games stay on <= 0.28.x.

// ─── DevBridge ──────────────────────────────────────────
export { DevBridge } from './dev-bridge';
export type { DevBridgeConfig, ReplayConfig, ReplayLaunch } from './dev-bridge';

// ─── Branded loading screen ─────────────────────────────
// Renderer-agnostic CSS preloader showing the Energy8 platform logo.
// Use this in any host (Pixi, Phaser, Three.js, custom) to keep the
// brand consistent across games on the platform.
export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from './loading';

// The branded game shell (DOM + Pixi) now lives in its own package, @energy8platform/shell
// (subpaths /html and /pixi); the i18n helpers (socialize/createI18n/Lang) moved there too.

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
// Re-exported from /simulation. Importing them from the main entry is
// fine for type-only usage; runtime classes still come from /simulation.
export type {
  NativeSimulationConfig,
  NativeSimulationResult,
  StageStats,
  DistributionBucket,
} from './simulation';
