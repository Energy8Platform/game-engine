import { Container } from 'pixi.js';

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

/**
 * Responsive layout container that automatically arranges its children.
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
 * // On resize, update layout position relative to viewport
 * toolbar.updateViewport(width, height);
 * ```
 */
export class Layout extends Container {
  private _config: Required<Pick<LayoutConfig, 'direction' | 'gap' | 'alignment' | 'autoLayout' | 'columns'>>;
  private _padding: [number, number, number, number];
  private _anchor: LayoutAnchor;
  private _maxWidth: number;
  private _breakpoints: [number, Partial<LayoutConfig>][];
  private _content: Container;
  private _items: Container[] = [];
  private _viewportWidth = 0;
  private _viewportHeight = 0;

  constructor(config: LayoutConfig = {}) {
    super();

    this._config = {
      direction: config.direction ?? 'vertical',
      gap: config.gap ?? 0,
      alignment: config.alignment ?? 'start',
      autoLayout: config.autoLayout ?? true,
      columns: config.columns ?? 2,
    };

    this._padding = Layout.normalizePadding(config.padding ?? 0);
    this._anchor = config.anchor ?? 'top-left';
    this._maxWidth = config.maxWidth ?? Infinity;

    // Sort breakpoints by width ascending for correct resolution
    this._breakpoints = config.breakpoints
      ? Object.entries(config.breakpoints)
          .map(([w, cfg]) => [Number(w), cfg] as [number, Partial<LayoutConfig>])
          .sort((a, b) => a[0] - b[0])
      : [];

    this._content = new Container();
    this.addChild(this._content);
  }

  /** Add an item to the layout */
  addItem(child: Container): this {
    this._items.push(child);
    this._content.addChild(child);
    if (this._config.autoLayout) this.layout();
    return this;
  }

  /** Remove an item from the layout */
  removeItem(child: Container): this {
    const idx = this._items.indexOf(child);
    if (idx !== -1) {
      this._items.splice(idx, 1);
      this._content.removeChild(child);
      if (this._config.autoLayout) this.layout();
    }
    return this;
  }

  /** Remove all items */
  clearItems(): this {
    for (const item of this._items) {
      this._content.removeChild(item);
    }
    this._items.length = 0;
    if (this._config.autoLayout) this.layout();
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
    this.layout();
  }

  /**
   * Recalculate layout positions of all children.
   */
  layout(): void {
    if (this._items.length === 0) return;

    // Resolve effective config (apply breakpoint overrides)
    const effective = this.resolveConfig();
    const gap = effective.gap ?? this._config.gap;
    const direction = effective.direction ?? this._config.direction;
    const alignment = effective.alignment ?? this._config.alignment;
    const columns = effective.columns ?? this._config.columns;
    const padding = effective.padding !== undefined
      ? Layout.normalizePadding(effective.padding)
      : this._padding;
    const maxWidth = effective.maxWidth ?? this._maxWidth;

    const [pt, pr, pb, pl] = padding;

    switch (direction) {
      case 'horizontal':
        this.layoutLinear('x', 'y', gap, alignment, pl, pt);
        break;
      case 'vertical':
        this.layoutLinear('y', 'x', gap, alignment, pt, pl);
        break;
      case 'grid':
        this.layoutGrid(columns, gap, alignment, pl, pt);
        break;
      case 'wrap':
        this.layoutWrap(maxWidth - pl - pr, gap, alignment, pl, pt);
        break;
    }

    // Apply anchor positioning relative to viewport
    this.applyAnchor(effective.anchor ?? this._anchor);
  }

  // ─── Private layout helpers ────────────────────────────

