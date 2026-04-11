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

// ─── State Machine ───────────────────────────────────────
export { StateMachine } from './state/StateMachine';

// ─── Animation ───────────────────────────────────────────
export { Tween } from './animation/Tween';
export { Timeline } from './animation/Timeline';
export { Easing } from './animation/Easing';
export { SpineHelper } from './animation/SpineHelper';
export { SpriteAnimation } from './animation/SpriteAnimation';
export type { SpriteAnimationConfig } from './animation/SpriteAnimation';

// ─── Input ───────────────────────────────────────────────
export { InputManager } from './input/InputManager';

// ─── UI ──────────────────────────────────────────────────
// NOTE: @pixi/ui and @pixi/layout are optional peer dependencies.
// Import UI components from '@energy8platform/game-engine/ui' sub-path
// to avoid pulling in these deps when they aren't installed.
export { Button } from './ui/Button';
export type { ButtonConfig, ButtonState } from './ui/Button';
export { ProgressBar } from './ui/ProgressBar';
export type { ProgressBarConfig } from './ui/ProgressBar';
export { Label } from './ui/Label';
export type { LabelConfig } from './ui/Label';
export { Panel } from './ui/Panel';
export type { PanelConfig } from './ui/Panel';
export { BalanceDisplay } from './ui/BalanceDisplay';
export type { BalanceDisplayConfig } from './ui/BalanceDisplay';
export { WinDisplay } from './ui/WinDisplay';
export type { WinDisplayConfig } from './ui/WinDisplay';
export { Modal } from './ui/Modal';
export type { ModalConfig } from './ui/Modal';
export { Toast } from './ui/Toast';
export type { ToastConfig, ToastType } from './ui/Toast';
export { Layout } from './ui/Layout';
export type { LayoutConfig, LayoutDirection, LayoutAlignment, LayoutAnchor } from './ui/Layout';
export { ScrollContainer } from './ui/ScrollContainer';
export type { ScrollContainerConfig, ScrollDirection } from './ui/ScrollContainer';

// ─── Loading ─────────────────────────────────────────────
export { LoadingScene } from './loading/LoadingScene';

// ─── Debug ───────────────────────────────────────────────
export { DevBridge } from './debug/DevBridge';
export type { DevBridgeConfig } from './debug/DevBridge';
export { FPSOverlay } from './debug/FPSOverlay';

// ─── Lua ────────────────────────────────────────────────
// NOTE: fengari is an optional peer dependency.
// Import Lua components from '@energy8platform/game-engine/lua' sub-path
// to avoid pulling in fengari when it isn't installed.
export { LuaEngine } from './lua/LuaEngine';
export { LuaEngineAPI, createSeededRng } from './lua/LuaEngineAPI';
export { ActionRouter, evaluateCondition } from './lua/ActionRouter';
export { SessionManager } from './lua/SessionManager';
export { PersistentState } from './lua/PersistentState';
export type {
  GameDefinition,
  ActionDefinition,
  TransitionRule,
  LuaEngineConfig,
  LuaPlayResult,
} from './lua/types';
