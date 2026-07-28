import { Container, Graphics, Rectangle } from 'pixi.js';
import { placePopover, popoverWidth, POPOVER, type Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../context';
import { ScrollBox } from './scroll';
import { FlexBox } from './flex';

export interface PopoverOpts {
  tag?: string;
  /** Anchor rect in screen coordinates, re-read on every layout (the bar rebuilds often). */
  anchor(): Rect | null;
  onClose(): void;
  /** Build the card content for a given inner width. */
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

    const pad = 8;
    // Width is content-driven (spec: clamped to [220, min(320, surfaceWidth-16)]), so the real
    // content has to be measured before we know the final width to lay it out at. Probe-build once
    // at the SMALLEST allowed inner width purely to measure natural size, then throw that copy away
    // and build the kept one at the resolved final width.
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

    const width = popoverWidth(w, measured + pad * 2);
    const content = this.opts.build(width - pad * 2);
    if (content instanceof FlexBox) content.setLayoutSize(width - pad * 2, undefined);
    const contentH = content.getSize().height;

    const p = placePopover(this.opts.anchor(), { w, h }, { w: width, h: contentH + pad * 2 });
    const cardH = Math.min(contentH + pad * 2, p.maxH);

    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.scroll.position.set(pad, pad);
    this.scroll.setViewport(width - pad * 2, cardH - pad * 2);
    this.scroll.content.addChild(content);
    this.scroll.refresh();

    this.bg.clear();
    this.bg.roundRect(0, 0, width, cardH, 18);
    this.bg.fill(this.host.tokens.plaqueDark);

    // Arrow: a 14×7 triangle on the edge that faces the anchor.
    this.arrow.clear();
    this.arrow.visible = p.arrowX >= 0;
    if (this.arrow.visible) {
      const edge = p.below ? 0 : cardH;      // the card edge the arrow sits on
      const tip = p.below ? -7 : cardH + 7;  // the tip, pointing at the anchor
      this.arrow.moveTo(p.arrowX - 7, edge);
      this.arrow.lineTo(p.arrowX + 7, edge);
      this.arrow.lineTo(p.arrowX, tip);
      this.arrow.fill(this.host.tokens.plaqueDark);
    }

    this.card.position.set(p.x, p.y);
    this._cardX = p.x;
    this._cardY = p.y;
    this._cardW = width;
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
