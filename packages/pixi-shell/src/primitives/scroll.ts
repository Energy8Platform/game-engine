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
    this.addChild(this.maskG);
    this.content.mask = this.maskG;
    this.eventMode = 'static';
    this.on('pointerdown', this.onDown);
    this.on('globalpointermove', this.onMove);
    this.on('pointerup', this.onUp);
    this.on('pointerupoutside', this.onUp);
    if (this.canvas) {
      this.wheelHandler = (e: WheelEvent) => {
        if (this.maxScroll <= 0) return;
        e.preventDefault();
        this.setScroll(this.scrollY + e.deltaY);
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
    this.hitArea = new Rectangle(0, 0, w, h);
    this.refresh();
  }

  /** Re-measure content height and clamp the scroll offset. */
  refresh(): void {
    const b = this.content.getLocalBounds();
    const contentH = b.height + b.y; // content laid out from y≈0 downward
    this.maxScroll = Math.max(0, contentH - this.viewH);
    this.setScroll(this.scrollY);
  }

  private setScroll(y: number): void {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, y));
    this.content.y = -this.scrollY;
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
