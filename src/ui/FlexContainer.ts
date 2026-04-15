import { Container } from 'pixi.js';

// ─── Types ───────────────────────────────────────────────

export type FlexDirection = 'row' | 'column';
export type JustifyContent = 'start' | 'center' | 'end' | 'space-between' | 'space-around';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';
export type AlignContent = 'start' | 'center' | 'end' | 'space-between' | 'stretch';

export type AlignSelf = 'auto' | 'start' | 'center' | 'end' | 'stretch';

export interface FlexItemConfig {
  /** Flex grow factor (0 = fixed size) */
  flexGrow?: number;
  /** Flex shrink factor (0 = don't shrink, default: 1) */
  flexShrink?: number;
  /** Explicit width override for layout calculations */
  layoutWidth?: number | string;
  /** Explicit height override for layout calculations */
  layoutHeight?: number | string;
  /** Override parent's alignItems for this child */
  alignSelf?: AlignSelf;
  /** Exclude from flex layout (acts like position: absolute) */
  flexExclude?: boolean;
  /** Absolute positioning for flexExclude children (distance from top edge) */
  top?: number;
  /** Absolute positioning for flexExclude children (distance from right edge) */
  right?: number;
  /** Absolute positioning for flexExclude children (distance from bottom edge) */
  bottom?: number;
  /** Absolute positioning for flexExclude children (distance from left edge) */
  left?: number;
}

export interface FlexContainerConfig {
  /** Layout direction (default: 'row') */
  direction?: FlexDirection;
  /** Main-axis distribution (default: 'start') */
  justifyContent?: JustifyContent;
  /** Cross-axis alignment (default: 'start') */
  alignItems?: AlignItems;
  /** Gap between children in pixels (default: 0) */
  gap?: number;
  /** Padding [top, right, bottom, left] or single number (default: 0) */
  padding?: number | [number, number, number, number];
  /** Individual padding overrides (take priority over `padding`) */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Enable wrapping to next line (default: false) */
  flexWrap?: boolean;
  /** Distribution of lines along the cross axis when wrapping (default: 'start') */
  alignContent?: AlignContent;
  /** Maximum width before wrapping (only with flexWrap) */
  maxWidth?: number;
  /** Maximum height before wrapping (only with flexWrap + column) */
  maxHeight?: number;
  /** Explicit container width — number in pixels, or string percentage (e.g. "50%") resolved against parent */
  width?: number | string;
  /** Explicit container height — number in pixels, or string percentage (e.g. "50%") resolved against parent */
  height?: number | string;
}

// ─── Helpers ─────────────────────────────────────────────

function normalizePadding(p: number | [number, number, number, number]): [number, number, number, number] {
  return typeof p === 'number' ? [p, p, p, p] : p;
}

/** Resolve padding from config: individual props override the base `padding` value */
function resolvePadding(config: FlexContainerConfig): [number, number, number, number] {
  const base = normalizePadding(config.padding ?? 0);
  return [
    config.paddingTop ?? base[0],
    config.paddingRight ?? base[1],
    config.paddingBottom ?? base[2],
    config.paddingLeft ?? base[3],
  ];
}

/** Resolve a dimension value — number passes through, "50%" resolves against reference */
function resolveDimension(value: number | string | undefined, reference: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.endsWith('%')) {
    const pct = parseFloat(value);
    if (!isNaN(pct) && reference > 0 && isFinite(reference)) return (pct / 100) * reference;
  }
  return undefined;
}

/** Measure a child's size and bounds offset for layout purposes */
function measureChild(
  child: Container & { _flexConfig?: FlexItemConfig },
  parentContentW = 0,
  parentContentH = 0,
): { w: number; h: number; ox: number; oy: number } {
  const cfg = child._flexConfig;
  const resolvedLW = resolveDimension(cfg?.layoutWidth, parentContentW);
  const resolvedLH = resolveDimension(cfg?.layoutHeight, parentContentH);
  if (resolvedLW !== undefined && resolvedLH !== undefined) {
    return { w: resolvedLW, h: resolvedLH, ox: 0, oy: 0 };
  }

  // For FlexContainers, use their explicit or computed size
  if (child instanceof FlexContainer) {
    const fc = child;
    const w = fc._explicitWidth > 0 ? fc._explicitWidth : (fc._computedWidth > 0 ? fc._computedWidth : undefined);
    const h = fc._explicitHeight > 0 ? fc._explicitHeight : (fc._computedHeight > 0 ? fc._computedHeight : undefined);
    if (w !== undefined && h !== undefined) {
      return { w, h, ox: 0, oy: 0 };
    }
  }

  // Use localBounds to get the true visual extent and origin offset.
  // This handles children with non-zero anchors (e.g. Button, Label with centered text).
  const bounds = child.getLocalBounds();
  const w = resolvedLW ?? bounds.width;
  const h = resolvedLH ?? bounds.height;
  return { w, h, ox: bounds.x, oy: bounds.y };
}

