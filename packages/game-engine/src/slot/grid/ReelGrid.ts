import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { SymbolCell, type CellData, type CellFrameStyle } from './SymbolCell';
import type { SymbolResolver } from './SymbolView';

export interface DecorationConfig { texture?: Texture; padding?: number; }
export interface ReelGridConfig {
  cols: number; rows: number; cellSize: number; gap?: number;
  resolve: SymbolResolver; frameStyle?: CellFrameStyle;
  decoration?: DecorationConfig;
  mask?: boolean;
}

export class ReelGrid extends Container {
  readonly __uiComponent = true as const;

  private _cols: number;
  private _rows: number;
  private _cellSize: number;
  private _gap: number;
  private _cells: SymbolCell[][] = [];
  private _cellLayer = new Container();

  constructor(config: ReelGridConfig) {
    super();
    this._cols = config.cols;
    this._rows = config.rows;
    this._cellSize = config.cellSize;
    this._gap = config.gap ?? 0;

    if (config.decoration) {
      const pad = config.decoration.padding ?? 0;
      const w = this._cols * (this._cellSize + this._gap) - this._gap + pad * 2;
      const h = this._rows * (this._cellSize + this._gap) - this._gap + pad * 2;
      if (config.decoration.texture) {
        const deco = new Sprite(config.decoration.texture);
        deco.width = w; deco.height = h; deco.position.set(-pad - this._cellSize / 2, -pad - this._cellSize / 2);
        this.addChild(deco);
      }
    }

    this.addChild(this._cellLayer);

    for (let c = 0; c < this._cols; c++) {
      this._cells[c] = [];
      for (let r = 0; r < this._rows; r++) {
        const cell = new SymbolCell({ size: this._cellSize, resolve: config.resolve, frameStyle: config.frameStyle });
        const { x, y } = this.cellPosition(c, r);
        cell.position.set(x, y);
        this._cellLayer.addChild(cell);
        this._cells[c][r] = cell;
      }
    }

    if (config.mask) {
      const w = this._cols * (this._cellSize + this._gap) - this._gap;
      const h = this._rows * (this._cellSize + this._gap) - this._gap;
      const m = new Graphics()
        .rect(-this._cellSize / 2, -this._cellSize / 2, w, h)
        .fill(0xffffff);
      this._cellLayer.mask = m;
      this.addChild(m);
    }
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  cellPosition(col: number, row: number): { x: number; y: number } {
    const step = this._cellSize + this._gap;
    return { x: col * step, y: row * step };
  }

  getCell(col: number, row: number): SymbolCell { return this._cells[col][row]; }

  setGrid(cells: CellData[][]): void {
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rows; r++) {
        this._cells[c]?.[r]?.setData(cells[c]?.[r] ?? { symbol: null });
      }
    }
  }

  resize(cellSize: number): void {
    this._cellSize = cellSize;
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rows; r++) {
        const { x, y } = this.cellPosition(c, r);
        this._cells[c][r].position.set(x, y);
      }
    }
  }
}
