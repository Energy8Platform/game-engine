import { Container, Graphics, Rectangle, Text, Ticker } from 'pixi.js';
import type { HbIconName } from '../icons';
import { makeIcon, IconView } from '../pixi-icon';
import { makeText, setText, NUM_FONT_SCALE } from '../text';
import type { TweenOpts } from '../../pixi/motion-pixi';
import { FlexBox, type Sizable } from '../../pixi/primitives/flex';
import { HB, BORDER, RADIUS } from '../theme';
import { plaque } from './plaque';

// Hellbuddha interactive primitives. Every button is a `plaque` (3px ink border, 8px corners, or
// a circle for SPIN) with a face colour and an icon whose colour slots follow the face: ink glyph
// on beige, beige glyph on orange/red.

// ── interaction helpers ──────────────────────────────────────────────────────
export function attachHover(node: Container, over: () => void, out: () => void): void {
  node.on('pointerover', over);
  node.on('pointerout', out);
}

/** Press-scale on pointerdown, restore on up/out — scales around the visual centre and keeps the
 *  hit area at full world size while pressed (see ui/pixi/primitives/widgets.ts for the why). */
export function attachPress(node: Container, scale: number, onTap: () => void): void {
  let down = false;
  let home: { x: number; y: number } | null = null;
  let savedHit: Rectangle | null = null;
  const box = (): { x: number; y: number; width: number; height: number } =>
    node.hitArea instanceof Rectangle ? node.hitArea : node.getLocalBounds();
  const press = (on: boolean): void => {
    if (on) {
      const b = box();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      home = { x: node.x, y: node.y };
      node.scale.set(scale);
      node.position.set(home.x + cx * (1 - scale), home.y + cy * (1 - scale));
      if (node.hitArea instanceof Rectangle) {
        savedHit = node.hitArea;
        const inv = 1 / scale;
        node.hitArea = new Rectangle(cx - (b.width * inv) / 2, cy - (b.height * inv) / 2, b.width * inv, b.height * inv);
      }
    } else if (home) {
      node.scale.set(1);
      node.position.set(home.x, home.y);
      if (savedHit) node.hitArea = savedHit;
      savedHit = null;
      home = null;
    }
  };
  node.on('pointerdown', () => {
    down = true;
    press(true);
  });
  const release = (): void => {
    if (down) press(false);
    down = false;
  };
  node.on('pointerup', release);
  node.on('pointerupoutside', release);
  node.on('pointertap', () => onTap());
}

// ── faces ────────────────────────────────────────────────────────────────────
export type Face = 'beige' | 'orange' | 'red' | 'panel';

const FACE = {
  beige: { fill: HB.beige, hover: HB.beigeHover, ink: HB.ink, glyphFill: HB.beige },
  orange: { fill: HB.orange, hover: HB.gold, ink: HB.ink, glyphFill: HB.beige },
  // ink text/glyphs on the accent (a light yellow) — beige wouldn't read on it
  red: { fill: HB.red, hover: HB.orange, ink: HB.ink, glyphFill: HB.beige },
  panel: { fill: HB.panel, hover: '#2a1c16', ink: HB.beige, glyphFill: HB.panel },
} as const;

/** Text colour that reads on a face. */
export function faceInk(face: Face): string {
  return face === 'panel' ? HB.beige : HB.ink;
}

// ── IconButton — a square (or round) plaque with a glyph ─────────────────────
export interface IconButtonOpts {
  size?: number; // plaque box (default 40)
  glyph?: number; // glyph px (default 24)
  face?: Face; // default beige
  round?: boolean;
  /** Engaged state (autoplay running): accent border + accent glyph ink. */
  active?: boolean;
  /** Turbo only: how many bolts are painted in (0–2). */
  bolts?: number;
  /** Bare glyph, no plaque (the bet-lock cross, chevrons in text rows). */
  bare?: boolean;
  onTap?: () => void;
}

export class IconButton extends Container implements Sizable {
  private box: number;
  private view: IconView;
  private bg = new Graphics();
  private face: Face;
  private round: boolean;
  private bare: boolean;
  private _active: boolean;
  private _bolts = 0;
  private _disabled = false;
  private _name: HbIconName;
  private hovering = false;