  private layoutLinear(
    mainAxis: 'x' | 'y',
    crossAxis: 'x' | 'y',
    gap: number,
    alignment: LayoutAlignment,
    mainOffset: number,
    crossOffset: number,
  ): void {
    let pos = mainOffset;
    const sizes = this._items.map(item => this.getItemSize(item));
    const maxCross = Math.max(...sizes.map(s => (crossAxis === 'x' ? s.width : s.height)));

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      const size = sizes[i];

      item[mainAxis] = pos;

      // Cross-axis alignment
      const itemCross = crossAxis === 'x' ? size.width : size.height;
      switch (alignment) {
        case 'start':
          item[crossAxis] = crossOffset;
          break;
        case 'center':
          item[crossAxis] = crossOffset + (maxCross - itemCross) / 2;
          break;
        case 'end':
          item[crossAxis] = crossOffset + maxCross - itemCross;
          break;
        case 'stretch':
          item[crossAxis] = crossOffset;
          // Note: stretch doesn't resize children — that's up to the item
          break;
      }

      const mainSize = mainAxis === 'x' ? size.width : size.height;
      pos += mainSize + gap;
    }
  }

  private layoutGrid(
    columns: number,
    gap: number,
    alignment: LayoutAlignment,
    offsetX: number,
    offsetY: number,
  ): void {
    const sizes = this._items.map(item => this.getItemSize(item));
    const maxItemWidth = Math.max(...sizes.map(s => s.width));
    const maxItemHeight = Math.max(...sizes.map(s => s.height));
    const cellW = maxItemWidth + gap;
    const cellH = maxItemHeight + gap;

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      const col = i % columns;
      const row = Math.floor(i / columns);
      const size = sizes[i];

      // X alignment within cell
      switch (alignment) {
        case 'center':
          item.x = offsetX + col * cellW + (maxItemWidth - size.width) / 2;
          break;
        case 'end':
          item.x = offsetX + col * cellW + maxItemWidth - size.width;
          break;
        default:
          item.x = offsetX + col * cellW;
      }

      item.y = offsetY + row * cellH;
    }
  }

  private layoutWrap(
    maxWidth: number,
    gap: number,
    alignment: LayoutAlignment,
    offsetX: number,
    offsetY: number,
  ): void {
    let x = offsetX;
    let y = offsetY;
    let rowHeight = 0;
    const sizes = this._items.map(item => this.getItemSize(item));

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      const size = sizes[i];

      // Check if item fits in current row
      if (x + size.width > maxWidth + offsetX && x > offsetX) {
        // Wrap to next row
        x = offsetX;
        y += rowHeight + gap;
        rowHeight = 0;
      }

      item.x = x;
      item.y = y;

      x += size.width + gap;
      rowHeight = Math.max(rowHeight, size.height);
    }
  }

  private applyAnchor(anchor: LayoutAnchor): void {
    if (this._viewportWidth === 0 || this._viewportHeight === 0) return;

    const bounds = this._content.getBounds();
    const contentW = bounds.width;
    const contentH = bounds.height;
    const vw = this._viewportWidth;
    const vh = this._viewportHeight;

    let anchorX = 0;
    let anchorY = 0;

    // Horizontal
    if (anchor.includes('left')) {
      anchorX = 0;
    } else if (anchor.includes('right')) {
      anchorX = vw - contentW;
    } else {
      // center
      anchorX = (vw - contentW) / 2;
    }

    // Vertical
    if (anchor.startsWith('top')) {
      anchorY = 0;
    } else if (anchor.startsWith('bottom')) {
      anchorY = vh - contentH;
    } else {
      // center
      anchorY = (vh - contentH) / 2;
    }

    // Compensate for content's local bounds offset
    this.x = anchorX - bounds.x;
    this.y = anchorY - bounds.y;
  }

  private resolveConfig(): Partial<LayoutConfig> {
    if (this._breakpoints.length === 0 || this._viewportWidth === 0) {
      return {};
    }

    // Find the largest breakpoint that's ≤ current viewport width
    let resolved: Partial<LayoutConfig> = {};
    for (const [maxWidth, overrides] of this._breakpoints) {
      if (this._viewportWidth <= maxWidth) {
        resolved = overrides;
        break;
      }
    }
    return resolved;
  }

  private getItemSize(item: Container): { width: number; height: number } {
    const bounds = item.getBounds();
    return { width: bounds.width, height: bounds.height };
  }

  private static normalizePadding(
    padding: number | [number, number, number, number],
  ): [number, number, number, number] {
    if (typeof padding === 'number') {
      return [padding, padding, padding, padding];
    }
    return padding;
  }
}
