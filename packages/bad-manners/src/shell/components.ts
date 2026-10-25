import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, type FederatedPointerEvent, type Text, type Ticker } from 'pixi.js';
import { SLICE, faceTex, FACE_ASPECT, iconTex, uiTex, type BubbleVariant, type IconName, type UiName } from './assets';
import { ease, reducedMotion, tween } from './motion';
import { display, fitWidth, num } from './text';
import { C, MOTION, SIZE, TYPE } from './theme';

// The BRANDBOOK §4 primitives, built only from kit textures (9-slice bubbles and pills, the atlas
// glyphs, the face mark). Code lays them out, tints glyphs and animates — it never draws a plate.

/** A kit glyph (64×64, white) at `size`, tinted, anchored at its centre. */
export function glyph(name: IconName, size: number, tint: number = C.paper): Sprite {
  const s = new Sprite(iconTex(name));
  s.anchor.set(0.5);
  s.width = s.height = size;
  s.tint = tint;
  return s;
}

/** The coloured face mark at `h` tall, anchored at its centre (never tinted). */
export function face(h: number): Sprite {
  const s = new Sprite(faceTex());
  s.anchor.set(0.5);
  s.height = h;
  s.width = h * FACE_ASPECT;
  return s;
}

function slice(name: UiName, insets: { left: number; right: number; top: number; bottom: number }): NineSliceSprite {
  return new NineSliceSprite({
    texture: uiTex(name),
    leftWidth: insets.left,
    rightWidth: insets.right,
    topHeight: insets.top,
    bottomHeight: insets.bottom,
  });
}

// ── Bubble ───────────────────────────────────────────────────────────────────
export type Tail = 'l' | 'r';

/** §4.1: a speech-bubble plate. The body is the top `h − 16`; the tail hangs below it on one side. */
export class Bubble extends Container {
  readonly plate: NineSliceSprite;
  readonly w: number;
  readonly h: number;
  readonly tail: Tail;
  private variant: BubbleVariant;

  constructor(o: { variant?: BubbleVariant; tail?: Tail; width: number; height: number }) {
    super();
    this.variant = o.variant ?? 'ink';
    this.tail = o.tail ?? 'l';
    this.w = o.width;
    this.h = Math.max(56, o.height);
    this.plate = slice(`bubble-${this.variant}-tail${this.tail}`, this.tail === 'l' ? SLICE.taill : SLICE.tailr);
    this.plate.width = this.w;
    this.plate.height = this.h;
    this.addChild(this.plate);
  }

  get bodyH(): number {
    return this.h - SIZE.tail;
  }

  setVariant(v: BubbleVariant): void {
    if (v === this.variant) return;
    this.variant = v;
    this.plate.texture = uiTex(`bubble-${v}-tail${this.tail}`);
  }

  /** Where the tail points — the pivot `bubblePop` grows from. */
  tailTip(): { x: number; y: number } {
    return { x: this.tail === 'l' ? 16 : this.w - 16, y: this.h };
  }

  /** Centre `node` (its local bounds) in the body. */
  centre(node: Container, dx = 0): void {
    const b = node.getLocalBounds();
    node.position.set((this.w - b.width) / 2 - b.x + dx, (this.bodyH - b.height) / 2 - b.y);
  }
}

/** Put `b`'s pivot on its tail tip without moving it (so it can pop from there). */
export function pivotOnTail(b: Bubble): void {
  const t = b.tailTip();
  b.pivot.set(t.x, t.y);
  b.position.set(b.x + t.x, b.y + t.y);
}

// ── pressable base ───────────────────────────────────────────────────────────
export type BtnState = 'idle' | 'hover' | 'press' | 'disabled';

/** Press behaviour shared by every button (§7): the face (`view`) scales to .94 in 80ms around its
 *  centre and springs back with back.out(3) in 180ms; the hit box stays put (plus 8px all round). */
export abstract class Btn extends Container {
  readonly view = new Container();
  readonly bw: number;
  readonly bh: number;
  protected state: BtnState = 'idle';
  private _disabled = false;
  private over = false;
  private down = false;
  private anim?: () => void;
  private pressScale: number;

