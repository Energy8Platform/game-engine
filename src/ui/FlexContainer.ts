import { Container } from 'pixi.js';

// ─── Types ───────────────────────────────────────────────

export type FlexDirection = 'row' | 'column';
export type JustifyContent = 'start' | 'center' | 'end' | 'space-between' | 'space-around';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';

export type AlignSelf = 'auto' | 'start' | 'center' | 'end' | 'stretch';

export interface FlexItemConfig {
  /** Flex grow factor (0 = fixed size) */
  flexGrow?: number;
  /** Flex shrink factor (0 = don't shrink, default: 1) */
  flexShrink?: number;
  /** Explicit width override for layout calculations */
  layoutWidth?: number;
  /** Explicit height override for layout calculations */
  layoutHeight?: number;
  /** Override parent's alignItems for this child */
  alignSelf?: AlignSelf;
  /** Exclude from flex layout (acts like position: absolute) */
  flexExclude?: boolean;
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
  /** Enable wrapping to next line (default: false) */
  flexWrap?: boolean;
  /** Maximum width before wrapping (only with flexWrap) */
  maxWidth?: number;
  /** Maximum height before wrapping (only with flexWrap + column) */
  maxHeight?: number;
  /** Explicit container width (used for cross-axis alignment/stretch) */
  width?: number;
  /** Explicit container height (used for cross-axis alignment/stretch) */
  height?: number;
}

// ─── Helpers ─────────────────────────────────────────────

function normalizePadding(p: number | [number, number, number, number]): [number, number, number, number] {
  return typeof p === 'number' ? [p, p, p, p] : p;
}

/** Measure a child's size and bounds offset for layout purposes */
function measureChild(child: Container & { _flexConfig?: FlexItemConfig }): { w: number; h: number; ox: number; oy: number } {
  const cfg = child._flexConfig;
  if (cfg?.layoutWidth !== undefined && cfg?.layoutHeight !== undefined) {
    return { w: cfg.layoutWidth, h: cfg.layoutHeight, ox: 0, oy: 0 };
  }

  // For FlexContainers, use their explicit size if set
  if (child instanceof FlexContainer) {
    const fc = child;
    if (fc._explicitWidth > 0 && fc._explicitHeight > 0) {
      return { w: fc._explicitWidth, h: fc._explicitHeight, ox: 0, oy: 0 };
    }
  }

  // Use localBounds to get the true visual extent and origin offset.
  // This handles children with non-zero anchors (e.g. Button, Label with centered text).
  const bounds = child.getLocalBounds();
  const w = cfg?.layoutWidth ?? bounds.width;
  const h = cfg?.layoutHeight ?? bounds.height;
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
        if (isRow) {
          item.w = flexSize;
          item.child.width = flexSize;
        } else {
          item.h = flexSize;
          item.child.height = flexSize;
        }
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
            if (isRow) {
              item.w = newSize;
              item.child.width = newSize;
            } else {
              item.h = newSize;
              item.child.height = newSize;
            }
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
        if (isRow) {
          item.child.height = crossSize;
        } else {
          item.child.width = crossSize;
        }
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

  private _config: Required<Pick<FlexContainerConfig, 'direction' | 'justifyContent' | 'alignItems' | 'gap' | 'flexWrap'>>;
  private _padding: [number, number, number, number];
  private _maxWidth: number;
  private _maxHeight: number;
  /** @internal */ _explicitWidth: number;
  /** @internal */ _explicitHeight: number;
  private _layoutChildren: (Container & { _flexConfig?: FlexItemConfig })[] = [];
  private _layoutDirty = true;

  constructor(config: FlexContainerConfig = {}) {
    super();

    this._config = {
      direction: config.direction ?? 'row',
      justifyContent: config.justifyContent ?? 'start',
      alignItems: config.alignItems ?? 'start',
      gap: config.gap ?? 0,
      flexWrap: config.flexWrap ?? false,
    };

    this._padding = normalizePadding(config.padding ?? 0);
    this._maxWidth = config.maxWidth ?? Infinity;
    this._maxHeight = config.maxHeight ?? Infinity;
    this._explicitWidth = config.width ?? 0;
    this._explicitHeight = config.height ?? 0;
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
    if (this._layoutDirty) this.updateLayout();
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

  /** Update the container size and recalculate layout */
  resize(width: number, height: number): void {
    this._explicitWidth = width;
    this._explicitHeight = height;
    this._layoutDirty = true;
    this.updateLayout();
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
    this._layoutDirty = false;
    const { direction, justifyContent, alignItems, gap, flexWrap } = this._config;
    const [pt, pr, pb, pl] = this._padding;
    const isRow = direction === 'row';

    const contentW = this._explicitWidth > 0 ? this._explicitWidth - pl - pr : Infinity;
    const contentH = this._explicitHeight > 0 ? this._explicitHeight - pt - pb : Infinity;
    const mainLimit = isRow ? contentW : contentH;
    const crossLimit = isRow ? contentH : contentW;

    // Measure children (skip flexExclude — they position themselves)
    const measured: LineItem[] = [];
    for (const child of this._layoutChildren) {
      if (child._flexConfig?.flexExclude) continue;
      const { w, h, ox, oy } = measureChild(child);
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

    // Layout each line
    let crossOffset = isRow ? pt : pl;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineCross = lineCrossSizes[i];
      const mainStart = isRow ? pl : pt;

      // Offset items by padding
      const tempItems = line.map((item) => ({ ...item }));

      // For single-line layouts, use the full available cross space for alignment;
      // for multi-line (wrapping), each line gets its own measured cross size.
      const effectiveCross = lines.length === 1 && crossLimit < Infinity
        ? crossLimit
        : (crossLimit < Infinity ? Math.min(lineCross, crossLimit) : lineCross);

      layoutLine(
        tempItems,
        isRow,
        mainLimit < Infinity ? mainLimit : 0,
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

      crossOffset += lineCross + gap;
    }
  }

  /** Computed content size (after layout) */
  getContentSize(): { width: number; height: number } {
    if (this._layoutDirty) this.updateLayout();

    let maxX = 0;
    let maxY = 0;
    for (const child of this._layoutChildren) {
      const { w, h } = measureChild(child);
      maxX = Math.max(maxX, child.x + w);
      maxY = Math.max(maxY, child.y + h);
    }

    const [, pr, pb] = this._padding;
    return { width: maxX + pr, height: maxY + pb };
  }

  /** React reconciler update hook — applies changed config props */
  updateConfig(changed: Record<string, any>): void {
    if ('direction' in changed) this.setDirection(changed.direction);
    if ('justifyContent' in changed) this.setJustifyContent(changed.justifyContent);
    if ('alignItems' in changed) this.setAlignItems(changed.alignItems);
    if ('gap' in changed) this.setGap(changed.gap);
    if ('padding' in changed) this.setPadding(changed.padding);
    if ('flexWrap' in changed) { this._config.flexWrap = changed.flexWrap; this._layoutDirty = true; }
    if ('width' in changed || 'height' in changed) {
      this.resize(changed.width ?? this._explicitWidth, changed.height ?? this._explicitHeight);
      return; // resize calls updateLayout
    }
    if (this._layoutDirty) this.updateLayout();
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this._layoutChildren.length = 0;
    super.destroy(options);
  }
}
