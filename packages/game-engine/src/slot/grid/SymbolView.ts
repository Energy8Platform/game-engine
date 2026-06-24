import type { Container } from 'pixi.js';

/** A symbol's visual. Any Container; optionally implements the lifecycle the cell drives. */
export interface SymbolView extends Container {
  playIdle?(): void;
  playWin?(): Promise<void>;
  showStatic?(): void;
  /** Resize the symbol to the given cell size in pixels. */
  resize?(size: number): void;
}

/** Game-supplied factory: build the view for a symbol id (sprite / layered sprites / Spine / composite). */
export type SymbolResolver = (symbolId: string) => SymbolView | null;