  constructor(name: HbIconName, opts: IconButtonOpts = {}) {
    super();
    this._name = name;
    this.box = opts.size ?? 40;
    this.face = opts.face ?? 'beige';
    this.round = opts.round ?? false;
    this.bare = opts.bare ?? false;
    this._active = opts.active ?? false;
    this._bolts = opts.bolts ?? 0;
    const glyph = opts.glyph ?? 24;
    if (!this.bare) this.addChild(this.bg);
    this.view = makeIcon(name, glyph);
    this.view.position.set((this.box - glyph) / 2, (this.box - glyph) / 2);
    this.addChild(this.view);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.box, this.box);
    this.paint();
    attachHover(this, () => { this.hovering = true; this.paint(); }, () => { this.hovering = false; this.paint(); });
    attachPress(this, 0.92, () => {
      if (!this._disabled) opts.onTap?.();
    });
  }

  private paint(): void {
    const f = FACE[this.face];
    const hot = this.hovering && !this._disabled;
    const ink = this._active ? HB.orange : f.ink;
    // on a beige face the glyph's own face is the button face (so a stroked glyph reads as an outline
    // on the button); on orange/red the glyph face is beige — the glyph IS a little beige button.
    const glyphFill = this.face === 'beige' ? (hot ? f.hover : f.fill) : f.glyphFill;
    this.view.setColors({
      ink,
      fill: glyphFill,
      accent: HB.orange,
      boltA: this._bolts >= 1 ? HB.orange : glyphFill,
      boltB: this._bolts >= 2 ? HB.orange : glyphFill,
    });
    if (!this.bare) {
      plaque(this.bg, this.box, this.box, {
        fill: hot ? f.hover : f.fill,
        border: this._active ? HB.orange : HB.ink,
        round: this.round,
      });
    }
  }

  setIcon(name: HbIconName): void {
    if (name === this._name) return;
    this._name = name;
    this.view.setIcon(name);
    this.paint();
  }

  get iconName(): HbIconName {
    return this._name;
  }

  setFace(face: Face): void {
    this.face = face;
    this.paint();
  }

  set active(v: boolean) {
    this._active = v;
    this.paint();
  }

  set bolts(n: number) {
    this._bolts = n;
    this.paint();
  }
  get bolts(): number {
    return this._bolts;
  }
  get active(): boolean {
    return this._active;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.alpha = v ? 0.5 : 1;
    this.cursor = v ? 'default' : 'pointer';
    this.eventMode = v ? 'none' : 'static';
    this.paint();
  }
  get disabled(): boolean {
    return this._disabled;
  }

  /** Kept for API parity with the mono renderer (autoplay "glow" = active here). */
  setGlow(on: boolean): void {
    this.active = on;
  }

  setLayoutSize(): void {
    /* fixed box */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.box, h: this.box };
  }
}

// ── TextButton — a plaque with a Space Grotesk label (CTA, confirm, footer) ──
export interface TextButtonOpts {
  w: number;
  h: number;
  face?: Face;
  size?: number; // font px
  onTap?: () => void;
}

export class TextButton extends Container implements Sizable {
  private w: number;
  private h: number;
  private bg = new Graphics();
  private face: Face;
  readonly labelText: Text;
  private hovering = false;
  private _disabled = false;

  constructor(label: string, opts: TextButtonOpts) {
    super();
    this.w = opts.w;
    this.h = opts.h;
    this.face = opts.face ?? 'orange';
    this.labelText = makeText(label, {
      size: opts.size ?? 14,
      weight: '700',
      heading: true,
      upper: true,
      color: this.face === 'red' || this.face === 'panel' ? HB.beige : HB.ink,
      align: 'center',
      letterSpacing: 0.5,
    });
    this.labelText.anchor.set(0.5);
    this.labelText.position.set(this.w / 2, this.h / 2);
    this.addChild(this.bg, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
    this.paint();
    attachHover(this, () => { this.hovering = true; this.paint(); }, () => { this.hovering = false; this.paint(); });
    attachPress(this, 0.96, () => {
      if (!this._disabled) opts.onTap?.();
    });
  }

  private paint(): void {
    const f = FACE[this.face];
    plaque(this.bg, this.w, this.h, { fill: this.hovering && !this._disabled ? f.hover : f.fill, border: f.ink === HB.beige ? HB.line : HB.ink });
    if (this.labelText.width > this.w - 16) this.labelText.scale.set((this.w - 16) / (this.labelText.width / this.labelText.scale.x));
  }

  setFace(face: Face): void {
    this.face = face;
    this.labelText.style.fill = face === 'red' || face === 'panel' ? HB.beige : HB.ink;
    this.paint();
  }

  setLabel(label: string): void {
    setText(this.labelText, label, true);
    this.labelText.scale.set(1);
    this.paint();
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.alpha = v ? 0.5 : 1;
    this.cursor = v ? 'default' : 'pointer';
    this.eventMode = v ? 'none' : 'static';
    this.paint();
  }
  get disabled(): boolean {
    return this._disabled;
  }

  setLayoutSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.hitArea = new Rectangle(0, 0, w, h);
    this.labelText.position.set(w / 2, h / 2);
    this.paint();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
}

// ── BetStrip — `index+1 / count` segments under the bet value ────────────────
export class BetStrip extends Container implements Sizable {
  private g = new Graphics();
  private w: number;
  private count: number;
  private index: number;
  static readonly H = 4;