  constructor(
    protected ticker: Ticker,
    w: number,
    h: number,
    private onTap: () => void,
    o: { pad?: number; pressScale?: number } = {},
  ) {
    super();
    this.bw = w;
    this.bh = h;
    this.pressScale = o.pressScale ?? MOTION.press.scale;
    this.view.pivot.set(w / 2, h / 2);
    this.view.position.set(w / 2, h / 2);
    this.addChild(this.view);
    const pad = o.pad ?? 8;
    this.hitArea = new Rectangle(-pad, -pad, w + 2 * pad, h + 2 * pad);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => {
      this.over = true;
      this.refresh();
    });
    this.on('pointerout', () => {
      this.over = false;
      this.refresh();
    });
    this.on('pointerdown', () => {
      if (this._disabled) return;
      this.down = true;
      this.scaleTo(this.pressScale, MOTION.press.dur, ease.power2Out);
      this.refresh();
    });
    const up = (): void => {
      if (!this.down) return;
      this.down = false;
      this.scaleTo(1, MOTION.release.dur, ease.backOut(3));
      this.refresh();
    };
    this.on('pointerup', up);
    this.on('pointerupoutside', up);
    this.on('pointertap', () => {
      if (!this._disabled) this.onTap();
    });
  }

  private scaleTo(to: number, duration: number, f: (p: number) => number): void {
    this.anim?.();
    const from = this.view.scale.x;
    this.anim = tween(this.ticker, {
      duration,
      ease: f,
      onUpdate: (p) => {
        if (!this.view.destroyed) this.view.scale.set(from + (to - from) * p);
      },
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.cursor = v ? 'default' : 'pointer';
    this.refresh();
  }
  get disabled(): boolean {
    return this._disabled;
  }

  protected refresh(): void {
    const s: BtnState = this._disabled ? 'disabled' : this.down ? 'press' : this.over ? 'hover' : 'idle';
    if (s === this.state) return;
    this.state = s;
    this.paint(s);
  }

  protected abstract paint(s: BtnState): void;

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.anim?.();
    super.destroy(options);
  }
}

// ── PillButton ───────────────────────────────────────────────────────────────
export type PillKind = 'primary' | 'secondary' | 'secondary-white';

/** §4.2: an action capsule. The pill keeps its kit height (52) and is scaled to `h`; only its width
 *  stretches. States swap the TEXTURE, so colours match the tokens exactly. */
export class PillButton extends Btn {
  readonly plate: NineSliceSprite;
  readonly labelText: Text;
  private icon?: Sprite;
  private kind: PillKind;

  constructor(ticker: Ticker, o: { label: string; kind?: PillKind; width?: number; height?: number; icon?: IconName; onTap: () => void }) {
    const w = o.width ?? 300;
    const h = o.height ?? SIZE.pill.h;
    super(ticker, w, h, o.onTap, { pressScale: 0.97 });
    this.kind = o.kind ?? 'primary';
    const k = h / 52;
    this.plate = slice('pill-lime', SLICE.pill);
    this.plate.width = w / k;
    this.plate.height = 52;
    this.plate.scale.set(k);
    this.labelText = display(o.label, TYPE.button * (h / SIZE.pill.h));
    const iconSize = this.labelText.height * 0.7;
    if (o.icon) this.icon = glyph(o.icon, iconSize);
    const gap = o.icon ? iconSize * 0.35 : 0;
    fitWidth(this.labelText, w - h - (o.icon ? iconSize + gap : 0));
    const total = this.labelText.width + (o.icon ? iconSize + gap : 0);
    const x0 = (w - total) / 2;
    if (this.icon) this.icon.position.set(x0 + iconSize / 2, h / 2);
    this.labelText.position.set(x0 + (o.icon ? iconSize + gap : 0), (h - this.labelText.height) / 2);
    this.view.addChild(this.plate, this.labelText);
    if (this.icon) this.view.addChild(this.icon);
    this.paint('idle');
  }

  protected paint(s: BtnState): void {
    const primary = this.kind === 'primary';
    const outline = this.kind === 'secondary' ? 'pill-ink-outline' : 'pill-ink-outline-white';
    const tex: UiName =
      s === 'disabled' ? 'pill-grey' : primary ? (s === 'press' ? 'pill-lime-press' : s === 'hover' ? 'pill-lime-hover' : 'pill-lime') : outline;
    this.plate.texture = uiTex(tex);
    const ink = s === 'disabled' ? C.grey500 : primary ? C.ink : s === 'hover' ? C.lime : C.paper;
    this.labelText.tint = ink;
    if (this.icon) this.icon.tint = ink;
    this.view.y = this.bh / 2 + (primary && s === 'press' ? 2 : 0);
  }
}

// ── IconButton ───────────────────────────────────────────────────────────────
export type IconShape = 'bubble-l' | 'bubble-r' | 'pill';