// ─── Layout items within a single line ───────────────────

interface LineItem {
  child: Container & { _flexConfig?: FlexItemConfig };
  w: number;
  h: number;
  /** Local bounds origin offset (x) — compensates for centered anchors */
  ox: number;
  /** Local bounds origin offset (y) */
  oy: number;
}

/**
 * Set a child's main or cross dimension.
 * For FlexContainer children, calls resize() to trigger internal relayout
 * instead of the PixiJS scale setter.
 */
function setChildMainSize(child: Container, isRow: boolean, mainSize: number, item: LineItem): void {
  if (child instanceof FlexContainer) {
    const fc = child;
    fc.resize(
      isRow ? mainSize : fc._explicitWidth || fc._computedWidth,
      isRow ? fc._explicitHeight || fc._computedHeight : mainSize,
    );
  } else {
    if (isRow) {
      child.width = mainSize;
    } else {
      child.height = mainSize;
    }
  }
  if (isRow) item.w = mainSize;
  else item.h = mainSize;
}

function setChildCrossSize(child: Container, isRow: boolean, crossSize: number): void {
  if (child instanceof FlexContainer) {
    const fc = child;
    fc.resize(
      isRow ? fc._explicitWidth || fc._computedWidth : crossSize,
      isRow ? crossSize : fc._explicitHeight || fc._computedHeight,
    );
  } else {
    if (isRow) {
      child.height = crossSize;
    } else {
      child.width = crossSize;
    }
  }
}

function layoutLine(
  items: LineItem[],
  isRow: boolean,
  mainSize: number,
  justify: JustifyContent,
  align: AlignItems,
  gap: number,
  crossOffset: number,
  crossSize: number,
): void {
  if (items.length === 0) return;

  // Compute total fixed main size and flex grow total
  let totalFixed = 0;
  let totalGrow = 0;
  for (const item of items) {
    const grow = item.child._flexConfig?.flexGrow ?? 0;
    if (grow > 0) {
      totalGrow += grow;
    } else {
      totalFixed += isRow ? item.w : item.h;
    }
  }

  const totalGap = gap * (items.length - 1);
  const availableForFlex = Math.max(0, mainSize - totalFixed - totalGap);

  // Resolve flex sizes
  if (totalGrow > 0) {
    for (const item of items) {
      const grow = item.child._flexConfig?.flexGrow ?? 0;
      if (grow > 0) {
        const flexSize = (grow / totalGrow) * availableForFlex;
        setChildMainSize(item.child, isRow, flexSize, item);
      }
    }
  }

  // Shrink: if content overflows and mainSize is finite, shrink eligible items
  if (totalGrow === 0 && mainSize > 0) {
    const overflow = totalFixed + totalGap - mainSize;
    if (overflow > 0) {
      let totalShrinkable = 0;
      for (const item of items) {
        const shrink = item.child._flexConfig?.flexShrink ?? 1;
        if (shrink > 0) {
          totalShrinkable += isRow ? item.w : item.h;
        }
      }
      if (totalShrinkable > 0) {
        for (const item of items) {
          const shrink = item.child._flexConfig?.flexShrink ?? 1;
          if (shrink > 0) {
            const itemMain = isRow ? item.w : item.h;
            const reduction = overflow * (itemMain / totalShrinkable);
            const newSize = Math.max(0, itemMain - reduction);
            setChildMainSize(item.child, isRow, newSize, item);
          }
        }
      }
    }
  }

  // Calculate total main size after flex
  let totalMain = totalGap;
  for (const item of items) {
    totalMain += isRow ? item.w : item.h;
  }

  // Justify: compute starting offset and extra spacing
  let mainOffset = 0;
  let extraGap = 0;

  switch (justify) {
    case 'start':
      break;
    case 'center':
      mainOffset = Math.max(0, (mainSize - totalMain) / 2);
      break;
    case 'end':
      mainOffset = Math.max(0, mainSize - totalMain);
      break;
    case 'space-between':
      if (items.length > 1) {
        extraGap = Math.max(0, (mainSize - totalMain + totalGap) / (items.length - 1)) - gap;
      }
      break;
    case 'space-around':
      if (items.length > 0) {
        const totalSpace = Math.max(0, mainSize - totalMain + totalGap);
        const segment = totalSpace / items.length;
        mainOffset = segment / 2;
        extraGap = segment - gap;
      }
      break;
  }

  // Position each item
  let pos = mainOffset;
  for (const item of items) {
    const mainDim = isRow ? item.w : item.h;
    const crossDim = isRow ? item.h : item.w;

    // Cross-axis alignment (alignSelf overrides align)
    const effectiveAlign = (item.child._flexConfig?.alignSelf && item.child._flexConfig.alignSelf !== 'auto')
      ? item.child._flexConfig.alignSelf
      : align;
    let crossPos = crossOffset;
    switch (effectiveAlign) {
      case 'start':
        break;
      case 'center':
        crossPos += (crossSize - crossDim) / 2;
        break;
      case 'end':
        crossPos += crossSize - crossDim;
        break;
      case 'stretch':
        setChildCrossSize(item.child, isRow, crossSize);
        break;
    }

    // Compensate for local bounds offset (e.g. centered anchors)
    if (isRow) {
      item.child.x = pos - item.ox;
      item.child.y = crossPos - item.oy;
    } else {
      item.child.x = crossPos - item.ox;
      item.child.y = pos - item.oy;
    }

    pos += mainDim + gap + extraGap;
  }
}

