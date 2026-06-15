export type ShellMode = 'base' | 'freeSpins' | 'replay';

export interface CurrencyConfig {
  symbol: string;
  position: 'left' | 'right';
  decimals?: number;
  separator?: { thousands?: string; decimal?: string };
}

export interface BonusOption {
  id: string;
  name: string;
  description: string;
  priceMultiplier: number;
  volatility?: 1 | 2 | 3 | 4 | 5;
  accentColor?: string;
}

export interface ThemeConfig {
  accent?: string;
  buyBonusColor?: string;
}

export interface GameInfoContent {
  rtp?: number;
  rules?: string;
  symbols?: Array<{ name: string; image?: string; payouts?: string }>;
  features?: Array<{ name: string; description: string }>;
}

export interface ShellFeatures {
  turbo: 0 | 1 | 2 | 3;
  autoplay: boolean;
  buyBonus: BonusOption[] | false;
}

export interface AutoplayOptions {
  active: boolean;
  remaining: number;
}

export interface FreeSpinsState {
  current: number;
  total: number;
  totalWin: number;
  lastWin: number;
}

export interface ShellConfig {
  mount: HTMLElement;
  theme?: ThemeConfig;
  gameInfo: GameInfoContent;
  language: string;
  currency: CurrencyConfig;
  availableBets: number[];
  defaultBet: number;
  currentBet: number | null;
  balance: number;
  win: number;
  mode: ShellMode;
  features: ShellFeatures;
}

export interface ShellState {
  mode: ShellMode;
  balance: number;
  win: number;
  bet: number;
  availableBets: number[];
  busy: boolean;
  autoplay: AutoplayOptions;
  turbo: number;
  buyBonusEnabled: boolean;
  freeSpins: FreeSpinsState;
}

export interface ShellEvents {
  spin: void;
  betChange: number;
  autoplayStart: AutoplayOptions;
  autoplayStop: void;
  turboChange: number;
  buyBonusSelect: { id: string };
  menuOpen: void;
  settingsOpen: void;
  infoOpen: void;
  settingChange: { key: string; value: unknown };
}