/** §4.3: a plate (bubble or pill) with a glyph at ≈ .55 of its side. Tints per §3.5; a toggle that is
 *  on gets the lime-outlined plate and a lime glyph, a `lime` one the lime plate with an ink glyph («на
 *  лайме»). `outline` gives a bubble the lime outline («закрыть»). */
export class IconButton extends Btn {
  readonly plate: NineSliceSprite;
  readonly glyph: Sprite;
  private shape: IconShape;
  private isOn: boolean;
  private lime: boolean;
  private _icon: IconName;
  get isBubble(): boolean {
    return this.shape !== 'pill';
  }
  private outline: boolean;

  constructor(
    ticker: Ticker,
    o: { icon: IconName; shape?: IconShape; width?: number; height?: number; on?: boolean; lime?: boolean; outline?: boolean; onTap: () => void },
  ) {
    const w = o.width ?? SIZE.hudButton;
    const h = o.height ?? SIZE.hudButton;
    super(ticker, w, h, o.onTap);
    this.shape = o.shape ?? 'bubble-l';
    this.isOn = o.on ?? false;
    this.lime = o.lime ?? false;
    this.outline = o.outline ?? false;
    const pill = this.shape === 'pill';
    if (pill) {
      const k = h / 52;
      this.plate = slice('pill-ink', SLICE.pill);
      this.plate.width = w / k;
      this.plate.height = 52;
      this.plate.scale.set(k);
    } else {
      this.plate = slice('bubble-ink-taill', this.shape === 'bubble-l' ? SLICE.taill : SLICE.tailr);
      this.plate.width = w;
      this.plate.height = h;
    }
    const body = pill ? h : h - SIZE.tail;
    this._icon = o.icon;
    this.glyph = glyph(o.icon, Math.min(w, body) * (pill ? 0.62 : 0.55));
    this.glyph.position.set(w / 2, body / 2);
    this.view.addChild(this.plate, this.glyph);
    this.paint('idle');
  }

  setIcon(name: IconName): void {
    this._icon = name;
    this.glyph.texture = iconTex(name);
  }

  get iconName(): IconName {
    return this._icon;
  }

  protected paint(s: BtnState): void {
    const off = s === 'disabled';
    if (this.shape === 'pill') {
      this.plate.texture = uiTex(
        off ? 'pill-grey' : this.lime ? (s === 'press' ? 'pill-lime-press' : s === 'hover' ? 'pill-lime-hover' : 'pill-lime') : this.isOn ? 'pill-ink-outline' : 'pill-ink',
      );
    } else {
      const t = this.shape === 'bubble-l' ? 'l' : 'r';
      this.plate.texture = uiTex(`bubble-${off ? 'grey' : this.outline ? 'ink-outline' : 'ink'}-tail${t}`);
    }
    this.glyph.tint = off ? C.grey500 : this.lime ? C.ink : this.isOn || s === 'hover' ? C.lime : C.paper;
  }
}

// ── Field ────────────────────────────────────────────────────────────────────
/** Widest each named field has been, so a readout only ever grows (no width jitter as digits change). */
const fieldWidths = new Map<string, number>();

export interface FieldOpts {
  label: string;
  value: string;
  tail?: Tail;
  height?: number;
  minW?: number;
  /** Remember the width under this key (the bar rebuilds its fields on every state change). */
  key?: string;
  /** − / + at the ends (BET). */
  stepper?: { onStep: (dir: 1 | -1) => void; downDisabled?: boolean; upDisabled?: boolean };
  /** Tap on the label/value (opens the bet picker). */
  onValue?: () => void;
}

/** §4.4: BALANCE / WIN / BET — a bubble-ink 76 tall: lime display label + 12 + numeric value. */
export class Field extends Container {
  readonly bubble: Bubble;
  readonly labelText: Text;
  readonly valueText: Text;
  readonly valueHit = new Container();
  minus?: StepBtn;
  plus?: StepBtn;