  constructor(w: number, count: number, index: number) {
    super();
    this.w = w;
    this.count = count;
    this.index = index;
    this.addChild(this.g);
    this.paint();
  }

  private paint(): void {
    this.g.clear();
    if (this.count < 2) return;
    // one solid bar, filled to (index + 1) / count
    this.g.roundRect(0, 0, this.w, BetStrip.H, 2).fill(HB.track);
    const filled = (this.w * this.filled) / this.count;
    if (filled > 0) this.g.roundRect(0, 0, filled, BetStrip.H, 2).fill(HB.orange);
  }

  set(index: number, count = this.count): void {
    this.index = index;
    this.count = count;
    this.paint();
  }

  /** Orange segment count — what a test reads. */
  get filled(): number {
    return this.count < 2 ? 0 : Math.max(0, Math.min(this.count, this.index + 1));
  }

  setLayoutSize(w: number): void {
    this.w = w;
    this.paint();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.count < 2 ? 0 : BetStrip.H };
  }
}

// ── Readout — label over a stroked Switzer value (+ optional bet strip) ──────
export interface ReadoutOpts {
  label: string;
  value: string;
  muted?: string; // label colour
  fg?: string; // value colour
  /** Value stroke colour; default HB.ink. `false` for an unstroked value (numbers on beige). */
  stroke?: string | false;
  align?: 'left' | 'center' | 'right';
  valueSize?: number; // default 13
  fixedWidth?: number;
  maxWidth?: number;
  /** Render the label as an orange chip with ink text (the active-feature bet mode). */
  chip?: boolean;
  /** Draw a BetStrip under the value. */
  strip?: { count: number; index: number };
}

export class Readout extends Container implements Sizable {
  readonly valueText: Text;
  private labelText: Text;
  private chipG?: Graphics;
  readonly strip?: BetStrip;
  private align: 'left' | 'center' | 'right';
  private fixedW?: number;
  private maxW?: number;
  private valueH: number;
  private static readonly CHIP_PAD = 5;

  constructor(opts: ReadoutOpts) {
    super();
    this.align = opts.align ?? 'left';
    this.fixedW = opts.fixedWidth;
    this.maxW = opts.maxWidth;
    this.labelText = makeText(opts.label, {
      size: 9,
      weight: '700',
      heading: true,
      color: opts.chip ? HB.ink : opts.muted ?? HB.muted,
      letterSpacing: 0.9,
      upper: true,
    });
    if (opts.chip) {
      this.chipG = new Graphics();
      this.addChild(this.chipG);
    }
    this.valueText = makeText(opts.value, {
      size: Math.round((opts.valueSize ?? 13) * NUM_FONT_SCALE),
      color: opts.fg ?? HB.fg,
      stroke: opts.stroke === false ? false : opts.stroke ?? true,
    });
    this.valueH = this.valueText.height;
    this.addChild(this.labelText, this.valueText);
    if (opts.strip) {
      this.strip = new BetStrip(this.fixedW ?? Math.max(this.labelText.width, this.valueText.width), opts.strip.count, opts.strip.index);
      this.addChild(this.strip);
    }
    this.relayout();
  }

  private labelH(): number {
    return this.chipG ? this.labelText.height + Readout.CHIP_PAD * 2 : this.labelText.height;
  }

  private relayout(): void {
    this.valueText.scale.set(1);
    const cap = this.fixedW ?? this.maxW;
    if (cap != null && this.valueText.width > cap && this.valueText.width > 0) {
      this.valueText.scale.set(cap / this.valueText.width);
    }
    const vW = this.valueText.width;
    const w = this.fixedW ?? Math.max(this.labelText.width + (this.chipG ? Readout.CHIP_PAD * 2 : 0), vW);
    const x = (tw: number): number => (this.align === 'center' ? (w - tw) / 2 : this.align === 'right' ? w - tw : 0);
    const P = Readout.CHIP_PAD;
    if (this.chipG) {
      const cw = this.labelText.width + P * 2;
      const ch = this.labelText.height + P * 2;
      this.chipG.clear().roundRect(x(cw), 0, cw, ch, 4).fill(HB.orange);
      this.labelText.position.set(x(cw) + P, P);
    } else {
      this.labelText.position.set(x(this.labelText.width), 0);
    }
    this.valueText.position.set(x(vW), this.labelH() + 4);
    if (this.strip) {
      this.strip.setLayoutSize(w);
      this.strip.position.set(0, this.labelH() + 4 + this.valueH + 4);
    }
  }

