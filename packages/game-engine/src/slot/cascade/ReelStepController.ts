// packages/game-engine/src/slot/cascade/ReelStepController.ts
//
// ReelStep™ mechanic. Flow: reels stop → winning lines are paid → each reel scrolls DOWN by N
// positions (N = winning symbols that played on that reel) → the board is re-evaluated → repeat,
// until no wins remain. Unlike a cascade/tumble, nothing is removed: the existing symbols ride
// down and N fresh symbols enter from the top. Reels with N=0 stay put; each reel moves
// independently by its own N.
//
// Presentation only — the caller supplies each step's per-reel shift vector and the post-shift
// board. Fits classic fixed-line grids (5×3, 5×4, 5×5, …), not ways/cluster.

import { Container } from 'pixi.js';
import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import { SymbolCell, type CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import {
  DEFAULT_REEL_CONFIG,
  type CascadeConfig,
  type WinConfig,
} from '../config/ReelSystemConfig';

export interface ReelStepData {
  /** Cells that won on the current board — highlighted/paid before the shift. */
  winningCells: { col: number; row: number }[];
  /** How far to scroll each reel down (length = cols). 0 = the reel stays put. */
  shifts: number[];
  /** Board after every reel has scrolled down by shifts[col]. */
  settledGrid: CellData[][];
}

/**
 * PURE: lay out one reel's scroll tape (top→bottom). The `shift` fresh symbols (the top of the
 * settled reel) stack above the reel's current symbols; the tape starts `shift` cells high so the
 * current symbols fill the window, then slides down by `shift` to reveal the fresh ones. `shift` is
 * clamped to the visible window height. Returns the stacked cells and the start offset (in cells,
 * relative to row 0) the tape animates from.
 */
export function buildReelStepTape(
  before: CellData[],
  settledCol: CellData[],
  shift: number,
): { stack: CellData[]; shift: number; startOffsetCells: number } {
  const rows = before.length;
  const s = Math.max(0, Math.min(shift, rows));
  const incoming = Array.from({ length: s }, (_, i) => settledCol[i] ?? { symbol: null });
  return { stack: [...incoming, ...before], shift: s, startOffsetCells: 0 - s };
}

export class ReelStepController {
  private _grid: ReelGrid;
  private _resolve: SymbolResolver;
  private _cfg: CascadeConfig;
  private _win: WinConfig = DEFAULT_REEL_CONFIG.win;
  private _killed = false;
  private _mult: number;
  private _temp: Container[] = [];
  /** Board the in-flight step settles to — used to snap on skip(). */
  private _pending: CellData[][] | null = null;

  constructor(grid: ReelGrid, resolve: SymbolResolver, cfg: CascadeConfig, win?: WinConfig) {
    this._grid = grid;
    this._resolve = resolve;
    this._cfg = cfg;
    this._mult = cfg.multiplier.start;
    if (win) this._win = win;
  }

  setConfig(cfg: CascadeConfig): void {
    this._cfg = cfg;
  }
  setWin(win: WinConfig): void {
    this._win = win;
  }
  /** Killed, or the grid was torn down underneath us (rebuild mid-chain). */
  private get _dead(): boolean {
    return this._killed || this._grid.destroyed;
  }
  get multiplier(): number {
    return this._mult;
  }
  resetMultiplier(): void {
    this._mult = this._cfg.multiplier.start;
  }

  private advanceMultiplier(): void {
    const m = this._cfg.multiplier;
    if (!m.enabled) return;
    const next = m.mode === 'mul' ? this._mult * m.step : this._mult + m.step;
    this._mult = m.cap != null ? Math.min(next, m.cap) : next;
  }

  /** Run one ReelStep: pay the winning cells, then scroll each reel down by shifts[col]. */
  async step(step: ReelStepData, stepIndex = 0, opts?: { turbo?: boolean }): Promise<void> {
    if (this._grid.destroyed) return;
    this._killed = false;
    this._pending = step.settledGrid;

    // 1. celebrate/pay the winning cells.
    await this._payWins(step, opts);
    if (this._dead) return;

    // No shift → just settle the board (defensive; a real ReelStep always shifts something).
    const hasShift = step.shifts.some((n) => n > 0);
    if (!this._cfg.enabled || !hasShift) {
      this._grid.setGrid(step.settledGrid);
      if (step.winningCells.length) this.advanceMultiplier();
      this._pending = null;
      return;
    }

    // 2. scroll every reel down by its own N (0 = untouched), all reels concurrently.
    const turbo = opts?.turbo ? 0.5 : 1;
    const decel = Math.min(this._cfg.perStepDecelCap, 1 + stepIndex * this._cfg.perStepDecel);
    const f = turbo * decel;
    await Promise.all(
      step.shifts.map((n, col) =>
        n > 0 ? this._scrollReel(col, n, step.settledGrid, f) : Promise.resolve(),
      ),
    );
    if (this._dead) {
      this._cleanupTemp();
      return;
    }

    // 3. normalise + advance multiplier.
    this._grid.setGrid(step.settledGrid);
    this._resetPositions();
    this._cleanupTemp();
    this._pending = null;
    if (step.winningCells.length) this.advanceMultiplier();
  }

  /** Highlight + hold the winning cells, then release them back to rest before the shift. */
  private async _payWins(step: ReelStepData, opts?: { turbo?: boolean }): Promise<void> {
    if (!step.winningCells.length) return;
    const turbo = opts?.turbo ? 0.5 : 1;
    const t = this._cfg.timings;
    const hs = this._win.highlightScale;
    const winSet = new Set(step.winningCells.map((w) => `${w.col}:${w.row}`));
    if (this._cfg.dimNonWinners) this._dim(winSet);
    await Promise.all(
      step.winningCells.map((w) => {
        const cell = this._grid.getCell(w.col, w.row);
        if (this._win.glow) cell.setState({ winning: true });
        return Tween.to(
          cell,
          { 'scale.x': hs, 'scale.y': hs },
          t.highlight * turbo,
          easingByName(this._cfg.easings.highlight),
        );
      }),
    );
    if (this._dead) {
      this._undim();
      return;
    }
    await Tween.delay(t.wait * turbo);
    for (const w of step.winningCells) {
      const cell = this._grid.getCell(w.col, w.row);
      cell.setState({});
      cell.scale.set(1);
    }
    this._undim();
  }

  /**
   * Scroll one reel down by `n` positions. A tape carrying the reel's current symbols with `n`
   * fresh symbols stacked on top slides down by `n` cells: the fresh symbols enter from the top,
   * the existing ones ride down, and the bottom `n` ride off below the window. Ends on
   * settledGrid[col]. The tape shares the cells' parent (so the reel mask, if any, clips it).
   */
  private async _scrollReel(
    col: number,
    n: number,
    settledGrid: CellData[][],
    f: number,
  ): Promise<void> {
    const rows = this._grid.rowsOf(col);
    if (rows === 0 || this._dead) return;
    const realCells = Array.from({ length: rows }, (_, r) => this._grid.getCell(col, r));
    const layer = realCells[0].parent ?? this._grid;
    const base = this._grid.cellPosition(col, 0);
    const step =
      rows > 1 ? this._grid.cellPosition(col, 1).y - base.y : this._grid.cellSize(col).height;

    // current visible symbols (top→bottom), captured before we hide them
    const before = realCells.map((c) => ({ ...c.data }));
    const { stack, startOffsetCells } = buildReelStepTape(before, settledGrid[col] ?? [], n);

    // Tape laid out top→bottom at local y = i*step: [incoming(shift)] above [before(rows)].
    const tape = new Container();
    tape.x = base.x;
    for (let i = 0; i < stack.length; i++) {
      const cell = new SymbolCell({ size: this._grid.cellSize(col), resolve: this._resolve });
      cell.setData(stack[i]);
      cell.position.set(0, i * step);
      tape.addChild(cell);
    }
    // Start: the `before` block fills the window; the incoming block sits above it (masked off).
    tape.y = base.y + startOffsetCells * step;
    realCells.forEach((c) => (c.visible = false));
    layer.addChild(tape);
    this._temp.push(tape);

    // Slide down by `shift` positions, with a small overshoot then settle-back.
    const overshoot = step * 0.12;
    await Tween.to(
      tape,
      { y: base.y + overshoot },
      this._cfg.timings.drop * f,
      easingByName(this._cfg.easings.drop),
    );
    if (this._dead) return;
    await Tween.to(
      tape,
      { y: base.y },
      Math.max(90, this._cfg.timings.refill * f),
      easingByName('easeOutQuad'),
    );
    if (this._dead) return;

    // Hand the settled symbols back to the real cells.
    for (let r = 0; r < rows; r++) realCells[r].setData(settledGrid[col]?.[r] ?? { symbol: null });
    realCells.forEach((c) => (c.visible = true));
    tape.destroy();
    this._temp = this._temp.filter((tp) => tp !== tape);
  }

  private _dim(winSet: Set<string>): void {
    for (let c = 0; c < this._grid.cols; c++)
      for (let r = 0; r < this._grid.rowsOf(c); r++)
        if (!winSet.has(`${c}:${r}`)) this._grid.getCell(c, r).alpha = this._cfg.dimAlpha;
  }
  private _undim(): void {
    for (let c = 0; c < this._grid.cols; c++)
      for (let r = 0; r < this._grid.rowsOf(c); r++) {
        const cell = this._grid.getCell(c, r);
        if (cell.alpha !== 0) cell.alpha = 1;
      }
  }
  private _resetPositions(): void {
    if (this._grid.destroyed) return;
    for (let c = 0; c < this._grid.cols; c++)
      for (let r = 0; r < this._grid.rowsOf(c); r++) {
        const cell = this._grid.getCell(c, r);
        const { x, y } = this._grid.cellPosition(c, r);
        cell.position.set(x, y);
        cell.scale.set(1);
        cell.alpha = 1;
        cell.visible = true;
      }
  }
  private _cleanupTemp(): void {
    for (const t of this._temp) if (!t.destroyed) t.destroy();
    this._temp = [];
  }

  /** Hard-cancel: kill tweens, drop tapes, snap to the in-flight step's settled board. */
  skip(): void {
    this._killed = true;
    for (let c = 0; c < this._grid.cols; c++)
      for (let r = 0; r < this._grid.rowsOf(c); r++) Tween.killTweensOf(this._grid.getCell(c, r));
    this._cleanupTemp();
    if (this._pending && !this._grid.destroyed) this._grid.setGrid(this._pending);
    this._pending = null;
    this._resetPositions();
  }
}