  constructor(ticker: Ticker, o: FieldOpts) {
    super();
    const h = o.height ?? SIZE.field.h;
    const k = h / SIZE.field.h;
    const pad = 26 * k;
    const gap = 12 * k;
    const side = o.stepper ? 64 * k : pad;
    this.labelText = display(o.label, TYPE.fieldLabel * k, C.lime);
    this.valueText = num(o.value, TYPE.fieldValue * k);
    const need = side * 2 + this.labelText.width + gap + this.valueText.width;
    const remembered = o.key ? fieldWidths.get(o.key) ?? 0 : 0;
    const w = Math.ceil(Math.max((o.minW ?? SIZE.field.minW) * k, need, remembered));
    if (o.key) fieldWidths.set(o.key, w);
    this.bubble = new Bubble({ variant: 'ink', tail: o.tail ?? 'l', width: w, height: h });
    const body = this.bubble.bodyH;
    const x0 = o.stepper ? (w - (this.labelText.width + gap + this.valueText.width)) / 2 : pad;
    this.labelText.position.set(x0, (body - this.labelText.height) / 2);
    this.valueText.position.set(x0 + this.labelText.width + gap, (body - this.valueText.height) / 2);
    this.valueHit.hitArea = new Rectangle(side, 0, w - 2 * side, body);
    this.addChild(this.bubble, this.labelText, this.valueText, this.valueHit);
    if (o.onValue) {
      this.valueHit.eventMode = 'static';
      this.valueHit.cursor = 'pointer';
      this.valueHit.on('pointertap', o.onValue);
    }
    if (o.stepper) {
      const st = o.stepper;
      this.minus = new StepBtn(ticker, 'minus', 64 * k, body, 26 * k, () => st.onStep(-1));
      this.plus = new StepBtn(ticker, 'plus', 64 * k, body, 26 * k, () => st.onStep(1));
      this.plus.x = w - 64 * k;
      this.minus.disabled = !!st.downDisabled;
      this.plus.disabled = !!st.upDisabled;
      this.addChild(this.minus, this.plus);
    }
  }

  get fw(): number {
    return this.bubble.w;
  }
  get fh(): number {
    return this.bubble.h;
  }
}

/** A bare lime ± with a square hit box (the BET stepper). */
export class StepBtn extends Btn {
  private g: Sprite;
  constructor(ticker: Ticker, icon: IconName, w: number, h: number, size: number, onTap: () => void) {
    super(ticker, w, h, onTap, { pad: 0 });
    this.g = glyph(icon, size, C.lime);
    this.g.position.set(w / 2, h / 2);
    this.view.addChild(this.g);
    this.paint('idle');
  }
  protected paint(s: BtnState): void {
    this.g.tint = s === 'disabled' ? C.grey500 : s === 'hover' ? C.limeHover : C.lime;
  }
}

// ── SpinButton ───────────────────────────────────────────────────────────────
export type SpinMode = 'spin' | 'stop' | 'autoplay';

/** §4.5: the base disc + spin glyph. Spinning: the pressed base and a rotating glyph (2.2 rps, turbo 4).
 *  Autoplay: the remaining count instead of the glyph (tap stops it). `counter` shows a free-spins
 *  readout instead (not tappable). */
export class SpinButton extends Btn {
  private base: Sprite;
  private icon?: Sprite;
  private count?: Text;
  private busy = false;
  private rot?: (t: Ticker) => void;

  constructor(
    ticker: Ticker,
    o: {
      size?: number;
      mode?: SpinMode;
      remaining?: number;
      counter?: { label: string; value: string };
      turbo?: boolean;
      onTap: () => void;
    },
  ) {
    const size = o.size ?? SIZE.spin;
    super(ticker, size, size, o.onTap);
    const k = size / SIZE.spin;
    this.base = new Sprite(uiTex('spin-base'));
    this.base.width = this.base.height = size;
    this.view.addChild(this.base);
    const mode = o.mode ?? 'spin';
    if (o.counter) {
      const label = display(o.counter.label, 15 * k, C.ink);
      const value = display(o.counter.value, 40 * k, C.ink);
      fitWidth(label, size * 0.7);
      fitWidth(value, size * 0.7);
      const top = (size - label.height - value.height) / 2;
      label.position.set((size - label.width) / 2, top);
      value.position.set((size - value.width) / 2, top + label.height);
      this.view.addChild(label, value);
      this.eventMode = 'none';
      this.cursor = 'default';
    } else if (mode === 'autoplay') {
      const n = o.remaining ?? 0;
      this.count = display(Number.isFinite(n) ? String(n) : '∞', 56 * k, C.ink);
      fitWidth(this.count, size * 0.62);
      this.count.position.set((size - this.count.width) / 2, (size - this.count.height) / 2);
      this.view.addChild(this.count);
    } else {
      this.icon = glyph(mode === 'stop' ? 'stop' : 'spin', (mode === 'stop' ? 60 : 92) * k, C.ink);
      this.icon.position.set(size / 2, size / 2);
      this.view.addChild(this.icon);
    }
    this.rps = o.turbo ? MOTION.spinRpsTurbo : MOTION.spinRps;
    this.paint('idle');
  }
  private rps: number;

