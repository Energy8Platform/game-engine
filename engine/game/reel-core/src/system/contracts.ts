// engine/game/reel-core/src/system/contracts.ts
//
// The seams of the pluggable reel system (slice 35). The core (`createReelSystem`) owns the grid,
// the board and the overlay layer; HOW the reels spin, WHICH reels anticipate and HOW a board step
// such as `tumble` plays are registered into it by the rows that provide them.

import type { Container } from 'pixi.js';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import type { AnticipationConfig, MotionConfig, WinConfig } from '../config/ReelSystemConfig';
import type { ReelStopPlan, SpinRunOpts } from '../motion/SpinEngine';
import type { AnticipationDecision } from '../motion/AnticipationController';

/** What a style or controller gets to work with — the core's live grid, overlay layer and board. */
export interface ReelKit {
  readonly grid: ReelGrid;
  readonly fx: Container;
  readonly resolve: SymbolResolver;
  readonly win: WinConfig;
  readonly board: CellData[][];
  setBoard(board: CellData[][]): void;
  log?(message: string): void;
}

export interface MotionRunner {
  plan(target: CellData[][], opts?: SpinRunOpts): ReelStopPlan[];
  run(target: CellData[][], opts?: SpinRunOpts): Promise<void>;
  skip(): void;
}

/** A way the reels spin to a target — registered by key; the `motion1` row picks one. */
export interface MotionStyle {
  readonly key: string;
  create(kit: ReelKit, config: MotionConfig): MotionRunner;
}

/** Which reels get the anticipation treatment, and the zoom around it. */
export interface Anticipator {
  readonly config: AnticipationConfig;
  decide(target: CellData[][]): AnticipationDecision;
  zoomIn(grid: ReelGrid): Promise<() => Promise<void>>;
}

export interface ControllerRunner<S> {
  run(step: S, opts?: { turbo?: boolean }): Promise<void>;
  skip(): void;
}

/** A board step the core does not perform itself — today `tumble`. */
export interface BoardController<S = unknown> {
  readonly kind: string;
  create(kit: ReelKit): ControllerRunner<S>;
}

export interface Registry<T> {
  /** Adds `item` (an existing key is replaced — last wins); the disposer removes only this entry. */
  register(item: T): () => void;
  get(key: string): T | undefined;
  /** Registered keys in insertion order. */
  keys(): string[];
}

export type Report = (severity: 'error' | 'warning', message: string) => void;
