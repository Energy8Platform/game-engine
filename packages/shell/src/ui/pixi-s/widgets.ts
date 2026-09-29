import { Container, Graphics, Polygon, Rectangle, type Text, type Ticker } from 'pixi.js';
import { attachHover, attachPress, type SpinAutoplayMode } from '../pixi-hb/primitives/widgets';
import { makeIcon, type IconView } from '../pixi-hb/pixi-icon';
import { Slab, SKEW, TOOTH_D, DOT_STEP, slabPoints, type Corners } from './slab';
import { sIcon } from './icons';
import { sLabel, sValue } from './text';
import { S, DISABLED_ALPHA } from './theme';

// S interactive pieces. Each is built fresh on every bar render (the renderer rebuilds the bar on
// state changes), so none of them needs an "update" path — they read their state once.

export type SFace = 'plate' | 'yellow' | 'red';

const FACES: Record<SFace, { fill: string; hover: string }> = {
  plate: { fill: S.plate, hover: S.plateHover },
  yellow: { fill: S.yellow, hover: S.yellowHover },
  red: { fill: S.red, hover: S.redHover },
};

/** Anything the SideBar stacks: a Container that knows its design box. */
export interface Sized extends Container {
  measureSize(): { w: number; h: number };
}

function setDisabled(node: Container, v: boolean): void {
  node.alpha = v ? DISABLED_ALPHA : 1;
  node.eventMode = v ? 'none' : 'static';
  node.cursor = v ? 'default' : 'pointer';
}

export interface SButtonOpts {
  w: number;
  h: number;
  face: SFace;
  corners: Corners;
  /** The glyph; its box is `glyphSize` square (an IconView or an sIcon). */
  glyph: Container;
  glyphSize: number;
  /** Right strip hidden under a neighbour (the tabs under SPIN): the glyph centres in what is left. */
  insetRight?: number;
  onTap: () => void;
}

/** A slab with a centred glyph: the burger, BUY and the autoplay / turbo tabs. Only black slabs carry
 *  the halftone — the yellow and red faces are plain, as in the reference. */
export class SButton extends Container implements Sized {
  readonly slab: Slab;
  readonly face: SFace;
  readonly glyph: Container;
  private _disabled = false;

