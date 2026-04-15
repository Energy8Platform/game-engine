import { Container, Graphics, type ColorSource, Ticker } from 'pixi.js';
import { resolveView } from './view';
import type { ViewInput } from './view';

// ─── Types ───────────────────────────────────────────────

export type ScrollDirection = 'vertical' | 'horizontal' | 'both';

export interface ScrollContainerConfig {
  /** Visible viewport width */
  width: number;

  /** Visible viewport height */
  height: number;

  /** Scroll direction (default: 'vertical') */
  direction?: ScrollDirection;

  /** Background color (undefined = transparent) */
  backgroundColor?: ColorSource;

  /** Border radius for the mask (default: 0) */
  borderRadius?: number;

  /** Gap between items (default: 0) */
  elementsMargin?: number;

  /** Padding */
  padding?: number;

  /** Disable easing/inertia */
  disableEasing?: boolean;

  /** Show scrollbar indicator (default: false) */
  scrollbar?: boolean;

  /** Custom scrollbar thumb view (string texture name, Texture, or Container) */
  thumbView?: ViewInput;

  /** Scrollbar width in px (default: 6) */
  scrollbarWidth?: number;

  /** Scrollbar padding from edge (default: 4) */
  scrollbarPadding?: number;

  /** Scrollbar color (when no thumbView, default: 0xaaaaaa) */
  scrollbarColor?: number;

  /** Scrollbar alpha (default: 0.5) */
  scrollbarAlpha?: number;
}

const DECELERATION = 0.95;
const MIN_VELOCITY = 0.5;

/**
 * Scrollable container with touch/drag, mouse wheel, and inertia.
 *
 * @example
 * ```ts
 * const scroll = new ScrollContainer({
 *   width: 600,
 *   height: 400,
 *   direction: 'vertical',
 *   elementsMargin: 8,
 * });
 *
 * for (let i = 0; i < 50; i++) {
 *   scroll.addItem(createRow(i));
 * }
 *
 * scene.container.addChild(scroll);
 * ```
 */
export class ScrollContainer extends Container {
  readonly __uiComponent = true as const;

  private _viewport: { width: number; height: number };
  private _internalSetup = true;
  private _content: Container;
  private _maskGfx: Graphics;
  private _bg: Graphics | null = null;
  private _scrollConfig: Required<Pick<ScrollContainerConfig, 'direction' | 'elementsMargin' | 'padding' | 'borderRadius' | 'disableEasing'>>;
  private _items: Container[] = [];

  // Scrollbar
  private _scrollbar: Container | null = null;
  private _scrollbarConfig: { width: number; padding: number };

  // Drag state
  private _dragging = false;
  private _dragStart = { x: 0, y: 0 };
  private _contentStart = { x: 0, y: 0 };
  private _velocity = { x: 0, y: 0 };
  private _lastDragPos = { x: 0, y: 0 };
  private _lastDragTime = 0;
  private _inertiaActive = false;

  // Bound handlers for cleanup
  private _onTickBound: ((ticker: Ticker) => void) | null = null;
  private _onWheelBound: ((e: WheelEvent) => void) | null = null;

  constructor(config: ScrollContainerConfig) {
    super();

    this._viewport = { width: config.width, height: config.height };
    this._scrollConfig = {
      direction: config.direction ?? 'vertical',
      elementsMargin: config.elementsMargin ?? 0,
      padding: config.padding ?? 0,
      borderRadius: config.borderRadius ?? 0,
      disableEasing: config.disableEasing ?? false,
    };

    // Background
    if (config.backgroundColor !== undefined) {
      this._bg = new Graphics();
      this._bg.roundRect(0, 0, config.width, config.height, this._scrollConfig.borderRadius)
        .fill(config.backgroundColor);
      this.addChild(this._bg);
    }

    // Mask
    this._maskGfx = new Graphics();
    this._maskGfx.roundRect(0, 0, config.width, config.height, this._scrollConfig.borderRadius)
      .fill(0xffffff);
    this.addChild(this._maskGfx);

    // Content container
    this._content = new Container();
    this._content.mask = this._maskGfx;
    this.addChild(this._content);

    // Interaction
    this.eventMode = 'static';
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= config.width && y >= 0 && y <= config.height };

    this.on('pointerdown', this._onPointerDown, this);
    this.on('pointermove', this._onPointerMove, this);
    this.on('pointerup', this._onPointerUp, this);
    this.on('pointerupoutside', this._onPointerUp, this);

    // Mouse wheel
    this._onWheelBound = this._onWheel.bind(this);

    // Scrollbar
    const sbWidth = config.scrollbarWidth ?? 6;
    const sbPadding = config.scrollbarPadding ?? 4;
    this._scrollbarConfig = { width: sbWidth, padding: sbPadding };

