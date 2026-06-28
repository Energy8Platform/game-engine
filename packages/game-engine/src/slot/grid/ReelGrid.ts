import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { SymbolCell, type CellData, type CellFrameStyle } from './SymbolCell';
import type { SymbolResolver } from './SymbolView';

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
  cellSize: number;
  gap?: number;
  resolve: SymbolResolver;
  frameStyle?: CellFrameStyle;
  decoration?: DecorationConfig;
  mask?: boolean;
}

/**
 * A grid of `SymbolCell`s. Supports uniform grids and variable-height reels (Megaways):
 * when `rowsPerReel` is set each reel is vertically centred inside the tallest reel's envelope.
 */
export class ReelGrid extends Container {
  readonly __uiComponent = true as const;

  private _cols: number;
  private _rowsPerReel: number[];
  private _maxRows: number;
  private _cellSize: number;
  private _gap: number;
  private _cells: SymbolCell[][] = [];
  private _cellLayer = new Container();
  private _resolve: SymbolResolver;
  private _frameStyle?: CellFrameStyle;
  private _mask: Graphics | null = null;

  constructor(config: ReelGridConfig) {
    super();
    this._cols = config.cols;
    this._rowsPerReel =
      config.rowsPerReel && config.rowsPerReel.length === config.cols
        ? config.rowsPerReel.slice()
        : Array.from({ length: config.cols }, () => config.rows);
    this._maxRows = Math.max(1, ...this._rowsPerReel);
    this._cellSize = config.cellSize;
    this._gap = config.gap ?? 0;
    this._resolve = config.resolve;
    this._frameStyle = config.frameStyle;

    if (config.decoration) {
      const pad = config.decoration.padding ?? 0;
      const w = this._cols * (this._cellSize + this._gap) - this._gap + pad * 2;
      const h = this._maxRows * (this._cellSize + this._gap) - this._gap + pad * 2;
      if (config.decoration.texture) {
        const deco = new Sprite(config.decoration.texture);
        deco.width = w;
        deco.height = h;
        deco.position.set(-pad - this._cellSize / 2, -pad - this._cellSize / 2);
        this.addChild(deco);
      }
    }

    this.addChild(this._cellLayer);
    this._buildCells();

    if (config.mask) this._applyMask();
  }

  private _buildCells(): void {
    for (let c = 0; c < this._cols; c++) {
      this._cells[c] = [];
      for (let r = 0; r < this._rowsPerReel[c]; r++) {
        const cell = new SymbolCell({
          size: this._cellSize,
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

  private _applyMask(): void {
    const w = this._cols * (this._cellSize + this._gap) - this._gap;
    const h = this._maxRows * (this._cellSize + this._gap) - this._gap;
    const m = new Graphics().rect(-this._cellSize / 2, -this._cellSize / 2, w, h).fill(0xffffff);
    this._cellLayer.mask = m;
    this.addChild(m);
    this._mask = m;
  }

  get cols(): number {
    return this._cols;
  }
  /** Tallest reel's row count (the grid's visual height in rows). */
  get rows(): number {
    return this._maxRows;
  }
  get cellSize(): number {
    return this._cellSize;
  }
  rowsOf(col: number): number {
    return this._rowsPerReel[col] ?? 0;
  }
  get rowsPerReel(): number[] {
    return this._rowsPerReel.slice();
  }

  /** Cell centre position. Variable-height reels are centred in the max-rows envelope. */
  cellPosition(col: number, row: number): { x: number; y: number } {
    const step = this._cellSize + this._gap;
    const reelRows = this._rowsPerReel[col] ?? this._maxRows;
    const yOffset = ((this._maxRows - reelRows) / 2) * step;
    return { x: col * step, y: yOffset + row * step };
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
    this._rowsPerReel = rowsPerReel.slice();
    this._maxRows = Math.max(1, ...this._rowsPerReel);
    this._buildCells();
    if (this._mask) {
      this._mask.destroy();
      this.removeChild(this._mask);
      this._mask = null;
      this._applyMask();
    }
  }

  resize(cellSize: number): void {
    this._cellSize = cellSize;
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rowsPerReel[c]; r++) {
        const { x, y } = this.cellPosition(c, r);
        this._cells[c][r].position.set(x, y);
      }
    }
  }
}
