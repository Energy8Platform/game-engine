import { Container, Graphics, Rectangle, type FederatedPointerEvent, type Text } from 'pixi.js';
import type { Sizable } from '../../pixi/primitives/flex';
import type { PixiComponentContext } from '../../pixi/context';
import type { ScrollLook } from '../../pixi-hb/primitives/scroll-affordance';
import { attachHover, attachPress } from '../../pixi-hb/primitives/widgets';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { Slab, SKEW, slabPoints, SHADOW_OFFSET } from '../slab';
import { SButton } from '../widgets';
import { sLabel, sValue } from '../text';
import { S, SHADOW_ALPHA, DISABLED_ALPHA } from '../theme';

// S overlay controls: every surface a flat or leaning plate, sharp corners, no outlines.

/** The S scrollbar: a flat yellow thumb on a flat track. */
export const S_SCROLL: ScrollLook = { track: S.track, thumb: S.yellow, radius: 0 };

/** A yellow title plate: ink caps on a leaning slab, as wide as its text (at least 3h, at most
 *  `maxW` — a longer title scales down inside). */
export class STitlePlate extends Container implements Sizable {
  readonly labelText: Text;
  readonly slab: Slab;

  constructor(text: string, h: number, maxW = Infinity) {
    super();
    this.labelText = sLabel(text, Math.round(h * 0.42), S.ink);
    const pad = h * 0.6;
    const w = Math.min(Math.floor(maxW), Math.round(Math.max(h * 3, this.labelText.width + pad * 2)));
    if (this.labelText.width > w - pad * 2) this.labelText.scale.set((w - pad * 2) / this.labelText.width);
    this.slab = new Slab(w, h, { face: S.yellow, corners: SKEW.readout });
    this.labelText.position.set((w - this.labelText.width) / 2, (h - this.labelText.height) / 2); // centred in a min-width plate
    this.addChild(this.slab, this.labelText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
  setLayoutSize(): void {
    /* sized by its text */
  }
}

/** The ✕: a yellow square slab with the ink `close` glyph. */
export function sCloseButton(size: number, onTap: () => void): SButton {
  const g = Math.round(size * 0.5);
  return new SButton({
    w: size,
    h: size,
    face: 'yellow',
    corners: SKEW.menu,
    glyph: makeIcon('close', g, { ink: S.ink, fill: S.ink }),
    glyphSize: g,
    onTap,
  });
}

export type SButtonKind = 'accent' | 'red' | 'ghost';

const KIND: Record<SButtonKind, { fill: string; hover: string; ink: string; hoverInk: string }> = {
  accent: { fill: S.yellow, hover: S.yellowHover, ink: S.ink, hoverInk: S.ink },
  red: { fill: S.red, hover: S.redHover, ink: S.fg, hoverInk: S.fg },
  ghost: { fill: S.plate, hover: S.yellow, ink: S.fg, hoverInk: S.ink },
};

/** A caps label on a slab: `accent` yellow/ink, `red` red/fg, `ghost` plate/fg (yellow on hover). */
export class STextButton extends Container implements Sizable {
  readonly labelText: Text;
  readonly slab: Slab;
  readonly kind: SButtonKind;
  private _disabled = false;

  constructor(label: string, o: { w: number; h: number; kind: SButtonKind; size?: number; onTap: () => void }) {
    super();
    const k = KIND[o.kind];
    this.kind = o.kind;
    this.slab = new Slab(o.w, o.h, { face: k.fill, corners: SKEW.menu });
    this.labelText = sLabel(label, o.size ?? Math.round(o.h * 0.36), k.ink);
    const room = o.w - 16;
    if (this.labelText.width > room) this.labelText.scale.set(room / this.labelText.width);
    this.labelText.position.set((o.w - this.labelText.width) / 2, (o.h - this.labelText.height) / 2);
    this.addChild(this.slab, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, o.w, o.h);
    attachHover(
      this,
      () => {
        if (this._disabled) return;
        this.slab.setFace(k.hover);
        this.labelText.style.fill = k.hoverInk;
      },
      () => {
        this.slab.setFace(k.fill);
        this.labelText.style.fill = k.ink;
      },
    );
    attachPress(this, 0.96, () => {
      if (!this._disabled) o.onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.alpha = v ? DISABLED_ALPHA : 1;
    this.eventMode = v ? 'none' : 'static';
    this.cursor = v ? 'default' : 'pointer';
  }
  get disabled(): boolean {
    return this._disabled;
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}

/** A picker chip — same API as HB `Chip`: a plate with the value in fg; selected = yellow + ink.
 *  The picker sets every chip to its column width, so the slab is redrawn on resize. */
export class SChip extends Container implements Sizable {
  readonly id: string;
  readonly labelText: Text;
  private shadow = new Graphics();
  private face = new Graphics();
  private _on: boolean;
  private hovering = false;
  private w: number;
  private h: number;

  constructor(_host: PixiComponentContext, id: string, label: string, selected: boolean, em: number, onTap: (id: string) => void) {
    super();
    this.id = id;
    this._on = selected;
    this.labelText = sValue(label, em, S.fg);
    this.w = Math.ceil(this.labelText.width + em * 2);
    this.h = Math.round(em * 2.6);
    this.shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
    this.addChild(this.shadow, this.face, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    attachHover(this, () => { this.hovering = true; this.paint(); }, () => { this.hovering = false; this.paint(); });
    this.on('pointertap', () => onTap(this.id));
    this.paint();
  }

  get selected(): boolean {
    return this._on;
  }
  setSelected(v: boolean): void {
    this._on = v;
    this.paint();
  }

  private paint(): void {
    const pts = slabPoints(this.w, this.h, SKEW.menu);
    this.shadow.clear().poly(pts).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
    this.face.clear().poly(pts).fill(this._on ? S.yellow : this.hovering ? S.plateHover : S.plate);
    this.labelText.style.fill = this._on ? S.ink : S.fg;
    this.labelText.position.set((this.w - this.labelText.width) / 2, (this.h - this.labelText.height) / 2);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }

  setLayoutSize(w: number | undefined, h?: number | undefined): void {
    if (w != null) this.w = w;
    if (h != null) this.h = h;
    this.paint();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
}

const SLIDER_H = 24;
const TRACK_H = 8;
const THUMB_W = 12;

/** The volume slider: a flat 8-thick track across its width, the yellow fill up to the thumb and a
 *  flat 12×24 yellow rect thumb. Same drag / `setValue` API as HB `Slider`. */
export class SSlider extends Container implements Sizable {
  private track = new Graphics();
  private fill = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private _value: number;
  private onInput: (v: number) => void;
  private dragging = false;

  constructor(value: number, onInput: (v: number) => void) {
    super();
    this._value = Math.max(0, Math.min(1, value));
    this.onInput = onInput;
    this.addChild(this.track, this.fill, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.setFromX(this.toLocal(e.global).x);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.setFromX(this.toLocal(e.global).x);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
  }

  get value(): number {
    return this._value;
  }
  private get thumbX(): number {
    return this._value * Math.max(0, this.w - THUMB_W);
  }
  get thumbRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.thumbX, y: 0, w: THUMB_W, h: SLIDER_H };
  }
  get trackRect(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: (SLIDER_H - TRACK_H) / 2, w: this.w, h: TRACK_H };
  }

  private setFromX(x: number): void {
    const usable = this.w - THUMB_W;
    this._value = Math.max(0, Math.min(1, usable > 0 ? (x - THUMB_W / 2) / usable : 0));
    this.draw();
    this.onInput(this._value);
  }

  private draw(): void {
    const t = this.trackRect;
    const x = this.thumbX;
    this.track.clear().rect(t.x, t.y, t.w, t.h).fill(S.track);
    this.fill.clear();
    if (x > 0) this.fill.rect(0, t.y, x + THUMB_W / 2, t.h).fill(S.yellow);
    this.thumb.clear().rect(x, 0, THUMB_W, SLIDER_H).fill(S.yellow);
    this.hitArea = new Rectangle(0, 0, this.w, SLIDER_H);
  }

  /** Move the thumb (0..1) without firing onInput — for live updates while the menu is open. */
  setValue(v: number): void {
    this._value = Math.max(0, Math.min(1, v));
    this.draw();
  }

  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
    this.draw();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: SLIDER_H };
  }
}

/** The S switch: a flat 44×24 track (track colour off, yellow on) with an 18-square knob — fg on the
 *  left when off, ink on the right when on. */
export class SToggle extends Container implements Sizable {
  private track = new Graphics();
  private knob = new Graphics();
  private _value: boolean;

  constructor(value: boolean, onChange: (v: boolean) => void) {
    super();
    this._value = value;
    this.addChild(this.track, this.knob);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, 44, 24);
    this.on('pointertap', () => onChange(!this._value));
    this.paint();
  }

  get value(): boolean {
    return this._value;
  }
  setValue(v: boolean): void {
    this._value = v;
    this.paint();
  }
  get knobRect(): { x: number; y: number; w: number; h: number } {
    return { x: this._value ? 44 - 21 : 3, y: 3, w: 18, h: 18 };
  }

  private paint(): void {
    this.track.clear().rect(0, 0, 44, 24).fill(this._value ? S.yellow : S.track);
    const k = this.knobRect;
    this.knob.clear().rect(k.x, k.y, k.w, k.h).fill(this._value ? S.ink : S.fg);
  }

  measureSize(): { w: number; h: number } {
    return { w: 44, h: 24 };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}

/** A stepped slider (the bet / autoplay pickers): a flat track half the thumb's height and a leaning
 *  yellow slab thumb, 0.8·h × h, snapping to `count` evenly spaced steps. */
export class SStepSlider extends Container implements Sizable {
  private track = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private h = 0;
  private _index: number;
  private count: number;
  private onChange: (i: number) => void;
  private dragging = false;

  constructor(count: number, index: number, onChange: (i: number) => void) {
    super();
    this.count = Math.max(1, count);
    this._index = Math.max(0, Math.min(this.count - 1, index));
    this.onChange = onChange;
    this.addChild(this.track, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.setFromX(this.toLocal(e.global).x);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.setFromX(this.toLocal(e.global).x);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
  }

  get index(): number {
    return this._index;
  }
  private get thumbW(): number {
    return Math.round(this.h * 0.8);
  }
  /** The thumb's centre x in local units. */
  get thumbCenterX(): number {
    const travel = Math.max(0, this.w - this.thumbW);
    const u = this.count > 1 ? this._index / (this.count - 1) : 0;
    return this.thumbW / 2 + u * travel;
  }

  private setFromX(x: number): void {
    const travel = Math.max(1, this.w - this.thumbW);
    const u = Math.max(0, Math.min(1, (x - this.thumbW / 2) / travel));
    const i = Math.round(u * (this.count - 1));
    if (i === this._index) return;
    this._index = i;
    this.draw();
    this.onChange(i);
  }

  /** Move to a step without firing onChange (keyboard / programmatic). */
  setIndex(i: number): void {
    this._index = Math.max(0, Math.min(this.count - 1, i));
    this.draw();
  }

  layout(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.draw();
  }

  private draw(): void {
    const th = this.h * 0.5;
    this.track.clear().rect(0, (this.h - th) / 2, this.w, th).fill(S.track);
    const tw = this.thumbW;
    const x = this.thumbCenterX - tw / 2;
    this.thumb.clear().poly(slabPoints(tw, this.h, SKEW.menu).map((v, i) => (i % 2 === 0 ? v + x : v))).fill(S.yellow);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
  setLayoutSize(): void {
    /* sized by layout() */
  }
}
