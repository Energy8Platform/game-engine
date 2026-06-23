import type { OptimizeParams } from './types';

/** A platform-core GameModel — typed loosely here to avoid a hard type import. */
export interface MathModel {
  spec: { maxWin: number; [k: string]: unknown };
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

export interface ModeMathConfig {
  sim?: ModeSimConfig;
  /** Curate params (stake-math-tools OptimizeParams); capMaxWin defaults to spec.maxWin. */
  curate?: Partial<OptimizeParams>;
}

export interface MathConfig {
  model: MathModel;
  /** node-built: buildLuaScript(model, readFileSync(logic.lua)). */
  luaScript: string;
  /** Per-mode overrides keyed by Stake mode (e.g. BASE). Missing modes use seeded defaults. */
  modes?: Record<string, ModeMathConfig>;
}

export interface ResolvedMode {
  mode: string;
  action: string;
  costMultiplier: number;
  sim: { iterations: number; bet: number; rng: 'provably-fair' | 'fast'; seed?: string; params?: unknown };
  curate: Partial<OptimizeParams> & { capMaxWin: number; costMultiplier: number };
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
      curate: { capMaxWin: maxWin, costMultiplier: m.costMultiplier, ...over.curate },
    };
  });
}
