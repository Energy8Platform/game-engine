// The pixi-shell reuses the renderer-agnostic shell contract from platform-core verbatim
// (so a game can swap the DOM shell for the Pixi shell with no change to its config/events),
// and replaces only the renderer-specific mount: instead of `mount: HTMLElement` the Pixi
// shell attaches to a Pixi `Application` / `Container`.

import type { Application, Container } from 'pixi.js';

// Re-export the shared contract so consumers can `import type { ... } from '@energy8platform/pixi-shell'`
// and get exactly the same types the DOM shell uses.
export type {
  ShellMode,
  CurrencyConfig,
  BonusOption,
  BonusCardContext,
  ThemeConfig,
  PaytableRow,
  PaylineDef,
  CellRef,
  ShapeDef,
  WinSection,
  GameMode,
  GameInfoSection,
  GameInfoContent,
  AutoplayConfig,
  ShellFeatures,
  AutoplayOptions,
  FreeSpinsState,
  ModalAction,
  ReplayModalOptions,
  ModalOptions,
  ShellState,
  ShellEvents,
} from '@energy8platform/platform-core/shell';

import type {
  ThemeConfig,
  GameInfoContent,
  CurrencyConfig,
  ShellMode,
  ShellFeatures,
} from '@energy8platform/platform-core/shell';

/** Pixi-shell configuration — the renderer-agnostic shell config with a Pixi mount target.
 *  Mirrors platform-core's `ShellConfig` field-for-field, swapping `mount: HTMLElement` for the
 *  Pixi `app` (its renderer drives sizing/resize + ticker, its stage hosts the shell). */
export interface PixiShellConfig {
  /** The Pixi application whose renderer (size + resize events + ticker) drives the shell. */
  app: Application;
  /** Container to attach the shell root to. Defaults to `app.stage`. The shell fills the whole
   *  renderer area (screen) and draws the bar at the bottom + full-screen overlays/modals. */
  parent?: Container;
  theme?: ThemeConfig;
  gameInfo: GameInfoContent;
  language: string;
  /** When true, all built-in shell text is shown in the social-casino vocabulary (derived from
   *  English via word-swap rules), regardless of `language`. Game-supplied content is untouched. */
  isSocial?: boolean;
  currency: CurrencyConfig;
  availableBets: number[];
  defaultBet: number;
  currentBet: number | null;
  balance: number;
  win: number;
  mode: ShellMode;
  /** Mark this shell as a read-only historical-round replay. A replay never shows the player's
   *  balance. Defaults to `mode === 'replay'`; set explicitly when a replay starts in another mode. */
  replay?: boolean;
  features: ShellFeatures;
  /** Override the BUY BONUS bar button's action: when set, tapping it calls this instead of
   *  opening the built-in buy-bonus overlay. */
  onBonusBuy?: () => void;
}

/** Alias kept so the copied renderer-agnostic helpers (state.ts) resolve `ShellConfig`. */
export type ShellConfig = PixiShellConfig;