    if (config.scrollbar) {
      const customThumb = resolveView(config.thumbView);
      if (customThumb) {
        this._scrollbar = customThumb;
      } else {
        const g = new Graphics();
        g.roundRect(0, 0, sbWidth, 40, sbWidth / 2).fill(config.scrollbarColor ?? 0xaaaaaa);
        g.alpha = config.scrollbarAlpha ?? 0.5;
        this._scrollbar = g;
      }
      this._scrollbar.visible = false;
      super.addChild(this._scrollbar);
    }

    this._internalSetup = false;
  }

  /**
   * Override addChild so external children are routed to scroll content.
   * Enables `<scrollContainer><label /><panel /></scrollContainer>` in React JSX.
   */
  override addChild<T extends Container>(...children: T[]): T {
    if (this._internalSetup) {
      return super.addChild(...children);
    }
    for (const child of children) {
      this.addItem(child as any);
    }
    return children[0];
  }

  override removeChild<T extends Container>(...children: T[]): T {
    if (this._internalSetup) {
      return super.removeChild(...children);
    }
    for (const child of children) {
      const idx = this._items.indexOf(child as any);
      if (idx !== -1) {
        this._items.splice(idx, 1);
        this._content.removeChild(child);
      }
    }
    this.layoutItems();
    return children[0];
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('width' in changed || 'height' in changed) {
      this.setViewportSize(
        changed.width ?? this._viewport.width,
        changed.height ?? this._viewport.height,
      );
    }
  }

  /** Enable mouse wheel scrolling (call after adding to stage) */
  enableWheel(canvas: HTMLCanvasElement): void {
    if (this._onWheelBound) {
      canvas.addEventListener('wheel', this._onWheelBound, { passive: false });
    }
  }

  /** Set scrollable content. Replaces any existing items. */
  setContent(content: Container): void {
    this.clearItems();
    const children = [...content.children] as Container[];
    for (const child of children) {
      this.addItem(child);
    }
  }

  /** Add a single item */
  addItem(child: Container): this {
    this._items.push(child);
    this._content.addChild(child);
    this.layoutItems();
    return this;
  }

  /** Remove all items */
  clearItems(): void {
    for (const item of this._items) {
      this._content.removeChild(item);
    }
    this._items.length = 0;
  }

  /** Get items */
  get items(): readonly Container[] {
    return this._items;
  }

  /** Scroll to make a specific item index visible */
  scrollToItem(index: number): void {
    if (index < 0 || index >= this._items.length) return;
    const item = this._items[index];
    const isVert = this._scrollConfig.direction !== 'horizontal';

    if (isVert) {
      this._content.y = -item.y + this._scrollConfig.padding;
    } else {
      this._content.x = -item.x + this._scrollConfig.padding;
    }
    this.clampScroll();
  }

  /** Current scroll position */
  get scrollPosition(): { x: number; y: number } {
    return { x: this._content.x, y: this._content.y };
  }

  /** Resize the scroll viewport */
  setViewportSize(width: number, height: number): void {
    this._viewport.width = width;
    this._viewport.height = height;

    this._maskGfx.clear();
    this._maskGfx.roundRect(0, 0, width, height, this._scrollConfig.borderRadius).fill(0xffffff);

    if (this._bg) {
      this._bg.clear();
      this._bg.roundRect(0, 0, width, height, this._scrollConfig.borderRadius)
        .fill(0xffffff); // color will be overridden if needed
    }

    this.clampScroll();
  }

  // ─── Layout ──────────────────────────────────────────

  private layoutItems(): void {
    const { direction, elementsMargin, padding } = this._scrollConfig;
    const isVert = direction !== 'horizontal';
    let pos = padding;

    for (const item of this._items) {
      if (isVert) {
        item.x = padding;
        item.y = pos;
        pos += item.height + elementsMargin;
      } else {
        item.x = pos;
        item.y = padding;
        pos += item.width + elementsMargin;
      }
    }
  }

  // ─── Drag handling ───────────────────────────────────

  private _onPointerDown(e: import('pixi.js').FederatedPointerEvent): void {
    this._dragging = true;
    this._inertiaActive = false;
    this._dragStart.x = e.globalX;
    this._dragStart.y = e.globalY;
    this._contentStart.x = this._content.x;
    this._contentStart.y = this._content.y;
    this._lastDragPos.x = e.globalX;
    this._lastDragPos.y = e.globalY;
    this._lastDragTime = Date.now();
    this._velocity.x = 0;
    this._velocity.y = 0;

    this.stopInertia();
  }

  private _onPointerMove(e: import('pixi.js').FederatedPointerEvent): void {
    if (!this._dragging) return;

    const dx = e.globalX - this._dragStart.x;
    const dy = e.globalY - this._dragStart.y;
    const { direction } = this._scrollConfig;

    if (direction !== 'horizontal') {
      this._content.y = this._contentStart.y + dy;
    }
    if (direction !== 'vertical') {
      this._content.x = this._contentStart.x + dx;
    }

    // Track velocity
    const now = Date.now();
    const dt = now - this._lastDragTime;
    if (dt > 0) {
      this._velocity.x = (e.globalX - this._lastDragPos.x) / dt * 16;
      this._velocity.y = (e.globalY - this._lastDragPos.y) / dt * 16;
    }
    this._lastDragPos.x = e.globalX;
    this._lastDragPos.y = e.globalY;
    this._lastDragTime = now;

    this.clampScroll();
  }

  private _onPointerUp(): void {
    if (!this._dragging) return;
    this._dragging = false;

    if (!this._scrollConfig.disableEasing &&
      (Math.abs(this._velocity.x) > MIN_VELOCITY || Math.abs(this._velocity.y) > MIN_VELOCITY)) {
      this.startInertia();
    }
  }

  // ─── Inertia ─────────────────────────────────────────

  private startInertia(): void {
    this._inertiaActive = true;
    this._onTickBound = this._inertiaTick.bind(this);
    Ticker.shared.add(this._onTickBound);
  }

  private stopInertia(): void {
    if (this._onTickBound && this._inertiaActive) {
      Ticker.shared.remove(this._onTickBound);
      this._inertiaActive = false;
    }
  }

  private _inertiaTick(): void {
    const { direction } = this._scrollConfig;

    if (direction !== 'horizontal') {
      this._content.y += this._velocity.y;
      this._velocity.y *= DECELERATION;
    }
    if (direction !== 'vertical') {
      this._content.x += this._velocity.x;
      this._velocity.x *= DECELERATION;
    }

    this.clampScroll();

    if (Math.abs(this._velocity.x) < MIN_VELOCITY && Math.abs(this._velocity.y) < MIN_VELOCITY) {
      this.stopInertia();
    }
  }

  // ─── Mouse wheel ─────────────────────────────────────

  private _onWheel(e: WheelEvent): void {
    const { direction } = this._scrollConfig;
    e.preventDefault();

    if (direction !== 'horizontal') {
      this._content.y -= e.deltaY;
    }
    if (direction !== 'vertical') {
      this._content.x -= e.deltaX;
    }

    this.clampScroll();
  }

  // ─── Scroll bounds ───────────────────────────────────

  private clampScroll(): void {
    const { direction } = this._scrollConfig;
    const bounds = this._content.getLocalBounds();

    if (direction !== 'horizontal') {
      const contentHeight = bounds.height + bounds.y;
      const maxScroll = Math.min(0, this._viewport.height - contentHeight);
      this._content.y = Math.max(maxScroll, Math.min(0, this._content.y));
    }

    if (direction !== 'vertical') {
      const contentWidth = bounds.width + bounds.x;
      const maxScroll = Math.min(0, this._viewport.width - contentWidth);
      this._content.x = Math.max(maxScroll, Math.min(0, this._content.x));
    }

    this.updateScrollbar();
  }

  private updateScrollbar(): void {
    if (!this._scrollbar) return;
    const { direction } = this._scrollConfig;
    const { width: sbW, padding: sbPad } = this._scrollbarConfig;
    const bounds = this._content.getLocalBounds();
    const isVert = direction !== 'horizontal';

    if (isVert) {
      const contentH = bounds.height + bounds.y;
      if (contentH <= this._viewport.height) {
        this._scrollbar.visible = false;
        return;
      }
      this._scrollbar.visible = true;
      const ratio = this._viewport.height / contentH;
      const thumbH = Math.max(20, this._viewport.height * ratio);
      const scrollRange = this._viewport.height - thumbH;
      const scrollProgress = -this._content.y / (contentH - this._viewport.height);

      this._scrollbar.x = this._viewport.width - sbW - sbPad;
      this._scrollbar.y = scrollProgress * scrollRange;
      this._scrollbar.height = thumbH;
      this._scrollbar.width = sbW;
    } else {
      const contentW = bounds.width + bounds.x;
      if (contentW <= this._viewport.width) {
        this._scrollbar.visible = false;
        return;
      }
      this._scrollbar.visible = true;
      const ratio = this._viewport.width / contentW;
      const thumbW = Math.max(20, this._viewport.width * ratio);
      const scrollRange = this._viewport.width - thumbW;
      const scrollProgress = -this._content.x / (contentW - this._viewport.width);

      this._scrollbar.y = this._viewport.height - sbW - sbPad;
      this._scrollbar.x = scrollProgress * scrollRange;
      this._scrollbar.width = thumbW;
      this._scrollbar.height = sbW;
    }
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this.stopInertia();
    this.off('pointerdown', this._onPointerDown, this);
    this.off('pointermove', this._onPointerMove, this);
    this.off('pointerup', this._onPointerUp, this);
    this.off('pointerupoutside', this._onPointerUp, this);
    this._items.length = 0;
    super.destroy(options);
  }
}
