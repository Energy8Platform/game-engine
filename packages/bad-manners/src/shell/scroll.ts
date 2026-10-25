import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import { C } from './theme';

/** Past this many screen px from the press it is a drag, not a tap. */
const DRAG_SLOP = 4;

/** A masked scrolling viewport (vertical, or horizontal for the bonus strip): drag + wheel. Add content
 *  to `.content`, then `refresh()`. Its progress bar (§5.2: a grey600 track with a lime fill up to how
 *  far the content has been seen) is drawn by `progressBar()` where the overlay wants it. */
export class ScrollBox extends Container {
  readonly content = new Container();
  private maskG = new Graphics();
  private viewW = 0;
  private viewH = 0;
  private pos = 0;
  private max = 0;
  private dragging = false;
  private last = 0;
  private pressAt = 0;
  private moved = false;
  private wheel?: (e: WheelEvent) => void;
  /** Called after every scroll (the overlay redraws its progress bar). */
  onScroll?: () => void;

  constructor(private canvas: HTMLCanvasElement | undefined, readonly axis: 'x' | 'y' = 'y') {
    super();
    this.addChild(this.content);
    this.eventMode = 'static';
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.moved = false;
      this.last = this.along(e);
      this.pressAt = axis === 'x' ? e.global.x : e.global.y;
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      const p = this.along(e);
      if (Math.abs((axis === 'x' ? e.global.x : e.global.y) - this.pressAt) > DRAG_SLOP) this.moved = true;
      this.scrollBy(this.last - p);
      this.last = p;
    });
    const up = (): void => {
      this.dragging = false;
    };
    this.on('pointerup', up);
    this.on('pointerupoutside', up);
    if (canvas) {
      this.wheel = (e: WheelEvent) => {
        e.preventDefault(); // never chain to the host page (Stake runs the game in an iframe)
        for (let n: Container | null = this; n; n = n.parent) if (!n.visible || n.eventMode === 'none') return;
        const d = axis === 'x' && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (this.max > 0) this.scrollBy(d);
      };
      canvas.addEventListener('wheel', this.wheel, { passive: false });
    }
  }

  /** Pointer position along the axis in the parent's space (1:1 under a scaled parent). */
  private along(e: FederatedPointerEvent): number {
    const p = this.parent ? this.parent.toLocal(e.global) : e.global;
    return this.axis === 'x' ? p.x : p.y;
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.maskG.clear().rect(0, 0, w, h).fill(0xffffff);
    this.refresh();
  }

  /** Re-measure the content; clip and take drags only when it overflows. */
  refresh(): void {
    this.content.mask = null;
    if (this.maskG.parent) this.removeChild(this.maskG);
    const b = this.content.getLocalBounds();
    const len = this.axis === 'x' ? b.x + b.width : b.y + b.height;
    this.max = Math.max(0, len - (this.axis === 'x' ? this.viewW : this.viewH));
    if (this.max > 0) {
      this.addChild(this.maskG);
      this.content.mask = this.maskG;
      this.hitArea = new Rectangle(0, 0, this.viewW, this.viewH);
    } else {
      this.hitArea = null;
    }
    this.scrollBy(0);
  }

  get scrollPos(): number {
    return this.pos;
  }
  get maxScroll(): number {
    return this.max;
  }
  /** The last press was a drag (a tap handler under it should ignore it). */
  get didDrag(): boolean {
    return this.moved;
  }

  /** How much of the content has been seen: (scrolled + viewport) / content, 1 when it fits. */
  get seen(): number {
    const view = this.axis === 'x' ? this.viewW : this.viewH;
    return this.max > 0 ? (this.pos + view) / (this.max + view) : 1;
  }

  scrollBy(d: number): void {
    if (this.destroyed || this.content.destroyed) return;
    this.pos = Math.max(0, Math.min(this.max, this.pos + d)) || 0;
    this.content[this.axis] = -this.pos;
    this.onScroll?.();
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.canvas && this.wheel) this.canvas.removeEventListener('wheel', this.wheel);
    this.wheel = undefined;
    super.destroy(options);
  }
}

/** §5.2's scroll progress: a grey600 track (8 tall, round ends) with a lime fill. `set(f)` fills 0..1. */
export class ProgressBar extends Container {
  private track = new Graphics();
  private fill = new Graphics();
  constructor(private w: number, private h = 8) {
    super();
    this.track.roundRect(0, 0, w, h, h / 2).fill(C.grey600);
    this.addChild(this.track, this.fill);
  }
  set(f: number): void {
    const fw = Math.max(this.h, this.w * Math.max(0, Math.min(1, f)));
    this.fill.clear().roundRect(0, 0, fw, this.h, this.h / 2).fill(C.lime);
  }
}
