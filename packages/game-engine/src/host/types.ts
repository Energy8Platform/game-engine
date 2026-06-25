// packages/game-engine/src/host/types.ts
import type { ApplicationOptions } from 'pixi.js';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { AssetManifest, LoadingScreenConfig } from '@energy8platform/platform-core';
import type { PixiGameShell } from '@energy8platform/pixi-shell';
import type { AudioConfig, ScaleMode, Orientation, SceneConstructor } from '../types';
import type { BookAdapter, AdapterModule, StakeBridge } from '@energy8platform/stake-bridge';
import type { GameApplication } from '../core';
import type { SlotShellOptions } from './shellConfig';
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface StakeIntegration {
  /** The game's BookAdapter (or its module). modeMap + gameId come from the model. */
  adapter: BookAdapter | AdapterModule;
}

/** One scene registered with the host: a key + its constructor. The list order matters — the
 *  first scene that is eligible for the current launch mode is the start scene (unless an explicit
 *  `startScene` overrides it). */
export interface SceneRegistration {
  key: string;
  scene: SceneConstructor;
  /** Skip this scene as a START scene on a replay launch (e.g. an intro). It is still registered
   *  (other scenes can `goto` it), it just isn't auto-started — the first non-skipped scene is. */
  skipOnReplay?: boolean;
}

/** @deprecated alias kept for one release — use {@link SceneRegistration}. */
export type SceneEntry = SceneRegistration;

/** Navigation injected into the start data of EVERY scene the host registers.
 *  Any scene (intro, game, …) reads it from its `onEnter(data)` to navigate. */
export interface SceneNavData {
  /** Switch to another registered scene by key. */
  goto: (key: string, data?: unknown) => void;
}

export interface CreateSlotGameOptions<T extends SlotSpinResultBase = SlotSpinResultBase> {
  model: GameModel;
  /** REQUIRED: maps the raw play result into the game's typed result. The host calls it on every play. */
  normalize: SlotResultNormalizer<T>;
  /** ALL scenes the game uses, registered up front, in order. The first scene eligible for the
   *  launch mode is the start scene — so a replay launch skips any leading `skipOnReplay` scene
   *  (e.g. the intro) and starts directly on the game scene. */
  scenes: SceneRegistration[];
  /** Optional explicit start scene key. Defaults to the first scene eligible for the launch mode
   *  (honoured only when that scene is itself eligible; otherwise the first eligible one wins). */
  startScene?: string;
  /** Start data passed to the start scene's `onEnter` (merged with the injected `goto`). */
  startData?: unknown;
  manifest: AssetManifest;
  container?: HTMLElement | string;
  design?: { width: number; height: number };
  scaleMode?: ScaleMode;
  orientation?: Orientation;
  loading?: LoadingScreenConfig;
  audio?: AudioConfig;
  pixi?: Partial<ApplicationOptions>;
  fonts?: string[];
  textureDefaults?: boolean;
  dev?: boolean;
  stake?: StakeIntegration;
  shell?: SlotShellOptions;
  /** Double-tap on the play area to skip the current spin animation. Default `true`. Set `false`
   *  to disable the gesture (e.g. games where a tap means something else). */
  skipGesture?: boolean;
  onFatalError?: (message: string) => void;
}

export interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: StakeBridge | null;
  shell: PixiGameShell | null;
}
