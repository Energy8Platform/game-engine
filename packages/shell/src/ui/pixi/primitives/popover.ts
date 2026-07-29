import { Container, Graphics, Rectangle } from 'pixi.js';
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../context';
import { ScrollBox } from './scroll';
import { FlexBox } from './flex';

export interface PopoverOpts {
  tag?: string;
  /** The plate: drives x, y, maxH, below — screen coordinates, re-read on every layout (the bar
   *  rebuilds often). Falls back to `pointer` when it resolves to null (no distinct plaque), and to
   *  the centred, arrow-less layout when neither resolves. */
  plate(): Rect | null;
  /** The control the arrow points at (e.g. the burger) — drives arrowX only. Defaults to `plate`
   *  (today's single-rect behaviour) when omitted. */
  pointer?(): Rect | null;
  /** Scale factor the card matches to the bar's own fit-scale (`BottomBar.fitScale()`), so its
   *  typography/padding/row-heights carry the same visual weight the bar's chrome has. Defaults to 1. */
  scale?(): number;
  onClose(): void;
  /** Build the card content for a given inner width (LOCAL/unscaled units — see `scale`). */
  build(width: number): Container;
}

/** Light-dismiss popover: a transparent full-screen hit rect + a rounded card with an arrow.
 *  No veil, no frosted snapshot — the game stays visible and unblurred behind it. */
export class Popover extends Container implements ShellLayer {
  readonly tag?: string;
  readonly dismissLayer = new Graphics();
  readonly card = new Container();
  private bg = new Graphics();
  private arrow = new Graphics();
  private scroll: ScrollBox;
  private host: PixiComponentContext;
  private opts: PopoverOpts;
  private _cardX = 0;
  private _cardY = 0;
  private _cardW = 0;
  private _arrowX = -1;

  constructor(host: PixiComponentContext, opts: PopoverOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.scroll = new ScrollBox(host.canvas);
    this.card.addChild(this.bg, this.arrow, this.scroll);
    this.addChild(this.dismissLayer, this.card);
    this.dismissLayer.eventMode = 'static';
    this.dismissLayer.on('pointertap', () => this.opts.onClose());
    // Taps on the card must not fall through to the dismiss layer.
    this.card.eventMode = 'static';
    // `e` itself is undefined when a caller (or test) emits the event with no payload, so guard the
    // property access, not just the call.
    this.card.on('pointertap', (e?: { stopPropagation?: () => void }) => e?.stopPropagation?.());
    this.resize(host.screenW, host.screenH);
  }

  get cardX(): number { return this._cardX; }
  get cardY(): number { return this._cardY; }
  get cardWidth(): number { return this._cardW; }
  get arrowX(): number { return this._arrowX; }
  get arrowVisible(): boolean { return this.arrow.visible; }

