import { Container, Graphics } from 'pixi.js';

// ─── Types ───────────────────────────────────────────────

export type ScrollDirection = 'vertical' | 'horizontal' | 'both';

export interface ScrollContainerConfig {
  /** Visible viewport width */
  width: number;

  /** Visible viewport height */
  height: number;

  /** Scroll direction (default: 'vertical') */
  direction?: ScrollDirection;

  /** Show scrollbar(s) (default: true) */
  showScrollbar?: boolean;

  /** Scrollbar width in pixels (default: 6) */
  scrollbarWidth?: number;

  /** Scrollbar color (default: 0xffffff) */
  scrollbarColor?: number;

  /** Scrollbar opacity (default: 0.4) */
  scrollbarAlpha?: number;

  /** Elasticity factor for overscroll bounce (0 = none, 1 = infinite, default: 0.3) */
  elasticity?: number;

  /** Inertia deceleration factor (0 = instant stop, 1 = infinite drift, default: 0.92) */
  inertia?: number;

  /** Snap to items of fixed height/width (0 = no snap) */
  snapSize?: number;

  /** Background color (undefined = transparent) */
  backgroundColor?: number;

  /** Background alpha (default: 1) */
  backgroundAlpha?: number;

  /** Border radius for the mask (default: 0) */
  borderRadius?: number;
}

/**
 * Scrollable container with touch/drag, mouse wheel, inertia, and optional scrollbar.
 *
 * Perfect for paytables, settings panels, bet history, and any scrollable content
 * that doesn't fit on screen.
 *
 * @example
 * ```ts
 * const scroll = new ScrollContainer({
 *   width: 600,
 *   height: 400,
 *   direction: 'vertical',
 *   showScrollbar: true,
 *   elasticity: 0.3,
 * });
 *
 * // Add content taller than 400px
 * const list = new Container();
 * for (let i = 0; i < 50; i++) {
 *   const row = createRow(i);
 *   row.y = i * 40;
 *   list.addChild(row);
 * }
 * scroll.setContent(list);
 *
 * scene.container.addChild(scroll);
 * ```
 */
export class ScrollContainer extends Container {
  private _config: Required<
    Pick<ScrollContainerConfig, 'width' | 'height' | 'direction' | 'showScrollbar' |
      'scrollbarWidth' | 'scrollbarColor' | 'scrollbarAlpha' | 'elasticity' | 'inertia' |
      'snapSize' | 'borderRadius'>
  >;

  private _viewport: Container;
  private _content: Container | null = null;
  private _mask: Graphics;
  private _bg: Graphics;
  private _scrollbarV: Graphics | null = null;
  private _scrollbarH: Graphics | null = null;
  private _scrollbarFadeTimeout: number | null = null;

  // Scroll state
  private _scrollX = 0;
  private _scrollY = 0;
  private _velocityX = 0;
  private _velocityY = 0;
  private _isDragging = false;
  private _dragStart = { x: 0, y: 0 };
  private _scrollStart = { x: 0, y: 0 };
  private _lastDragPos = { x: 0, y: 0 };
  private _lastDragTime = 0;
  private _isAnimating = false;
  private _animationFrame: number | null = null;

  constructor(config: ScrollContainerConfig) {
    super();

    this._config = {
      width: config.width,
      height: config.height,
      direction: config.direction ?? 'vertical',
      showScrollbar: config.showScrollbar ?? true,
      scrollbarWidth: config.scrollbarWidth ?? 6,
      scrollbarColor: config.scrollbarColor ?? 0xffffff,
      scrollbarAlpha: config.scrollbarAlpha ?? 0.4,
      elasticity: config.elasticity ?? 0.3,
      inertia: config.inertia ?? 0.92,
      snapSize: config.snapSize ?? 0,
      borderRadius: config.borderRadius ?? 0,
    };

    // Background
    this._bg = new Graphics();
    if (config.backgroundColor !== undefined) {
      this._bg.roundRect(0, 0, config.width, config.height, this._config.borderRadius)
        .fill({ color: config.backgroundColor, alpha: config.backgroundAlpha ?? 1 });
    }
    this.addChild(this._bg);

    // Viewport (masked area)
    this._viewport = new Container();
    this.addChild(this._viewport);

    // Mask
    this._mask = new Graphics();
    this._mask.roundRect(0, 0, config.width, config.height, this._config.borderRadius)
      .fill(0xffffff);
    this.addChild(this._mask);
    this._viewport.mask = this._mask;

    // Scrollbars
    if (this._config.showScrollbar) {
      if (this._config.direction !== 'horizontal') {
        this._scrollbarV = new Graphics();
        this._scrollbarV.alpha = 0;
        this.addChild(this._scrollbarV);
      }
      if (this._config.direction !== 'vertical') {
        this._scrollbarH = new Graphics();
        this._scrollbarH.alpha = 0;
        this.addChild(this._scrollbarH);
      }
    }

    // Interaction
    this.eventMode = 'static';
    this.cursor = 'grab';
    this.hitArea = { contains: (x: number, y: number) =>
      x >= 0 && x <= config.width && y >= 0 && y <= config.height };

    this.on('pointerdown', this.onPointerDown);
    this.on('pointermove', this.onPointerMove);
    this.on('pointerup', this.onPointerUp);
    this.on('pointerupoutside', this.onPointerUp);
    this.on('wheel', this.onWheel);
  }

