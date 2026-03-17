import { Container } from 'pixi.js';
import type { LayoutStyles } from '@pixi/layout';

// ─── Types ───────────────────────────────────────────────

export type LayoutDirection = 'horizontal' | 'vertical' | 'grid' | 'wrap';
export type LayoutAlignment = 'start' | 'center' | 'end' | 'stretch';
export type LayoutAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface LayoutConfig {
  /** Layout direction (default: 'vertical') */
  direction?: LayoutDirection;

  /** Gap between children in pixels (default: 0) */
  gap?: number;

  /** Padding inside the layout container [top, right, bottom, left] or a single number */
  padding?: number | [number, number, number, number];

  /** Alignment of children on the cross axis (default: 'start') */
  alignment?: LayoutAlignment;

  /** Anchor point determining where the layout is positioned relative to its coordinates */
  anchor?: LayoutAnchor;

  /** Number of columns (only for 'grid' direction) */
  columns?: number;

  /** Maximum width for 'wrap' direction before wrapping to next line */
  maxWidth?: number;

  /** Whether to auto-layout when children change (default: true) */
  autoLayout?: boolean;

  /** Breakpoints: map of max viewport widths to override configs */
  breakpoints?: Record<number, Partial<LayoutConfig>>;
}

// ─── Helpers ─────────────────────────────────────────────

