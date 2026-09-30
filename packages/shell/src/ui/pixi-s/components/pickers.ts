import { Container, Graphics, Rectangle, type Text } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { Slab, SKEW } from '../slab';
import type { SButton } from '../widgets';
import { STitlePlate, STextButton, SStepSlider, sCloseButton } from '../primitives/controls';
import { stripMetrics, closeCorner } from '../primitives/page';
import { sValue } from '../text';
import { S } from '../theme';

// The S bet / autoplay pickers (R4): a full-screen layer with no card — a centred title plate, ✕ in the
// shared corner, a yellow value plate riding above a stepped slider, and a confirm button; the block
// fit-scales to a short screen. Keys as HB's.

interface Choice {
  id: string;
  label: string;
}

interface PickerOpts {
  tag: string;
  title: string;
  choices: Choice[];
  selected: string;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** The yellow value plate: ink value on a leaning slab, sized to the widest choice. */
class ValuePlate extends Container {
  readonly labelText: Text;
  private slab: Slab;
  readonly w: number;

  constructor(maxLabel: string, h: number) {
    super();
    this.labelText = sValue(maxLabel, Math.round(h * 0.5), S.ink);
    this.w = Math.round(Math.max(h * 1.8, this.labelText.width + h * 0.9));
    this.slab = new Slab(this.w, h, { face: S.yellow, corners: SKEW.readout });
    this.addChild(this.slab, this.labelText);
  }

