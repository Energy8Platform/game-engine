/** `freeSpins` and `bonus` are the SAME bar layout (host-driven hero + Total Win); `freeSpins` is
 *  kept as a back-compat alias for the common case (its readout is derived current/total), while
 *  `bonus` pairs with `setBonus()` to show a game-supplied label + value (adventure, hold-and-spin,
 *  respins — anything that isn't a plain free-spins counter). */
export type ShellMode = 'base' | 'bonus' | 'freeSpins' | 'replay';

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
  /** Override the card UI. Return the card's inner content; the shell keeps the grid wrapper,
   *  accent vars and live re-pricing, and runs the normal buy flow when you call `ctx.select()`.
   *  Core uses `unknown`; each renderer re-exports a typed alias (ui/html → HTMLElement,
   *  ui/pixi → Container). */
  custom?: (ctx: BonusCardContext) => unknown;
}

/** Context passed to a `BonusOption.custom` renderer. Render the card however you like and wire
 *  your own control to `select()` — the buy/confirm flow stays internal to the shell. */
export interface BonusCardContext {
  bonus: BonusOption;
  /** Current bet. */
  bet: number;
  /** Card price = `bonus.priceMultiplier × bet`. */
  price: number;
  /** `price` formatted in the shell currency. */
  priceText: string;
  /** True when the option can't be bought right now (unaffordable / busy / buy-bonus disabled);
   *  reflect it in your UI. `select()` is a no-op while disabled. */
  disabled: boolean;
  /** Card accent (per-option override or the type default); also set as the `--card-acc` CSS var. */
  accent: string;
  /** Proceed through the shell's normal flow: opens the confirm modal, then emits `buyBonusSelect`
   *  / activates the feature. No-op while `disabled`. */
  select: () => void;
}

export interface ThemeConfig {
  /** Palette scheme: 'dark' (default) for dark games, 'light' for light backgrounds. */
  scheme?: 'dark' | 'light';
  /** Brand accent — active states, the SPIN hover glow, and the BUY BONUS button.
   *  (Per-bonus card accents are set on each `BonusOption.accentColor`.) */
  accent?: string;
}

/** One paytable entry: a symbol (text/image) and its win tiers, rendered "<count> x<multiplier>". */
export interface PaytableRow {
  symbol: { text?: string; image?: string };
  wins: Array<{ count?: string; multiplier: number }>;
}

/** One payline over a cols×rows grid: the row index (0 = top) the line takes in each column. */
export interface PaylineDef {
  /** length must equal grid.cols; each value in 0..rows-1 */
  pattern: number[];
  label?: string;
}

/** A single grid cell, 0-based, row 0 = top. */
export type CellRef = [col: number, row: number];

/** A named winning shape: an arbitrary set of grid cells (not one-per-column like a payline),
 *  shown as a grid illustration with its name and optional description. */
export interface ShapeDef {
  /** The lit cells, in any pattern. */
  cells: CellRef[];
  name: string;
  description?: string;
}

/** How a game pays — drives the GameInfo win-section illustration. One section = one kind.
 *  `example`/`winExample`/`loseExample` are optional; omit them for an auto-drawn illustration
 *  sized to `grid`. */
export type WinSection = {
  type: 'wins';
  title?: string;
  order?: number;
  grid: { cols: number; rows: number };
  /** Optional prose shown alongside the illustration. */
  description?: string;
} & (
  | { kind: 'classic'; lines: Array<number[] | PaylineDef> }
  | { kind: 'cluster'; minCount: number; example?: CellRef[] }
  | { kind: 'anywhere'; minCount: number; example?: CellRef[] }
  | { kind: 'ways'; winExample?: CellRef[]; loseExample?: CellRef[] }
  | { kind: 'shapes'; shapes: ShapeDef[] }
);

/** A playable mode / bonus-buy option, shown for comparison (informational only). */
export interface GameMode {
  title: string;
  price?: string;
  rtp?: number;
  maxWin?: string;
  description?: string;
}

/** A preset game-info section. `order` overrides placement; by default `modes` comes
 *  first, `controls` second, and the rest follow in declaration order. */
export type GameInfoSection =
  | { type: 'modes'; title?: string; order?: number; modes: GameMode[] }
  | { type: 'controls'; title?: string; order?: number }
  | { type: 'hotkeys'; title?: string; order?: number }
  | { type: 'paytable'; title?: string; order?: number; rows: PaytableRow[] }
  | WinSection
  | { type: 'custom'; title?: string; order?: number; node?: unknown; html?: string };

export interface GameInfoContent {
  sections?: GameInfoSection[];
}

