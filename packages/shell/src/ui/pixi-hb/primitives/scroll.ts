import { Container, Graphics, Rectangle, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { scrollHint } from '@/core/scrollHint';
import { ScrollAffordanceView, THUMB_THICK, THUMB_INSET, type ScrollLook } from './scroll-affordance';

/** How far (px, along the axis) the pointer travels from the press before it is a drag, not a tap. */
const DRAG_SLOP = 4;

/** A scrolling viewport (vertical by default, or horizontal) — mask + drag + mouse-wheel, the Pixi
 *  analogue of the overlay's `overflow:auto` scroll region. Add content to `.content`; call `refresh()`
 *  after content changes or a resize. */
export class ScrollBox extends Container {
  /** Room the scrollbar takes at the right edge (y) or the bottom edge (x) — content should stay clear of it. */
  static readonly GUTTER = THUMB_THICK + THUMB_INSET * 2;
  readonly content = new Container();
  /** The drawn "this scrolls" marks — thumb, edge scrim, chevron. Public so the overlay that owns
   *  the box (and the tests) can read what a player would see. */
  readonly affordance: ScrollAffordanceView;
  private maskG = new Graphics();
  private viewW = 0;
  private viewH = 0;
  private scrollY = 0;
  private maxScroll = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** The press point along the axis, in the parent's space. */
  private pressAt = 0;
  private axis: 'x' | 'y';
  private moved = false;
  private canvas?: HTMLCanvasElement;
  private wheelHandler?: (e: WheelEvent) => void;

  constructor(canvas?: HTMLCanvasElement, _ticker?: Ticker, look?: ScrollLook, axis: 'x' | 'y' = 'y') {
    super();
    this.axis = axis;
    this.canvas = canvas;
    this.affordance = new ScrollAffordanceView(look);
    // Added AFTER content, and never masked: the marks describe the viewport, so clipping them to
    // the content they describe would hide them exactly when the content overflows.
    this.addChild(this.content, this.affordance);
    // maskG is added to the scene only while scrolling (see refresh) — a leftover unused mask
    // graphic renders as a white rect. (Masking does NOT gate pointer events to the content, despite
    // what an earlier version of this comment claimed — see the correction in refresh() below.)
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
        if (this.maxScroll > 0) this.setScroll(
          this.scrollY + (this.axis === 'x' && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY),
        );
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
    const x = this.axis === 'x';
    const contentLen = x ? b.width + b.x : b.height + b.y; // content laid out from 0 onward
    this.maxScroll = Math.max(0, contentLen - (x ? this.viewW : this.viewH));
    // Only clip + grab pointer/drag when the content actually overflows. (An earlier version of this
    // comment claimed a masked container blocks pointer events to its children in Pixi v8 — that's
    // false: EventBoundary's hitPruneFn only prunes a point OUTSIDE the mask/hitArea, so interactive
    // children stay reachable anywhere inside the visible viewport; see tests/pixi/bet-picker-fit.test.ts
    // and tests/pixi/menu.test.ts, which hit-test an overflowing, masked list on purpose to prove it.
    // We still only mask + grab the pointer when scrollable, since an unmasked, passive box is
    // simpler and cheaper when there's nothing to clip or drag.)
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
    this.syncAffordance();
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
    this.content[this.axis] = this.scrollY === 0 ? 0 : -this.scrollY;
    this.syncAffordance();
  }

  private syncAffordance(): void {
    if (this.destroyed || this.affordance.destroyed) return;
    const len = this.axis === 'x' ? this.viewW : this.viewH;
    this.affordance.update(
      { x: 0, y: 0, w: this.viewW, h: this.viewH, axis: this.axis },
      scrollHint({ scrollTop: this.scrollY, scrollHeight: len + this.maxScroll, clientHeight: len }),
    );
  }

  /** A press in the scrollbar gutter drags the THUMB (content moves track-proportionally); anywhere
   *  else drags the content itself. */
  private thumbDrag = false;
  /** Pointer position in the parent's space, so a drag is 1:1 under the finger even when the parent
   *  is scaled. */
  private parentPoint(e: FederatedPointerEvent): { x: number; y: number } {
    return this.parent ? this.parent.toLocal(e.global) : e.global;
  }
  private onDown = (e: FederatedPointerEvent): void => {
    this.dragging = true;
    this.moved = false;
    const p = this.parentPoint(e);
    this.lastX = p.x;
    this.lastY = p.y;
    this.pressAt = this.axis === 'x' ? p.x : p.y;
    const local = this.toLocal(e.global);
    const t = this.affordance.trackBounds;
    if (this.axis === 'x') {
      this.thumbDrag = !!t && local.y >= t.y - THUMB_INSET;
      if (this.thumbDrag && t) {
        const b = this.affordance.thumbBounds!;
        // a press outside the thumb jumps it there
        if (local.x < b.x || local.x > b.x + b.w) this.setScroll(((local.x - t.x - b.w / 2) / Math.max(1, t.w - b.w)) * this.maxScroll);
      }
      return;
    }
    this.thumbDrag = !!t && local.x >= t.x - THUMB_INSET;
    if (this.thumbDrag && t) {
      const b = this.affordance.thumbBounds!;
      if (local.y < b.y || local.y > b.y + b.h) this.setScroll(((local.y - t.y - b.h / 2) / Math.max(1, t.h - b.h)) * this.maxScroll);
    }
  };
  private onMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    const p = this.parentPoint(e);
    const x = this.axis === 'x';
    const d = x ? p.x - this.lastX : p.y - this.lastY;
    // a drag once the finger is more than 4px from the press along the axis — a slow drag too
    if (Math.abs((x ? p.x : p.y) - this.pressAt) > DRAG_SLOP) this.moved = true;
    this.lastX = p.x;
    this.lastY = p.y;
    if (this.maxScroll <= 0) return;
    if (this.thumbDrag) {
      const t = this.affordance.trackBounds;
      const b = this.affordance.thumbBounds;
      const travel = t && b ? Math.max(1, x ? t.w - b.w : t.h - b.h) : 1;
      this.setScroll(this.scrollY + (d / travel) * this.maxScroll);
    } else {
      this.setScroll(this.scrollY - d);
    }
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