// ─── FlexContainer ───────────────────────────────────────

/**
 * Lightweight flexbox-like layout container for PixiJS.
 *
 * Supports row/column direction, justify/align, gap, padding, wrapping,
 * and flex-grow distribution. Zero external dependencies.
 *
 * @example
 * ```ts
 * const toolbar = new FlexContainer({
 *   direction: 'row',
 *   justifyContent: 'space-between',
 *   alignItems: 'center',
 *   gap: 16,
 *   padding: 12,
 * });
 *
 * toolbar.addFlexChild(button1);
 * toolbar.addFlexChild(button2);
 * toolbar.resize(800, 60);
 * ```
 */
export class FlexContainer extends Container {
  readonly __uiComponent = true as const;

  private _config: Required<Pick<FlexContainerConfig, 'direction' | 'justifyContent' | 'alignItems' | 'gap' | 'flexWrap' | 'alignContent'>>;
  private _padding: [number, number, number, number];
  private _maxWidth: number;
  private _maxHeight: number;
  /** @internal */ _explicitWidth: number;
  /** @internal */ _explicitHeight: number;
  /** @internal */ _computedWidth = 0;
  /** @internal */ _computedHeight = 0;
  /** @internal */ _availableWidth = 0;
  /** @internal */ _availableHeight = 0;
  /** @internal */ _rawWidth: number | string;
  /** @internal */ _rawHeight: number | string;
  private _layoutChildren: (Container & { _flexConfig?: FlexItemConfig })[] = [];
  private _layoutDirty = true;
  private _layoutSuspended = false;

  constructor(config: FlexContainerConfig = {}) {
    super();

    this._config = {
      direction: config.direction ?? 'row',
      justifyContent: config.justifyContent ?? 'start',
      alignItems: config.alignItems ?? 'start',
      gap: config.gap ?? 0,
      flexWrap: config.flexWrap ?? false,
      alignContent: config.alignContent ?? 'start',
    };

    this._padding = resolvePadding(config);
    this._maxWidth = config.maxWidth ?? Infinity;
    this._maxHeight = config.maxHeight ?? Infinity;
    this._rawWidth = config.width ?? 0;
    this._rawHeight = config.height ?? 0;
    this._explicitWidth = typeof this._rawWidth === 'number' ? this._rawWidth : 0;
    this._explicitHeight = typeof this._rawHeight === 'number' ? this._rawHeight : 0;
  }

