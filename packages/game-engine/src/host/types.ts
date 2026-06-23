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

export interface SceneEntry {
  key: string;
  scene: SceneConstructor;
}

export interface CreateSlotGameOptions<T extends SlotSpinResultBase = SlotSpinResultBase> {
  model: GameModel;
  /** REQUIRED: maps the raw play result into the game's typed result. The host calls it on every play. */
  normalize: SlotResultNormalizer<T>;
  scene: SceneEntry;
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
