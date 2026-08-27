// packages/game-engine/src/slot/motion/AnticipationController.ts
//
// Decides which trailing reels get the "anticipation" slow-down treatment, based purely on
// the already-resolved landing grid (presentation only — never a secondary outcome decision).

import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import type { AnticipationConfig, AnticipationOverride, PerReel } from '../config/ReelSystemConfig';

export interface AnticipationDecision {
  active: boolean;
  /** Reel indices that should spin slower / longer, in the order the ramp applies. */
  reels: number[];
  /** Speed factor. A scalar when flat; a per-reel array when the decision ramps (see
   *  `progressiveSlowdown` / a game-supplied `decide`). Resolve with `perReelValue`. */
  slowdown: PerReel<number>;
  /** Extra hold before landing. Scalar or per-reel array, same as `slowdown`. */
  holdMs: PerReel<number>;
  /** `cascade-drop`: growth of the gap between successive cells inside the reel (1 = even). */
  cellStaggerRamp: PerReel<number>;
}

/** Fresh "nothing to anticipate" decision (fresh, so callers may mutate `reels` freely). */
const none = (): AnticipationDecision => ({
  active: false,
  reels: [],
  slowdown: 1,
  holdMs: 0,
  cellStaggerRamp: 1,
});

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
    if (!this._cfg.enabled) return none();

    // A game-supplied predicate replaces the symbol counting entirely.
    if (this._cfg.decide) {
      const custom = this._cfg.decide(targetGrid);
      if (!custom) return none();
      const o: AnticipationOverride = Array.isArray(custom) ? { reels: custom } : custom;
      if (!o.reels?.length) return none();
      return this.build(o.reels.slice(), o.slowdown, o.holdMs, o.cellStaggerRamp);
    }

    if (Array.isArray(this._cfg.reels)) {
      // explicit reel list — arm only if the threshold is met somewhere on the board
      const total = targetGrid.reduce((sum, reel) => sum + this.countOnReel(reel), 0);
      if (total < this._cfg.threshold) return none();
      return this.build(this._cfg.reels.slice());
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
    if (armReel < 0) return none();

    const reels: number[] = [];
    for (let c = armReel + 1; c < targetGrid.length; c++) reels.push(c);
    if (reels.length === 0) return none();
    return this.build(reels);
  }

  /** Assemble a decision, applying the configured progression unless the caller pinned values. */
  private build(
    reels: number[],
    slowdown?: PerReel<number>,
    holdMs?: PerReel<number>,
    cellStaggerRamp?: PerReel<number>,
  ): AnticipationDecision {
    return {
      active: true,
      reels,
      cellStaggerRamp: cellStaggerRamp ?? this._cfg.progressiveCellStagger,
      slowdown:
        slowdown ??
        this.ramp(reels, this._cfg.slowdownFactor, (base, i) =>
          i === 0 ? base : base * Math.pow(this._cfg.progressiveSlowdown, i),
        ),
      holdMs:
        holdMs ??
        this.ramp(reels, this._cfg.holdMs, (base, i) => base + this._cfg.progressiveHoldMs * i),
    };
  }

  /**
   * A flat scalar when the progression is a no-op, else an array INDEXED BY REEL so the engine can
   * read a per-reel value straight out of `plan()`.
   */
  private ramp(
    reels: number[],
    base: number,
    at: (base: number, i: number) => number,
  ): PerReel<number> {
    if (at(base, 1) === base) return base;
    const out: (number | undefined)[] = [];
    reels.forEach((reel, i) => {
      out[reel] = at(base, i);
    });
    return out;
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
