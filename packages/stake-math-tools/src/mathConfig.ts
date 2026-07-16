import type { OptimizeParams } from './types';

/** A platform-core GameModel — typed loosely here to avoid a hard type import. */
export interface MathModel {
  spec: { maxWin: number };
  mathModes: { action: string; mode: string; costMultiplier: number }[];
  gameDefinition: unknown;
}

export interface ModeSimConfig {
  iterations?: number;
  bet?: number;
  rng?: 'provably-fair' | 'fast';
  seed?: string;
  params?: unknown;
}

/** Context passed to a `transformEvents` hook alongside one book's events. */
export interface CurateEventContext {
  /** Stake mode being curated (e.g. `BASE`). */
  mode: string;
  /** Curated book id (== the LUT `sim` and the book's `id`). */
  bookId: number;
  /** The book's payout in integer cents (== book `payoutMultiplier`). */
  payoutCents: number;
  /** Max-win cap in cents (0 = uncapped). */
  capCents: number;
}

/**
 * Per-book events transform, applied during curate to each book's `events`
 * array right before it's serialized (one call per output "line"). Return the
 * events to ship — the same array mutated, or a brand-new array. You may edit,
 * add, drop, split, or merge events; return `[]` to ship an empty book. The
 * transformed result is what gets size-checked (Stake's 1 MiB `events` cap) and
 * what `criteria` is derived from, so keep `type: 'free_spin'` on feature spins.
 */
export type CurateEventsTransform = (
  events: Record<string, unknown>[],
  ctx: CurateEventContext,
) => Record<string, unknown>[];

export interface ModeMathConfig {
  sim?: ModeSimConfig;
  /** Curate params (stake-math-tools OptimizeParams); capMaxWin defaults to spec.maxWin × 100 (cents). */
  curate?: Partial<OptimizeParams>;
  /** Per-mode override of the events transform (falls back to the top-level `transformEvents`). */
  transformEvents?: CurateEventsTransform;
}

export interface MathConfig {
  model: MathModel;
  /**
   * The math source. Lua runtime: buildLuaScript(model, readFileSync(logic.lua)).
   * Spin runtime: the raw .spin source (declarations live inside it — no prelude).
   */
  luaScript: string;
  /**
   * Math runtime. 'spin' (default — the Rust e8 SpinML engine) is the only
   * supported runtime; 'lua' is rejected with a migration hint (legacy games
   * pin stake-math-tools <= 0.8.x).
   */
  runtime?: 'spin' | 'lua';
  /** Per-mode overrides keyed by Stake mode (e.g. BASE). Missing modes use seeded defaults. */
  modes?: Record<string, ModeMathConfig>;
  /** Default events transform applied to every mode's books during curate.
   *  A per-mode `modes[mode].transformEvents` overrides it for that mode. */
  transformEvents?: CurateEventsTransform;
}

export interface ResolvedMode {
  mode: string;
  action: string;
  costMultiplier: number;
  sim: { iterations: number; bet: number; rng: 'provably-fair' | 'fast'; seed?: string; params?: unknown };
  curate: Partial<OptimizeParams> & { capMaxWin: number; costMultiplier: number };
  /** Resolved events transform for this mode (per-mode override ?? top-level default ?? none). */
  transformEvents?: CurateEventsTransform;
}

const SIM_DEFAULTS = { iterations: 1_000_000, bet: 1, rng: 'provably-fair' as const };

/** Every mode from model.mathModes, with per-mode overrides merged over spec-seeded defaults. */
export function resolveModes(cfg: MathConfig): ResolvedMode[] {
  const maxWin = cfg.model.spec.maxWin;
  return cfg.model.mathModes.map((m) => {
    const over = cfg.modes?.[m.mode] ?? {};
    return {
      mode: m.mode,
      action: m.action,
      costMultiplier: m.costMultiplier,
      sim: { ...SIM_DEFAULTS, ...over.sim },
      // capMaxWin is in CENTS: payoutCents is bet-mult × 100, so the cap is maxWin × 100.
      curate: { capMaxWin: maxWin * 100, costMultiplier: m.costMultiplier, ...over.curate },
      transformEvents: over.transformEvents ?? cfg.transformEvents,
    };
  });
}