  set(text: string): void {
    this.labelText.text = text;
    this.labelText.position.set((this.w - this.labelText.width) / 2, (this.slab.h - this.labelText.height) / 2);
  }
}

/** The choice matching `selected`, else the numerically nearest one (ids are numbers; ∞ is only
 *  nearest to ∞). */
function nearestIndex(choices: Choice[], selected: string): number {
  const exact = choices.findIndex((c) => c.id === selected);
  if (exact >= 0) return exact;
  const v = Number(selected);
  let best = 0;
  let bestD = Infinity;
  choices.forEach((c, i) => {
    const d = Math.abs(Number(c.id) - v);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}

export class SPicker extends Container implements ShellLayer {
  readonly tag: string;
  readonly veil = new Graphics();
  titlePlate!: STitlePlate;
  closeBtn!: SButton;
  slider!: SStepSlider;
  valuePlate!: ValuePlate;
  confirm!: STextButton;
  private host: PixiComponentContext;
  private opts: PickerOpts;
  private index: number;
  /** Set by any slider / keyboard step; until then Confirm keeps the current value (HB's no-op). */
  private moved = false;
  /** The screen size last laid out for. */
  private laidOut = '';

  constructor(host: PixiComponentContext, opts: PickerOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.index = nearestIndex(opts.choices, opts.selected);
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.addChild(this.veil);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    // a same-size resize (the bar re-rendering) must not rebuild the slider out from under a drag
    if (this.laidOut === `${w}x${h}`) return;
    this.laidOut = `${w}x${h}`;
    if (this.children.length > 1) this.removeChildren(1).forEach((c) => c.destroy({ children: true }));
    const em = clampEm(w, h);
    const strip = stripMetrics(h);
    const corner = closeCorner(w, h);

    this.closeBtn = sCloseButton(corner.size, () => this.host.closeLayer());
    this.closeBtn.position.set(corner.x, corner.y);

    const titleH = strip.height; // the title plate is one strip tall (≈ the ✕)
    const sliderW = Math.round(Math.min(620, w * 0.7));
    const sliderH = Math.round(em * 3.2);
    const plateH = Math.round(em * 3.6);
    const btnW = Math.round(Math.min(sliderW, em * 16));
    const btnH = Math.round(em * 3);
    const gapA = em * 3;
    const gapB = em * 0.5;
    const gapC = em * 2;
    // the block (title · gap · value plate · slider · gap · confirm) is laid out in its own units, then
    // fit-scaled to the screen height inside the strip margins and centred
    const blockH = titleH + gapA + plateH + gapB + sliderH + gapC + btnH;
    const k = Math.min(1, (h - 2 * strip.top) / blockH);
    const top = (h - blockH * k) / 2;
    // a title level with the ✕ keeps clear of it on both sides; lower down it only keeps the margins
    const titleMaxW = top < corner.y + corner.size ? w - 2 * (w - corner.x) - 2 * strip.top : w - 2 * strip.top;
    this.titlePlate = new STitlePlate(this.opts.title, titleH, titleMaxW / k);
    const widest = this.opts.choices.reduce((a, c) => (c.label.length > a.length ? c.label : a), '');
    this.valuePlate = new ValuePlate(widest, plateH);
    this.slider = new SStepSlider(this.opts.choices.length, this.index, (i) => {
      this.index = i;
      this.moved = true;
      this.sync();
    });
    this.slider.layout(sliderW, sliderH);
    this.confirm = new STextButton(this.opts.confirmLabel, { w: btnW, h: btnH, kind: 'accent', size: em, onTap: () => this.doConfirm() });

    const blockW = Math.max(sliderW, btnW, this.titlePlate.measureSize().w);
    const block = new Container();
    let y = 0;
    this.titlePlate.position.set((blockW - this.titlePlate.measureSize().w) / 2, y);
    y += titleH + gapA;
    this.valuePlate.y = y;
    y += plateH + gapB;
    this.slider.position.set((blockW - sliderW) / 2, y);
    y += sliderH + gapC;
    this.confirm.position.set((blockW - btnW) / 2, y);
    block.addChild(this.titlePlate, this.valuePlate, this.slider, this.confirm);
    block.scale.set(k);
    block.position.set((w - blockW * k) / 2, top);
    this.addChild(block, this.closeBtn);
    this.sync();
  }

  /** Move the value plate over the thumb (clamped to the slider's ends) and show the current choice. */
  private sync(): void {
    this.index = this.slider.index; // the slider is the source of truth
    const c = this.opts.choices[this.index];
    this.valuePlate.set(c ? c.label : '');
    const cx = this.slider.x + this.slider.thumbCenterX;
    const x = Math.max(this.slider.x, Math.min(this.slider.x + this.slider.measureSize().w - this.valuePlate.w, cx - this.valuePlate.w / 2));
    this.valuePlate.x = x;
  }

  private step(dir: 1 | -1): void {
    this.moved = true;
    const n = Math.max(0, Math.min(this.opts.choices.length - 1, this.index + dir));
    if (n === this.index) return;
    this.index = n;
    this.slider.setIndex(n);
    this.sync();
  }

  private doConfirm(): void {
    const c = this.opts.choices[this.index];
    if (!this.moved) this.opts.onConfirm(this.opts.selected); // untouched: keep the current (maybe off-list) value
    else if (c) this.opts.onConfirm(c.id);
    this.host.closeLayer();
  }

  fit(): void {
    /* re-laid out on resize */
  }

  onKey(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Equal':
      case 'NumpadAdd':
        this.step(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'Minus':
      case 'NumpadSubtract':
        this.step(-1);
        return true;
      case 'Enter':
      case 'Space':
        this.doConfirm();
        return true;
      case 'Escape':
        this.host.closeLayer();
        return true;
      default:
        return false;
    }
  }
}

/** Bet picker — every bet level on the slider; Confirm applies it. */
export function openSBetPicker(host: PixiComponentContext): ShellLayer {
  return new SPicker(host, {
    tag: 'bet-modal',
    title: host.t('Bet'),
    confirmLabel: host.t('Confirm'),
    choices: host.state.availableBets.map((b) => ({ id: String(b), label: host.fmt(b) })),
    selected: String(host.state.bet),
    onConfirm: (id) => host.actions.setBet(Number(id)),
  });
}

const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

function autoplayCounts(maxCount?: number): number[] {
  if (maxCount == null) return AUTOPLAY_COUNTS;
  const capped = AUTOPLAY_COUNTS.filter((n) => Number.isFinite(n) && n <= maxCount);
  if (!capped.includes(maxCount)) capped.push(maxCount);
  return capped;
}

/** Autoplay picker — spin counts (∞ unless maxCount caps them); Start begins autoplay. */
export function openSAutoplayPicker(host: PixiComponentContext): ShellLayer {
  const maxCount = host.config.features.autoplay?.maxCount;
  const counts = autoplayCounts(maxCount);
  return new SPicker(host, {
    tag: 'autoplay-modal',
    title: host.t('Autoplay'),
    confirmLabel: host.t('Start'),
    choices: counts.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(host.state.autoplay.remaining || counts[0]),
    onConfirm: (id) => {
      let remaining = Number(id);
      if (maxCount != null) remaining = Math.min(remaining, maxCount);
      host.actions.startAutoplay(remaining);
    },
  });
}
