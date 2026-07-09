// packages/game-engine/src/host/types.ts
import type { ApplicationOptions } from 'pixi.js';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { AssetManifest, LoadingScreenConfig } from '@energy8platform/platform-core';
import type { Shell, PixiShellConfig } from '@energy8platform/shell/pixi';
import type { AudioConfig, ScaleMode, Orientation, SceneConstructor } from '../types';
import type { BookAdapter, AdapterModule, StakeBridge } from '@energy8platform/stake-bridge';
import type { GameApplication } from '../core';
import type { SlotShellOptions } from './shellConfig';
import type {
  SlotSpinResultBase,
  SlotResultNormalizer,
} from '@energy8platform/platform-core/slot-result';
import type { FreeSpinsView } from './freeSpinsCounter';

/** Turns a bonus segment into the bar readout for games whose bonus ISN'T a plain free-spins
 *  counter (adventure, hold-and-spin, respins). The shell shows a host-driven hero + Total Win in
 *  ANY bonus; this only customises the label + counter VALUE. Omit `bonus` entirely and the host
 *  falls back to the free-spins default (label 'Free spins', value current/total, retrigger-aware). */
export interface BonusReadoutConfig<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Bar label (localized by the shell, so a game i18n entry is honoured). A string, or a function
   *  of the current mode (e.g. `m => m === 'ADVENTURE' ? 'Adventure' : 'Free spins'`).
   *  Default: 'Free spins'. */
  label?: string | ((mode: string) => string);
  /** Format the counter VALUE string from the settled segment. `view` is the host's default
   *  free-spins counter (current/total, retrigger-aware) — use it for the common case, or ignore it
   *  and read your own fields off `result` (respins left, coins collected, a multiplier).
   *  Default: `view.current == null ? String(view.total) : `${view.current} / ${view.total}``. */
  readout?: (result: T, ctx: { view: FreeSpinsView; mode: string }) => string;
}

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
  /** Customise the bonus bar readout for games whose bonus isn't plain free spins (adventure,
   *  hold-and-spin, respins). Omit for the free-spins default. See `BonusReadoutConfig`. */
  bonus?: BonusReadoutConfig<T>;
  /** Override how the control-bar shell is built. The host resolves the full shell config (theme,
   *  features, gameInfo, currency, balance) and the Pixi mount (`app`/`parent`) and hands it to this
   *  factory; return any `Shell` — e.g. `createShell({ renderer: new MyRenderer(...), ...config })`
   *  to plug a custom renderer while the shell core still drives bet/balance/overlays. A custom
   *  renderer can ignore `app`/`parent` and mount elsewhere (a DOM overlay, another canvas).
   *  Default: the built-in Pixi shell (`createPixiShell`). */
  shellFactory?: ShellFactory;
  /** Double-tap on the play area to skip the current spin animation. Default `true`. Set `false`
   *  to disable the gesture (e.g. games where a tap means something else). */
  skipGesture?: boolean;
  onFatalError?: (message: string) => void;
}

/** Builds the shell the host drives. Receives the fully-resolved Pixi shell config (a custom
 *  renderer may ignore the `app`/`parent` mount fields). Must return a `Shell`. */
export type ShellFactory = (config: PixiShellConfig) => Shell;

export interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: StakeBridge | null;
  shell: Shell | null;
}