/** Autoplay limits. Presence of this object (vs `null`) is what enables autoplay. */
export interface AutoplayConfig {
  /** Maximum selectable spin count in the autoplay picker. Caps the built-in presets and
   *  drops the unlimited (∞) choice; if it isn't already a preset it becomes the top choice.
   *  Omit for the default presets (including ∞). */
  maxCount?: number;
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
  autoplay?: AutoplayConfig | null;
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

/** A game-supplied bonus readout for the bar hero, set via `setBonus()`. Generalizes the
 *  free-spins counter: the shell renders `label` (localized via the shell translator, so a game
 *  i18n entry for it is honoured) + `value` (a pre-formatted string, shown verbatim — "2 / 10",
 *  "3", "×5", "7 coins") + the Total Win accumulator. The shell stays free of any per-game bonus
 *  concept — the label/value semantics live in the game/host. */
export interface BonusReadout {
  /** Bar label, e.g. 'Free spins' | 'Adventure' | 'Hold & Spin'. Run through the shell translator. */
  label: string;
  /** Pre-formatted counter value shown verbatim (NOT translated). */
  value: string;
  /** Cumulative bonus win for the Total Win readout. */
  totalWin: number;
}

/** One footer button of a generic modal. Clicking it runs `on` (if any), then closes the modal. */
export interface ModalAction {
  title: string;
  /** Button fill colour (any CSS colour). Omit for a neutral/secondary button. */
  color?: string;
  on?: () => void;
}

/** Options for `shell.openReplay()` — a non-dismissable replay summary modal.
 *  `bonusId` is matched against `features.buyBonus` to label the mode and read the cost
 *  multiplier. There is no ✕ and the backdrop never closes it; the only action is START
 *  REPLAY, which closes the modal, runs `onReplay`, then reopens it. */
export interface ReplayModalOptions {
  bonusId: string;
  /** Base bet the replay was recorded at. */
  bet: number;
  payoutMultiplier: number;
  /** Runs after the modal closes; the modal reopens once it resolves (immediately for sync). */
  onReplay: () => void | Promise<void>;
}

/** Options for `shell.openModal()` — a generic, externally-triggered card modal. */
export interface ModalOptions {
  /** Show the ✕ in the overlay's top-right corner. */
  availableClose: boolean;
  title: string;
  body: string;
  /** Footer buttons; each closes the modal (after running its `on`). */
  actions?: ModalAction[];
  /** Backdrop blur in px (defaults to the shell's standard blur). */
  blurLevel?: number;
  /** Optional keyboard handler — called by the shell keyboard controller while this modal is
   *  open. Return true to consume the key (prevents bar actions + Escape close); false to let
   *  the controller handle it (Escape → closeModal). */
  onKey?: (e: KeyboardEvent) => boolean;
}

export interface ShellConfig {
  // NOTE: `mount: HTMLElement` is intentionally omitted — mount target is a renderer concern.
  theme?: ThemeConfig;
  gameInfo: GameInfoContent;
  language: string;
  /** Game version shown in the game-info footer (e.g. '1.2.0'). Defaults to '1.0.0'. The footer
   *  stamp is `${version}.${engineVersionWithoutDots}` — e.g. game 1.0.0 on engine 0.24.6 → '1.0.0.0246'. */
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
   *  balance (there's no live wallet), even while its free-spins phase runs in `freeSpins` mode.
   *  Defaults to `mode === 'replay'`; set explicitly when a replay starts in another mode. */
  replay?: boolean;
  features: ShellFeatures;
  /** Override the BUY BONUS bar button's action: when set, tapping it calls this instead of
   *  opening the built-in buy-bonus overlay (e.g. the game shows its own bonus UI). The button
   *  is shown whenever this OR `features.buyBonus` is set. */
  onBonusBuy?: () => void;
}

/** ShellConfig after the controller applies defaults (version, isSocial, replay, theme). No mount. */
export type ResolvedShellConfig = Required<
  Pick<
    ShellConfig,
    | 'language'
    | 'currency'
    | 'availableBets'
    | 'defaultBet'
    | 'balance'
    | 'win'
    | 'mode'
    | 'features'
    | 'gameInfo'
    | 'version'
    | 'isSocial'
    | 'replay'
  >
> &
  Pick<ShellConfig, 'currentBet' | 'theme' | 'onBonusBuy'>;

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
  /** Game-supplied bonus label + value override (from `setBonus()`). When null the bar derives the
   *  readout from `freeSpins` (label 'Free spins', value current/total) — the back-compat default. */
  bonus: { label: string; value: string } | null;
  /** The currently activated `feature` option (e.g. Ante), or null. Drives the
   *  effective-bet readout tint and the BUY BONUS → DISABLE toggle on the bar. */
  activeFeature: BonusOption | null;
}

export interface ShellEvents {
  spin: void;
  betChange: number;
  autoplayStart: AutoplayOptions;
  autoplayStop: void;
  turboChange: number;
  buyBonusSelect: { id: string };
  featureActivate: { id: string };
  featureDeactivate: { id: string };
  menuOpen: void;
  settingsOpen: void;
  infoOpen: void;
  settingChange: { key: string; value: unknown };
}