  /** Set scrollable content. Replaces any existing content. */
  setContent(content: Container): void {
    if (this._content) {
      this._viewport.removeChild(this._content);
    }
    this._content = content;
    this._viewport.addChild(content);
    this._scrollX = 0;
    this._scrollY = 0;
    this.applyScroll();
  }

  /** Get the content container */
  get content(): Container | null {
    return this._content;
  }

  /** Scroll to a specific position (in content coordinates) */
  scrollTo(x: number, y: number, animate = true): void {
    if (!animate) {
      this._scrollX = x;
      this._scrollY = y;
      this.clampScroll();
      this.applyScroll();
      return;
    }

    this.animateScrollTo(x, y);
  }

  /** Scroll to make a specific item/child visible */
  scrollToItem(index: number): void {
    if (this._config.snapSize > 0) {
      const pos = index * this._config.snapSize;
      if (this._config.direction === 'horizontal') {
        this.scrollTo(pos, this._scrollY);
      } else {
        this.scrollTo(this._scrollX, pos);
      }
    }
  }

  /** Current scroll position */
  get scrollPosition(): { x: number; y: number } {
    return { x: this._scrollX, y: this._scrollY };
  }

  /** Resize the scroll viewport */
  resize(width: number, height: number): void {
    this._config.width = width;
    this._config.height = height;

    // Redraw mask and background
    this._mask.clear();
    this._mask.roundRect(0, 0, width, height, this._config.borderRadius).fill(0xffffff);

    this._bg.clear();

    this.hitArea = { contains: (x: number, y: number) =>
      x >= 0 && x <= width && y >= 0 && y <= height };

    this.clampScroll();
    this.applyScroll();
  }

  /** Destroy and clean up */
  override destroy(options?: any): void {
    this.stopAnimation();
    if (this._scrollbarFadeTimeout !== null) {
      clearTimeout(this._scrollbarFadeTimeout);
    }
    this.off('pointerdown', this.onPointerDown);
    this.off('pointermove', this.onPointerMove);
    this.off('pointerup', this.onPointerUp);
    this.off('pointerupoutside', this.onPointerUp);
    this.off('wheel', this.onWheel);
    super.destroy(options);
  }

  // ─── Scroll mechanics ─────────────────────────────────

  private get contentWidth(): number {
    if (!this._content) return 0;
    const bounds = this._content.getBounds();
    return bounds.width;
  }

  private get contentHeight(): number {
    if (!this._content) return 0;
    const bounds = this._content.getBounds();
    return bounds.height;
  }

  private get maxScrollX(): number {
    return Math.max(0, this.contentWidth - this._config.width);
  }

  private get maxScrollY(): number {
    return Math.max(0, this.contentHeight - this._config.height);
  }

  private canScrollX(): boolean {
    return this._config.direction === 'horizontal' || this._config.direction === 'both';
  }

  private canScrollY(): boolean {
    return this._config.direction === 'vertical' || this._config.direction === 'both';
  }

  private clampScroll(): void {
    if (this.canScrollX()) {
      this._scrollX = Math.max(0, Math.min(this._scrollX, this.maxScrollX));
    } else {
      this._scrollX = 0;
    }
    if (this.canScrollY()) {
      this._scrollY = Math.max(0, Math.min(this._scrollY, this.maxScrollY));
    } else {
      this._scrollY = 0;
    }
  }

