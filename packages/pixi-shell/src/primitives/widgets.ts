import { BlurFilter, Color, Container, Graphics, Rectangle, Text, Ticker } from 'pixi.js';
import type { ShellTokens } from '../theme';
import type { IconName } from '../icons';
import { makeIcon, IconView } from '../pixi-icon';
import { makeText, setText } from '../text';
import { tween, type TweenOpts } from '../motion';
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

  constructor(name: IconName, opts: IconButtonOpts) {
    super();
    this._name = name;
    this.box = opts.size ?? 40;
    this._color = opts.color;
    this.hoverColor = opts.hover;
    this.activeColor = opts.activeColor ?? opts.color;
    this._active = opts.active ?? false;
    const glyph = opts.glyph ?? 24;
    this.view = makeIcon(name, glyph, this._active ? this.activeColor : this._color);
    this.view.position.set((this.box - glyph) / 2, (this.box - glyph) / 2);
    this.addChild(this.view);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.box, this.box);
    attachHover(this, () => this.paint(true), () => this.paint(false));
    attachPress(this, 0.92, () => {
      if (!this._disabled) opts.onTap?.();
    });
  }

  private paint(hovering: boolean): void {
    if (this._disabled) return;
    const c = hovering ? this.hoverColor : this._active ? this.activeColor : this._color;
    this.view.setColor(c);
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
    this.view.setColor(on ? this.hoverColor : this._active ? this.activeColor : this._color);
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
  align?: 'left' | 'center';
  shadow?: boolean; // floating readouts have a text-shadow; plaque ones don't
  valueSize?: number;
}

export class Readout extends Container implements Sizable {
  readonly valueText: Text;
  private labelText: Text;
  private align: 'left' | 'center';

  constructor(opts: ReadoutOpts) {
    super();
    this.align = opts.align ?? 'left';
    this.labelText = makeText(opts.label, {
      size: 9,
      weight: '600',
      color: opts.muted,
      letterSpacing: 0.9, // .1em at 9px
      upper: true,
    });
    this.valueText = makeText(opts.value, {
      size: opts.valueSize ?? 13,
      weight: '700',
      color: opts.fg,
      shadow: opts.shadow,
    });
    this.addChild(this.labelText, this.valueText);
    this.relayout();
  }

  private relayout(): void {
    const w = Math.max(this.labelText.width, this.valueText.width);
    if (this.align === 'center') {
      this.labelText.position.set((w - this.labelText.width) / 2, 0);
      this.valueText.position.set((w - this.valueText.width) / 2, this.labelText.height + 4);
    } else {
      this.labelText.position.set(0, 0);
      this.valueText.position.set(0, this.labelText.height + 4);
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
    /* content sized */
  }
  measureSize(): { w: number; h: number } {
    return { w: Math.max(this.labelText.width, this.valueText.width), h: this.labelText.height + 4 + this.valueText.height };
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

/** The hover halo shared by SPIN + BUY BONUS: `box-shadow: 0 0 0 3px accent, 0 0 16px accent` —
 *  a SOLID 3px accent ring hugging the disc plus a soft accent glow behind it. */
function drawHalo(glow: Graphics, ring: Graphics, size: number, accent: string, on: boolean): void {
  glow.clear();
  ring.clear();
  if (!on) return;
  const r = size / 2;
  glow.circle(r, r, r + 7).fill({ color: accent, alpha: 0.65 }); // blurred by the glow's filter → glow
  ring.circle(r, r, r + 1.5).stroke({ color: accent, width: 3 }); // solid, opaque accent ring
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
    this.size = opts.size ?? 86;
    this.glyphSize = opts.glyph ?? 68;
    this.tokens = opts.tokens;
    this.ticker = opts.ticker;
    this.onSpin = opts.onSpin;
    this.onStop = opts.onStop;
    this.disc = new Graphics();
    this.glyph = makeIcon('spin', this.glyphSize, this.tokens.spinFg);
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
    drawDisc(this.disc, this.size, hot ? this.tokens.accent : this.tokens.spin);
    drawHalo(this.glow, this.ring, this.size, this.tokens.accent, hot); // solid ring + glow on hover
    const glyphColor = hot ? '#ffffff' : this.tokens.spinFg;
    this.glyph.setColor(glyphColor);
    if (this.countText) this.countText.style.fill = hot ? '#ffffff' : this.tokens.spinFg;
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
        this.countText = makeText('', { size: 22, weight: '800', color: this.tokens.spinFg, align: 'center' });
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
      this.stopGlyphView = makeIcon('stop', this.glyphSize, this.tokens.spinFg);
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
  label: string; // "BUY BONUS" (2-line) or "DISABLE"
  tokens: ShellTokens;
  ticker: Ticker;
  onTap: () => void;
}

export class BuyBonusBadge extends Container implements Sizable {
  private size: number;
  private disc: Graphics;
  private labelText: Text;
  private bg: string;
  private fg: string;
  private border: number;
  private ticker: Ticker;
  private _disabled = false;
  private pulseCancel?: () => void;
  private glow = makeGlow();
  private ring = new Graphics();

  constructor(opts: BuyBonusOpts) {
    super();
    this.size = opts.size ?? 80;
    this.border = opts.border ?? 3;
    this.bg = opts.bg;
    this.fg = opts.fg ?? '#ffffff';
    this.ticker = opts.ticker;
    this.disc = new Graphics();
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
    this.addChild(this.glow, this.ring, this.disc, this.labelText);
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
    // disabled → grayscale(.5) brightness(.72) baked into the fill/label (no filter → crisp ring)
    drawDisc(this.disc, this.size, this._disabled ? dimColor(this.bg) : this.bg, this.border);
    this.labelText.style.fill = this._disabled ? dimColor(this.fg) : this.fg;
    const on = hovering && !this._disabled;
    drawHalo(this.glow, this.ring, this.size, this.bg, on); // solid 3px accent ring + soft glow
    if (on) this.startPulse();
    else this.stopPulse();
  }

  private startPulse(): void {
    if (this.pulseCancel) return;
    const loop = (): void => {
      this.pulseCancel = tween(this.ticker, {
        duration: 700,
        ease: (p) => p,
        onUpdate: (p) => {
          // 0→1→0 triangle → scale 1..1.16 (CSS ge-bb-pulse)
          const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
          this.labelText.scale.set(1 + 0.16 * tri);
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
    this.labelText.scale.set(1);
  }

  setColors(bg: string, fg: string): void {
    this.bg = bg;
    this.labelText.style.fill = fg;
    this.paint(false);
  }

  setLabel(label: string): void {
    setText(this.labelText, label);
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

// ── thin vertical divider — .ge-pl-divider ───────────────────────────────────
export function divider(tokens: ShellTokens, height = 30): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 1, height);
  g.fill(tokens.plaqueLine);
  return g;
}

export { FlexBox };
export type { Sizable, TweenOpts };
