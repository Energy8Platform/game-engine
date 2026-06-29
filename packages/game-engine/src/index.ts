// ─── Core ────────────────────────────────────────────────
export { GameApplication } from './core/GameApplication';
export { SceneManager } from './core/SceneManager';
export { Scene } from './core/Scene';
export { EventEmitter } from './core/EventEmitter';

// ─── Types ───────────────────────────────────────────────
export {
  ScaleMode,
  Orientation,
  TransitionType,
} from './types';
export type {
  GameApplicationConfig,
  LoadingScreenConfig,
  AssetManifest,
  AssetBundle,
  AssetEntry,
  AudioConfig,
  IScene,
  SceneConstructor,
  TransitionConfig,
  GameEngineEvents,
  EasingFunction,
  TweenOptions,
  // Re-exported SDK types
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
} from './types';

// ─── Assets ──────────────────────────────────────────────
export { AssetManager } from './assets/AssetManager';

// ─── Audio ───────────────────────────────────────────────
export { AudioManager } from './audio/AudioManager';

// ─── SDK Error Classes ───────────────────────────────────
export {
  SDKError,
  TimeoutError,
  BridgeNotReadyError,
  BridgeDestroyedError,
} from '@energy8platform/game-sdk';

// ─── Viewport ────────────────────────────────────────────
export { ViewportManager } from './viewport/ViewportManager';

// ─── Animation ───────────────────────────────────────────
export { Tween } from './animation/Tween';
export { Timeline } from './animation/Timeline';
export { Easing } from './animation/Easing';
export { SpineHelper } from './animation/SpineHelper';
export { SpriteAnimation } from './animation/SpriteAnimation';
export type { SpriteAnimationConfig } from './animation/SpriteAnimation';

// ─── Input ───────────────────────────────────────────────
export { InputManager } from './input/InputManager';

// ─── Loading ─────────────────────────────────────────────
export { LoadingScene } from './loading/LoadingScene';

// ─── Debug ───────────────────────────────────────────────
export { DevBridge } from '@energy8platform/platform-core/dev-bridge';
export type { DevBridgeConfig, ReplayConfig, ReplayLaunch } from '@energy8platform/platform-core/dev-bridge';
export { FPSOverlay } from './debug/FPSOverlay';

// ─── Lua ────────────────────────────────────────────────
// Lua module is Node.js only (fengari). Use the sub-path import:
//   import { LuaEngine } from '@energy8platform/game-engine/lua'
// Re-export only types (zero runtime cost, no fengari in browser bundle).
export type {
  GameDefinition,
  ActionDefinition,
  TransitionRule,
  LuaEngineConfig,
  LuaPlayResult,
} from '@energy8platform/platform-core/lua';
