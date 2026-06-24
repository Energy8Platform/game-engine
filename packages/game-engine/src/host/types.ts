// packages/game-engine/src/host/types.ts
import type { ApplicationOptions } from 'pixi.js';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { AssetManifest, LoadingScreenConfig } from '@energy8platform/platform-core';
import type { GameShell } from '@energy8platform/platform-core/shell';
import type { AudioConfig, ScaleMode, Orientation, SceneConstructor } from '../types';
import type { BookAdapter, AdapterModule, StakeBridge } from '@energy8platform/stake-bridge';
import type { GameApplication } from '../core';
import type { SlotShellOptions } from './shellConfig';
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface StakeIntegration {
  /** The game's BookAdapter (or its module). modeMap + gameId come from the model. */
  adapter: BookAdapter | AdapterModule;
}

/** One scene registered with the host: a key + its constructor. */
export interface SceneRegistration {
  key: string;
  scene: SceneConstructor;
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
  /** ALL scenes the game uses, registered up front. */
  scenes: SceneRegistration[];
  /** Key (from `scenes`) of the scene to start first. */
  startScene: string;
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
  onFatalError?: (message: string) => void;
}

export interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: StakeBridge | null;
  shell: GameShell | null;
}