  private applyScroll(): void {
    if (!this._content) return;
    this._content.x = -this._scrollX;
    this._content.y = -this._scrollY;
    this.updateScrollbars();
  }

  // ─── Input handlers ────────────────────────────────────

  private onPointerDown = (e: any): void => {
    this._isDragging = true;
    this._isAnimating = false;
    this.stopAnimation();
    this.cursor = 'grabbing';

    const local = e.getLocalPosition(this);
    this._dragStart = { x: local.x, y: local.y };
    this._scrollStart = { x: this._scrollX, y: this._scrollY };
    this._lastDragPos = { x: local.x, y: local.y };
    this._lastDragTime = Date.now();
    this._velocityX = 0;
    this._velocityY = 0;

    this.showScrollbars();
  };

  private onPointerMove = (e: any): void => {
    if (!this._isDragging) return;

    const local = e.getLocalPosition(this);
    const dx = local.x - this._dragStart.x;
    const dy = local.y - this._dragStart.y;
    const now = Date.now();
    const dt = Math.max(1, now - this._lastDragTime);

    // Calculate velocity for inertia
    this._velocityX = (local.x - this._lastDragPos.x) / dt * 16; // normalize to ~60fps
    this._velocityY = (local.y - this._lastDragPos.y) / dt * 16;

    this._lastDragPos = { x: local.x, y: local.y };
    this._lastDragTime = now;

    // Apply scroll with elasticity for overscroll
    let newX = this._scrollStart.x - dx;
    let newY = this._scrollStart.y - dy;

    const elasticity = this._config.elasticity;
    if (this.canScrollX()) {
      if (newX < 0) newX *= elasticity;
      else if (newX > this.maxScrollX) newX = this.maxScrollX + (newX - this.maxScrollX) * elasticity;
      this._scrollX = newX;
    }
    if (this.canScrollY()) {
      if (newY < 0) newY *= elasticity;
      else if (newY > this.maxScrollY) newY = this.maxScrollY + (newY - this.maxScrollY) * elasticity;
      this._scrollY = newY;
    }

    this.applyScroll();
  };

  private onPointerUp = (): void => {
    if (!this._isDragging) return;
    this._isDragging = false;
    this.cursor = 'grab';

    // Start inertia
    if (Math.abs(this._velocityX) > 0.5 || Math.abs(this._velocityY) > 0.5) {
      this.startInertia();
    } else {
      this.snapAndBounce();
    }
  };

  private onWheel = (e: any): void => {
    e.preventDefault?.();
    const delta = e.deltaY ?? 0;
    const deltaX = e.deltaX ?? 0;

    if (this.canScrollY()) {
      this._scrollY += delta * 0.5;
    }
    if (this.canScrollX()) {
      this._scrollX += deltaX * 0.5;
    }

    this.clampScroll();
    this.applyScroll();
    this.showScrollbars();
    this.scheduleScrollbarFade();
  };

  // ─── Inertia & snap ───────────────────────────────────

  private startInertia(): void {
    this._isAnimating = true;

    const tick = () => {
      if (!this._isAnimating) return;

      this._velocityX *= this._config.inertia;
      this._velocityY *= this._config.inertia;

      if (this.canScrollX()) this._scrollX -= this._velocityX;
      if (this.canScrollY()) this._scrollY -= this._velocityY;

      // Bounce back if overscrolled
      let bounced = false;
      if (this.canScrollX()) {
        if (this._scrollX < 0) { this._scrollX *= 0.8; bounced = true; }
        else if (this._scrollX > this.maxScrollX) {
          this._scrollX = this.maxScrollX + (this._scrollX - this.maxScrollX) * 0.8;
          bounced = true;
        }
      }
      if (this.canScrollY()) {
        if (this._scrollY < 0) { this._scrollY *= 0.8; bounced = true; }
        else if (this._scrollY > this.maxScrollY) {
          this._scrollY = this.maxScrollY + (this._scrollY - this.maxScrollY) * 0.8;
          bounced = true;
        }
      }

      this.applyScroll();

      const speed = Math.abs(this._velocityX) + Math.abs(this._velocityY);
      if (speed < 0.1 && !bounced) {
        this._isAnimating = false;
        this.snapAndBounce();
        return;
      }

      this._animationFrame = requestAnimationFrame(tick);
    };

    this._animationFrame = requestAnimationFrame(tick);
  }

