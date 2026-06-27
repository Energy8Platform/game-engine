export type ShellMode = 'base' | 'freeSpins' | 'replay';

export interface ThemeConfig {
  /** Palette scheme: 'dark' (default) for dark games, 'light' for light backgrounds. */
  scheme?: 'dark' | 'light';
  /** Brand accent — active states, the SPIN hover glow, and the BUY BONUS button.
   *  (Per-bonus card accents are set on each `BonusOption.accentColor`.) */
  accent?: string;
}

export interface CurrencyConfig {
  symbol: string;
  position: 'left' | 'right';
  /** Maximum fraction digits (default 2). Win / total-win readouts are rounded to this precision;
   *  balance / bet / prices stay fixed at `minDecimals`. */
  maxDecimals?: number;
  /** Minimum fraction digits (defaults to `maxDecimals`). For win / total-win, trailing zeros are
   *  trimmed down to this many places so small wins keep their significant digits (e.g. 0.0673)
   *  while round amounts stay compact (e.g. 0.30). Everything else is shown at exactly this many. */
  minDecimals?: number;
  separator?: { thousands?: string; decimal?: string };
}

export interface BonusOption {
  id: string;
  /** 'bonus' buys into a bonus round, 'feature' toggles a base-game modifier (e.g. Ante).
   *  Drives the card/button label and accent. Defaults to 'bonus'. */
  type?: 'feature' | 'bonus';
  title: string;
  description: string;
  /** Transparent art image shown at the top of the card (no background plate). */
  thumbnail?: string;
  volatility?: 1 | 2 | 3 | 4 | 5;
  /** Card price = priceMultiplier × current bet, rendered in the shell currency. */
  priceMultiplier: number;
  /** Per-option accent override. Falls back to the type default (bonus → purple, feature → gold). */
  accentColor?: string;
}

export interface ShellFeatures {
  turbo: 0 | 1 | 2 | 3;
  /** Master keyboard-shortcut switch. Defaults to `true`; set `false` to disable ALL hotkeys
   *  (overrides `spacebar` and any future hotkey). */
  hotkeys?: boolean;
  /** Spacebar starts a spin in base mode. Defaults to `true`; set `false` to disable the
   *  keyboard shortcut (e.g. jurisdictions that forbid quick-spin keys). */
  spacebar?: boolean;
  /** Autoplay: `null` (or omitted) disables it; an object enables it (optionally with limits). */
  autoplay?: { maxCount?: number } | null;
  buyBonus: BonusOption[] | false;
}

export interface AutoplayOptions {
  active: boolean;
  remaining: number;
}

export interface FreeSpinsState {
  /** Spin index for the `current / total` counter. Set to `null` (or omit) to instead show just
   *  `total` as a single number — drive a countdown by decrementing `total` each spin. */
  current?: number | null;
  total: number;
  totalWin: number;
}

export interface ShellConfig {
  // NOTE: `mount: HTMLElement` is intentionally omitted — core stays node-free. Task 4 adds it.
  language: string;
  currency: CurrencyConfig;
  availableBets: number[];
  defaultBet: number;
  currentBet: number | null;
  balance: number;
  win: number;
  mode: ShellMode;
  /** Mark this shell as a read-only historical-round replay. */
  replay?: boolean;
  features: ShellFeatures;
  isSocial?: boolean;
  gameInfo?: unknown;
  version?: string;
  theme?: ThemeConfig;
  onBonusBuy?: () => void;
}

export interface ShellState {
  mode: ShellMode;
  /** Sticky replay marker — true for a historical-round replay, regardless of the current
   *  `mode`. Set once (from config or when `mode` becomes 'replay') and never cleared, since a
   *  shell instance is either a live game or a replay viewer for its whole lifetime. */
  replay: boolean;
  balance: number;
  win: number;
  bet: number;
  availableBets: number[];
  busy: boolean;
  autoplay: AutoplayOptions;
  turbo: number;
  buyBonusEnabled: boolean;
  freeSpins: FreeSpinsState;
  /** The currently activated `feature` option (e.g. Ante), or null. */
  activeFeature: BonusOption | null;
}