  setValue(v: string): void {
    setText(this.valueText, v);
    this.relayout();
  }

  setLabel(v: string): void {
    setText(this.labelText, v, true);
    this.relayout();
  }

  setColors(label: string, value: string): void {
    this.labelText.style.fill = label;
    this.valueText.style.fill = value;
  }

  setLayoutSize(): void {
    /* content sized (or fixed via fixedWidth) */
  }
  measureSize(): { w: number; h: number } {
    const w = this.fixedW ?? Math.max(this.labelText.width + (this.chipG ? Readout.CHIP_PAD * 2 : 0), this.valueText.width);
    const stripH = this.strip ? 4 + this.strip.measureSize().h : 0;
    return { w, h: this.labelH() + 4 + this.valueH + stripH };
  }
}

// ── SpinDisc — the round orange hero ─────────────────────────────────────────
export interface SpinDiscOpts {
  size?: number;
  glyph?: number;
  ticker: Ticker;
  onSpin: () => void;
  onStop: () => void;
  onResume?: () => void;
}

export type SpinAutoplayMode = 'off' | 'running' | 'paused';

export class SpinDisc extends Container implements Sizable {
  private size: number;
  private glyphSize: number;
  private ticker: Ticker;
  private disc = new Graphics();
  private glyph: IconView;
  private dim = new Graphics();
  private countText?: Text;
  private mode: 'spin' | 'stop' | 'resume' = 'spin';
  private _busy = false;
  private _disabled = false;
  private hovering = false;
  private rotTick?: (t: Ticker) => void;
  private onSpin: () => void;
  private onStop: () => void;
  private onResume: () => void;

  constructor(opts: SpinDiscOpts) {
    super();
    this.size = opts.size ?? 84;
    this.glyphSize = opts.glyph ?? 72;
    this.ticker = opts.ticker;
    this.onSpin = opts.onSpin;
    this.onStop = opts.onStop;
    this.onResume = opts.onResume ?? opts.onSpin;
    this.glyph = makeIcon('spin', this.glyphSize);
    this.glyph.position.set((this.size - this.glyphSize) / 2, (this.size - this.glyphSize) / 2);
    this.addChild(this.disc, this.glyph, this.dim);
    this.paint();
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.size, this.size);
    attachHover(this, () => { this.hovering = true; this.paint(); }, () => { this.hovering = false; this.paint(); });
    attachPress(this, 0.94, () => {
      if (this._disabled) return;
      if (this.mode === 'stop') this.onStop();
      else if (this.mode === 'resume') this.onResume();
      else this.onSpin();
    });
  }

  private paint(): void {
    const hot = this.hovering && !this._disabled;
    plaque(this.disc, this.size, this.size, { fill: hot ? HB.gold : HB.orange, round: true });
    this.glyph.setColors({ ink: HB.ink, fill: HB.beige });
    if (this.countText) this.countText.style.fill = HB.ink;
    this.dim.clear();
    if (this._disabled) {
      this.dim.circle(this.size / 2, this.size / 2, this.size / 2).fill({ color: 0x000000, alpha: 0.4 });
    }
  }

  setAutoplay(mode: SpinAutoplayMode, remaining: number): void {
    if (mode === 'off') {
      this.mode = 'spin';
      this.glyph.visible = true;
      this.removeStopGlyph();
      this.removeAutoGlyph();
      if (this.countText) {
        this.removeChild(this.countText);
        this.countText.destroy();
        this.countText = undefined;
      }
      this.paint();
      return;
    }
    const running = mode === 'running';
    this.mode = running ? 'stop' : 'resume';
    this.stopRotation();
    this.glyph.visible = false;
    if (running) {
      this.removeAutoGlyph();
      this.stopGlyph();
    } else {
      this.removeStopGlyph();
      this.autoGlyph();
    }
    if (!this.countText) {
      // running: ink digits on the beige STOP face; halted: stroked beige digits on the orange disc
      this.countText = makeText('', { size: 22, align: 'center', stroke: false, color: HB.ink });
      this.addChild(this.countText);
    }
    setText(this.countText, Number.isFinite(remaining) ? String(remaining) : '∞');
    const cy = running ? (this.size - this.countText.height) / 2 : this.size * 0.56;
    this.countText.position.set((this.size - this.countText.width) / 2, cy);
    this.paint();
  }

  private stopGlyphView?: IconView;
  private stopGlyph(): void {
    if (!this.stopGlyphView) {
      this.stopGlyphView = makeIcon('stop', this.glyphSize);
      this.stopGlyphView.position.set((this.size - this.glyphSize) / 2, (this.size - this.glyphSize) / 2);
      this.addChild(this.stopGlyphView);
      if (this.countText) this.addChild(this.countText); // keep the count on top
    }
  }
  private removeStopGlyph(): void {
    if (this.stopGlyphView) {
      this.removeChild(this.stopGlyphView);
      this.stopGlyphView.destroy();
      this.stopGlyphView = undefined;
    }
  }

  private autoGlyphView?: IconView;
  private autoGlyph(): void {
    if (this.autoGlyphView) return;
    const size = this.glyphSize * 0.5;
    this.autoGlyphView = makeIcon('autoplay', size);
    this.autoGlyphView.position.set((this.size - size) / 2, this.size * 0.17);
    this.addChild(this.autoGlyphView);
  }
  private removeAutoGlyph(): void {
    if (this.autoGlyphView) {
      this.removeChild(this.autoGlyphView);
      this.autoGlyphView.destroy();
      this.autoGlyphView = undefined;
    }
  }

  setBusy(busy: boolean): void {
    this._busy = busy;
    if (busy && this.mode === 'spin') this.startRotation();
    else this.stopRotation();
  }

  private startRotation(): void {
    if (this.rotTick) return;
    this.rotTick = (t: Ticker) => {
      this.glyph.spin += (t.deltaMS / 800) * Math.PI * 2;
    };
    this.ticker.add(this.rotTick);
  }
  private stopRotation(): void {
    if (this.rotTick) {
      this.ticker.remove(this.rotTick);
      this.rotTick = undefined;
    }
    this.glyph.spin = 0;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.cursor = v ? 'default' : 'pointer';
    this.eventMode = v ? 'none' : 'static';
    this.paint();
  }
  get busy(): boolean {
    return this._busy;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopRotation();
    super.destroy(options);
  }

  setLayoutSize(): void {
    /* fixed */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.size, h: this.size };
  }
}