  // ─── Public API ──────────────────────────────────────

  /** Add a child with optional flex config. Also registers in flex layout. */
  addFlexChild(child: Container, flexConfig?: FlexItemConfig): this {
    if (flexConfig) (child as any)._flexConfig = flexConfig;
    if (!this._layoutChildren.includes(child as any)) {
      this._layoutChildren.push(child as any);
      this._layoutDirty = true;
    }
    super.addChild(child);
    return this;
  }

  /** Remove a child from flex layout and display list */
  removeFlexChild(child: Container): this {
    const idx = this._layoutChildren.indexOf(child as any);
    if (idx !== -1) {
      this._layoutChildren.splice(idx, 1);
      this._layoutDirty = true;
    }
    super.removeChild(child);
    return this;
  }

  /** Remove all flex children */
  clearFlexChildren(): this {
    for (const child of this._layoutChildren) {
      super.removeChild(child);
    }
    this._layoutChildren.length = 0;
    this._layoutDirty = true;
    return this;
  }

  /**
   * Override addChild so children automatically participate in flex layout.
   * This enables declarative usage from React JSX.
   */
  override addChild<T extends Container>(...children: T[]): T {
    for (const child of children) {
      if (!this._layoutChildren.includes(child as any)) {
        this._layoutChildren.push(child as any);
        this._layoutDirty = true;
      }
    }
    const result = super.addChild(...children);
    if (this._layoutDirty && !this._layoutSuspended) this.updateLayout();
    return result;
  }

  override addChildAt<T extends Container>(child: T, index: number): T {
    if (!this._layoutChildren.includes(child as any)) {
      // Insert into layout children at matching position
      const layoutIndex = Math.min(index, this._layoutChildren.length);
      this._layoutChildren.splice(layoutIndex, 0, child as any);
      this._layoutDirty = true;
    }
    const result = super.addChildAt(child, index);
    if (this._layoutDirty && !this._layoutSuspended) this.updateLayout();
    return result;
  }

  override removeChild<T extends Container>(...children: T[]): T {
    for (const child of children) {
      const idx = this._layoutChildren.indexOf(child as any);
      if (idx !== -1) {
        this._layoutChildren.splice(idx, 1);
        this._layoutDirty = true;
      }
    }
    return super.removeChild(...children);
  }

  /** Get all flex layout children (read-only) */
  get flexChildren(): readonly Container[] {
    return this._layoutChildren;
  }

  /** Suspend automatic layout recalculation. Call resumeLayout() to flush. */
  suspendLayout(): void {
    this._layoutSuspended = true;
  }

  /** Resume automatic layout and flush if dirty. */
  resumeLayout(): void {
    this._layoutSuspended = false;
    if (this._layoutDirty) this.updateLayout();
  }

  /** Update the container size and recalculate layout */
  resize(width: number, height: number): void {
    this._explicitWidth = width;
    this._explicitHeight = height;
    this._layoutDirty = true;
    if (!this._layoutSuspended) this.updateLayout();
  }

  /** Update layout direction */
  setDirection(direction: FlexDirection): void {
    this._config.direction = direction;
    this._layoutDirty = true;
  }

  /** Update justifyContent */
  setJustifyContent(justify: JustifyContent): void {
    this._config.justifyContent = justify;
    this._layoutDirty = true;
  }

  /** Update alignItems */
  setAlignItems(align: AlignItems): void {
    this._config.alignItems = align;
    this._layoutDirty = true;
  }

  /** Update gap */
  setGap(gap: number): void {
    this._config.gap = gap;
    this._layoutDirty = true;
  }

  /** Update padding */
  setPadding(padding: number | [number, number, number, number]): void {
    this._padding = normalizePadding(padding);
    this._layoutDirty = true;
  }