  private snapAndBounce(): void {
    // Clamp first
    let targetX = Math.max(0, Math.min(this._scrollX, this.maxScrollX));
    let targetY = Math.max(0, Math.min(this._scrollY, this.maxScrollY));

    // Snap
    if (this._config.snapSize > 0) {
      if (this.canScrollY()) {
        targetY = Math.round(targetY / this._config.snapSize) * this._config.snapSize;
        targetY = Math.max(0, Math.min(targetY, this.maxScrollY));
      }
      if (this.canScrollX()) {
        targetX = Math.round(targetX / this._config.snapSize) * this._config.snapSize;
        targetX = Math.max(0, Math.min(targetX, this.maxScrollX));
      }
    }

    if (Math.abs(targetX - this._scrollX) < 0.5 && Math.abs(targetY - this._scrollY) < 0.5) {
      this._scrollX = targetX;
      this._scrollY = targetY;
      this.applyScroll();
      this.scheduleScrollbarFade();
      return;
    }

    this.animateScrollTo(targetX, targetY);
  }

  private animateScrollTo(targetX: number, targetY: number): void {
    this._isAnimating = true;
    const startX = this._scrollX;
    const startY = this._scrollY;
    const startTime = Date.now();
    const duration = 300;

    const tick = () => {
      if (!this._isAnimating) return;

      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);

      this._scrollX = startX + (targetX - startX) * eased;
      this._scrollY = startY + (targetY - startY) * eased;
      this.applyScroll();

      if (t < 1) {
        this._animationFrame = requestAnimationFrame(tick);
      } else {
        this._isAnimating = false;
        this.scheduleScrollbarFade();
      }
    };

    this._animationFrame = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    this._isAnimating = false;
    if (this._animationFrame !== null) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
  }

  // ─── Scrollbars ────────────────────────────────────────

  private updateScrollbars(): void {
    const { width, height, scrollbarWidth, scrollbarColor, scrollbarAlpha } = this._config;

    if (this._scrollbarV && this.canScrollY() && this.contentHeight > height) {
      const ratio = height / this.contentHeight;
      const barH = Math.max(20, height * ratio);
      const barY = (this._scrollY / this.maxScrollY) * (height - barH);

      this._scrollbarV.clear();
      this._scrollbarV.roundRect(
        width - scrollbarWidth - 2,
        Math.max(0, barY),
        scrollbarWidth,
        barH,
        scrollbarWidth / 2,
      ).fill({ color: scrollbarColor, alpha: scrollbarAlpha });
    }

    if (this._scrollbarH && this.canScrollX() && this.contentWidth > width) {
      const ratio = width / this.contentWidth;
      const barW = Math.max(20, width * ratio);
      const barX = (this._scrollX / this.maxScrollX) * (width - barW);

      this._scrollbarH.clear();
      this._scrollbarH.roundRect(
        Math.max(0, barX),
        height - scrollbarWidth - 2,
        barW,
        scrollbarWidth,
        scrollbarWidth / 2,
      ).fill({ color: scrollbarColor, alpha: scrollbarAlpha });
    }
  }

  private showScrollbars(): void {
    if (this._scrollbarV) this._scrollbarV.alpha = 1;
    if (this._scrollbarH) this._scrollbarH.alpha = 1;
  }

  private scheduleScrollbarFade(): void {
    if (this._scrollbarFadeTimeout !== null) {
      clearTimeout(this._scrollbarFadeTimeout);
    }
    this._scrollbarFadeTimeout = window.setTimeout(() => {
      this.fadeScrollbars();
    }, 1000);
  }

  private fadeScrollbars(): void {
    const duration = 300;
    const startTime = Date.now();
    const startAlphaV = this._scrollbarV?.alpha ?? 0;
    const startAlphaH = this._scrollbarH?.alpha ?? 0;

    const tick = () => {
      const t = Math.min((Date.now() - startTime) / duration, 1);
      if (this._scrollbarV) this._scrollbarV.alpha = startAlphaV * (1 - t);
      if (this._scrollbarH) this._scrollbarH.alpha = startAlphaH * (1 - t);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