// ── BonusButton — the square orange plaque with the bird ─────────────────────
export interface BonusButtonOpts {
  size?: number;
  /** red = an active feature (tap deactivates). */
  face?: 'orange' | 'red';
  /** `close` while a feature is active. */
  icon?: 'bonus' | 'close';
  onTap: () => void;
}

export class BonusButton extends IconButton {
  constructor(opts: BonusButtonOpts) {
    const size = opts.size ?? 58;
    const icon = opts.icon ?? 'bonus';
    super(icon, { size, glyph: Math.round(size * (icon === 'close' ? 0.55 : 0.88)), face: opts.face ?? 'orange', onTap: opts.onTap });
  }
}

// ── FsHero — the FS counter in the SPIN slot (beige plaque rectangle) ────────
export interface FsHeroOpts {
  label: string;
  value: string;
  height?: number;
  minWidth?: number;
}

export class FsHero extends Container implements Sizable {
  private w: number;
  private h: number;
  private bgG = new Graphics();

  constructor(opts: FsHeroOpts) {
    super();
    this.h = opts.height ?? 84;
    const minW = opts.minWidth ?? 96;
    const padX = 18;
    const gap = 3;
    const label = makeText(opts.label, {
      size: 9, weight: '700', heading: true, color: HB.ink, letterSpacing: 0.72, upper: true,
      align: 'center', wrapWidth: minW - padX * 2,
    });
    const num = makeText(opts.value, { size: 30, color: HB.ink, stroke: false, align: 'center' });
    const contentW = Math.max(label.width, num.width);
    this.w = Math.max(minW, contentW + padX * 2);
    plaque(this.bgG, this.w, this.h, { fill: HB.beige });
    const stackH = label.height + gap + num.height;
    const top = (this.h - stackH) / 2;
    label.position.set((this.w - label.width) / 2, top);
    num.position.set((this.w - num.width) / 2, top + label.height + gap);
    this.addChild(this.bgG, label, num);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
  setLayoutSize(): void {
    /* fixed */
  }
}

// ── thin vertical divider ────────────────────────────────────────────────────
export function divider(height = 30, color: string = HB.line): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 1, height);
  g.fill(color);
  return g;
}

export { FlexBox, BORDER, RADIUS };
export type { Sizable, TweenOpts };
