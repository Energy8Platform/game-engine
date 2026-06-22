// packages/game-engine/src/slot/anim/ReelSpinController.ts
import { Tween, Easing } from '../../animation';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';

export interface ReelSpinData { targetGrid: CellData[][]; strip?: (reel: number) => string[]; }
export interface ReelSpinTimings { spinUp: number; hold: number; stopStagger: number; settle: number; }
export interface ReelStopPlan {
  reel: number;
  stopTime: number;
  landing: CellData[];
  settle: { amp: number; ms: number };
}

const DEFAULT_TIMINGS: ReelSpinTimings = { spinUp: 500, hold: 200, stopStagger: 120, settle: 240 };

export class ReelSpinController {
  private _grid: ReelGrid;
  private _t: ReelSpinTimings;
  private _killed = false;

  constructor(grid: ReelGrid, timings?: Partial<ReelSpinTimings>) {
    this._grid = grid;
    this._t = { ...DEFAULT_TIMINGS, ...(timings ?? {}) };
  }

  /** PURE: per-reel stop timing + landing window. No Pixi mutation. */
  plan(data: ReelSpinData, opts?: { turbo?: boolean }): ReelStopPlan[] {
    const f = opts?.turbo ? 0.5 : 1;
    const out: ReelStopPlan[] = [];
    for (let reel = 0; reel < this._grid.cols; reel++) {
      out.push({
        reel,
        stopTime: this._t.spinUp * f + reel * this._t.stopStagger * f,
        landing: data.targetGrid[reel] ?? [],
        settle: { amp: 7, ms: this._t.settle * f },
      });
    }
    return out;
  }

  /** Execute the spin: scroll each reel, decelerate, land on target, settle-bounce. Not unit-tested. */
  async run(data: ReelSpinData, opts?: { turbo?: boolean }): Promise<void> {
    this._killed = false;
    const plan = this.plan(data, opts);
    await Promise.all(
      plan.map(async (p) => {
        if (this._killed) return;
        const strip = data.strip?.(p.reel) ?? p.landing.map((c) => c.symbol ?? '');
        // texture-swap spin: cycle symbols quickly while decelerating, then land
        const cells = Array.from({ length: this._grid.rows }, (_, r) => this._grid.getCell(p.reel, r));
        const ticks = Math.max(6, Math.floor(p.stopTime / 60));
        for (let i = 0; i < ticks; i++) {
          if (this._killed) break;
          for (let r = 0; r < cells.length; r++) {
            const sym = strip[(i + r) % strip.length] || null;
            cells[r].setData({ symbol: sym });
          }
          await Tween.delay(Math.min(60, p.stopTime / ticks));
        }
        // land on the real target
        for (let r = 0; r < cells.length; r++) cells[r].setData(p.landing[r] ?? { symbol: null });
        // settle bounce on the column parent
        if (!this._killed && cells[0]?.parent) {
          const colY = cells[0].parent.y;
          await Tween.fromTo(cells[0].parent, { y: colY - p.settle.amp }, { y: colY }, p.settle.ms, Easing.easeOutBack);
        }
      }),
    );
  }

  private _killOwnTweens(): void {
    for (let c = 0; c < this._grid.cols; c++) {
      for (let r = 0; r < this._grid.rows; r++) {
        Tween.killTweensOf(this._grid.getCell(c, r));
      }
    }
  }

  skip(): void { this._killed = true; this._killOwnTweens(); }
}