  constructor(o: SButtonOpts) {
    super();
    const f = FACES[o.face];
    this.face = o.face;
    this.slab = new Slab(o.w, o.h, { face: f.fill, dots: o.face === 'plate' ? S.plateDot : undefined, corners: o.corners });
    this.glyph = o.glyph;
    this.glyph.position.set((o.w - (o.insetRight ?? 0) - o.glyphSize) / 2, (o.h - o.glyphSize) / 2);
    this.addChild(this.slab, this.glyph);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, o.w, o.h);
    attachHover(this, () => this.slab.setFace(f.hover), () => this.slab.setFace(f.fill));
    attachPress(this, 0.94, () => {
      if (!this._disabled) o.onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    setDisabled(this, v);
  }
  get disabled(): boolean {
    return this._disabled;
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

/** A bare yellow ± glyph with a square hit box (the bet stepper). */
export class SStep extends Container {
  private _disabled = false;

  constructor(name: 'minus' | 'plus', glyph: number, box: number, onTap: () => void) {
    super();
    const g = makeIcon(name, glyph, { ink: S.yellow, fill: S.yellow });
    g.position.set((box - glyph) / 2, (box - glyph) / 2);
    this.addChild(g);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, box, box);
    attachPress(this, 0.9, () => {
      if (!this._disabled) onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    setDisabled(this, v);
  }
  get disabled(): boolean {
    return this._disabled;
  }
}

/** The slab width for `texts` side by side plus `chrome` px of padding and gaps. When they do not fit
 *  `w`: `grow` widens the slab (rounded up to DOT_STEP, so the dot-context cache stays small);
 *  otherwise the slab keeps `w` and the texts scale down by one factor. */
function fitSlab(w: number, chrome: number, texts: Text[], grow: boolean): number {
  const textW = texts.reduce((a, t) => a + t.width, 0);
  if (chrome + textW <= w) return w;
  if (grow) return Math.ceil((chrome + textW) / DOT_STEP) * DOT_STEP;
  for (const t of texts) t.scale.set((w - chrome) / textW);
  return w;
}

export interface SReadoutOpts {
  label: string;
  value: string;
  w: number;
  h: number;
  labelSize: number;
  valueSize: number;
  /** Widen past `w` when the text does not fit (default). Off: keep `w` and scale the text down —
   *  the wide columns set the scene's side insets, which must not change with content. */
  grow?: boolean;
}

/** WIN / BALANCE / TOTAL WIN: the yellow caps label, then the white value, on a black slab. With
 *  `grow` (mobile) it widens when the text would not fit and the bar's fit scale then shrinks the
 *  whole block; without it the text scales down inside `w`. */
export class SReadout extends Container implements Sized {
  readonly labelText: Text;
  readonly valueText: Text;
  readonly slab: Slab;

  constructor(o: SReadoutOpts) {
    super();
    const pad = Math.round(o.h * 0.34);
    const gap = Math.round(o.valueSize * 0.5);
    this.labelText = sLabel(o.label, o.labelSize);
    this.valueText = sValue(o.value, o.valueSize);
    const w = fitSlab(o.w, 2 * pad + gap, [this.labelText, this.valueText], o.grow !== false);
    this.slab = new Slab(w, o.h, { face: S.plate, dots: S.plateDot, corners: SKEW.readout });
    this.labelText.position.set(pad, (o.h - this.labelText.height) / 2);
    this.valueText.position.set(pad + this.labelText.width + gap, (o.h - this.valueText.height) / 2);
    this.addChild(this.slab, this.labelText, this.valueText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SBetOpts {
  /** BET, or the active feature's title — yellow either way, as in the reference. */
  label: string;
  value: string;
  w: number;
  h: number;
  labelSize: number;
  valueSize: number;
  /** Show − / + at the slab's ends (base mode). */
  stepper: boolean;
  onStep: (dir: 1 | -1) => void;
  /** Tap on the label/value area (opens the bet picker); omitted = not tappable. */
  onValue?: () => void;
  /** As SReadoutOpts.grow. */
  grow?: boolean;
}

/** − BET value + on one black slab. The ± hit boxes are h×h squares at the ends. */
export class SBet extends Container implements Sized {
  readonly labelText: Text;
  readonly valueText: Text;
  readonly slab: Slab;
  readonly valueHit = new Container();
  readonly up?: SStep;
  readonly down?: SStep;

  constructor(o: SBetOpts) {
    super();
    const gap = Math.round(o.valueSize * 0.4);
    this.labelText = sLabel(o.label, o.labelSize);
    this.valueText = sValue(o.value, o.valueSize);
    const side = o.stepper ? o.h : Math.round(o.h * 0.4);
    const w = fitSlab(o.w, 2 * side + 3 * gap, [this.labelText, this.valueText], o.grow !== false);
    const mid = this.labelText.width + gap + this.valueText.width;
    this.slab = new Slab(w, o.h, { face: S.plate, dots: S.plateDot, corners: SKEW.bet });
    const x0 = (w - mid) / 2;
    this.labelText.position.set(x0, (o.h - this.labelText.height) / 2);
    this.valueText.position.set(x0 + this.labelText.width + gap, (o.h - this.valueText.height) / 2);
    this.valueHit.hitArea = new Rectangle(side, 0, w - 2 * side, o.h);
    this.addChild(this.slab, this.labelText, this.valueText, this.valueHit);
    if (o.onValue) {
      this.valueHit.eventMode = 'static';
      this.valueHit.cursor = 'pointer';
      this.valueHit.on('pointertap', o.onValue);
    }
    if (o.stepper) {
      const glyph = Math.round(o.h * 0.42);
      this.down = new SStep('minus', glyph, o.h, () => o.onStep(-1));
      this.up = new SStep('plus', glyph, o.h, () => o.onStep(1));
      this.up.position.set(w - o.h, 0);
      this.addChild(this.down, this.up);
    }
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SSpinOpts {
  w: number;
  h: number;
  glyph: number;
  ticker: Ticker;
  /** HB's autoplay face: off → SPIN, running → STOP + count, paused → resume + count. */
  autoplay: SpinAutoplayMode;
  remaining: number;
  onSpin: () => void;
  onStop: () => void;
  onResume: () => void;
}

/** The yellow sawtooth SPIN slab with HB's spin glyph in ink. Busy: the glyph rotates. Disabled: a
 *  dark veil over the slab (not alpha — a half-transparent yellow hero would wash out over the game). */
export class SSpin extends Container implements Sized {
  readonly slab: Slab;
  private glyph: IconView;
  private veil: Graphics;
  private countText?: Text;
  private ticker: Ticker;
  private rotTick?: (t: Ticker) => void;
  private _mode: 'spin' | 'stop' | 'resume' = 'spin';
  private _disabled = false;

  constructor(o: SSpinOpts) {
    super();
    this.ticker = o.ticker;
    this.slab = new Slab(o.w, o.h, { face: S.yellow, dots: S.yellowDot, fade: false, corners: SKEW.spin, sawtooth: true });
    const body = o.h - TOOTH_D;
    this.glyph = makeIcon('spin', o.glyph, { ink: S.ink, fill: S.ink });
    this.glyph.position.set((o.w - o.glyph) / 2, (body - o.glyph) / 2);
    this.veil = new Graphics().poly(slabPoints(o.w, o.h, SKEW.spin, true)).fill({ color: 0x000000, alpha: 0.35 });
    this.veil.visible = false;
    this.addChild(this.slab, this.glyph);
    if (o.autoplay !== 'off') this.buildAutoplay(o.autoplay === 'running', o.remaining, o.w, body);
    this.addChild(this.veil);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    // The leaning outline, not the box: the tabs' visible strips left of the lean are theirs to hit.
    this.hitArea = new Polygon(slabPoints(o.w, o.h, SKEW.spin, true));
    attachHover(this, () => this.slab.setFace(S.yellowHover), () => this.slab.setFace(S.yellow));
    attachPress(this, 0.96, () => {
      if (this._disabled) return;
      if (this._mode === 'stop') o.onStop();
      else if (this._mode === 'resume') o.onResume();
      else o.onSpin();
    });
  }

  /** Running: a black STOP square with the remaining count in yellow on it. Halted with spins left: a
   *  play glyph over the count in ink (tap resumes). */
  private buildAutoplay(running: boolean, remaining: number, w: number, body: number): void {
    this._mode = running ? 'stop' : 'resume';
    this.glyph.visible = false;
    const sq = Math.round(body * 0.62);
    const top = (body - sq) / 2;
    if (running) {
      const stop = makeIcon('stop', sq, { ink: S.ink, fill: S.ink });
      stop.position.set((w - sq) / 2, top);
      this.addChild(stop);
    } else {
      const p = Math.round(sq * 0.45);
      const play = sIcon('play', p, S.ink);
      play.position.set((w - p) / 2, top);
      this.addChild(play);
    }
    this.countText = sValue(Number.isFinite(remaining) ? String(remaining) : '∞', Math.round(sq * 0.42), running ? S.yellow : S.ink);
    const y = running ? (body - this.countText.height) / 2 : top + sq * 0.55;
    this.countText.position.set((w - this.countText.width) / 2, y);
    this.addChild(this.countText);
  }

  get mode(): 'spin' | 'stop' | 'resume' {
    return this._mode;
  }
  get count(): string | undefined {
    return this.countText?.text;
  }

  setBusy(busy: boolean): void {
    if (!busy || this._mode !== 'spin') {
      this.stopRotation();
      return;
    }
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
    this.veil.visible = v;
    this.eventMode = v ? 'none' : 'static';
    this.cursor = v ? 'default' : 'pointer';
  }
  get disabled(): boolean {
    return this._disabled;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopRotation();
    super.destroy(options);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}

export interface SFsCounterOpts {
  w: number;
  h: number;
  label: string;
  value: string;
  labelSize: number;
  valueSize: number;
}

/** Replaces SPIN in free spins: the yellow sawtooth slab with an ink caps label over the counter. */
export class SFsCounter extends Container implements Sized {
  readonly slab: Slab;
  readonly labelText: Text;
  readonly valueText: Text;

  constructor(o: SFsCounterOpts) {
    super();
    this.slab = new Slab(o.w, o.h, { face: S.yellow, dots: S.yellowDot, fade: false, corners: SKEW.spin, sawtooth: true });
    const label = (this.labelText = sLabel(o.label, o.labelSize, S.ink));
    this.valueText = sValue(o.value, o.valueSize, S.ink);
    // Centred text clears the lean at both ends only when narrower than w − 2·lean (+ breathing room).
    const maxW = o.w - 2 * SKEW.spin[0][0] - o.labelSize;
    for (const t of [label, this.valueText]) if (t.width > maxW) t.scale.set(maxW / t.width);
    const body = o.h - TOOTH_D;
    const gap = Math.round(o.labelSize * 0.4);
    const top = (body - label.height - gap - this.valueText.height) / 2;
    label.position.set((o.w - label.width) / 2, top);
    this.valueText.position.set((o.w - this.valueText.width) / 2, top + label.height + gap);
    this.addChild(this.slab, label, this.valueText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
}