  get countText(): string | undefined {
    return this.count?.text;
  }

  /** A round is playing: the pressed base, and the spin glyph rotates. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.paint(this.state);
    if (busy && this.icon && !this.rot && !reducedMotion()) {
      this.rot = (t: Ticker) => {
        if (this.icon && !this.icon.destroyed) this.icon.rotation += (t.deltaMS / 1000) * this.rps * Math.PI * 2;
      };
      this.ticker.add(this.rot);
    } else if (!busy) this.stopRot();
  }

  private stopRot(): void {
    if (this.rot) this.ticker.remove(this.rot);
    this.rot = undefined;
    if (this.icon && !this.icon.destroyed) this.icon.rotation = 0;
  }

  protected paint(s: BtnState): void {
    const tex: UiName = s === 'disabled' ? 'spin-base-disabled' : s === 'press' || this.busy ? 'spin-base-press' : s === 'hover' ? 'spin-base-hover' : 'spin-base';
    this.base.texture = uiTex(tex);
    const ink = s === 'disabled' ? C.grey500 : C.ink;
    if (this.icon) this.icon.tint = ink;
    if (this.count) this.count.tint = ink;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopRot();
    super.destroy(options);
  }
}

// ── BuyButton ────────────────────────────────────────────────────────────────
/** The BUY disc's ring at the kit's 128 (§3.3's 3 px outline). */
const BUY_RING = 3;

/** The round BUY: an ink disc with an accent ring, the logo face inside it (its black outline melts
 *  into the disc — a white face with the accent tongue); with a feature on, the accent disc with a ✕
 *  that switches it off. */
export class BuyButton extends Btn {
  private base?: Sprite;
  private disc?: Graphics;
  private size: number;

  constructor(ticker: Ticker, o: { size: number; active: boolean; onTap: () => void }) {
    super(ticker, o.size, o.size, o.onTap);
    this.size = o.size;
    const k = o.size / SIZE.spin;
    if (o.active) {
      this.base = new Sprite(uiTex('spin-base'));
      this.base.width = this.base.height = o.size;
      const x = glyph('close', 72 * k, C.ink);
      x.position.set(o.size / 2, o.size / 2);
      this.view.addChild(this.base, x);
    } else {
      this.disc = new Graphics();
      const f = face(o.size * 0.74);
      f.position.set(o.size / 2, o.size / 2);
      this.view.addChild(this.disc, f);
    }
    this.paint('idle');
  }

  protected paint(s: BtnState): void {
    if (this.base) this.base.texture = uiTex(s === 'disabled' ? 'spin-base-disabled' : s === 'press' ? 'spin-base-press' : s === 'hover' ? 'spin-base-hover' : 'spin-base');
    if (this.disc) {
      const r = this.size / 2;
      const ring = BUY_RING * (this.size / SIZE.spin);
      const color = s === 'disabled' ? C.grey500 : s === 'hover' ? C.limeHover : s === 'press' ? C.limePress : C.lime;
      this.disc.clear().circle(r, r, r - ring / 2).fill(C.ink).stroke({ width: ring, color });
    }
    this.view.alpha = s === 'disabled' ? 0.45 : 1;
  }
}
// ── Slider ───────────────────────────────────────────────────────────────────
export interface SliderOpts {
  width: number;
  /** Discrete positions (bet levels, autoplay counts); omitted = continuous 0..1. */
  steps?: number;
  /** Start: a step index, or 0..1 when continuous. */
  value: number;
  onChange: (v: number) => void;
  /** Value-bubble text for a position; omitted = no bubble (the volume sliders). */
  label?: (v: number) => string;
  knob?: number;
}

/** §4.6: track + fill to the knob's CENTRE + the face-mark knob; the value bubble rides above the knob
 *  inside the track's ends. Snaps to the nearest step when discrete. */
export class Slider extends Container {
  readonly track: NineSliceSprite;
  readonly fill: NineSliceSprite;
  readonly knob: Sprite;
  readonly bubble?: Bubble;
  private valueText?: Text;
  private o: SliderOpts;
  private u = 0;
  private dragging = false;
  private anim?: () => void;
  readonly trackY: number;
  readonly sh: number;
  private kbx = 1;
  private kby = 1;

