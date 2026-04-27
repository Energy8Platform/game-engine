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
// LuaEngine and friends are available only via the /lua sub-path. We
// don't re-export them as runtime values from the main entry because
// `fengari` (the underlying Lua VM) is a CommonJS module — pulling it
// in unconditionally breaks Vite dev-mode ESM resolution for any
// consumer that doesn't actually use Lua in the browser. Use:
//
//   import { LuaEngine } from '@energy8platform/platform-core/lua';
//
// For Node-only RTP simulation (Go binary, worker_threads), import from
// '@energy8platform/platform-core/simulation' instead.

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
