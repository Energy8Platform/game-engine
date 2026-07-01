import { Container, Graphics, Text } from 'pixi.js';
import { Tween, Easing } from '../../animation';
import type { SymbolResolver, SymbolView } from './SymbolView';

export interface CellFrameStyle {
  radius?: number;
  idle?: { color: number; alpha: number };
  winning?: { color: number; alpha: number };
  removed?: { color: number; alpha: number };
  fresh?: { color: number; alpha: number };
}
export interface CellData {
  symbol: string | null;
  multiplier?: number;
  bonus?: number;
  sticky?: { remaining: number };
}
export interface CellState {
  winning?: boolean;
  removed?: boolean;
  fresh?: boolean;
}
export interface SymbolCellConfig {
  /** Square scalar or rectangular cell size in px. */
  size: number | { width: number; height: number };
  resolve: SymbolResolver;
  frameStyle?: CellFrameStyle;
}

const DEFAULT_STYLE: Required<CellFrameStyle> = {
  radius: 8,
  idle: { color: 0x223047, alpha: 0.34 },
  winning: { color: 0x00d4ff, alpha: 0.95 },
  removed: { color: 0x223047, alpha: 0.12 },
  fresh: { color: 0xffffff, alpha: 0.6 },
};

const cellDims = (size: number | { width: number; height: number }) =>
  typeof size === 'number' ? { width: size, height: size } : size;

export class SymbolCell extends Container {
  readonly __uiComponent = true as const;

  private _w: number;
  private _h: number;
  private _resolve: SymbolResolver;
  private _style: Required<CellFrameStyle>;
  private _frame: Graphics;
  private _view: SymbolView | null = null;
  private _badges = new Container();
  private _multBadge: Container | null = null;
  private _bonusBadge: Container | null = null;
  /** Last applied state key — exposed for tests/inspection. */
  frameStyleKey: 'idle' | 'winning' | 'removed' | 'fresh' = 'idle';

  constructor(config: SymbolCellConfig) {
    super();
    const { width, height } = cellDims(config.size);
    this._w = width;
    this._h = height;
    this._resolve = config.resolve;
    this._style = { ...DEFAULT_STYLE, ...(config.frameStyle ?? {}) } as Required<CellFrameStyle>;
    this._frame = new Graphics();
    this.addChild(this._frame);
    this.addChild(this._badges);
    this._drawFrame('idle');
  }

  get view(): SymbolView | null {
    return this._view;
  }

  setData(data: CellData): void {
    if (this.destroyed) return; // a killed-tween chain may resume after the cell is gone
    // symbol view
    if (data.symbol == null) {
      if (this._view) {
        this._view.destroy();
        this._view = null;
      }
    } else {
      if (this._view) {
        this._view.destroy();
        this._view = null;
      }
      const v = this._resolve(data.symbol);
      if (v) {
        v.resize?.({ width: this._w, height: this._h });
        this.addChildAt(v, 1); // above frame, below badges
        this._view = v;
      }
    }
    // badges
    this._setMultiplier(data.multiplier);
    this._setBonus(data.bonus);
  }

  setState(state: CellState): void {
    if (this.destroyed) return;
    const key = state.winning
      ? 'winning'
      : state.removed
        ? 'removed'
        : state.fresh
          ? 'fresh'
          : 'idle';
    this.frameStyleKey = key;
    this._drawFrame(key);
  }

  playWin(): Promise<void> {
    if (this._view?.playWin) return this._view.playWin();
    // default: scale pop
    const target = this._view ?? this;
    return Tween.to(target, { 'scale.x': 1.15, 'scale.y': 1.15 }, 160, Easing.easeOutBack).then(
      () => Tween.to(target, { 'scale.x': 1, 'scale.y': 1 }, 140, Easing.easeOutQuad),
    );
  }

  playIdle(): void {
    this._view?.playIdle?.();
  }

  hasBadge(kind: 'multiplier' | 'bonus'): boolean {
    return kind === 'multiplier' ? this._multBadge != null : this._bonusBadge != null;
  }

  private _drawFrame(key: 'idle' | 'winning' | 'removed' | 'fresh'): void {
    if (this.destroyed || this._frame.destroyed) return;
    const s = this._style[key];
    this._frame.clear();
    this._frame
      .roundRect(-this._w / 2, -this._h / 2, this._w, this._h, this._style.radius)
      .fill({ color: s.color, alpha: s.alpha });
    // store the colour as tint for cheap inspection/testing
    this._frame.tint = s.color;
  }

  private _setMultiplier(value?: number): void {
    if (this._multBadge) {
      this._multBadge.destroy();
      this._multBadge = null;
    }
    if (!value || value <= 1) return;
    this._multBadge = this._badge(`×${value}`, 0xffd24a);
    this._multBadge.position.set(this._w / 2 - 12, -this._h / 2 + 12);
    this._badges.addChild(this._multBadge);
  }

  private _setBonus(value?: number): void {
    if (this._bonusBadge) {
      this._bonusBadge.destroy();
      this._bonusBadge = null;
    }
    if (!value || value <= 0) return;
    this._bonusBadge = this._badge(`+${value}`, 0x7ad7ff);
    this._bonusBadge.position.set(-this._w / 2 + 12, -this._h / 2 + 12);
    this._badges.addChild(this._bonusBadge);
  }

  private _badge(label: string, color: number): Container {
    const c = new Container();
    const t = new Text({ text: label, style: { fontSize: 18, fill: color, fontWeight: '700' } });
    t.anchor.set(0.5);
    c.addChild(t);
    return c;
  }
}
