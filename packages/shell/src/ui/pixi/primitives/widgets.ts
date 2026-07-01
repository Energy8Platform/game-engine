import { BlurFilter, Color, Container, Graphics, Rectangle, Text, Ticker } from 'pixi.js';
import type { ShellTokens } from '@/core/theme';
import type { IconName } from '../icons';
import { makeIcon, IconView } from '../pixi-icon';
import { makeText, setText, NUM_FONT_FAMILY, NUM_FONT_SCALE } from '../text';
import { tween, type TweenOpts } from '../motion-pixi';
import { FlexBox, type Sizable } from './flex';

// Shared interactive primitives, ported from the DOM shell's CSS rules. Each widget reproduces
// one CSS class (.ge-iconbtn, .ge-rd, .ge-shell-spin, .ge-shell-buybonus, .ge-chip, .ge-slider …)
// — same sizes, colours, hover/press behaviour.

// ── interaction helpers ──────────────────────────────────────────────────────
/** grayscale(.5) brightness(.72) baked into a colour — the DOM's disabled-button filter applied to
 *  the fill directly. A ColorMatrixFilter would render the badge to a low-res texture and pixelate
 *  its ring; this keeps the geometry crisp. Pixi's Color parses named accents ('green') too. */
function dimColor(input: string): string {
  let r: number, g: number, b: number;
  try {
    const [cr, cg, cb] = new Color(input).toRgbArray();
    r = cr * 255;
    g = cg * 255;
    b = cb * 255;
  } catch {
    return input;
  }
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const ch = (c: number): string =>
    Math.round(Math.max(0, Math.min(255, (c + (luma - c) * 0.5) * 0.72)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

export function attachHover(node: Container, over: () => void, out: () => void): void {
  node.on('pointerover', over);
  node.on('pointerout', out);
}

/** Press-scale on pointerdown, restore on up/out — the CSS `:active { transform:scale(x) }`.
 *  Scales around the visual centre (CSS transform-origin:50% 50%), not the top-left origin, and
 *  holds the hit area at full WORLD size while pressed — otherwise origin-scaling slid the box away
 *  from the pointer, so edge presses released off-target and only centre taps registered. */
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
      node.position.set(home.x + cx * (1 - scale), home.y + cy * (1 - scale)); // keep centre fixed
      if (node.hitArea instanceof Rectangle) {
        savedHit = node.hitArea;
        const inv = 1 / scale; // grow local box so its world size is unchanged → edge taps still land
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

// ── IconButton — .ge-iconbtn (borderless icon button) ────────────────────────
export interface IconButtonOpts {
  size?: number; // box (CSS default 40×40)
  glyph?: number; // glyph font-size (CSS default 24)
  color: string; // resting colour (token.icon, or white in plaques)
  hover: string; // hover colour (token.accent)
  activeColor?: string; // .ge-active colour (token.iconActive)
  active?: boolean;
  /** White-disc style (auto/turbo on the desktop panel): a `disc` fill + `border` ring. Hover/active
   *  tint BOTH the icon and the ring with `hover`. Omit for a plain borderless icon (menu, +/-). */
  disc?: string;
  discBorder?: number;
  onTap?: () => void;
}

export class IconButton extends Container implements Sizable {
  private box: number;
  private view: IconView;
  private _color: string;
  private hoverColor: string;
  private activeColor: string;
  private _active: boolean;
  private _disabled = false;
  private _name: IconName;
  private discFill?: string;
  private discBorder: number;
  private discG?: Graphics;

  constructor(name: IconName, opts: IconButtonOpts) {
    super();
    this._name = name;
    this.box = opts.size ?? 40;
    this._color = opts.color;
    this.hoverColor = opts.hover;
    this.activeColor = opts.activeColor ?? opts.color;
    this._active = opts.active ?? false;
    this.discFill = opts.disc;
    this.discBorder = opts.discBorder ?? 2;
    const glyph = opts.glyph ?? 24;
    if (this.discFill) {
      this.discG = new Graphics();
      this.addChild(this.discG);
    }
    this.view = makeIcon(name, glyph, this._active ? this.activeColor : this._color);
    this.view.position.set((this.box - glyph) / 2, (this.box - glyph) / 2);
    this.addChild(this.view);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.box, this.box);
    this.paint(false);
    attachHover(this, () => this.paint(true), () => this.paint(false));
    attachPress(this, 0.92, () => {
      if (!this._disabled) opts.onTap?.();
    });
  }

  private _glow = false;

  private paint(hovering: boolean): void {
    if (this._disabled && !this.discG) return;
    const lit = hovering || this._active || this._glow;
    const c = this._disabled
      ? this._color
      : hovering || this._glow ? this.hoverColor : this._active ? this.activeColor : this._color;
    this.view.setColor(c);
    if (this.discG && this.discFill) {
      // white disc + black ring; lit (hover/active) → accent ring (mirrors `.ge-bar-panel .ge-iconbtn`)
      const r = this.box / 2 - this.discBorder / 2;
      this.discG.clear();
      this.discG.circle(this.box / 2, this.box / 2, r).fill(this.discFill);
      this.discG.stroke({ color: !this._disabled && lit ? this.hoverColor : '#000000', width: this.discBorder });
    }
  }

  setIcon(name: IconName): void {
    if (name === this._name) return;
    this._name = name;
    const glyph = this.view.size;
    this.removeChild(this.view);
    this.view.destroy();
    this.view = makeIcon(name, glyph, this._active ? this.activeColor : this._color);
    this.view.position.set((this.box - glyph) / 2, (this.box - glyph) / 2);
    this.addChild(this.view);
  }

  set active(v: boolean) {
    this._active = v;
    this.paint(false);
  }
  get active(): boolean {
    return this._active;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.alpha = v ? 0.35 : 1;
    this.cursor = v ? 'default' : 'pointer';
    this.eventMode = v ? 'none' : 'static';
  }
  get disabled(): boolean {
    return this._disabled;
  }

  /** Accent recolour while autoplay runs — `.ge-iconbtn.ge-glow` (the CSS also adds a
   *  drop-shadow; the colour change carries the state legibly here). */
  setGlow(on: boolean): void {
    this._glow = on;
    this.paint(false);
  }

  setColors(color: string, hover: string, activeColor?: string): void {
    this._color = color;
    this.hoverColor = hover;
    if (activeColor) this.activeColor = activeColor;
    this.paint(false);
  }

  setLayoutSize(): void {
    /* fixed box */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.box, h: this.box };
  }
}

// ── Readout — .ge-rd (label over value) ──────────────────────────────────────
export interface ReadoutOpts {
  label: string;
  value: string;
  muted: string; // label colour
  fg: string; // value colour
  align?: 'left' | 'center' | 'right';
  shadow?: boolean; // floating readouts have a text-shadow; plaque ones don't
  valueSize?: number; // value font-size BEFORE the Oswald 1.15× bump (default 13)
  /** Fixed slot width — the value shrinks to fit it (no jiggle on +/-, mirrors the DOM `.ge-rd-val`
   *  fit). The label aligns within this width too. Omit for content sizing. */
  fixedWidth?: number;
  /** Max slot width — like fixedWidth but only CAPS: the readout is content-sized until it would
   *  exceed maxWidth, then the value shrinks to fit (mirrors the DOM's shrinkable total-win slot).
   *  Ignored when fixedWidth is set. */
  maxWidth?: number;
}

export class Readout extends Container implements Sizable {
  readonly valueText: Text;
  private labelText: Text;
  private align: 'left' | 'center' | 'right';
  private fixedW?: number;
  private maxW?: number;
  // Value baseline ascent at scale 1 (for stable bottom alignment as the value scales down).
  private valueH: number;

  constructor(opts: ReadoutOpts) {
    super();
    this.align = opts.align ?? 'left';
    this.fixedW = opts.fixedWidth;
    this.maxW = opts.maxWidth;
    this.labelText = makeText(opts.label, {
      size: 9,
      weight: '600',
      color: opts.muted,
      letterSpacing: 0.9, // .1em at 9px
      upper: true,
    });
    // The VALUE uses the Oswald numeral font, bumped 1.15× (mirrors `.ge-rd-val`).
    this.valueText = makeText(opts.value, {
      size: Math.round((opts.valueSize ?? 13) * NUM_FONT_SCALE),
      family: NUM_FONT_FAMILY,
      weight: '700',
      color: opts.fg,
      shadow: opts.shadow,
    });
    this.valueH = this.valueText.height;
    this.addChild(this.labelText, this.valueText);
    this.relayout();
  }

  private relayout(): void {
    // shrink the value to fit its slot (transform-scale, like the DOM fit): a fixed slot always,
    // a max slot only when the value would overflow it. Content-sized otherwise.
    this.valueText.scale.set(1);
    const cap = this.fixedW ?? this.maxW;
    if (cap != null && this.valueText.width > cap && this.valueText.width > 0) {
      this.valueText.scale.set(cap / this.valueText.width);
    }
    const vW = this.valueText.width; // scaled width (== cap when it overflowed a max/fixed slot)
    const w = this.fixedW ?? Math.max(this.labelText.width, vW);
    const x = (tw: number): number => (this.align === 'center' ? (w - tw) / 2 : this.align === 'right' ? w - tw : 0);
    this.labelText.position.set(x(this.labelText.width), 0);
    this.valueText.position.set(x(vW), this.labelText.height + 4);
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
    const w = this.fixedW ?? Math.max(this.labelText.width, this.valueText.width);
    return { w, h: this.labelText.height + 4 + this.valueH };
  }
}

// ── circular bordered disc helper (SPIN + BUY BONUS share the black-rim coin look) ──
function drawDisc(g: Graphics, size: number, fill: string, border = 3): void {
  g.clear();
  g.circle(size / 2, size / 2, size / 2 - border / 2);
  g.fill(fill);
  g.stroke({ color: '#000000', width: border });
}

/** A glow Graphics with a soft blur baked in — draw an accent circle into it and it reads as a halo. */
function makeGlow(): Graphics {
  const g = new Graphics();
  try {
    g.filters = [new BlurFilter({ strength: 6, quality: 3 })];
  } catch {
    /* no WebGL (jsdom tests) → unfiltered; tests don't render so the filter is irrelevant there */
  }
  return g;
}

/** BUY BONUS hover: a SOFT accent glow only — `box-shadow: 0 0 11px 1px accent` (no solid ring). */
function drawGlow(glow: Graphics, size: number, accent: string, on: boolean): void {
  glow.clear();
  if (!on) return;
  const r = size / 2;
  glow.circle(r, r, r + 6).fill({ color: accent, alpha: 0.7 }); // blurred by the glow's filter → halo
}

// ── SpinDisc — .ge-shell-spin ────────────────────────────────────────────────
export interface SpinDiscOpts {
  size?: number; // 86 desktop / 84 mobile
  glyph?: number; // 68 / 66
  tokens: ShellTokens;
  ticker: Ticker;
  onSpin: () => void;
  onStop: () => void;
}

export class SpinDisc extends Container implements Sizable {
  private size: number;
  private glyphSize: number;
  private tokens: ShellTokens;
  private ticker: Ticker;
  private glow = makeGlow();
  private ring = new Graphics();
  private disc: Graphics;
  private glyph: IconView;
  private dim = new Graphics();
  private countText?: Text;
  private mode: 'spin' | 'stop' = 'spin';
  private _busy = false;
  private _disabled = false;
  private hovering = false;
  private rotTick?: (t: Ticker) => void;
  private onSpin: () => void;
  private onStop: () => void;

  constructor(opts: SpinDiscOpts) {
    super();
    this.size = opts.size ?? 84;
    this.glyphSize = opts.glyph ?? 65;
    this.tokens = opts.tokens;
    this.ticker = opts.ticker;
    this.onSpin = opts.onSpin;
    this.onStop = opts.onStop;
    this.disc = new Graphics();
    this.glyph = makeIcon('spin', this.glyphSize, this.tokens.btnInk);
    this.glyph.position.set((this.size - this.glyphSize) / 2, (this.size - this.glyphSize) / 2);
    this.addChild(this.glow, this.ring, this.disc, this.glyph, this.dim);
    this.paint();
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.size, this.size);
    attachHover(this, () => {
      this.hovering = true;
      this.paint();
    }, () => {
      this.hovering = false;
      this.paint();
    });
    attachPress(this, 0.94, () => {
      if (this._disabled) return;
      if (this.mode === 'stop') this.onStop();
      else this.onSpin();
    });
  }

  private paint(): void {
    const hot = this.hovering && !this._disabled && this.mode === 'spin';
    // white disc, black 4px ring; hover tints ONLY the glyph accent (no fill/halo) — `.ge-bar-panel
    // .ge-shell-spin`. The hero pops above/below the bar (sized by the caller).
    drawDisc(this.disc, this.size, this.tokens.btn, 4);
    const glyphColor = hot ? this.tokens.accent : this.tokens.btnInk;
    this.glyph.setColor(glyphColor);
    if (this.countText) this.countText.style.fill = hot ? this.tokens.accent : this.tokens.btnInk;
    // Disabled (mid-spin / can't spin): darken OPAQUELY (≈ filter:grayscale(.4) brightness(.62))
    // with a dark veil over the disc — not alpha, which would let the bright board show through and
    // read as a translucent/missing button (what looked "transparent" while spinning).
    this.dim.clear();
    if (this._disabled) {
      this.dim.circle(this.size / 2, this.size / 2, this.size / 2 - 1.5).fill({ color: 0x000000, alpha: 0.4 });
    }
  }

  /** STOP glyph + remaining-count, when autoplay runs. */
  setAutoplay(active: boolean, remaining: number): void {
    if (active) {
      this.mode = 'stop';
      this.stopRotation();
      // STOP glyph at the disc's full size (like SPIN); the count is centred on top of it.
      this.glyph.visible = false;
      this.stopGlyph();
      if (!this.countText) {
        this.countText = makeText('', { size: 22, weight: '800', color: this.tokens.btnInk, align: 'center', family: NUM_FONT_FAMILY });
        this.addChild(this.countText); // added after the STOP glyph → renders on top of it
      }
      const label = Number.isFinite(remaining) ? String(remaining) : '∞';
      setText(this.countText, label);
      this.countText.position.set((this.size - this.countText.width) / 2, (this.size - this.countText.height) / 2);
    } else {
      this.mode = 'spin';
      this.glyph.visible = true;
      this.removeStopGlyph();
      if (this.countText) {
        this.removeChild(this.countText);
        this.countText.destroy();
        this.countText = undefined;
      }
    }
    this.paint();
  }

  private stopGlyphView?: IconView;
  private stopGlyph(): void {
    if (!this.stopGlyphView) {
      this.stopGlyphView = makeIcon('stop', this.glyphSize, this.tokens.btnInk);
      this.stopGlyphView.position.set((this.size - this.glyphSize) / 2, (this.size - this.glyphSize) / 2);
      this.addChild(this.stopGlyphView);
    }
  }
  private removeStopGlyph(): void {
    if (this.stopGlyphView) {
      this.removeChild(this.stopGlyphView);
      this.stopGlyphView.destroy();
      this.stopGlyphView = undefined;
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
      this.glyph.spin += (t.deltaMS / 800) * Math.PI * 2; // .8s/rev linear (CSS ge-spin-rot)
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
    this.stopRotation(); // remove the rotation ticker callback before the glyph is torn down
    super.destroy(options);
  }

  setLayoutSize(): void {
    /* fixed */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.size, h: this.size };
  }
}

// ── BuyBonusBadge — .ge-shell-buybonus ───────────────────────────────────────
export interface BuyBonusOpts {
  size?: number; // 80 / 50
  fontSize?: number; // 13 / 9
  border?: number; // 3 / 2
  bg: string; // accent
  fg?: string; // text colour (#fff, or contrast in feature mode)
  label: string; // "DISABLE" (feature mode) — ignored when `icon` is set
  /** Show this icon (the ticket) instead of the text label — the BUY state. */
  icon?: IconName;
  iconSize?: number; // glyph px (≈ size * 0.62)
  iconColor?: string; // ticket ink (black)
  tokens: ShellTokens;
  ticker: Ticker;
  onTap: () => void;
}

export class BuyBonusBadge extends Container implements Sizable {
  private size: number;
  private disc: Graphics;
  private labelText?: Text;
  private iconView?: IconView;
  private content: Container; // labelText or iconView — the pulsed node
  private bg: string;
  private fg: string;
  private border: number;
  private ticker: Ticker;
  private _disabled = false;
  private pulseCancel?: () => void;
  private glow = makeGlow();

  constructor(opts: BuyBonusOpts) {
    super();
    this.size = opts.size ?? 80;
    this.border = opts.border ?? 3;
    this.bg = opts.bg;
    this.fg = opts.fg ?? '#ffffff';
    this.ticker = opts.ticker;
    this.disc = new Graphics();
    this.addChild(this.glow, this.disc);
    if (opts.icon) {
      const gs = opts.iconSize ?? this.size * 0.62;
      this.iconView = makeIcon(opts.icon, gs, opts.iconColor ?? '#0b0e16');
      this.iconView.pivot.set(gs / 2, gs / 2);             // pulse/scale around the glyph centre
      this.iconView.position.set(this.size / 2, this.size / 2);
      this.content = this.iconView;
      this.addChild(this.iconView);
    } else {
      this.labelText = makeText(opts.label, {
        size: opts.fontSize ?? 13,
        weight: '800',
        color: opts.fg ?? '#ffffff',
        letterSpacing: (opts.fontSize ?? 13) * 0.02,
        align: 'center',
        lineHeight: (opts.fontSize ?? 13) * 1.08,
      });
      this.labelText.anchor.set(0.5);
      this.labelText.position.set(this.size / 2, this.size / 2);
      this.content = this.labelText;
      this.addChild(this.labelText);
    }
    this.paint(false);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.size, this.size);
    attachHover(this, () => this.paint(true), () => this.paint(false));
    attachPress(this, 0.96, () => {
      if (!this._disabled) opts.onTap();
    });
  }

  private paint(hovering: boolean): void {
    // disabled → grayscale(.5) brightness(.72) baked into the fill/label (no filter → crisp)
    drawDisc(this.disc, this.size, this._disabled ? dimColor(this.bg) : this.bg, this.border);
    if (this.labelText) this.labelText.style.fill = this._disabled ? dimColor(this.fg) : this.fg;
    const on = hovering && !this._disabled;
    drawGlow(this.glow, this.size, this.bg, on); // soft accent glow only (no ring) — `.ge-shell-buybonus:hover`
    if (on) this.startPulse();
    else this.stopPulse();
  }

  private startPulse(): void {
    if (this.pulseCancel) return;
    // both the label (anchor 0.5) and the icon (pivot centred) scale around their centre
    const loop = (): void => {
      this.pulseCancel = tween(this.ticker, {
        duration: 700,
        ease: (p) => p,
        onUpdate: (p) => {
          const tri = p < 0.5 ? p * 2 : (1 - p) * 2; // 0→1→0 triangle → scale 1..1.16 (ge-bb-pulse)
          this.content.scale.set(1 + 0.16 * tri);
        },
        onComplete: () => {
          this.pulseCancel = undefined;
          loop();
        },
      });
    };
    loop();
  }
  private stopPulse(): void {
    this.pulseCancel?.();
    this.pulseCancel = undefined;
    this.content.scale.set(1);
  }

  setColors(bg: string, fg: string): void {
    this.bg = bg;
    if (this.labelText) this.labelText.style.fill = fg;
    this.paint(false);
  }

  setLabel(label: string): void {
    if (this.labelText) setText(this.labelText, label);
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.cursor = v ? 'default' : 'pointer';
    this.eventMode = v ? 'none' : 'static';
    this.paint(false); // disabled look is baked into the fill/label (see paint) — crisp, no filter
  }

  setLayoutSize(): void {
    /* fixed */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.size, h: this.size };
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopPulse(); // cancel the hover-pulse tween (ticker) before teardown
    super.destroy(options);
  }
}

