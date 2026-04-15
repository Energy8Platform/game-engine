import { Container } from 'pixi.js';
import { FlexContainer } from './FlexContainer';
import type { FlexDirection, AlignItems, FlexItemConfig } from './FlexContainer';

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

function directionToFlex(direction: LayoutDirection): { direction: FlexDirection; wrap: boolean } {
  switch (direction) {
    case 'horizontal': return { direction: 'row', wrap: false };
    case 'vertical': return { direction: 'column', wrap: false };
    case 'grid': return { direction: 'row', wrap: true };
    case 'wrap': return { direction: 'row', wrap: true };
  }
}

/**
 * Responsive layout container powered by a lightweight built-in flex layout solver.
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
  readonly __uiComponent = true as const;

  private _layoutConfig: Required<Pick<LayoutConfig, 'direction' | 'gap' | 'alignment' | 'autoLayout' | 'columns'>>;
  private _padding: number | [number, number, number, number];
  private _anchor: LayoutAnchor;
  private _maxWidth: number;
  private _breakpoints: [number, Partial<LayoutConfig>][];
  private _items: Container[] = [];
  private _viewportWidth = 0;
  private _viewportHeight = 0;
  private _flex: FlexContainer;

  constructor(config: LayoutConfig = {}) {
    super();

    this._layoutConfig = {
      direction: config.direction ?? 'vertical',
      gap: config.gap ?? 0,
      alignment: config.alignment ?? 'start',
      autoLayout: config.autoLayout ?? true,
      columns: config.columns ?? 2,
    };

    this._padding = config.padding ?? 0;
    this._anchor = config.anchor ?? 'top-left';
    this._maxWidth = config.maxWidth ?? Infinity;

    this._breakpoints = config.breakpoints
      ? Object.entries(config.breakpoints)
          .map(([w, cfg]) => [Number(w), cfg] as [number, Partial<LayoutConfig>])
          .sort((a, b) => a[0] - b[0])
      : [];

    // Create internal FlexContainer
    this._flex = new FlexContainer();
    super.addChild(this._flex);

    this.applyLayoutStyles();
  }

  /** Add an item to the layout */
  addItem(child: Container): this {
    this._items.push(child);

    const flexConfig = this.buildFlexItemConfig(child);
    this._flex.addFlexChild(child, flexConfig);

    if (this._layoutConfig.autoLayout) {
      this.applyLayoutStyles();
    }

    return this;
  }

  /** Remove an item from the layout */
  removeItem(child: Container): this {
    const idx = this._items.indexOf(child);
    if (idx !== -1) {
      this._items.splice(idx, 1);
      this._flex.removeFlexChild(child);
    }
    return this;
  }

  /** Remove all items */
  clearItems(): this {
    this._flex.clearFlexChildren();
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
    const padding = effective.padding ?? this._padding;
    const maxWidth = effective.maxWidth ?? this._maxWidth;

    const { direction: flexDir, wrap } = directionToFlex(direction);

    this._flex.setDirection(flexDir);
    this._flex.setJustifyContent('start');
    this._flex.setAlignItems(alignment as AlignItems);
    this._flex.setGap(gap);
    this._flex.setPadding(padding);

    // Wrap and maxWidth
    if (wrap) {
      (this._flex as any)._config.flexWrap = true;
      if (direction === 'grid' && maxWidth < Infinity) {
        (this._flex as any)._maxWidth = maxWidth;
      } else if (direction === 'grid') {
        // For grid without explicit maxWidth, we don't constrain wrapping —
        // each child gets a proportional width via flexConfig
      }
      if (maxWidth < Infinity) {
        (this._flex as any)._maxWidth = maxWidth;
      }
    } else {
      (this._flex as any)._config.flexWrap = false;
    }

    // Update grid child widths
    if (direction === 'grid') {
      for (const item of this._items) {
        const flexConfig = this.buildFlexItemConfig(item);
        (item as any)._flexConfig = flexConfig;
      }
    }

    // Set explicit size if we have viewport dimensions
    if (this._viewportWidth > 0 && this._viewportHeight > 0) {
      this._flex.resize(this._viewportWidth, this._viewportHeight);
    } else {
      this._flex.updateLayout();
    }
  }

  private buildFlexItemConfig(_child: Container): FlexItemConfig | undefined {
    const effective = this.resolveConfig();
    const direction = effective.direction ?? this._layoutConfig.direction;
    const columns = effective.columns ?? this._layoutConfig.columns;

    if (direction === 'grid' && columns > 0) {
      // For grid, give each item a proportional width
      // The actual pixel width will be computed during layout
      return { flexGrow: 1 };
    }

    return undefined;
  }

  private applyAnchor(): void {
    const anchor = this.resolveConfig().anchor ?? this._anchor;
    if (this._viewportWidth === 0 || this._viewportHeight === 0) return;

    const { width: contentW, height: contentH } = this._flex.getContentSize();
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

    this.x = anchorX;
    this.y = anchorY;
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

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('direction' in changed) this._layoutConfig.direction = changed.direction;
    if ('gap' in changed) this._layoutConfig.gap = changed.gap;
    if ('alignment' in changed) this._layoutConfig.alignment = changed.alignment;
    if ('anchor' in changed) this._anchor = changed.anchor;
    if ('padding' in changed) this._padding = changed.padding;
    if ('columns' in changed) this._layoutConfig.columns = changed.columns;
    this.applyLayoutStyles();
    if (this._viewportWidth > 0) this.applyAnchor();
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this._items.length = 0;
    super.destroy(options);
  }
}
