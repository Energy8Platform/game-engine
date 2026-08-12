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

/**
 * A loading overlay the GAME owns, covering the gap BEFORE the engine's own loading screen exists:
 * from the browser's first paint to the first frame the engine paints. It does not replace the
 * loading screen — see `LoadingScreenConfig.externalOverlay`.
 *
 * Described structurally on purpose. The implementation this exists for is Artube's
 * `LoaderViewController` (vendored at `@energy8platform/artube-bridge/loader`), whose markup their
 * Vite plugin injects into `index.html` so the overlay is painted before our bundle is even
 * fetched. Naming that type here would tie every consumer of platform-core to the Artube packages;
 * the shape is satisfied with no adapter, and nothing in `@energy8platform/platform-core` knows
 * Artube exists.
 *
 * The engine's use of it, in order:
 *  - `showLoader()` once, at the very start of boot, before anything that can throw;
 *  - `updateProgress(0..100)` at boot milestones (Pixi up, SDK handshake done, subsystems up) —
 *    real progress through the gap, not the asset loading that follows;
 *  - `hideLoader()` the moment the engine's loading screen has painted its first frame — AND on
 *    every failure path, so a boot that throws can never leave the overlay on screen forever.
 */
export interface ExternalLoadingOverlay {
  /** Reveal the overlay / its progress affordance. Called once, at the start of boot. */
  showLoader(): void;
  /** Loading progress as a PERCENTAGE, 0–100 (what `ILoaderViewController` expects — the engine's
   *  internal 0..1 fraction is converted at the seam). */
  updateProgress(value: number): void;
  /** Dismiss the overlay. Called once; must tolerate being called after a failed boot. */
  hideLoader(): void;
}

export interface LoadingScreenConfig {
  /**
   * A game-supplied loading overlay covering ONLY the gap before the engine's own loading screen
   * paints — Artube's branded loader is the case this exists for. It is not a replacement: once the
   * loading screen has painted its first frame, the overlay is dismissed and the rest of the boot
   * (brand, progress bar, tap-to-start, minimum display time) is exactly what it is on every other
   * target. Every other option in this object therefore still applies.
   *
   * The two never stack visibly: the built-in preloader is mounted only at the hand-over, and it
   * covers the external overlay (z-index) from the frame it appears in, so there is no gap, no
   * flash and no bare background at the seam.
   */
  externalOverlay?: ExternalLoadingOverlay;
  /**
   * How long {@link externalOverlay} is guaranteed on screen, in ms, measured from the boot's very
   * first step. Default 1500.
   *
   * The gap this overlay covers is short — a warm boot hands over in a few hundred milliseconds —
   * and a partner's branding that flashes past in under a second has not been shown. The floor also
   * gives a two-phase overlay (Artube's) room to reach its second phase and settle there instead of
   * being cut mid-crossfade. It costs a slow boot nothing: the hand-over happens later than this
   * anyway.
   *
   * Distinct from {@link minDisplayTime}, which is the minimum for the engine's OWN loading screen
   * and is measured from the hand-over. A game that sets both is asking for the sum.
   */
  externalOverlayMinDisplayTime?: number;
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
