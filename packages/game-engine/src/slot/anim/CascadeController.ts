// packages/game-engine/src/slot/anim/CascadeController.ts
import { Tween } from '../../animation';
import { EASING_BY_NAME } from './easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';

export interface CascadeStepData {
  winningCells: { col: number; row: number }[];
  removedCells: { col: number; row: number }[];
  newCells: { col: number; row: number; symbol: string }[];
  settledGrid: CellData[][];
}
export interface CascadeTimings { reveal: number; highlight: number; remove: number; drop: number; refill: number; wait: number; }
export interface CascadeAnim {
  col: number; row: number;
  phase: 'reveal' | 'highlight' | 'remove' | 'drop' | 'refill';
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  scale?: number;
  alpha?: number;
  duration: number;
  easing?: string;
  delay?: number;
}

const DEFAULT_TIMINGS: CascadeTimings = { reveal: 300, highlight: 400, remove: 250, drop: 200, refill: 220, wait: 150 };

export class CascadeController {
  private _grid: ReelGrid;
  private _t: CascadeTimings;
  private _killed = false;

  constructor(grid: ReelGrid, timings?: Partial<CascadeTimings>) {
    this._grid = grid;
    this._t = { ...DEFAULT_TIMINGS, ...(timings ?? {}) };
  }

  /** PURE: ordered animation descriptors for a cascade step. */
  plan(step: CascadeStepData, opts?: { turbo?: boolean }): CascadeAnim[] {
    const f = opts?.turbo ? 0.5 : 1;
    const out: CascadeAnim[] = [];

    for (const w of step.winningCells) {
      out.push({ col: w.col, row: w.row, phase: 'highlight', scale: 1.08, duration: this._t.highlight * f, easing: 'easeOutQuad' });
    }
    for (const w of step.winningCells) {
      out.push({ col: w.col, row: w.row, phase: 'remove', scale: 0, alpha: 0, duration: this._t.remove * f, easing: 'easeInBack' });
    }
    // new cells drop from two row-heights above their target, staggered per column.
    // Row height is derived purely from public geometry (no private grid access).
    const rowStep = this._grid.cellPosition(0, 1).y - this._grid.cellPosition(0, 0).y;
    const perCol: Record<number, number> = {};
    for (const n of step.newCells) {
      const to = this._grid.cellPosition(n.col, n.row);
      const from = { x: to.x, y: to.y - rowStep * 2 };
      const idx = (perCol[n.col] = (perCol[n.col] ?? 0) + 1);
      out.push({ col: n.col, row: n.row, phase: 'drop', from, to, duration: this._t.drop * f, easing: 'easeOutBounce', delay: idx * 30 * f });
    }
    return out;
  }

  /** Execute the plan via Tween. Not unit-tested (Ticker doesn't tick in node). */
  async run(step: CascadeStepData, opts?: { turbo?: boolean }): Promise<void> {
    this._killed = false;
    const plan = this.plan(step, opts);
    // highlight + remove first
    for (const a of plan.filter((p) => p.phase === 'highlight')) {
      if (this._killed) return;
      const cell = this._grid.getCell(a.col, a.row);
      cell.setState({ winning: true });
      await Tween.to(cell, { 'scale.x': a.scale!, 'scale.y': a.scale! }, a.duration, EASING_BY_NAME[a.easing ?? 'easeOutQuad']);
    }
    for (const a of plan.filter((p) => p.phase === 'remove')) {
      if (this._killed) return;
      const cell = this._grid.getCell(a.col, a.row);
      await Tween.to(cell, { 'scale.x': 0, 'scale.y': 0, alpha: 0 }, a.duration, EASING_BY_NAME[a.easing ?? 'easeInBack']);
    }
    // settle data, then drop new cells in
    this._grid.setGrid(step.settledGrid);
    await Promise.all(
      plan.filter((p) => p.phase === 'drop').map(async (a) => {
        if (this._killed) return;
        const cell = this._grid.getCell(a.col, a.row);
        cell.alpha = 1; cell.scale.set(1);
        cell.position.set(a.from!.x, a.from!.y);
        if (a.delay) await Tween.delay(a.delay);
        await Tween.to(cell, { 'position.y': a.to!.y }, a.duration, EASING_BY_NAME[a.easing ?? 'easeOutBounce']);
      }),
    );
  }

  skip(): void { Tween.killAll(); }
  kill(): void { this._killed = true; Tween.killAll(); }
}
