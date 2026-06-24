import type { GameDefinition, TransitionRule } from '../lua/types';

export type SymbolKind = 'high' | 'mid' | 'low' | 'wild' | 'scatter' | 'multiplier' | 'custom';
export type ActionRole = 'base' | 'feature' | 'buy' | 'free';

export interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;
  pay?: Record<number, number>;
  /** Multiplier-symbol x-value(s) (e.g. 100, or [2,3,5]). */
  value?: number | number[];
  /** Arbitrary per-symbol config (tier tables, behavior flags). */
  meta?: Record<string, unknown>;
}

export interface ActionSpec {
  role?: ActionRole;
  stage?: string;
  cost?: number;
  mode?: string;
  feature?: Record<string, unknown>;
  /** Shell display for buy/feature actions (SSOT). */
  title?: string;
  description?: string;
  /** Target RTP for THIS mode (0..1), e.g. 0.96. Single source of truth: seeds the math
   *  pipeline's `targetRTP` AND the Game Info per-mode table. `math.config` keeps only optimizer
   *  tuning (CV / hit-rate / nRowsOut / tolerances), never the RTP. */
  rtp?: number;
  /** Max win for THIS mode as a bet-multiplier; defaults to the game-level `spec.maxWin`. Seeds the
   *  curate cap (`capMaxWin`) for the mode AND the Game Info per-mode "Max Win" cell. */
  maxWin?: number;
  transitions?: TransitionRule[];
}

export interface GameSpec {
  id: string;
  type: 'slot';
  grid: { cols: number; rows: number };
  betLevels: number[];
  defaultBet?: number;
  maxWin: number;
  currency?: string;
  symbols: SymbolSpec[];
  actions: Record<string, ActionSpec>;
  /** Open hint for codegen/UI: 'cascade' | 'cluster' | 'ways' | 'lines' | … */
  mechanic?: string;
  /** Game-level escape hatch. */
  meta?: Record<string, unknown>;
}

export interface MathModeSpec {
  action: string;
  mode: string;
  costMultiplier: number;
  /** Target RTP for the mode (from `ActionSpec.rtp`), if declared — seeds the math pipeline. */
  rtp?: number;
  /** Max win (bet-multiplier) for the mode: `ActionSpec.maxWin` ?? game-level `spec.maxWin`. */
  maxWin: number;
}

export interface PaytableEntry {
  id: string;
  name: string;
  kind: SymbolKind;
  pay: Record<number, number>;
}

export interface PaytableView {
  symbols: PaytableEntry[];
}

export interface GameModel {
  spec: GameSpec;
  gameDefinition: GameDefinition;
  luaPrelude: string;
  modeMap: Record<string, string>;
  mathModes: MathModeSpec[];
  paytable: PaytableView;
  symbols: SymbolSpec[];
}