  /**
   * Recalculate and apply layout positions for all children.
   * Called automatically by `resize()`. Call manually after
   * adding/removing children without resize.
   */
  updateLayout(): void {
    if (this._layoutSuspended) {
      this._layoutDirty = true;
      return;
    }
    this._layoutDirty = false;
    const { direction, justifyContent, alignItems, gap, flexWrap, alignContent } = this._config;
    const [pt, pr, pb, pl] = this._padding;
    const isRow = direction === 'row';

    // Resolve percentage width/height against parent's available space
    if (typeof this._rawWidth === 'string') {
      this._explicitWidth = resolveDimension(this._rawWidth, this._availableWidth) ?? 0;
    }
    if (typeof this._rawHeight === 'string') {
      this._explicitHeight = resolveDimension(this._rawHeight, this._availableHeight) ?? 0;
    }

    const contentW = this._explicitWidth > 0 ? this._explicitWidth - pl - pr : Infinity;
    const contentH = this._explicitHeight > 0 ? this._explicitHeight - pt - pb : Infinity;
    const mainLimit = isRow ? contentW : contentH;
    const crossLimit = isRow ? contentH : contentW;

    // Pass content area to measureChild for percentage resolution
    const pctRefW = contentW < Infinity ? contentW : 0;
    const pctRefH = contentH < Infinity ? contentH : 0;

    // Propagate available size to child FlexContainers and resolve their percentages
    for (const child of this._layoutChildren) {
      if (child instanceof FlexContainer) {
        const fc = child;
        fc._availableWidth = pctRefW;
        fc._availableHeight = pctRefH;
        // If child has percentage dimensions, trigger its layout to resolve them
        if (typeof fc._rawWidth === 'string' || typeof fc._rawHeight === 'string') {
          fc.updateLayout();
        }
      }
    }

    // Measure children (skip flexExclude — they position themselves)
    const measured: LineItem[] = [];
    for (const child of this._layoutChildren) {
      if (child._flexConfig?.flexExclude) continue;
      const { w, h, ox, oy } = measureChild(child, pctRefW, pctRefH);
      measured.push({ child, w, h, ox, oy });
    }

    // Split into lines (if wrapping)
    const lines: LineItem[][] = [];
    if (flexWrap && mainLimit < Infinity) {
      let currentLine: LineItem[] = [];
      let lineMain = 0;

      for (const item of measured) {
        const itemMain = isRow ? item.w : item.h;
        const wouldBe = lineMain + (currentLine.length > 0 ? gap : 0) + itemMain;

        if (currentLine.length > 0 && wouldBe > mainLimit) {
          lines.push(currentLine);
          currentLine = [item];
          lineMain = itemMain;
        } else {
          currentLine.push(item);
          lineMain = wouldBe;
        }
      }
      if (currentLine.length > 0) lines.push(currentLine);
    } else {
      lines.push(measured);
    }

    // Compute cross size per line
    const lineCrossSizes: number[] = lines.map((line) => {
      let maxCross = 0;
      for (const item of line) {
        const cross = isRow ? item.h : item.w;
        if (cross > maxCross) maxCross = cross;
      }
      return maxCross;
    });

    // Compute natural main size (for auto-sizing when no explicit size given)
    let naturalMainSize = 0;
    if (mainLimit === Infinity) {
      for (const line of lines) {
        let lineMain = 0;
        for (const item of line) {
          lineMain += isRow ? item.w : item.h;
        }
        lineMain += gap * Math.max(0, line.length - 1);
        naturalMainSize = Math.max(naturalMainSize, lineMain);
      }
    }

    // Effective main size: explicit if set, otherwise natural content size
    const effectiveMainSize = mainLimit < Infinity ? mainLimit : naturalMainSize;

    // Compute alignContent offsets for multi-line layouts
    const totalLinesCross = lineCrossSizes.reduce((s, v) => s + v, 0) + gap * Math.max(0, lines.length - 1);
    let acOffset = 0;
    let acExtraGap = 0;
    if (lines.length > 1 && crossLimit < Infinity) {
      const freeSpace = Math.max(0, crossLimit - totalLinesCross);
      switch (alignContent) {
        case 'center':
          acOffset = freeSpace / 2;
          break;
        case 'end':
          acOffset = freeSpace;
          break;
        case 'space-between':
          if (lines.length > 1) {
            acExtraGap = freeSpace / (lines.length - 1);
          }
          break;
        case 'stretch':
          if (lines.length > 0) {
            const extra = freeSpace / lines.length;
            for (let i = 0; i < lineCrossSizes.length; i++) {
              lineCrossSizes[i] += extra;
            }
          }
          break;
        // 'start' — no adjustment
      }
    }

    // Layout each line
    let crossOffset = (isRow ? pt : pl) + acOffset;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineCross = lineCrossSizes[i];
      const mainStart = isRow ? pl : pt;

      // Offset items by padding
      const tempItems = line.map((item) => ({ ...item }));

      // Cross size for alignment: use container cross size for single-line, line cross for multi-line
      const effectiveCross = lines.length === 1 && crossLimit < Infinity ? crossLimit : lineCross;

      layoutLine(
        tempItems,
        isRow,
        effectiveMainSize,
        mainLimit < Infinity ? justifyContent : 'start',
        alignItems,
        gap,
        crossOffset,
        effectiveCross,
      );

      // Apply main-axis padding offset
      for (const item of tempItems) {
        const origChild = line.find((l) => l.child === item.child)!;
        origChild.child.x = item.child.x + (isRow ? mainStart : 0);
        origChild.child.y = item.child.y + (isRow ? 0 : mainStart);
      }

      crossOffset += lineCross + gap + acExtraGap;
    }

