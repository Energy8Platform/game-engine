// packages/game-engine/src/slot/config/ReelSystemConfig.ts
//
// The single, fully-typed configuration object for the configurable reel system.
// Everything is optional with sensible defaults — `resolveReelConfig(partial)` deep-merges
// a partial config onto DEFAULT_REEL_CONFIG so games (and the reel-lab playground) can
// override only what they need.
//
// Design notes are in docs/reels-analysis-and-design.md.

import type { CellData, CellFrameStyle } from '../grid/SymbolCell';
import { resolveGeometry, type CellSizeSpec, type ResolvedGeometry } from '../grid/geometry';

export type { CellSizeSpec, ResolvedGeometry };

/** Names of easing functions available in the engine's `Easing` map (see anim/easing-map.ts). */
export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeOutBounce'
  | 'easeInBounce'
  | 'easeOutElastic'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine';

/**
 * A value that is either flat across the board, or per-reel: an array indexed by REEL INDEX
 * (holes fall back to the scalar default). Used for anticipation timings so a game can make
 * each successive reel slower than the last.
 */
export type PerReel<T> = T | (T | undefined)[];

/** Resolve a `PerReel<T>` for one reel. `undefined` (or a hole in the array) yields `fallback`. */
export function perReelValue<T>(value: PerReel<T> | undefined, reel: number, fallback: T): T {
  if (value === undefined) return fallback;
  if (Array.isArray(value)) return (value[reel] as T | undefined) ?? fallback;
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid
// ─────────────────────────────────────────────────────────────────────────────

/** Win-evaluation model. Purely presentational here (affects geometry + highlight), the math lives in Lua. */
export type EvaluationMode = 'lines' | 'ways' | 'anywhere' | 'cluster' | 'megaways' | 'infinity';

export interface GridConfig {
  cols: number;
  /** Uniform row count. Ignored when `rowsPerReel` is set. */
  rows: number;
  /** Per-reel row counts (Megaways / variable-height reels). Length should equal `cols`. */
  rowsPerReel?: number[];
  /** Square cell size (shorthand: same width & height, all reels). */
  cellSize: number;
  /** Rectangular cells, uniform across reels. Override `cellSize` when set. */
  cellWidth?: number;
  cellHeight?: number;
  /** Per-strip cell size (square scalar or {width,height}). Overrides the above for that reel. */
  cellSizePerReel?: CellSizeSpec[];
  /** Uniform gap (shorthand for both axes). */
  gap: number;
  /** Horizontal gap between adjacent reels. Scalar, or per-boundary (length cols-1). Overrides `gap`. */
  colGap?: number | number[];
  /** Vertical gap between rows. Scalar, or per-reel (length cols). Overrides `gap`. */
  rowGap?: number | number[];
  evaluation: EvaluationMode;
  /** For Megaways: clamp per-reel rows to [minRows, maxRows]. */
  minRows?: number;
  maxRows?: number;
  /** Megaways top horizontal reel (renders above the grid, adds to ways). */
  topReel?: { size: number } | null;
  mask: boolean;
  frameStyle?: CellFrameStyle;
  decoration?: { padding?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion
// ─────────────────────────────────────────────────────────────────────────────

export type MotionStyle =
  | 'swap' // texture-swap ring (cheap, the engine's original behaviour)
  | 'strip' // strip-scroll: a tape of symbols slides past a masked window
  | 'cascade-drop'; // symbols drop in from above (tumble-style boards)

export type StopMode = 'sequential' | 'sync' | 'random';
export type StopOrder = 'ltr' | 'rtl';
export type Intensity = 'full' | 'reduced' | 'minimal';

export interface SettleConfig {
  /** Overshoot amplitude in px applied to the reel before it springs back. */
  amp: number;
  ms: number;
  easing: EasingName;
}

/** Squash & stretch on landing impact (Stone-Rush / magnus style). */
export interface SquashConfig {
  enabled: boolean;
  scaleX: number; // e.g. 1.3 (wider)
  scaleY: number; // e.g. 0.7 (shorter)
  ms: number;
}

export interface BlurConfig {
  enabled: boolean;
  /** Alpha applied to in-motion symbols (hot-ross uses 0.82). */
  alpha: number;
  /** Runtime BlurFilter strength factor (PixiJS slots demo uses ~8), 0 disables the filter. */
  strength: number;
  /** Draw vertical motion streaks behind moving symbols. */
  streaks: boolean;
}

export interface MotionConfig {
  style: MotionStyle;
  /** Base spin-up duration (ms) before the first reel can stop. */
  spinUp: number;
  /** Extra hold (ms) at full speed before deceleration. */
  hold: number;
  /** Delay (ms) between consecutive reel stops in sequential mode. */
  stopStagger: number;
  stopMode: StopMode;
  stopOrder: StopOrder;
  settle: SettleConfig;
  squash: SquashConfig;
  blur: BlurConfig;
  /** Multiply all durations in turbo mode (0.5 = twice as fast). */
  turboFactor: number;
  /** Global animation-intensity scale (accessibility): full=1, reduced=0.7, minimal=0.4. */
  intensity: Intensity;
  /** Allow slam/quick-stop (snaps reels to target without changing outcome). */
  slamStop: boolean;
  /** Symbols visible on a reel tape while spinning (swap/strip). */
  symbolsPerReel: number;
  /** `cascade-drop`: ms between consecutive cells of ONE reel (top→bottom). Default 24. */
  cellStagger: number;
  /** `cascade-drop`: multiplier on `stopStagger` for the per-reel offset. Default 0.4. */
  reelStaggerFactor: number;
  /** `cascade-drop`: fall duration as a fraction of `spinUp`. Default 0.6. */
  dropFallFactor: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anticipation
// ─────────────────────────────────────────────────────────────────────────────

/** What a game-supplied `AnticipationConfig.decide` may return instead of a bare reel list. */
export interface AnticipationOverride {
  /** Reels to anticipate, in the order the progression should ramp. Empty = no anticipation. */
  reels: number[];
  /** Speed factor (lower = slower). Scalar, or per-reel indexed by reel index. */
  slowdown?: PerReel<number>;
  /** Extra hold before landing. Scalar, or per-reel indexed by reel index. */
  holdMs?: PerReel<number>;
}

export interface AnticipationConfig {
  enabled: boolean;
  /** Symbols that count toward the anticipation threshold (scatter/bonus). */
  triggerSymbols: string[];
  /** Number of trigger symbols already landed that arms anticipation (N−1, usually 2). */
  threshold: number;
  /** Which reels get the slow treatment: the still-spinning trailing reels, or explicit indices. */
  reels: 'trailing' | number[];
  /** Multiply the trailing reel's spin speed (lower = slower / longer). */
  slowdownFactor: number;
  /** Extra hold (ms) before the final anticipation reel lands (300–500 typical). */
  holdMs: number;
  /**
   * Game-supplied decision, REPLACING the built-in `triggerSymbols`/`threshold` counting.
   * Return the reels to anticipate (or an `AnticipationOverride`); `null` / `[]` = no anticipation.
   * Use this when the trigger is not expressible as "N of symbol X landed" — e.g. "the round is
   * still alive on every reel so far", or "reel 3 missed its symbol, so let 4 and 5 stop normally".
   */
  decide?: ((targetGrid: CellData[][]) => number[] | AnticipationOverride | null) | null;
  /**
   * Ramp the slowdown across successive anticipated reels: reel #i of the decision gets
   * `slowdownFactor * progressiveSlowdown ** i`. 1 = flat (default); < 1 = each reel slower
   * than the last.
   */
  progressiveSlowdown: number;
  /** Extra hold (ms) added per successive anticipated reel: reel #i gets `holdMs + i * this`. */
  progressiveHoldMs: number;
  /** Optional grid zoom while anticipating (magnum-opus uses 1.3×). */
  zoom: { enabled: boolean; scale: number; ms: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade
// ─────────────────────────────────────────────────────────────────────────────

export interface CascadeConfig {
  enabled: boolean;
  /** Animate surviving symbols sliding down into the gaps (true tumble). */
  gravity: boolean;
  timings: {
    reveal: number;
    highlight: number;
    remove: number;
    drop: number;
    refill: number;
    wait: number;
  };
  easings: { highlight: EasingName; remove: EasingName; drop: EasingName };
  /** Slow each successive cascade step to build tension: factor = 1 + step*perStepDecel (capped). */
  perStepDecel: number;
  perStepDecelCap: number;
  /** Dim non-winning symbols during the highlight phase. */
  dimNonWinners: boolean;
  dimAlpha: number;
  /** Running win multiplier that climbs per cascade (Pragmatic Tumble / Avalanche). */
  multiplier: {
    enabled: boolean;
    start: number;
    /** 'add' → +step each step; 'mul' → ×step each step. */
    mode: 'add' | 'mul';
    step: number;
    cap: number | null;
    /** Keep climbing across free-spins instead of resetting per spin. */
    persistInFreeSpins: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Win presentation
// ─────────────────────────────────────────────────────────────────────────────

export interface WinConfig {
  highlightScale: number;
  glow: boolean;
  /** Frame shake on landing/win. */
  frameShake: { enabled: boolean; amp: number; ms: number; onlyOnSymbols: string[] | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Special feature mechanics
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpandingWildConfig {
  enabled: boolean;
  symbol: string;
  /** Reels that may host an expanding wild (empty = all). */
  reels: number[];
  /** Expand to the full reel height. */
  toFullReel: boolean;
  ms: number;
  easing: EasingName;
  onlyInFreeSpins: boolean;
}

export interface StickyConfig {
  enabled: boolean;
  symbols: string[];
  /** How many spins a sticky symbol persists (0 = whole feature/bonus). */
  durationSpins: number;
  /** Ring colour drawn around sticky cells. */
  ringColor: number;
}

export interface WalkingWildConfig {
  enabled: boolean;
  symbol: string;
  direction: 'left' | 'right';
  stepPerSpin: number;
  awardsRespin: boolean;
  asStacked: boolean;
}

export interface MultiplierConfig {
  enabled: boolean;
  /** Multiplier symbol id (carries a value), or null when multipliers are per-cell data. */
  symbol: string | null;
  scope: 'perSymbol' | 'perReel' | 'global';
  combine: 'additive' | 'multiplicative';
  attachedToWild: boolean;
  max: number;
  accumulateAcrossFreeSpins: boolean;
}

export interface MysteryConfig {
  enabled: boolean;
  symbol: string;
  /** Eligible reveal targets; all mystery tiles reveal the SAME single draw per spin. */
  revealPool: string[];
  canRevealWild: boolean;
  ms: number;
}

export interface TransformConfig {
  enabled: boolean;
  /** Trigger symbol whose landing fires the transform (null = data-driven). */
  trigger: string | null;
  /** 'randomLow' picks one low symbol at random; or pin a specific source. */
  source: 'randomLow' | string;
  target: string;
  /** Convert every instance of the source symbol. */
  allInstances: boolean;
  /** Restrict to low→high (upgrade) direction. */
  upgradeOnly: boolean;
  ms: number;
}

export interface GiantConfig {
  enabled: boolean;
  /** Footprint in cells. */
  width: number;
  height: number;
  /** Symbols that may appear giant (empty = any). */
  symbols: string[];
  /** Pick one giant symbol type per spin. */
  chosenPerSpin: boolean;
  onlyInFreeSpins: boolean;
}

export interface SplitConfig {
  enabled: boolean;
  symbol: string;
  factor: number; // ×2 typical
  /** Reels that can host the split trigger (xSplit lands on the last reel). */
  reels: number[];
  /** Defer the split execution until all respins finish. */
  deferUntilRespinsEnd: boolean;
}

export interface StackedConfig {
  enabled: boolean;
  symbols: string[];
  /** Max stack height (positions of the same symbol on one reel). */
  height: number;
}

export interface NudgeConfig {
  enabled: boolean;
  /** Reels eligible to nudge. */
  reels: number[];
  step: number; // ±1 position
  /** xNudge: nudge a stacked wild into full view, +1 multiplier per nudge. */
  toFullReel: boolean;
  multiplierStart: number;
  multiplierPerNudge: number;
}

export interface ReelModifierConfig {
  enabled: boolean;
  /** Random pre-spin modifiers, each with a trigger weight. */
  pool: {
    effect: 'addRows' | 'addWilds' | 'setGiant' | 'guaranteedWilds';
    magnitude: number;
    weight: number;
  }[];
  appliesIn: 'base' | 'freeSpins' | 'both';
}

export interface HoldAndSpinConfig {
  enabled: boolean;
  lockSymbols: string[];
  triggerThreshold: number; // e.g. 6
  respinsAwarded: number; // e.g. 3
  /** Reset the respin counter to full whenever a new symbol locks. */
  resetOnNewSymbol: boolean;
  jackpotTiers: string[]; // ['Mini','Minor','Major','Grand']
  fullGridAwardsGrand: boolean;
}

export interface RandomWildConfig {
  enabled: boolean;
  /** Fixed count, or [min,max] range. */
  count: number | [number, number];
  sticky: boolean;
  multiplier: number;
  trigger: 'randomBaseSpin' | 'onFreeSpins';
  chance: number; // 0..1 for randomBaseSpin
}

export interface FeaturesConfig {
  expandingWild: ExpandingWildConfig;
  sticky: StickyConfig;
  walkingWild: WalkingWildConfig;
  multiplier: MultiplierConfig;
  mystery: MysteryConfig;
  transform: TransformConfig;
  giant: GiantConfig;
  split: SplitConfig;
  stacked: StackedConfig;
  nudge: NudgeConfig;
  reelModifier: ReelModifierConfig;
  holdAndSpin: HoldAndSpinConfig;
  randomWild: RandomWildConfig;
}

/** Ordered list of feature keys (resolve order matters; see docs §3.4). */
export type FeatureKey = keyof FeaturesConfig;
export const FEATURE_KEYS: FeatureKey[] = [
  'reelModifier', // pre-spin
  'giant',
  'stacked',
  'mystery', // post-spin reveal
  'expandingWild',
  'walkingWild',
  'randomWild',
  'transform',
  'split',
  'nudge',
  'multiplier',
  'sticky',
  'holdAndSpin',
];

// ─────────────────────────────────────────────────────────────────────────────
// Root config
// ─────────────────────────────────────────────────────────────────────────────

export interface ReelSystemConfig {
  grid: GridConfig;
  motion: MotionConfig;
  anticipation: AnticipationConfig;
  cascade: CascadeConfig;
  win: WinConfig;
  features: FeaturesConfig;
}

/** Deep-partial helper for overrides. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REEL_CONFIG: ReelSystemConfig = {
  grid: {
    cols: 5,
    rows: 3,
    cellSize: 96,
    gap: 6,
    evaluation: 'lines',
    minRows: 2,
    maxRows: 7,
    topReel: null,
    mask: true,
    decoration: { padding: 0 },
  },
  motion: {
    style: 'swap',
    spinUp: 500,
    hold: 200,
    stopStagger: 120,
    stopMode: 'sequential',
    stopOrder: 'ltr',
    settle: { amp: 7, ms: 240, easing: 'easeOutBack' },
    squash: { enabled: false, scaleX: 1.18, scaleY: 0.82, ms: 90 },
    blur: { enabled: false, alpha: 0.85, strength: 8, streaks: false },
    turboFactor: 0.5,
    intensity: 'full',
    slamStop: true,
    symbolsPerReel: 6,
    cellStagger: 24,
    reelStaggerFactor: 0.4,
    dropFallFactor: 0.6,
  },
  anticipation: {
    enabled: false,
    triggerSymbols: ['scatter'],
    threshold: 2,
    reels: 'trailing',
    slowdownFactor: 0.3,
    holdMs: 400,
    decide: null,
    progressiveSlowdown: 1,
    progressiveHoldMs: 0,
    zoom: { enabled: false, scale: 1.15, ms: 600 },
  },
  cascade: {
    enabled: false,
    gravity: true,
    timings: { reveal: 300, highlight: 400, remove: 250, drop: 220, refill: 220, wait: 150 },
    easings: { highlight: 'easeOutQuad', remove: 'easeInBack', drop: 'easeOutBounce' },
    perStepDecel: 0.08,
    perStepDecelCap: 1.5,
    dimNonWinners: false,
    dimAlpha: 0.35,
    multiplier: {
      enabled: false,
      start: 1,
      mode: 'add',
      step: 1,
      cap: null,
      persistInFreeSpins: false,
    },
  },
  win: {
    highlightScale: 1.12,
    glow: true,
    frameShake: { enabled: false, amp: 3, ms: 180, onlyOnSymbols: null },
  },
  features: {
    expandingWild: {
      enabled: false,
      symbol: 'wild',
      reels: [],
      toFullReel: true,
      ms: 420,
      easing: 'easeOutBack',
      onlyInFreeSpins: false,
    },
    sticky: { enabled: false, symbols: ['wild'], durationSpins: 3, ringColor: 0xec4899 },
    walkingWild: {
      enabled: false,
      symbol: 'wild',
      direction: 'left',
      stepPerSpin: 1,
      awardsRespin: true,
      asStacked: false,
    },
    multiplier: {
      enabled: false,
      symbol: null,
      scope: 'perSymbol',
      combine: 'additive',
      attachedToWild: false,
      max: 128,
      accumulateAcrossFreeSpins: false,
    },
    mystery: { enabled: false, symbol: 'mystery', revealPool: [], canRevealWild: false, ms: 300 },
    transform: {
      enabled: false,
      trigger: null,
      source: 'randomLow',
      target: 'wild',
      allInstances: true,
      upgradeOnly: false,
      ms: 320,
    },
    giant: {
      enabled: false,
      width: 2,
      height: 2,
      symbols: [],
      chosenPerSpin: false,
      onlyInFreeSpins: false,
    },
    split: { enabled: false, symbol: 'split', factor: 2, reels: [], deferUntilRespinsEnd: true },
    stacked: { enabled: false, symbols: [], height: 3 },
    nudge: {
      enabled: false,
      reels: [],
      step: 1,
      toFullReel: false,
      multiplierStart: 1,
      multiplierPerNudge: 1,
    },
    reelModifier: { enabled: false, pool: [], appliesIn: 'both' },
    holdAndSpin: {
      enabled: false,
      lockSymbols: ['coin'],
      triggerThreshold: 6,
      respinsAwarded: 3,
      resetOnNewSymbol: true,
      jackpotTiers: ['Mini', 'Minor', 'Major', 'Grand'],
      fullGridAwardsGrand: true,
    },
    randomWild: {
      enabled: false,
      count: [1, 3],
      sticky: false,
      multiplier: 1,
      trigger: 'onFreeSpins',
      chance: 0.2,
    },
  },
};

/** Intensity → duration scale (accessibility). */
export const INTENSITY_SCALE: Record<Intensity, number> = { full: 1, reduced: 0.7, minimal: 0.4 };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge `partial` onto `base` (arrays replace, objects merge). Returns a new object. */
export function mergeReelConfig<T>(base: T, partial?: DeepPartial<T>): T {
  if (partial == null) return structuredCloneSafe(base);
  const out = structuredCloneSafe(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(v) && isPlainObject(cur))
      out[k] = mergeReelConfig(cur, v as DeepPartial<unknown>);
    else out[k] = v;
  }
  return out as T;
}

/** Resolve a partial config to a fully-populated `ReelSystemConfig`. */
export function resolveReelConfig(partial?: DeepPartial<ReelSystemConfig>): ReelSystemConfig {
  return mergeReelConfig(DEFAULT_REEL_CONFIG, partial);
}

/** True only for `{}`-shaped objects — a class instance or a Date is NOT one. */
function isCloneableRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-clone a config. Hand-rolled rather than `structuredClone` because a config may carry
 * functions (`anticipation.decide`), which `structuredClone` refuses to copy. Functions and
 * anything that is not a plain object/array pass through by reference.
 */
function structuredCloneSafe<T>(v: T): T {
  if (Array.isArray(v)) return v.map((item) => structuredCloneSafe(item)) as unknown as T;
  if (isCloneableRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = structuredCloneSafe(val);
    return out as T;
  }
  return v;
}

/** Effective per-reel row counts (resolves Megaways `rowsPerReel`, else uniform `rows`). */
export function effectiveRowsPerReel(grid: GridConfig): number[] {
  if (grid.rowsPerReel && grid.rowsPerReel.length === grid.cols) return grid.rowsPerReel.slice();
  return Array.from({ length: grid.cols }, () => grid.rows);
}

/** Resolve a `GridConfig` into a fully-populated per-reel geometry (rectangular / per-strip aware). */
export function resolveGridGeometry(grid: GridConfig): ResolvedGeometry {
  return resolveGeometry(grid);
}

/** Total ways-to-win for a ways/megaways grid (product of per-reel heights). */
export function waysCount(grid: GridConfig): number {
  return effectiveRowsPerReel(grid).reduce((a, b) => a * b, 1);
}
