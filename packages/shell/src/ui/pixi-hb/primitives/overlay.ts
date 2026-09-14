import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { makeText } from '../text';
import { IconButton } from './widgets';
import { ScrollBox } from './scroll';
import { FlexBox } from '../../pixi/primitives/flex';
import { HB, BORDER, RADIUS } from '../theme';
import { plaque } from './plaque';

export function clamp(min: number, pref: number, max: number): number {
  return Math.max(min, Math.min(max, pref));
}

/** Header nav button — an orange square plaque with a beige glyph. */
export function navButton(_host: PixiComponentContext, iconName: 'close' | 'back', onTap: () => void, size = 36): IconButton {
  return new IconButton(iconName, { size, glyph: Math.round(size * 0.5), face: 'orange', onTap });
}

/** Where the 80 % frame lands on a `w × h` screen: at most 80 % per axis, at least screen − 16. */
export function frameRect(w: number, h: number): Rectangle {
  const fw = Math.min(w - 16, Math.max(w * 0.8, Math.min(w - 16, 360)));
  const fh = Math.min(h - 16, Math.max(h * 0.8, Math.min(h - 16, 240)));
  return new Rectangle(Math.round((w - fw) / 2), Math.round((h - fh) / 2), Math.round(fw), Math.round(fh));
}

export interface FrameOpts {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  tag?: string;
}

/** The HB modal frame: a backdrop veil, a solid panel plaque sized to 80 % of the screen, and a
 *  header band (Space Grotesk title, orange close plaque on the right, ink rule underneath). Subclasses
 *  lay their content into `inner` (the area under the header, inside the border). */
export class Frame extends Container implements ShellLayer {
  readonly tag?: string;
  protected host: PixiComponentContext;
  protected veil = new Graphics();
  protected panel = new Graphics();
  protected header = new Container();
  /** Frame rect in screen space. */
  protected frame = new Rectangle();
  /** Content rect in screen space (under the header, inside the border). */
  protected inner = new Rectangle();
  protected headerH = 48;
  private frameOpts: FrameOpts;

  constructor(host: PixiComponentContext, opts: FrameOpts) {
    super();
    this.host = host;
    this.frameOpts = opts;
    this.tag = opts.tag;
    this.addChild(this.veil, this.panel, this.header);
    this.veil.eventMode = 'static'; // swallow clicks to the game behind
    this.panel.eventMode = 'static';
  }

  protected layoutFrame(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(HB.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.frame = frameRect(w, h);
    this.headerH = clamp(44, this.frame.height * 0.12, 60);
    const f = this.frame;
    plaque(this.panel, f.width, f.height, { fill: HB.panel, border: HB.line });
    // header rule — the "highlighted" band is closed by an ink line at its bottom edge
    this.panel.rect(BORDER, this.headerH - BORDER, f.width - BORDER * 2, BORDER).fill(HB.line);
    this.panel.position.set(f.x, f.y);
    this.panel.hitArea = new Rectangle(0, 0, f.width, f.height);
    this.inner = new Rectangle(f.x + BORDER, f.y + this.headerH, f.width - BORDER * 2, f.height - this.headerH - BORDER);
    this.buildHeader();
  }

  private buildHeader(): void {
    this.header.removeChildren().forEach((c) => c.destroy({ children: true }));
    const f = this.frame;
    const nav = clamp(30, this.headerH - 12, 36);
    const pad = (this.headerH - BORDER - nav) / 2;
    const left = this.frameOpts.onBack ? navButton(this.host, 'back', () => this.frameOpts.onBack!(), nav) : null;
    const close = navButton(this.host, 'close', () => this.frameOpts.onClose(), nav);
    const titleSize = clamp(16, this.headerH * 0.5, 28); // 2em of the game-info scale at full size
    const title = makeText(this.frameOpts.title, {
      size: titleSize,
      weight: '700',
      heading: true,
      color: HB.fg,
      letterSpacing: titleSize * 0.04,
      upper: true,
      align: 'center',
    });
    const maxTitleW = f.width - (nav + pad) * 2 - 24;
    if (title.width > maxTitleW) title.scale.set(maxTitleW / title.width);
    title.anchor.set(0.5);
    title.position.set(f.x + f.width / 2, f.y + (this.headerH - BORDER) / 2);
    close.position.set(f.x + f.width - BORDER - pad - nav, f.y + BORDER + pad - BORDER / 2);
    this.header.addChild(title, close);
    if (left) {
      left.position.set(f.x + BORDER + pad, close.y);
      this.header.addChild(left);
    }
  }

  resize(w: number, h: number): void {
    this.layoutFrame(w, h);
  }

  fit(): void {
    /* frames re-fit on resize */
  }
}

export interface OverlayOpts extends FrameOpts {
  /** Build the scrolling body content for a given inner width (a Sizable column). */
  build: (bodyWidth: number) => Container;
}

/** A framed modal with a scrolling body (game info). The body is rebuilt on resize so it reflows. */
export class Overlay extends Frame {
  private opts: OverlayOpts;
  private scroll: ScrollBox;

  /** Expose the scroll box for keyboard/test access. */
  get scrollContent(): ScrollBox { return this.scroll; }

  constructor(host: PixiComponentContext, opts: OverlayOpts) {
    super(host, opts);
    this.opts = opts;
    this.scroll = new ScrollBox(host.canvas, host.ticker);
    this.addChildAt(this.scroll, 2); // above the panel, below the header
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.layoutFrame(w, h);
    this.layoutBody();
  }

  private layoutBody(): void {
    const r = this.inner;
    const sidePad = clamp(12, r.width * 0.04, 24);
    const vPad = 16;
    const bodyW = Math.min(760, r.width - sidePad * 2 - ScrollBox.GUTTER);

    this.scroll.position.set(r.x, r.y);
    this.scroll.setViewport(r.width, r.height);
    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));

    const content = this.opts.build(bodyW);
    if (content instanceof FlexBox) content.setLayoutSize(bodyW, undefined);
    content.position.set(Math.round((r.width - ScrollBox.GUTTER - bodyW) / 2), vPad);
    // bottom padding so the last card clears the frame's rounded corner
    const pad = new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 });
    pad.position.set(0, content.y + content.height + vPad + RADIUS);
    this.scroll.content.addChild(content, pad);
    this.scroll.refresh();
  }

  onKey(e: KeyboardEvent): boolean {
    const viewH = this.inner.height;
    const lineStep = 60;
    const pageStep = Math.floor(viewH * 0.9);
    switch (e.code) {
      case 'ArrowDown':
        this.scroll.scrollBy(lineStep);
        return true;
      case 'ArrowUp':
        this.scroll.scrollBy(-lineStep);
        return true;
      case 'PageDown':
        this.scroll.scrollBy(pageStep);
        return true;
      case 'PageUp':
        this.scroll.scrollBy(-pageStep);
        return true;
      case 'Space':
        this.scroll.scrollBy(e.shiftKey ? -pageStep : pageStep);
        return true;
      case 'Home':
        this.scroll.scrollBy(-999999);
        return true;
      case 'End':
        this.scroll.scrollBy(999999);
        return true;
      default:
        return false;
    }
  }

  onRemove(): void {
    this.scroll.destroy({ children: true });
  }
}
