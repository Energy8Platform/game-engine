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
  AutoplayOptions,
  FreeSpinsState,
  ModalAction,
  ReplayModalOptions,
  ModalOptions,
  ShellEvents,
} from '@energy8platform/platform-core/shell';

import type {
  ThemeConfig,
  GameInfoContent,
  CurrencyConfig,
  ShellMode,
  BonusOption as CoreBonusOption,
  BonusCardContext as CoreBonusCardContext,
  ShellFeatures as CoreShellFeatures,
  ShellState as CoreShellState,
} from '@energy8platform/platform-core/shell';

// ── Renderer-specific overrides ──────────────────────────────────────────────
// The shared contract is reused verbatim EXCEPT where it bakes in the DOM renderer: a
// `BonusOption.custom` card returns an `HTMLElement` in platform-core, which a Pixi scene can't
// mount. Re-exporting that shape would advertise a hook that silently no-ops, so we redefine the few
// types that reference it — the Pixi `custom` hook returns a Pixi `Container` and actually renders.

/** A buy-bonus option. Same data contract as the DOM shell; a `custom` card renderer returns a Pixi
 *  `Container` (the shell keeps the card slot + live re-pricing + buy/confirm flow via `ctx.select`;
 *  the game owns the interior). */
export interface BonusOption extends Omit<CoreBonusOption, 'custom'> {
  custom?: (ctx: BonusCardContext) => Container;
}

/** Context handed to a Pixi `BonusOption.custom` renderer — the DOM shell's fields, Pixi `bonus`. */
export interface BonusCardContext extends Omit<CoreBonusCardContext, 'bonus'> {
  bonus: BonusOption;
}

export interface ShellFeatures extends Omit<CoreShellFeatures, 'buyBonus'> {
  buyBonus: BonusOption[] | false;
}

export interface ShellState extends Omit<CoreShellState, 'activeFeature'> {
  activeFeature: BonusOption | null;
}

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
  /** Game version shown in the game-info footer (e.g. '1.2.0'). Defaults to '1.0.0'. The footer
   *  stamp is `${version}.${engineVersionWithoutDots}`. */
  version?: string;
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