    // Compute and store actual dimensions for measureChild() and getContentSize()
    let totalCrossNatural = 0;
    for (let i = 0; i < lineCrossSizes.length; i++) {
      totalCrossNatural += lineCrossSizes[i];
      if (i < lineCrossSizes.length - 1) totalCrossNatural += gap;
    }

    if (isRow) {
      this._computedWidth = this._explicitWidth > 0 ? this._explicitWidth : (pl + naturalMainSize + pr);
      this._computedHeight = this._explicitHeight > 0 ? this._explicitHeight : (pt + totalCrossNatural + pb);
    } else {
      this._computedWidth = this._explicitWidth > 0 ? this._explicitWidth : (pl + totalCrossNatural + pr);
      this._computedHeight = this._explicitHeight > 0 ? this._explicitHeight : (pt + naturalMainSize + pb);
    }

    // Position flexExclude children (absolute positioning)
    for (const child of this._layoutChildren) {
      if (!child._flexConfig?.flexExclude) continue;
      const cfg = child._flexConfig;
      const { w, h } = measureChild(child, pctRefW, pctRefH);
      const cw = this._computedWidth;
      const ch = this._computedHeight;
      if (cfg.left !== undefined) child.x = cfg.left;
      else if (cfg.right !== undefined) child.x = cw - w - cfg.right;
      if (cfg.top !== undefined) child.y = cfg.top;
      else if (cfg.bottom !== undefined) child.y = ch - h - cfg.bottom;
    }
  }

  /** Computed content size (after layout) */
  getContentSize(): { width: number; height: number } {
    if (this._layoutDirty) this.updateLayout();
    return { width: this._computedWidth, height: this._computedHeight };
  }

  /** React reconciler update hook — applies changed config props */
  updateConfig(changed: Record<string, any>): void {
    if ('direction' in changed) this.setDirection(changed.direction);
    if ('justifyContent' in changed) this.setJustifyContent(changed.justifyContent);
    if ('alignItems' in changed) this.setAlignItems(changed.alignItems);
    if ('gap' in changed) this.setGap(changed.gap);
    if ('padding' in changed || 'paddingTop' in changed || 'paddingRight' in changed || 'paddingBottom' in changed || 'paddingLeft' in changed) {
      this._padding = resolvePadding(changed as FlexContainerConfig);
      this._layoutDirty = true;
    }
    if ('flexWrap' in changed) { this._config.flexWrap = changed.flexWrap; this._layoutDirty = true; }
    if ('alignContent' in changed) { this._config.alignContent = changed.alignContent; this._layoutDirty = true; }
    if ('width' in changed || 'height' in changed) {
      const w = changed.width ?? this._rawWidth;
      const h = changed.height ?? this._rawHeight;
      this._rawWidth = w;
      this._rawHeight = h;
      if (typeof w === 'number' && typeof h === 'number') {
        this.resize(w, h);
      } else {
        // Percentage — will resolve in updateLayout
        this._explicitWidth = typeof w === 'number' ? w : 0;
        this._explicitHeight = typeof h === 'number' ? h : 0;
        this._layoutDirty = true;
        if (!this._layoutSuspended) this.updateLayout();
      }
      return;
    }
    if (this._layoutDirty && !this._layoutSuspended) this.updateLayout();
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this._layoutChildren.length = 0;
    super.destroy(options);
  }
}
