import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import type { ShellHost } from '../context';
import { makeText } from '../text';
import { FlexBox, type Sizable } from './flex';
import { attachHover } from './widgets';

// Overlay/modal content primitives — section plaques, full-width glass rows, chips, sliders,
// wrapped paragraphs. Each mirrors a CSS class from the DOM shell (.ge-gi-sec, .ge-ov-row,
// .ge-chip, .ge-slider …).

/** Wrapped body text — `.ge-gi-sec p` / `.ge-gi-win-desc` etc. */
export function paragraph(
  host: ShellHost,
  text: string,
  width: number,
  opts: { size?: number; color?: string } = {},
): Text {
  return makeText(text, {
    size: opts.size ?? 15,
    weight: '400',
    color: opts.color ?? 'rgba(255,255,255,.88)',
    wrapWidth: width,
    lineHeight: (opts.size ?? 15) * 1.6,
  });
}

/** A zero-size flex child that grows to push siblings apart (CSS `flex:1` spacer). */
export class Spacer extends Container implements Sizable {
  private w = 0;
  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: 0 };
  }
}

/** A titled glass-plaque section — `.ge-gi-sec`. Stretch to the body width; add content via `.add`. */
export function section(host: ShellHost, title?: string): FlexBox {
  const sec = new FlexBox({
    direction: 'column',
    align: 'start',
    gap: 12,
    padding: { top: 16, bottom: 16, left: 18, right: 18 },
    background: { fill: host.tokens.plaqueGlass, radius: 16 },
  });
  if (title) {
    sec.add(
      makeText(title, {
        size: 11,
        weight: '700',
        color: host.tokens.plaqueLabel,
        letterSpacing: 11 * 0.14,
        upper: true,
      }),
    );
  }
  return sec;
}

/** A full-width glass row — `.ge-ov-row`. `button` adds hover (glass-hover bg + accent label). */
export class GlassRow extends Container implements Sizable {
  private host: ShellHost;
  private bg = new Graphics();
  private content = new Container();
  private w = 0;
  private h: number;
  private padX = 16;
  private isButton: boolean;
  private hoverLabels: Text[] = [];

  constructor(host: ShellHost, opts: { height?: number; button?: boolean; onTap?: () => void } = {}) {
    super();
    this.host = host;
    this.h = opts.height ?? 46;
    this.isButton = !!opts.button;
    this.addChild(this.bg, this.content);
    if (opts.button) {
      this.eventMode = 'static';
      this.cursor = 'pointer';
      attachHover(this, () => this.paint(true), () => this.paint(false));
      if (opts.onTap) this.on('pointertap', opts.onTap);
    }
    this.paint(false);
  }

  /** Register a label to recolour to accent on hover (button rows). */
  addContent(node: Container, accentOnHover?: Text): this {
    this.content.addChild(node);
    if (accentOnHover) this.hoverLabels.push(accentOnHover);
    return this;
  }

  private paint(hover: boolean): void {
    this.bg.clear();
    this.bg.roundRect(0, 0, this.w || 1, this.h, 16);
    this.bg.fill(hover && this.isButton ? this.host.tokens.plaqueGlassHover : this.host.tokens.plaqueGlass);
    for (const l of this.hoverLabels) l.style.fill = hover ? this.host.tokens.accent : '#ffffff';
  }

  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
    this.paint(false);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
  get innerWidth(): number {
    return this.w - this.padX * 2;
  }
  get rowHeight(): number {
    return this.h;
  }
  get pad(): number {
    return this.padX;
  }
}

/** Draggable volume slider — `.ge-slider` (accent fill + white thumb). */
export class Slider extends Container implements Sizable {
  private host: ShellHost;
  private track = new Graphics();
  private fill = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private _value: number;
  private onInput: (v: number) => void;

  constructor(host: ShellHost, value: number, onInput: (v: number) => void) {
    super();
    this.host = host;
    this._value = value;
    this.onInput = onInput;
    this.addChild(this.track, this.fill, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', this.onDown);
    this.on('globalpointermove', this.onMove);
    // release over the slider (pointerup) OR anywhere else after a press on it (pointerupoutside)
    this.on('pointerup', this.endDrag);
    this.on('pointerupoutside', this.endDrag);
  }

  private dragging = false;
  private onDown = (e: FederatedPointerEvent): void => {
    this.dragging = true;
    this.setFromX(this.toLocal(e.global).x);
  };
  private onMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    this.setFromX(this.toLocal(e.global).x);
  };
  private endDrag = (): void => {
    this.dragging = false;
  };

  // Thumb radius — the thumb travels within [R, w−R] so it never overhangs the track ends (like a
  // native range input), giving even left/right padding instead of poking past the right edge.
  private static R = 9;

  private setFromX(x: number): void {
    const usable = this.w - 2 * Slider.R;
    const v = Math.max(0, Math.min(1, usable > 0 ? (x - Slider.R) / usable : 0));
    this._value = v;
    this.draw();
    this.onInput(v);
  }

  private draw(): void {
    const h = 24;
    const cy = h / 2;
    const tr = 6; // track thickness (thicker, closer to the DOM accent-color range)
    const r = Slider.R;
    const cx = r + this._value * Math.max(0, this.w - 2 * r); // thumb centre, kept within the track
    this.track.clear();
    this.track.roundRect(0, cy - tr / 2, this.w, tr, tr / 2).fill(this.host.tokens.track);
    this.fill.clear();
    this.fill.roundRect(0, cy - tr / 2, cx, tr, tr / 2).fill(this.host.tokens.accent);
    this.thumb.clear();
    this.thumb.circle(cx, cy, r).fill('#ffffff');
    this.hitArea = new Rectangle(0, 0, this.w, h);
  }

  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
    this.draw();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: 24 };
  }
}

/** Picker chip — `.ge-chip`. Selected = accent bg + accent border. */
export class Chip extends Container implements Sizable {
  readonly id: string;
  private host: ShellHost;
  private bg = new Graphics();
  private labelText: Text;
  private _on: boolean;
  private w = 0;
  private h = 0;
  private em: number;

  constructor(host: ShellHost, id: string, label: string, selected: boolean, em: number, onTap: (id: string) => void) {
    super();
    this.id = id;
    this.host = host;
    this._on = selected;
    this.em = em;
    this.labelText = makeText(label, { size: em, weight: '700', color: '#ffffff', align: 'center' });
    this.addChild(this.bg, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => onTap(id));
    attachHover(this, () => this.paint(true), () => this.paint(false));
  }

  setSelected(v: boolean): void {
    this._on = v;
    this.paint(false);
  }

  private paint(hover: boolean): void {
    const t = this.host.tokens;
    this.bg.clear();
    this.bg.roundRect(0, 0, this.w, this.h, 0.8 * this.em);
    this.bg.fill(this._on ? t.accent : hover ? t.plaqueGlassHover : 'rgba(255,255,255,.04)');
    this.bg.stroke({ color: this._on ? t.accent : t.plaqueLine, width: 1 });
    this.labelText.position.set((this.w - this.labelText.width) / 2, (this.h - this.labelText.height) / 2);
  }

  setLayoutSize(w: number | undefined, h: number | undefined): void {
    if (w != null) this.w = w;
    // height from content (padding .8em vertical) unless imposed
    this.h = h ?? this.labelText.height + 1.6 * this.em;
    this.paint(false);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w || this.labelText.width + 1.1 * this.em, h: this.h || this.labelText.height + 1.6 * this.em };
  }
}
