import type { GameDefinition, TransitionRule } from '../lua/types';

export type SymbolKind = 'high' | 'low' | 'wild' | 'scatter' | 'multiplier';
export type ActionRole = 'base' | 'free' | 'buy';

export interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;
  pay?: Record<number, number>;
}

export interface ActionSpec {
  role?: ActionRole;
  stage?: string;
  cost?: number;
  mode?: string;
  feature?: Record<string, unknown>;
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
}

export interface MathModeSpec {
  action: string;
  mode: string;
  costMultiplier: number;
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
