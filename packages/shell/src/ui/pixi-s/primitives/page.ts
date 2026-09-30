import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { FlexBox } from '../../pixi/primitives/flex';
import { ScrollBox } from '../../pixi-hb/primitives/scroll';
import { clamp, frameRect } from '../../pixi-hb/primitives/overlay';
import type { SButton } from '../widgets';
import { STitlePlate, sCloseButton, S_SCROLL } from './controls';
import { S } from '../theme';
import { BORDER } from '../../pixi-hb/theme';

/** Where the page's top strip sits on a screen `h` tall: its top edge and height. */
export function stripMetrics(h: number): { top: number; height: number } {
  return { top: clamp(12, h * 0.03, 24), height: clamp(44, h * 0.09, 72) };
}

/** The ✕'s place, shared by every S overlay: the top-right screen corner, inboard of the scrollbar
 *  gutter, one strip tall. */
export function closeCorner(w: number, h: number): { x: number; y: number; size: number } {
  const { top: m, height: size } = stripMetrics(h);
  return { x: w - m - ScrollBox.GUTTER - size, y: m, size };
}

/** The page column: HB game info's body width, centred — "по ширине и позиционированию оставить
 *  также". HB: inner = frame − 2·border; body = min(760, inner − 2·sidePad − gutter). */
export function pageColumn(w: number, h: number): { x: number; width: number } {
  const inner = frameRect(w, h).width - 2 * BORDER;
  const sidePad = clamp(12, inner * 0.04, 24);
  const width = Math.min(760, inner - sidePad * 2 - ScrollBox.GUTTER);
  return { x: Math.round((w - width - ScrollBox.GUTTER) / 2), width };
}

export interface SPageOpts {
  tag: string;
  title: string;
  onClose(): void;
  /** Build the scrolling column's content for a given width (a Sizable column). */
  build(width: number): Container;
}

/** The S full-screen page (game info): a veil over the frosted game, a yellow title plate in the
 *  top-left screen corner and a yellow ✕ in the top-right (clear of the scrollbar); the scroll area is the
 *  whole screen with the content column centred in it. Rebuilt on resize. */
export class SPage extends Container implements ShellLayer {
  readonly tag: string;
  readonly veil = new Graphics();
  titlePlate?: STitlePlate;
  closeBtn?: SButton;
  private opts: SPageOpts;
  private scroll: ScrollBox;
  private viewH = 0;

  get scrollContent(): ScrollBox {
    return this.scroll;
  }

  constructor(host: PixiComponentContext, opts: SPageOpts) {
    super();
    this.opts = opts;
    this.tag = opts.tag;
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.scroll = new ScrollBox(host.canvas, host.ticker, S_SCROLL);
    this.addChild(this.veil, this.scroll);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    const col = pageColumn(w, h);
    const strip = stripMetrics(h);
    const m = strip.top;

    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    this.titlePlate = new STitlePlate(this.opts.title, strip.height, w - m * 4 - strip.height - ScrollBox.GUTTER);
    this.titlePlate.position.set(m, m);
    const c = closeCorner(w, h);
    this.closeBtn = sCloseButton(c.size, () => this.opts.onClose());
    this.closeBtn.position.set(c.x, c.y);

    // the scroll area is the whole screen (scrollbar on the right edge); the column sits centred in it
    this.viewH = h;
    this.scroll.position.set(0, 0);
    this.scroll.setViewport(w, h);
    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    const content = this.opts.build(col.width);
    if (content instanceof FlexBox) content.setLayoutSize(col.width, undefined);
    content.position.set(Math.round((w - ScrollBox.GUTTER - col.width) / 2), Math.round(m + strip.height * 1.5));
    const tail = new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 });
    tail.position.set(content.x, content.y + content.height + 16);
    this.scroll.content.addChild(content, tail);
    this.scroll.refresh();
    this.addChild(this.titlePlate, this.closeBtn); // above the scroll box
  }

  fit(): void {
    /* re-laid out on resize */
  }

  /** Scroll keys as HB's overlay; Escape is left to the controller (it closes the layer). */
  onKey(e: KeyboardEvent): boolean {
    const page = Math.floor(this.viewH * 0.9);
    switch (e.code) {
      case 'ArrowDown':
        this.scroll.scrollBy(60);
        return true;
      case 'ArrowUp':
        this.scroll.scrollBy(-60);
        return true;
      case 'PageDown':
        this.scroll.scrollBy(page);
        return true;
      case 'PageUp':
        this.scroll.scrollBy(-page);
        return true;
      case 'Space':
        this.scroll.scrollBy(e.shiftKey ? -page : page);
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