  resize(w: number, h: number): void {
    this.dismissLayer.clear();
    this.dismissLayer.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0 });
    this.dismissLayer.hitArea = new Rectangle(0, 0, w, h);

    const s = this.opts.scale?.() ?? 1;
    const pad = 8;
    // Width is content-driven (spec: clamped to [220, min(320, surfaceWidth-16)]), so the real
    // content has to be measured before we know the final width to lay it out at. Probe-build once
    // at the SMALLEST allowed inner width purely to measure natural size, then throw that copy away
    // and build the kept one at the resolved final width. Measured in LOCAL (unscaled) units, like
    // every other Pixi size in this file — `s` only converts to screen units where placement needs
    // it (the card carries the scale as a single transform, same as the DOM's card).
    //
    // The probe deliberately measures at the MINIMUM, not the maximum: a decorative row (the menu's
    // separator) draws its divider line at exactly the width `build()` is called with — it has no
    // content-driven size of its own, unlike every real row, which ignores that parameter and sizes
    // from its icon/label/control regardless. Probing at the maximum would make that separator line
    // alone measure near-maximum and dominate `naturalWidth`, pegging the card at ~maxW for every
    // menu that has a separator — which the default menu always does. Probing at the minimum cannot
    // distort the result the other way: content narrower than the probe still clamps to minW either
    // way (nothing above changes), and content wider than the probe always wins the max() the layout
    // takes over row widths, so real content still drives growth past minW correctly.
    const probeW = POPOVER.minW - pad * 2;
    const probe = this.opts.build(probeW);
    const measured = probe instanceof FlexBox ? probe.measureSize().w : probe.getSize().width;
    probe.destroy({ children: true });

    // Resolve the ON-SCREEN width (screen units, clamped against the surface), then convert back to
    // LOCAL for the actual content layout — mirrors the DOM's naturalW·s → resolvedW → style.width÷s.
    const screenW = popoverWidth(w, (measured + pad * 2) * s);
    const localW = s > 0 ? screenW / s : screenW;
    const content = this.opts.build(localW - pad * 2);
    if (content instanceof FlexBox) content.setLayoutSize(localW - pad * 2, undefined);
    const contentH = content.getSize().height; // local units

    // The plate falls back to the pointer when it can't be resolved (no distinct plaque), and to the
    // centred/arrow-less layout when neither resolves — placePopover itself already defaults the
    // ARROW to `pointer ?? plate`, so passing the pointer through unconditionally is enough there.
    const plateRect = this.opts.plate() ?? this.opts.pointer?.() ?? null;
    const pointerRect = this.opts.pointer?.() ?? null;
    const p = placePopover(plateRect, { w, h }, { w: screenW, h: (contentH + pad * 2) * s }, pointerRect);
    const maxHLocal = s > 0 ? p.maxH / s : p.maxH;
    const cardH = Math.min(contentH + pad * 2, maxHLocal); // local units

    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.scroll.position.set(pad, pad);
    this.scroll.setViewport(localW - pad * 2, cardH - pad * 2);
    this.scroll.content.addChild(content);
    this.scroll.refresh();

    this.bg.clear();
    this.bg.roundRect(0, 0, localW, cardH, 18);
    this.bg.fill(this.host.tokens.plaqueDark);

    // Arrow: a 14×7 triangle (local units — it lives inside the scaled card) on the edge that faces
    // the plate.
    this.arrow.clear();
    this.arrow.visible = p.arrowX >= 0;
    if (this.arrow.visible) {
      const arrowXLocal = s > 0 ? p.arrowX / s : p.arrowX;
      const edge = p.below ? 0 : cardH;      // the card edge the arrow sits on
      const tip = p.below ? -7 : cardH + 7;  // the tip, pointing at the pointer (or the plate)
      this.arrow.moveTo(arrowXLocal - 7, edge);
      this.arrow.lineTo(arrowXLocal + 7, edge);
      this.arrow.lineTo(arrowXLocal, tip);
      this.arrow.fill(this.host.tokens.plaqueDark);
    }

    // The card carries the scale as ONE transform around its own (0,0) local origin — equivalent to
    // the DOM's transform-origin:top left — so `p.x`/`p.y` (screen units) remain its visual top-left
    // regardless of `s`, and every local size above (background rect, scroll viewport, arrow) scales
    // with it automatically.
    this.card.scale.set(s);
    this.card.position.set(p.x, p.y);
    this._cardX = p.x;
    this._cardY = p.y;
    this._cardW = screenW;
    this._arrowX = p.arrowX;
  }

  /** Arrow keys scroll a long list; everything else (Escape included) goes to the controller. */
  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown') { this.scroll.scrollBy(40); return true; }
    if (e.code === 'ArrowUp') { this.scroll.scrollBy(-40); return true; }
    return false;
  }

  fit(): void {
    this.resize(this.host.screenW, this.host.screenH);
  }

  onRemove(): void {
    this.scroll.destroy({ children: true });
  }
}