  constructor(private ticker: Ticker, o: SliderOpts) {
    super();
    this.o = o;
    const kn = o.knob ?? SIZE.sliderKnob;
    const w = o.width;
    const bubbleH = 64;
    this.trackY = o.label ? bubbleH + 12 + kn / 2 : kn / 2;
    this.sh = this.trackY + kn / 2;
    this.track = slice('slider-track', SLICE.slider);
    this.track.width = w;
    this.track.height = SIZE.sliderTrackH;
    this.track.y = this.trackY - SIZE.sliderTrackH / 2;
    this.fill = slice('slider-fill', SLICE.slider);
    this.fill.height = SIZE.sliderTrackH;
    this.fill.y = this.track.y;
    this.knob = face(kn);
    this.knob.y = this.trackY;
    this.kbx = this.knob.scale.x;
    this.kby = this.knob.scale.y;
    this.addChild(this.track, this.fill, this.knob);
    if (o.label) {
      const widest = Math.max(...this.allLabels().map((s) => num(s, 22).width));
      this.bubble = new Bubble({ variant: 'ink-outline', tail: 'l', width: Math.max(96, widest + 48), height: bubbleH });
      this.valueText = num('', 22);
      this.bubble.addChild(this.valueText);
      this.addChild(this.bubble);
    }
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(-kn / 2, this.trackY - kn / 2 - 8, w + kn, kn + 16);
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.grab(true);
      this.moveTo(e);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.moveTo(e);
    });
    const up = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.grab(false);
    };
    this.on('pointerup', up);
    this.on('pointerupoutside', up);
    this.set(o.steps ? o.value / Math.max(1, o.steps - 1) : o.value);
  }

  private allLabels(): string[] {
    const n = this.o.steps ?? 0;
    return n ? Array.from({ length: n }, (_, i) => this.o.label!(i)) : [this.o.label!(1)];
  }

  /** The current value: a step index, or 0..1. */
  get value(): number {
    return this.o.steps ? Math.round(this.u * (this.o.steps - 1)) : this.u;
  }

  setValue(v: number): void {
    this.set(this.o.steps ? v / Math.max(1, this.o.steps - 1) : v);
  }

  private moveTo(e: FederatedPointerEvent): void {
    const x = this.toLocal(e.global).x;
    let u = Math.max(0, Math.min(1, x / this.o.width));
    if (this.o.steps) u = Math.round(u * (this.o.steps - 1)) / Math.max(1, this.o.steps - 1);
    if (u === this.u) return;
    this.set(u);
    this.o.onChange(this.value);
  }

  private set(u: number): void {
    this.u = Math.max(0, Math.min(1, u));
    const x = this.u * this.o.width;
    this.knob.x = x;
    this.fill.width = Math.max(16, x);
    this.fill.visible = x > 0;
    if (this.bubble && this.valueText) {
      this.valueText.text = this.o.label!(this.value);
      this.bubble.centre(this.valueText);
      // the tail (≈16px in from the bubble's left) points at the knob; clamped inside the track
      this.bubble.position.set(Math.max(0, Math.min(this.o.width - this.bubble.w, x - 16)), 0);
    }
  }

  /** While dragged the knob grows to 1.1 and leans −8°; it springs back with back.out(3). */
  private grab(on: boolean): void {
    this.anim?.();
    const kn = this.knob;
    const from = { s: kn.scale.y / this.kby, r: kn.rotation };
    const to = on ? { s: 1.1, r: reducedMotion() ? 0 : (-8 * Math.PI) / 180 } : { s: 1, r: 0 };
    this.anim = tween(this.ticker, {
      duration: on ? MOTION.press.dur : MOTION.release.dur,
      ease: on ? ease.power2Out : ease.backOut(3),
      onUpdate: (p) => {
        if (kn.destroyed) return;
        const s = from.s + (to.s - from.s) * p;
        kn.scale.set(this.kbx * s, this.kby * s);
        kn.rotation = from.r + (to.r - from.r) * p;
      },
    });
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.anim?.();
    super.destroy(options);
  }
}

// ── Volatility ───────────────────────────────────────────────────────────────
const GRAWLIX: IconName[] = ['grawlix-excl', 'grawlix-at', 'grawlix-hash', 'grawlix-dollar', 'grawlix-percent'];

/** §3.7: `! @ # $ %` — the first `level` lime, the rest grey700. */
export function volatility(level: number, size = 38, gap = 8): Container {
  const c = new Container();
  GRAWLIX.forEach((n, i) => {
    const g = glyph(n, size, i < level ? C.lime : C.grey700);
    g.position.set(size / 2 + i * (size + gap), size / 2);
    c.addChild(g);
  });
  return c;
}
