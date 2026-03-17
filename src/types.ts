import type { ApplicationOptions, Container } from 'pixi.js';
import type {
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

// ─── Scale Modes ───────────────────────────────────────────

export enum ScaleMode {
  /** Fit inside container, maintain aspect ratio (letterbox/pillarbox) */
  FIT = 'FIT',
  /** Fill container, maintain aspect ratio (crop edges) */
  FILL = 'FILL',
  /** Stretch to fill (distorts) */
  STRETCH = 'STRETCH',
}

// ─── Orientation ───────────────────────────────────────────

export enum Orientation {
  LANDSCAPE = 'landscape',
  PORTRAIT = 'portrait',
  ANY = 'any',
}

// ─── Loading Screen Config ─────────────────────────────────

export interface LoadingScreenConfig {
  /** Background color (hex number or CSS string) */
  backgroundColor?: number | string;
  /** Background gradient (CSS string applied to the CSS preloader) */
  backgroundGradient?: string;
  /** Logo texture alias (must be in 'preload' bundle) */
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
  /** CSS preloader custom HTML (shown before PixiJS is ready) */
  cssPreloaderHTML?: string;
}

// ─── Asset Manifest ────────────────────────────────────────

export interface AssetEntry {
  alias: string;
  src: string | string[];
  /** Optional data to pass to the loader */
  data?: Record<string, unknown>;
}

export interface AssetBundle {
  name: string;
  assets: AssetEntry[];
}

export interface AssetManifest {
  bundles: AssetBundle[];
}

// ─── Audio Config ──────────────────────────────────────────

export interface AudioCategory {
  volume: number;
  muted: boolean;
}

export interface AudioConfig {
  /** Default volumes per category (0..1) */
  music?: number;
  sfx?: number;
  ui?: number;
  ambient?: number;
  /** Persist mute state in localStorage */
  persist?: boolean;
  /** LocalStorage key prefix */
  storageKey?: string;
}

// ─── Game Application Config ───────────────────────────────

export interface GameApplicationConfig {
  /** Container element or CSS selector to mount canvas into */
  container?: HTMLElement | string;

  /** Reference design width (fallback: GameConfigData.viewport.width or 1920) */
  designWidth?: number;

  /** Reference design height (fallback: GameConfigData.viewport.height or 1080) */
  designHeight?: number;

  /** How to scale the game to fit the container */
  scaleMode?: ScaleMode;

  /** Preferred orientation */
  orientation?: Orientation;

  /** Loading screen configuration */
  loading?: LoadingScreenConfig;

  /** Asset manifest — what to load */
  manifest?: AssetManifest;

  /** Audio configuration */
  audio?: AudioConfig;

  /** SDK options. Set to false to disable SDK (offline/development mode) */
  sdk?:
    | {
        parentOrigin?: string;
        timeout?: number;
        debug?: boolean;
        /** Use in-memory channel instead of postMessage (no iframe required) */
        devMode?: boolean;
      }
    | false;

  /** PixiJS Application options (pass-through) */
  pixi?: Partial<ApplicationOptions>;

  /** Enable debug overlay (FPS, draw calls) */
  debug?: boolean;
}

// ─── Scene Types ───────────────────────────────────────────

export interface SceneConstructor {
  new (): IScene;
  // Allow Scene subclasses to be used as constructors
  [key: string]: any;
}

export interface IScene {
  /** Root display container for this scene */
  readonly container: Container;

  /** Called when the scene is entered */
  onEnter?(data?: unknown): Promise<void> | void;

  /** Called when the scene is exited */
  onExit?(): Promise<void> | void;

  /** Called every frame */
  onUpdate?(dt: number): void;

  /** Called when viewport resizes */
  onResize?(width: number, height: number): void;

  /** Called when the scene is destroyed */
  onDestroy?(): void;
}

// ─── Transition Types ──────────────────────────────────────

export enum TransitionType {
  NONE = 'none',
  FADE = 'fade',
  SLIDE_LEFT = 'slide-left',
  SLIDE_RIGHT = 'slide-right',
}

export interface TransitionConfig {
  type: TransitionType;
  duration?: number;
  easing?: (t: number) => number;
}

// ─── Event Types ───────────────────────────────────────────

export interface GameEngineEvents {
  /** Fired when engine initialization is complete */
  initialized: void;
  /** Fired when all assets are loaded */
  loaded: void;
  /** Fired when the engine starts running */
  started: void;
  /** Fired on viewport resize */
  resize: { width: number; height: number };
  /** Fired on orientation change */
  orientationChange: Orientation;
  /** Fired on scene change */
  sceneChange: { from: string | null; to: string };
  /** Fired when player balance changes (forwarded from SDK) */
  balanceUpdate: { balance: number };
  /** Fired on error */
  error: Error;
  /** Fired when engine is destroyed */
  destroyed: void;
}

// ─── Tween Types ───────────────────────────────────────────

export type EasingFunction = (t: number) => number;

export interface TweenOptions {
  duration: number;
  easing?: EasingFunction;
  delay?: number;
  repeat?: number;
  yoyo?: boolean;
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
}

// ─── Re-exports from SDK for convenience ───────────────────

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
};
