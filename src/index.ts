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
} from './types';

// ─── Assets ──────────────────────────────────────────────
export { AssetManager } from './assets/AssetManager';

// ─── Audio ───────────────────────────────────────────────
export { AudioManager } from './audio/AudioManager';

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
// Activate @pixi/layout mixin (must be imported before creating containers)
import '@pixi/layout';

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

// Re-exports from @pixi/ui and @pixi/layout for direct use
export { FancyButton, ScrollBox, ButtonContainer } from '@pixi/ui';
export { LayoutContainer } from '@pixi/layout/components';
export type { LayoutStyles } from '@pixi/layout';

// ─── Loading ─────────────────────────────────────────────
export { LoadingScene } from './loading/LoadingScene';

// ─── Debug ───────────────────────────────────────────────
export { DevBridge } from './debug/DevBridge';
export type { DevBridgeConfig } from './debug/DevBridge';
export { FPSOverlay } from './debug/FPSOverlay';