// ── FsHero — .ge-fs-hero (FS counter in the SPIN slot: white/black-ring RECTANGLE) ──
export interface FsHeroOpts {
  label: string; // localized "Free spins"
  value: string; // "3 / 10"
  tokens: ShellTokens;
  height?: number; // 84 — matches the SPIN disc so it pops above/below the bar
  minWidth?: number; // 96
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
    // label wraps to ≤2 lines for long locales ("Бесплатные вращения")
    const label = makeText(opts.label, {
      size: 9, weight: '700', color: '#454c5a', letterSpacing: 0.72, upper: true,
      align: 'center', wrapWidth: minW - padX * 2,
    });
    const num = makeText(opts.value, { size: 30, weight: '700', color: opts.tokens.btnInk, family: NUM_FONT_FAMILY, align: 'center' });
    const contentW = Math.max(label.width, num.width);
    this.w = Math.max(minW, contentW + padX * 2);
    this.bgG.roundRect(0, 0, this.w, this.h, 20).fill(opts.tokens.btn).stroke({ color: '#000000', width: 4 });
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

// ── thin vertical divider — .ge-pl-divider ───────────────────────────────────
export function divider(tokens: ShellTokens, height = 30): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 1, height);
  g.fill(tokens.plaqueLine);
  return g;
}

export { FlexBox };
export type { Sizable, TweenOpts };
