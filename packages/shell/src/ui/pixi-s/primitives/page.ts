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

/** The S full-screen page (game info): a veil over the frosted game, a yellow title plate at the
 *  column's left and a yellow ✕ at its right, and the column scrolling under them. Rebuilt on resize. */
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

    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    this.titlePlate = new STitlePlate(this.opts.title, strip.height, col.width - strip.height * 1.5);
    this.titlePlate.position.set(col.x, strip.top);
    this.closeBtn = sCloseButton(strip.height, () => this.opts.onClose());
    this.closeBtn.position.set(col.x + col.width - strip.height, strip.top);
    this.addChild(this.titlePlate, this.closeBtn);

    const top = strip.top + strip.height * 1.3;
    this.viewH = Math.max(0, h - top - 12);
    this.scroll.position.set(col.x, top);
    this.scroll.setViewport(col.width + ScrollBox.GUTTER, this.viewH);
    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    const content = this.opts.build(col.width);
    if (content instanceof FlexBox) content.setLayoutSize(col.width, undefined);
    const tail = new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 });
    tail.position.set(0, content.y + content.height + 16);
    this.scroll.content.addChild(content, tail);
    this.scroll.refresh();
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
