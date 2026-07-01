import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { SymbolCell, type CellData, type CellFrameStyle } from './SymbolCell';
import type { SymbolResolver } from './SymbolView';
import {
  resolveGeometry,
  cellPositionOf,
  type CellSizeSpec,
  type ResolvedGeometry,
} from './geometry';

export interface DecorationConfig {
  texture?: Texture;
  padding?: number;
}
export interface ReelGridConfig {
  cols: number;
  /** Uniform row count. Ignored per-reel when `rowsPerReel` is provided. */
  rows: number;
  /** Per-reel row counts for Megaways / variable-height reels. Length must equal `cols`. */
  rowsPerReel?: number[];
  /** Square cell size (shorthand: same width & height, all reels). */
  cellSize: number;
  /** Rectangular cells, uniform across reels. Override `cellSize` when set. */
  cellWidth?: number;
  cellHeight?: number;
  /** Per-strip cell size (square scalar or {width,height}). */
  cellSizePerReel?: CellSizeSpec[];
  /** Uniform gap (shorthand for both axes). */
  gap?: number;
  /** Horizontal gap between adjacent reels. Scalar, or per-boundary (length cols-1). */
  colGap?: number | number[];
  /** Vertical gap between rows. Scalar, or per-reel (length cols). */
  rowGap?: number | number[];
  resolve: SymbolResolver;
  frameStyle?: CellFrameStyle;
  decoration?: DecorationConfig;
  mask?: boolean;
}

/**
 * A grid of `SymbolCell`s. Supports uniform grids, variable-height reels (Megaways), and
 * rectangular / per-strip cell sizes with per-strip gaps. All layout flows through a single
 * resolved geometry (see grid/geometry.ts); every consumer reads positions via `cellPosition`
 * and dimensions via `cellSize(col)` rather than assuming a square cell.
 */
export class ReelGrid extends Container {
  readonly __uiComponent = true as const;

  private _cfg: ReelGridConfig;
  private _geom: ResolvedGeometry;
  private _cells: SymbolCell[][] = [];
  private _cellLayer = new Container();
  private _resolve: SymbolResolver;
  private _frameStyle?: CellFrameStyle;
  private _mask: Graphics | null = null;

  constructor(config: ReelGridConfig) {
    super();
    this._cfg = { ...config };
    this._resolve = config.resolve;
    this._frameStyle = config.frameStyle;
    this._geom = resolveGeometry(config);

    if (config.decoration?.texture) {
      const pad = config.decoration.padding ?? 0;
      const deco = new Sprite(config.decoration.texture);
      deco.width = this._geom.gridW + pad * 2;
      deco.height = this._geom.gridH + pad * 2;
      deco.position.set(this._geom.leftX - pad, this._geom.topY - pad);
      this.addChild(deco);
    }

    this.addChild(this._cellLayer);
    this._buildCells();

    if (config.mask) this._applyMask();
  }

  private get _cols(): number {
    return this._geom.cols;
  }
  private get _rowsPerReel(): number[] {
    return this._geom.rowsPerReel;
  }

  private _buildCells(): void {
    for (let c = 0; c < this._cols; c++) {
      this._cells[c] = [];
      for (let r = 0; r < this._rowsPerReel[c]; r++) {
        const cell = new SymbolCell({
          size: this.cellSize(c),
          resolve: this._resolve,
          frameStyle: this._frameStyle,
        });
        const { x, y } = this.cellPosition(c, r);
        cell.position.set(x, y);
        this._cellLayer.addChild(cell);
        this._cells[c][r] = cell;
      }
    }
  }

  /** Per-strip mask: one window per reel sized to that reel's own cell width × column height. */
  private _applyMask(): void {
    const g = this._geom;
    const m = new Graphics();
    for (let c = 0; c < this._cols; c++) {
      const rows = this._rowsPerReel[c];
      const w = g.cellW[c];
      const h = rows * g.cellH[c] + Math.max(0, rows - 1) * g.rowGap[c];
      const x = g.colX[c] - w / 2;
      const y = g.yOff[c] - g.cellH[c] / 2;
      m.rect(x, y, w, h);
    }
    m.fill(0xffffff);
    this._cellLayer.mask = m;
    this.addChild(m);
    this._mask = m;
  }

  get cols(): number {
    return this._cols;
  }
  /** Tallest reel's row count (the grid's visual height in rows). */
  get rows(): number {
    return this._geom.maxRows;
  }
  /** Cell dimensions (px) for a reel. Rectangular / per-strip aware. */
  cellSize(col: number): { width: number; height: number } {
    return { width: this._geom.cellW[col] ?? 0, height: this._geom.cellH[col] ?? 0 };
  }
  /** The fully-resolved grid geometry (read-only view). */
  get geometry(): ResolvedGeometry {
    return this._geom;
  }
  rowsOf(col: number): number {
    return this._rowsPerReel[col] ?? 0;
  }
  get rowsPerReel(): number[] {
    return this._rowsPerReel.slice();
  }

  /** Cell centre position. Variable-height reels are centred about a shared centre line. */
  cellPosition(col: number, row: number): { x: number; y: number } {
    return cellPositionOf(this._geom, col, row);
  }

  /** Grid bounding-box centre in local coords. */
  center(): { x: number; y: number } {
    return { x: this._geom.centerX, y: this._geom.centerY };
  }

  getCell(col: number, row: number): SymbolCell {
    return this._cells[col][row];
  }

  setGrid(cells: CellData[][]): void {
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rowsPerReel[c]; r++) {
        this._cells[c]?.[r]?.setData(cells[c]?.[r] ?? { symbol: null });
      }
    }
  }

  /** Rebuild the grid with new per-reel row counts (Megaways re-roll / dynamic rows). */
  reshape(rowsPerReel: number[]): void {
    if (rowsPerReel.length !== this._cols) return;
    this._cellLayer.removeChildren().forEach((c) => c.destroy());
    this._cells = [];
    this._cfg = { ...this._cfg, rowsPerReel: rowsPerReel.slice() };
    this._geom = resolveGeometry(this._cfg);
    this._buildCells();
    if (this._mask) {
      this._mask.destroy();
      this.removeChild(this._mask);
      this._mask = null;
      this._applyMask();
    }
  }

  /**
   * Re-resolve geometry after a base cell-size change and reposition cells. Accepts a square
   * scalar (updates `cellSize`) or explicit `{width,height}`. Per-strip overrides still apply.
   * (Cell frames are not re-drawn here — a geometry change routes through a full rebuild upstream.)
   */
  resize(size: number | { width: number; height: number }): void {
    if (typeof size === 'number') {
      this._cfg = { ...this._cfg, cellSize: size, cellWidth: undefined, cellHeight: undefined };
    } else {
      this._cfg = { ...this._cfg, cellWidth: size.width, cellHeight: size.height };
    }
    this._geom = resolveGeometry(this._cfg);
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rowsPerReel[c]; r++) {
        const { x, y } = this.cellPosition(c, r);
        this._cells[c][r].position.set(x, y);
      }
    }
  }
}