const ALIGNMENT_MAP: Record<LayoutAlignment, LayoutStyles['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

function normalizePadding(
  padding: number | [number, number, number, number],
): [number, number, number, number] {
  if (typeof padding === 'number') return [padding, padding, padding, padding];
  return padding;
}

function directionToFlexStyles(
  direction: LayoutDirection,
  maxWidth: number,
): Partial<LayoutStyles> {
  switch (direction) {
    case 'horizontal':
      return { flexDirection: 'row', flexWrap: 'nowrap' };
    case 'vertical':
      return { flexDirection: 'column', flexWrap: 'nowrap' };
    case 'grid':
      return { flexDirection: 'row', flexWrap: 'wrap' };
    case 'wrap':
      return {
        flexDirection: 'row',
        flexWrap: 'wrap',
        ...(maxWidth < Infinity ? { maxWidth } : {}),
      };
  }
}

function buildLayoutStyles(config: {
  direction: LayoutDirection;
  gap: number;
  alignment: LayoutAlignment;
  columns: number;
  padding: [number, number, number, number];
  maxWidth: number;
}): LayoutStyles {
  const [pt, pr, pb, pl] = config.padding;

  return {
    ...directionToFlexStyles(config.direction, config.maxWidth),
    gap: config.gap,
    alignItems: ALIGNMENT_MAP[config.alignment],
    paddingTop: pt,
    paddingRight: pr,
    paddingBottom: pb,
    paddingLeft: pl,
  };
}

/**
 * Responsive layout container powered by `@pixi/layout` (Yoga flexbox engine).
 *
 * Supports horizontal, vertical, grid, and wrap layout modes with
 * alignment, padding, gap, and viewport-anchor positioning.
 * Breakpoints allow different layouts for different screen sizes.
 *
 * @example
 * ```ts
 * const toolbar = new Layout({
 *   direction: 'horizontal',
 *   gap: 20,
 *   alignment: 'center',
 *   anchor: 'bottom-center',
 *   padding: 16,
 *   breakpoints: {
 *     768: { direction: 'vertical', gap: 10 },
 *   },
 * });
 *
 * toolbar.addItem(spinButton);
 * toolbar.addItem(betLabel);
 * scene.container.addChild(toolbar);
 *
 * toolbar.updateViewport(width, height);
 * ```
 */
export class Layout extends Container {
  private _layoutConfig: Required<Pick<LayoutConfig, 'direction' | 'gap' | 'alignment' | 'autoLayout' | 'columns'>>;
  private _padding: [number, number, number, number];
  private _anchor: LayoutAnchor;
  private _maxWidth: number;
  private _breakpoints: [number, Partial<LayoutConfig>][];
  private _items: Container[] = [];
  private _viewportWidth = 0;
  private _viewportHeight = 0;

  constructor(config: LayoutConfig = {}) {
    super();

    this._layoutConfig = {
      direction: config.direction ?? 'vertical',
      gap: config.gap ?? 0,
      alignment: config.alignment ?? 'start',
      autoLayout: config.autoLayout ?? true,
      columns: config.columns ?? 2,
    };

    this._padding = normalizePadding(config.padding ?? 0);
    this._anchor = config.anchor ?? 'top-left';
    this._maxWidth = config.maxWidth ?? Infinity;

    this._breakpoints = config.breakpoints
      ? Object.entries(config.breakpoints)
          .map(([w, cfg]) => [Number(w), cfg] as [number, Partial<LayoutConfig>])
          .sort((a, b) => a[0] - b[0])
      : [];

    this.applyLayoutStyles();
  }

  /** Add an item to the layout */
  addItem(child: Container): this {
    this._items.push(child);
    this.addChild(child);

    if (this._layoutConfig.direction === 'grid') {
      this.applyGridChildWidth(child);
    }

    return this;
  }

  /** Remove an item from the layout */
  removeItem(child: Container): this {
    const idx = this._items.indexOf(child);
    if (idx !== -1) {
      this._items.splice(idx, 1);
      this.removeChild(child);
    }
    return this;
  }

  /** Remove all items */
  clearItems(): this {
    for (const item of this._items) {
      this.removeChild(item);
    }
    this._items.length = 0;
    return this;
  }

  /** Get all layout items */
  get items(): readonly Container[] {
    return this._items;
  }

  /**
   * Update the viewport size and recalculate layout.
   * Should be called from `Scene.onResize()`.
   */
  updateViewport(width: number, height: number): void {
    this._viewportWidth = width;
    this._viewportHeight = height;
    this.applyLayoutStyles();
    this.applyAnchor();
  }

  private applyLayoutStyles(): void {
    const effective = this.resolveConfig();
    const direction = effective.direction ?? this._layoutConfig.direction;
    const gap = effective.gap ?? this._layoutConfig.gap;
    const alignment = effective.alignment ?? this._layoutConfig.alignment;
    const columns = effective.columns ?? this._layoutConfig.columns;
    const padding = effective.padding !== undefined
      ? normalizePadding(effective.padding)
      : this._padding;
    const maxWidth = effective.maxWidth ?? this._maxWidth;

    const styles = buildLayoutStyles({ direction, gap, alignment, columns, padding, maxWidth });
    this.layout = styles;

    if (direction === 'grid') {
      for (const item of this._items) {
        this.applyGridChildWidth(item);
      }
    }
  }

  private applyGridChildWidth(child: Container): void {
    const effective = this.resolveConfig();
    const columns = effective.columns ?? this._layoutConfig.columns;
    const gap = effective.gap ?? this._layoutConfig.gap;

    // Account for gaps between columns: total gap space = gap * (columns - 1)
    // Each column gets: (100% - total_gap) / columns
    // We use flexBasis + flexGrow to let Yoga handle the math when gap > 0
    const styles: Record<string, unknown> = gap > 0
      ? { flexBasis: 0, flexGrow: 1, flexShrink: 1, maxWidth: `${(100 / columns).toFixed(2)}%` }
      : { width: `${(100 / columns).toFixed(2)}%` };

    if (child._layout) {
      child._layout.setStyle(styles);
    } else {
      child.layout = styles;
    }
  }

  private applyAnchor(): void {
    const anchor = this.resolveConfig().anchor ?? this._anchor;
    if (this._viewportWidth === 0 || this._viewportHeight === 0) return;

    const bounds = this.getLocalBounds();
    const contentW = bounds.width * this.scale.x;
    const contentH = bounds.height * this.scale.y;
    const vw = this._viewportWidth;
    const vh = this._viewportHeight;

    let anchorX = 0;
    let anchorY = 0;

    if (anchor.includes('left')) {
      anchorX = 0;
    } else if (anchor.includes('right')) {
      anchorX = vw - contentW;
    } else {
      anchorX = (vw - contentW) / 2;
    }

    if (anchor.startsWith('top')) {
      anchorY = 0;
    } else if (anchor.startsWith('bottom')) {
      anchorY = vh - contentH;
    } else {
      anchorY = (vh - contentH) / 2;
    }

    this.x = anchorX - bounds.x * this.scale.x;
    this.y = anchorY - bounds.y * this.scale.y;
  }

  private resolveConfig(): Partial<LayoutConfig> {
    if (this._breakpoints.length === 0 || this._viewportWidth === 0) {
      return {};
    }

    for (const [maxWidth, overrides] of this._breakpoints) {
      if (this._viewportWidth <= maxWidth) {
        return overrides;
      }
    }
    return {};
  }
}
