// packages/game-engine/src/slot/motion/AnticipationController.ts
//
// Decides which trailing reels get the "anticipation" slow-down treatment, based purely on
// the already-resolved landing grid (presentation only — never a secondary outcome decision).

import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import type { AnticipationConfig } from '../config/ReelSystemConfig';

export interface AnticipationDecision {
  active: boolean;
  /** Reel indices that should spin slower / longer. */
  reels: number[];
  slowdown: number;
  holdMs: number;
}

export class AnticipationController {
  private _cfg: AnticipationConfig;
  constructor(cfg: AnticipationConfig) {
    this._cfg = cfg;
  }
  setConfig(cfg: AnticipationConfig): void {
    this._cfg = cfg;
  }

  /** Count how many trigger symbols land on a given reel. */
  private countOnReel(reel: CellData[]): number {
    let n = 0;
    for (const c of reel) if (c?.symbol && this._cfg.triggerSymbols.includes(c.symbol)) n++;
    return n;
  }

  /**
   * Decide anticipation from the landing grid. Trigger symbols are counted left→right;
   * once the running total reaches `threshold`, every still-spinning reel after that point
   * is flagged for the slow treatment (this mirrors "searching for the last scatter").
   */
  decide(targetGrid: CellData[][]): AnticipationDecision {
    if (!this._cfg.enabled) return { active: false, reels: [], slowdown: 1, holdMs: 0 };

    if (Array.isArray(this._cfg.reels)) {
      // explicit reel list — arm only if the threshold is met somewhere on the board
      const total = targetGrid.reduce((sum, reel) => sum + this.countOnReel(reel), 0);
      const active = total >= this._cfg.threshold;
      return active
        ? {
            active,
            reels: this._cfg.reels.slice(),
            slowdown: this._cfg.slowdownFactor,
            holdMs: this._cfg.holdMs,
          }
        : { active: false, reels: [], slowdown: 1, holdMs: 0 };
    }

    // 'trailing': find the reel where the cumulative count hits the threshold
    let running = 0;
    let armReel = -1;
    for (let c = 0; c < targetGrid.length; c++) {
      running += this.countOnReel(targetGrid[c] ?? []);
      if (running >= this._cfg.threshold) {
        armReel = c;
        break;
      }
    }
    if (armReel < 0) return { active: false, reels: [], slowdown: 1, holdMs: 0 };

    const reels: number[] = [];
    for (let c = armReel + 1; c < targetGrid.length; c++) reels.push(c);
    if (reels.length === 0) return { active: false, reels: [], slowdown: 1, holdMs: 0 };
    return { active: true, reels, slowdown: this._cfg.slowdownFactor, holdMs: this._cfg.holdMs };
  }

  /** Optionally zoom the grid in while anticipating, then settle back. Returns a reset fn. */
  async zoomIn(grid: ReelGrid): Promise<() => Promise<void>> {
    if (!this._cfg.zoom.enabled) return async () => {};
    const sx = grid.scale.x;
    const sy = grid.scale.y;
    await Tween.to(
      grid,
      { 'scale.x': sx * this._cfg.zoom.scale, 'scale.y': sy * this._cfg.zoom.scale },
      this._cfg.zoom.ms,
      easingByName('easeOutCubic'),
    );
    return async () => {
      await Tween.to(
        grid,
        { 'scale.x': sx, 'scale.y': sy },
        this._cfg.zoom.ms,
        easingByName('easeOutCubic'),
      );
    };
  }
}
