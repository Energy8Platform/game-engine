import { Container, Graphics, Rectangle } from 'pixi.js';
import type { ShellHost, ShellLayer } from '../context';
import { makeIcon } from '../pixi-icon';
import { makeText } from '../text';
import { attachHover, attachPress } from './widgets';
import { ScrollBox } from './scroll';
import { FlexBox } from './flex';

export function clamp(min: number, pref: number, max: number): number {
  return Math.max(min, Math.min(max, pref));
}

/** Small rounded icon nav button — the overlay header back/close and row chevrons.
 *  `.ge-ov-nav`: 32×32, radius 9, plaque-dark bg, white icon, hover → glass bg + accent icon. */
export function navButton(host: ShellHost, iconName: 'close' | 'back', onTap: () => void, size = 32): Container {
  const root = new Container();
  const bg = new Graphics();
  const draw = (hover: boolean): void => {
    bg.clear();
    bg.roundRect(0, 0, size, size, 9);
    bg.fill(hover ? host.tokens.plaqueGlass : host.tokens.plaqueDark);
  };
  draw(false);
  const glyph = makeIcon(iconName, 18, '#ffffff');
  glyph.position.set((size - 18) / 2, (size - 18) / 2);
  root.addChild(bg, glyph);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new Rectangle(0, 0, size, size);
  attachHover(root, () => {
    draw(true);
    glyph.setColor(host.tokens.accent);
  }, () => {
    draw(false);
    glyph.setColor('#ffffff');
  });
  attachPress(root, 0.92, onTap);
  return root;
}

export interface OverlayOpts {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  /** Build the scrolling body content for a given inner width (a Sizable column). */
  build: (bodyWidth: number) => Container;
  /** dataset-style tag for debugging/tests. */
  tag?: string;
}

/** Full-screen overlay: frosted dark veil, fixed header (title + back/close), scrolling body.
 *  The body is rebuilt on resize so it reflows like the CSS overlay. */
export class Overlay extends Container implements ShellLayer {
  readonly tag?: string;
  private host: ShellHost;
  private opts: OverlayOpts;
  private veil = new Graphics();
  private header = new Container();
  private scroll: ScrollBox;
  private titleNode = new Container();
  private nav = new Container();
  private w = 0;
  private h = 0;
  private headerH = 44;

  constructor(host: ShellHost, opts: OverlayOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.scroll = new ScrollBox(host.canvas);
    this.addChild(this.veil, this.scroll, this.header);
    this.veil.eventMode = 'static'; // swallow clicks to the game behind
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const vh = h / 100;
    this.headerH = clamp(40, 6.4 * vh, 52);

    // veil
    this.veil.clear();
    this.veil.rect(0, 0, w, h);
    this.veil.fill(this.host.tokens.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);

    this.buildHeader();
    this.layoutBody();
  }

  private buildHeader(): void {
    this.header.removeChildren().forEach((c) => c.destroy({ children: true }));
    const pad = 10;
    // back or spacer (left), centred title, close (right)
    const left = this.opts.onBack
      ? navButton(this.host, 'back', () => this.opts.onBack!())
      : new Container();
    const close = navButton(this.host, 'close', () => this.opts.onClose());
    const titleSize = clamp(13, 2.6 * (this.h / 100), 16);
    const title = makeText(this.opts.title, {
      size: titleSize,
      weight: '800',
      color: '#ffffff',
      letterSpacing: titleSize * 0.04,
      upper: true,
      align: 'center',
    });
    title.anchor.set(0.5);
    title.position.set(this.w / 2, this.headerH / 2 + pad / 2);
    left.position.set(pad, (this.headerH - 32) / 2 + pad / 2);
    close.position.set(this.w - 32 - pad, (this.headerH - 32) / 2 + pad / 2);
    this.header.addChild(title, left, close);
  }

  private layoutBody(): void {
    const top = this.headerH + 6;
    const sidePad = clamp(16, 4 * (this.w / 100), 24);
    const vPad = clamp(6, 2 * (this.h / 100), 16);
    const bodyW = Math.min(800, this.w - sidePad * 2);

    this.scroll.position.set(0, top);
    this.scroll.setViewport(this.w, this.h - top);
    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));

    const content = this.opts.build(bodyW);
    if (content instanceof FlexBox) content.setLayoutSize(bodyW, undefined);
    content.position.set((this.w - bodyW) / 2, vPad);
    this.scroll.content.addChild(content);
    this.scroll.refresh();
  }

  fit(): void {
    /* overlays scroll; no card fit needed */
  }

  onRemove(): void {
    this.scroll.destroy({ children: true });
  }
}
