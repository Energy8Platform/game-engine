// Platform-level type re-exports.
//
// Phaser/Three/custom-engine consumers import these from
// `@energy8platform/platform-core` instead of pulling in game-engine.

import type { PreloaderVariantName } from './loading/variants';

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
  /**
   * Which visual identity the CSS preloader renders. Defaults to `'energy8'`;
   * an unknown value falls back to the default. Ignored when `cssPreloaderHTML`
   * is set (custom HTML bypasses the variant).
   */
  preloaderVariant?: PreloaderVariantName;
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
  /**
   * If true (default), `waitCSSPreloaderTap()` blocks until the user
   * clicks the preloader. Set to `false` to make `waitCSSPreloaderTap()`
   * resolve immediately (skip-flag for games that don't want a manual
   * gate). Useful for mobile audio unlock — the click satisfies the
   * browser's user-gesture requirement.
   */
  tapToStart?: boolean;
  /** Label shown in the SVG text element while waiting for tap. Default: 'TAP TO START'. */
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
