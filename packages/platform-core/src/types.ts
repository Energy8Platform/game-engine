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

// ─── Asset Manifest ────────────────────────────────────────
// Renderer-agnostic declaration: "what to load, in which bundles".
// Each renderer implements its own loader (pixi.Assets, Phaser.Loader,
// THREE.TextureLoader, …) but the manifest format is the same.

export interface AssetEntry {
  alias: string;
  src: string | string[];
  /** Optional loader-specific data (e.g. parser hints) */
  data?: Record<string, unknown>;
}

export interface AssetBundle {
  name: string;
  assets: AssetEntry[];
}

export interface AssetManifest {
  bundles: AssetBundle[];
}

// ─── Loading Screen Config ─────────────────────────────────
// Used by the Energy8 CSS preloader (in this package) and by
// engine-specific loading scenes (in @energy8platform/game-engine etc.).

export interface LoadingScreenConfig {
  /** Background color (hex number or CSS string) */
  backgroundColor?: number | string;
  /** Background gradient (CSS string applied to the CSS preloader) */
  backgroundGradient?: string;
  /** Logo texture alias (must be in 'preload' bundle — engine-specific) */
  logoAsset?: string;
  /** Logo scale (default: 1) */
  logoScale?: number;
  /** Show percentage text below the loader bar */
  showPercentage?: boolean;
  /** Custom progress text formatter */
  progressTextFormatter?: (progress: number) => string;
  /** Show "Tap to start" after loading (needed for mobile audio unlock) */
  tapToStart?: boolean;
  /** "Tap to start" label text */
  tapToStartText?: string;
  /** Minimum display time in ms (so the user sees the brand, even if loading is fast) */
  minDisplayTime?: number;
  /** CSS preloader custom HTML (shown before the renderer is ready) */
  cssPreloaderHTML?: string;
}

// Lua / game-definition types
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
} from './lua/types';
