// packages/game-engine/src/slot/cascade/TumbleController.ts
//
// Richer cascade/tumble than the back-compat CascadeController: animates surviving symbols
// sliding into the gaps (gravity), supports per-step deceleration (tension build), dimming of
// non-winning symbols, and a running win multiplier (Pragmatic Tumble / NetEnt Avalanche style).
//
// Presentation only — the settled board is provided by the caller.

import { Tween } from '../../animation';
import { easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import {
  DEFAULT_REEL_CONFIG,
  type CascadeConfig,
  type WinConfig,
} from '../config/ReelSystemConfig';

export interface TumbleStep {
  winningCells: { col: number; row: number }[];
  removedCells: { col: number; row: number }[];
  /** Optional explicit survivor slides (col, fromRow→toRow). When omitted, gravity is derived. */
  drops?: { col: number; fromRow: number; toRow: number }[];
  newCells: { col: number; row: number; symbol: string }[];
  settledGrid: CellData[][];
}

export class TumbleController {
  private _grid: ReelGrid;
  private _cfg: CascadeConfig;
  private _win: WinConfig = DEFAULT_REEL_CONFIG.win;
  private _killed = false;
  private _mult: number;

  constructor(grid: ReelGrid, cfg: CascadeConfig, win?: WinConfig) {
    this._grid = grid;
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
  /** Killed, or the grid was torn down underneath us (rebuild during a cascade). */
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

  /** Derive survivor slides for one column when explicit drops aren't supplied. */
  private deriveDrops(step: TumbleStep): { col: number; fromRow: number; toRow: number }[] {
    const removedByCol = new Map<number, Set<number>>();
    for (const r of step.removedCells) {
      if (!removedByCol.has(r.col)) removedByCol.set(r.col, new Set());
      removedByCol.get(r.col)!.add(r.row);
    }
    const out: { col: number; fromRow: number; toRow: number }[] = [];
    for (const [col, removed] of removedByCol) {
      const rows = this._grid.rowsOf(col);
      // survivors keep order and fall to the bottom; count holes below each survivor
      const survivors: number[] = [];
      for (let r = 0; r < rows; r++) if (!removed.has(r)) survivors.push(r);
      const newCount = rows - survivors.length;
      survivors.forEach((fromRow, i) => {
        const toRow = newCount + i;
        if (toRow !== fromRow) out.push({ col, fromRow, toRow });
      });
    }
    return out;
  }

  /** Run a single cascade step. `stepIndex` drives per-step deceleration. */
  async step(step: TumbleStep, stepIndex = 0, opts?: { turbo?: boolean }): Promise<void> {
    if (this._grid.destroyed) return;
    if (!this._cfg.enabled) {
      this._grid.setGrid(step.settledGrid);
      return;
    }
    this._killed = false;
    const turbo = opts?.turbo ? 0.5 : 1;
    const decel = Math.min(this._cfg.perStepDecelCap, 1 + stepIndex * this._cfg.perStepDecel);
    const f = turbo * decel;
    const t = this._cfg.timings;

    // 1. highlight winners (+ dim others). win.highlightScale / win.glow drive the pop.
    const winSet = new Set(step.winningCells.map((w) => `${w.col}:${w.row}`));
    const dimmed = this._cfg.dimNonWinners && step.winningCells.length > 0;
    if (dimmed) this._dim(winSet);
    const hs = this._win.highlightScale;
    await Promise.all(
      step.winningCells.map((w) => {
        const cell = this._grid.getCell(w.col, w.row);
        if (this._win.glow) cell.setState({ winning: true });
        return Tween.to(
          cell,
          { 'scale.x': hs, 'scale.y': hs },
          t.highlight * f,
          easingByName(this._cfg.easings.highlight),
        );
      }),
    );
    if (this._dead) {
      if (dimmed) this._undim();
      return;
    }
    await Tween.delay(t.wait * f);

    // 2. remove the cleared cells (removedCells, falling back to winningCells)
    const cleared = step.removedCells.length ? step.removedCells : step.winningCells;
    await Promise.all(
      cleared.map((w) => {
        const cell = this._grid.getCell(w.col, w.row);
        return Tween.to(
          cell,
          { 'scale.x': 0, 'scale.y': 0, alpha: 0 },
          t.remove * f,
          easingByName(this._cfg.easings.remove),
        );
      }),
    );
    if (this._dead) {
      if (dimmed) this._undim();
      return;
    }
    for (const w of cleared) {
      const cell = this._grid.getCell(w.col, w.row);
      cell.setData({ symbol: null });
      cell.setState({});
      cell.scale.set(1);
      cell.alpha = 1;
    }
    this._undim();

    // 3. gravity: survivors slide down, new cells drop from above
    const rowStep = this._grid.cellPosition(0, 1).y - this._grid.cellPosition(0, 0).y;
    const slides = this._cfg.gravity ? (step.drops ?? this.deriveDrops(step)) : [];
    const anims: Promise<void>[] = [];

    for (const d of slides) {
      const cell = this._grid.getCell(d.col, d.toRow);
      const home = this._grid.cellPosition(d.col, d.toRow);
      cell.setData(step.settledGrid[d.col]?.[d.toRow] ?? { symbol: null });
      cell.alpha = 1;
      cell.scale.set(1);
      cell.position.set(home.x, this._grid.cellPosition(d.col, d.fromRow).y);
      anims.push(
        Tween.to(cell, { 'position.y': home.y }, t.drop * f, easingByName(this._cfg.easings.drop)),
      );
    }

    const perCol: Record<number, number> = {};
    for (const n of step.newCells) {
      const cell = this._grid.getCell(n.col, n.row);
      const home = this._grid.cellPosition(n.col, n.row);
      cell.setData({ symbol: n.symbol });
      cell.setState({ fresh: true });
      cell.alpha = 1;
      cell.scale.set(1);
      cell.position.set(home.x, home.y - rowStep * (this._grid.rowsOf(n.col) + 1));
      const idx = (perCol[n.col] = (perCol[n.col] ?? 0) + 1);
      anims.push(
        (async () => {
          await Tween.delay(idx * 28 * f);
          if (this._dead) return;
          await Tween.to(
            cell,
            { 'position.y': home.y },
            t.refill * f,
            easingByName(this._cfg.easings.drop),
          );
          cell.setState({});
        })(),
      );
    }
    await Promise.all(anims);
    if (this._dead) return;

    // 4. normalise + advance multiplier
    this._grid.setGrid(step.settledGrid);
    this._resetPositions();
    if (step.winningCells.length) this.advanceMultiplier();
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
      }
  }

  skip(): void {
    this._killed = true;
    for (let c = 0; c < this._grid.cols; c++)
      for (let r = 0; r < this._grid.rowsOf(c); r++) Tween.killTweensOf(this._grid.getCell(c, r));
    this._resetPositions();
  }
}
