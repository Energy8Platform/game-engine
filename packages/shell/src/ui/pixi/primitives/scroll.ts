import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';

/** A vertically-scrolling viewport — mask + drag + mouse-wheel, the Pixi analogue of the
 *  overlay's `overflow-y:auto` scroll region. Add content to `.content`; call `refresh()`
 *  after content changes or a resize. */
export class ScrollBox extends Container {
  readonly content = new Container();
  private maskG = new Graphics();
  private viewW = 0;
  private viewH = 0;
  private scrollY = 0;
  private maxScroll = 0;
  private dragging = false;
  private lastY = 0;
  private moved = false;
  private canvas?: HTMLCanvasElement;
  private wheelHandler?: (e: WheelEvent) => void;

  constructor(canvas?: HTMLCanvasElement) {
    super();
    this.canvas = canvas;
    this.addChild(this.content);
    // maskG is added to the scene only while scrolling (see refresh) — a leftover unused mask
    // graphic renders as a white rect, and a masked container blocks pointer events to its children.
    this.eventMode = 'static';
    this.on('pointerdown', this.onDown);
    this.on('globalpointermove', this.onMove);
    this.on('pointerup', this.onUp);
    this.on('pointerupoutside', this.onUp);
    if (this.canvas) {
      this.wheelHandler = (e: WheelEvent) => {
        // Always swallow the wheel while this scroll region is mounted (a modal is open) so the
        // gesture never chains to the parent page — on Stake the game is in an iframe and an
        // un-prevented wheel scrolls the host page. Still scroll our content when it overflows.
        e.preventDefault();
        if (this.maxScroll > 0) this.setScroll(this.scrollY + e.deltaY);
      };
      this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.maskG.clear();
    this.maskG.rect(0, 0, w, h);
    this.maskG.fill(0xffffff);
    this.refresh();
  }

  /** Re-measure content height, clamp the scroll, and clip only when it overflows. */
  refresh(): void {
    this.content.mask = null; // measure unmasked (a mask clips getLocalBounds to the viewport)
    if (this.maskG.parent) this.removeChild(this.maskG);
    const b = this.content.getLocalBounds();
    const contentH = b.height + b.y; // content laid out from y≈0 downward
    this.maxScroll = Math.max(0, contentH - this.viewH);
    // Only clip + grab pointer/drag when the content actually overflows: a masked container blocks
    // pointer events to its children in Pixi v8, so when it fits we leave it unmasked and passive →
    // interactive controls (settings sliders/buttons) work. Tall scrolling content (game info) that
    // does get masked has no interactive children, so nothing is lost there.
    const scrollable = this.maxScroll > 0;
    if (scrollable) {
      this.addChild(this.maskG);
      this.content.mask = this.maskG;
      this.hitArea = new Rectangle(0, 0, this.viewW, this.viewH);
    } else {
      this.hitArea = null;
    }
    this.eventMode = scrollable ? 'static' : 'passive';
    this.setScroll(this.scrollY);
  }

  /** Max scrollable distance (0 when content fits) — exposed for tests. */
  get maxScrollY(): number {
    return this.maxScroll;
  }

  /** Scroll by `dy` pixels (positive = down, negative = up), clamped to [0, maxScroll]. */
  scrollBy(dy: number): void {
    this.setScroll(this.scrollY + dy);
  }

  private setScroll(y: number): void {
    // Ignore late scrolls after teardown: a queued keydown (or resize) can route here once the modal
    // has been destroyed, and writing to a torn-down content Container throws (use-after-destroy).
    if (this.destroyed || !this.content || this.content.destroyed) return;
    this.scrollY = Math.max(0, Math.min(this.maxScroll, y)) || 0; // || 0 converts -0 to 0
    this.content.y = this.scrollY === 0 ? 0 : -this.scrollY;
  }

  private onDown = (e: FederatedPointerEvent): void => {
    this.dragging = true;
    this.moved = false;
    this.lastY = e.global.y;
  };
  private onMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    const dy = e.global.y - this.lastY;
    if (Math.abs(dy) > 2) this.moved = true;
    this.lastY = e.global.y;
    if (this.maxScroll > 0) this.setScroll(this.scrollY - dy);
  };
  private onUp = (): void => {
    this.dragging = false;
  };

  /** True if the last pointer sequence was a drag (so a tap handler can ignore it). */
  get didDrag(): boolean {
    return this.moved;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.canvas && this.wheelHandler) {
      this.canvas.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = undefined;
    }
    super.destroy(options);
  }
}
