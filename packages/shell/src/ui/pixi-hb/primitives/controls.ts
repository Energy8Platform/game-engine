import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import type { PixiComponentContext } from '../../pixi/context';
import { makeText } from '../text';
import { FlexBox, type Sizable } from '../../pixi/primitives/flex';
import { attachHover } from './widgets';
import { HB, BORDER, RADIUS } from '../theme';
import { plaque } from './plaque';

// Overlay/modal content primitives in the Hellbuddha pattern — bordered section cards, rows,
// chips, sliders, wrapped paragraphs (centred).

/** Wrapped body text — `.ge-gi-sec p` / `.ge-gi-win-desc` etc. */
export function paragraph(
  host: PixiComponentContext,
  text: string,
  width: number,
  opts: { size?: number; color?: string; align?: 'left' | 'center' } = {},
): Text {
  return makeText(text, {
    size: opts.size ?? 15,
    weight: '400',
    color: opts.color ?? HB.fg,
    wrapWidth: width,
    lineHeight: (opts.size ?? 15) * 1.6,
    align: opts.align ?? 'center',
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

/** A titled section — no plaque of its own (the frame is the plaque); centred heading. */
export function section(_host: PixiComponentContext, title?: string): FlexBox {
  const sec = new FlexBox({
    direction: 'column',
    align: 'center',
    gap: 12,
    padding: { top: 8, bottom: 8, left: 0, right: 0 },
  });
  if (title) sec.add(heading(title));
  return sec;
}

/** Space Grotesk section heading (1.8em of the game-info scale). */
export function heading(title: string, size = GI_EM * 1.8): Text {
  return makeText(title, { size, weight: '700', heading: true, color: HB.fg, upper: true, letterSpacing: size * 0.04, align: 'center' });
}

/** A block on the panel ground — paytable rows, modes, control lists. Draws NOTHING of its own
 *  (no fill, no outline) unless a `fill`/`border` is passed: game-info blocks are pure spacing. */
export function card(opts: { fill?: string; border?: string; padding?: number; gap?: number; align?: 'start' | 'center' | 'stretch'; direction?: 'row' | 'column' } = {}): FlexBox {
  return new FlexBox({
    direction: opts.direction ?? 'column',
    align: opts.align ?? 'center',
    gap: opts.gap ?? 8,
    padding: opts.padding ?? 12,
    ...(opts.fill || opts.border
      ? {
          background: {
            ...(opts.fill ? { fill: opts.fill } : {}),
            radius: RADIUS,
            ...(opts.border ? { stroke: { color: opts.border, width: BORDER, alignment: 1 } } : {}),
          },
        }
      : {}),
  });
}

/** Game-info type scale: body 1em, section titles 1.8em, the frame title 2em. */
export const GI_EM = 14;

/** A full-width glass row — `.ge-ov-row`. `button` adds hover (glass-hover bg + accent label). */
export class GlassRow extends Container implements Sizable {
  private host: PixiComponentContext;
  private bg = new Graphics();
  private content = new Container();
  private w = 0;
  private h: number;
  private padX = 16;
  private isButton: boolean;
  private hoverLabels: Text[] = [];

  constructor(host: PixiComponentContext, opts: { height?: number; button?: boolean; onTap?: () => void } = {}) {
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
    plaque(this.bg, this.w || 1, this.h, { fill: hover && this.isButton ? '#2a1c16' : HB.panel, border: HB.line });
    for (const l of this.hoverLabels) l.style.fill = hover ? HB.orange : HB.fg;
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
  private host: PixiComponentContext;
  private track = new Graphics();
  private fill = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private _value: number;
  private onInput: (v: number) => void;

  constructor(host: PixiComponentContext, value: number, onInput: (v: number) => void) {
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
    this.track.roundRect(0, cy - tr / 2, this.w, tr, tr / 2).fill(HB.track);
    this.fill.clear();
    this.fill.roundRect(0, cy - tr / 2, cx, tr, tr / 2).fill(HB.orange);
    this.thumb.clear();
    this.thumb.circle(cx, cy, r).fill(HB.beige).stroke({ color: HB.ink, width: 2, alignment: 1 });
    this.hitArea = new Rectangle(0, 0, this.w, h);
  }

  /** Programmatically move the thumb (0..1) without firing onInput — for live updates driven by
   *  `host.setVolume()` while the overlay is open. */
  setValue(v: number): void {
    this._value = Math.max(0, Math.min(1, v));
    this.draw();
  }

  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
    this.draw();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: 24 };
  }
}

/** Pill switch — the Pixi twin of the DOM `.ge-toggle`. 42×24, knob 20, accent when on. */
export class Toggle extends Container {
  private track = new Graphics();
  private knob = new Graphics();
  private _value: boolean;
  private onChange: (v: boolean) => void;
  private accent: string;
  private offFill: string;

  constructor(value: boolean, onChange: (v: boolean) => void, accent: string = HB.orange, off: string = HB.track) {
    super();
    this._value = value;
    this.onChange = onChange;
    this.accent = accent;
    this.offFill = off;
    this.addChild(this.track, this.knob);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, 42, 24);
    this.on('pointertap', () => this.onChange(!this._value));
    this.paint();
  }

  get value(): boolean {
    return this._value;
  }
  setValue(v: boolean): void {
    this._value = v;
    this.paint();
  }
  private paint(): void {
    this.track.clear();
    this.track.roundRect(0, 0, 42, 24, 12);
    this.track.fill(this._value ? this.accent : this.offFill);
    this.knob.clear();
    this.knob.circle(this._value ? 30 : 12, 12, 9);
    this.knob.fill(HB.beige).stroke({ color: HB.ink, width: 2, alignment: 1 });
  }
  measureSize(): { w: number; h: number } {
    return { w: 42, h: 24 };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}

/** Picker chip — `.ge-chip`. Selected = accent bg + accent border. */
export class Chip extends Container implements Sizable {
  readonly id: string;
  private host: PixiComponentContext;
  private bg = new Graphics();
  private labelText: Text;
  private _on: boolean;
  private w = 0;
  private h = 0;
  private em: number;

  constructor(host: PixiComponentContext, id: string, label: string, selected: boolean, em: number, onTap: (id: string) => void) {
    super();
    this.id = id;
    this.host = host;
    this._on = selected;
    this.em = em;
    this.labelText = makeText(label, { size: em, weight: '700', heading: true, color: HB.fg, align: 'center' });
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
    plaque(this.bg, this.w, this.h, {
      fill: this._on ? HB.orange : hover ? HB.beigeHover : HB.beige,
      borderWidth: 2,
    });
    this.labelText.style.fill = HB.ink;
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
