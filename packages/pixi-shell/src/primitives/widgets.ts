import { Container, Graphics, Rectangle, Text, Ticker } from 'pixi.js';
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
export function attachHover(node: Container, over: () => void, out: () => void): void {
  node.on('pointerover', over);
  node.on('pointerout', out);
}

/** Press-scale on pointerdown, restore on up/out — the CSS `:active { transform:scale(x) }`. */
export function attachPress(node: Container, scale: number, onTap: () => void): void {
  let down = false;
  const set = (s: number) => node.scale.set(s);
  node.on('pointerdown', () => {
    down = true;
    set(scale);
  });
  const release = () => {
    if (down) set(1);
    down = false;
  };
  node.on('pointerup', () => {
    release();
  });
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
  private disc: Graphics;
  private glyph: IconView;
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
    this.addChild(this.disc, this.glyph);
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
    const glyphColor = hot ? '#ffffff' : this.tokens.spinFg;
    this.glyph.setColor(glyphColor);
    if (this.countText) this.countText.style.fill = hot ? '#ffffff' : this.tokens.spinFg;
    this.alpha = 1;
    if (this._disabled) {
      // approximate `filter:grayscale(.4) brightness(.62)` — dim the whole disc
      this.alpha = 0.62;
    }
  }

  /** STOP glyph + remaining-count, when autoplay runs. */
  setAutoplay(active: boolean, remaining: number): void {
    if (active) {
      this.mode = 'stop';
      this.stopRotation();
      this.glyph.setColor(this.tokens.spinFg);
      // swap to the STOP glyph (smaller, leaving room for the count below)
      this.glyph.visible = false;
      if (!this.countText) {
        this.countText = makeText('', { size: 22, weight: '800', color: this.tokens.spinFg, align: 'center' });
        this.addChild(this.countText);
      }
      this.stopGlyph();
      const label = Number.isFinite(remaining) ? String(remaining) : '∞';
      setText(this.countText, label);
      this.countText.position.set((this.size - this.countText.width) / 2, this.size / 2 + 6);
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
      const gs = Math.round(this.glyphSize * 0.62);
      this.stopGlyphView = makeIcon('stop', gs, this.tokens.spinFg);
      this.stopGlyphView.position.set((this.size - gs) / 2, this.size / 2 - gs - 2);
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

  destroyDisc(): void {
    this.stopRotation();
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
  private border: number;
  private ticker: Ticker;
  private _disabled = false;
  private pulseCancel?: () => void;
  private glow: Graphics;

  constructor(opts: BuyBonusOpts) {
    super();
    this.size = opts.size ?? 80;
    this.border = opts.border ?? 3;
    this.bg = opts.bg;
    this.ticker = opts.ticker;
    this.glow = new Graphics();
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
    this.addChild(this.glow, this.disc, this.labelText);
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
    drawDisc(this.disc, this.size, this.bg, this.border);
    this.glow.clear();
    if (hovering && !this._disabled) {
      // approximate `box-shadow: 0 0 0 3px accent, 0 0 16px accent` with a soft ring
      this.glow.circle(this.size / 2, this.size / 2, this.size / 2 + 4);
      this.glow.fill({ color: this.bg, alpha: 0.35 });
      this.startPulse();
    } else {
      this.stopPulse();
    }
    this.alpha = this._disabled ? 0.72 : 1;
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
    this.paint(false);
  }

  setLayoutSize(): void {
    /* fixed */
  }
  measureSize(): { w: number; h: number } {
    return { w: this.size, h: this.size };
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
