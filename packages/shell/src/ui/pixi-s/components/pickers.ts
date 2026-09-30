import { Container, Graphics, Rectangle, type Text } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { Slab, SKEW } from '../slab';
import type { SButton } from '../widgets';
import { STitlePlate, STextButton, SStepSlider, sCloseButton } from '../primitives/controls';
import { stripMetrics } from '../primitives/page';
import { sValue } from '../text';
import { S } from '../theme';

// The S bet / autoplay pickers (R4): a full-screen layer with no card — a centred title plate, ✕ in the
// corner, a yellow value plate riding above a stepped slider, and a confirm button. Keys as HB's.

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

  constructor(host: PixiComponentContext, opts: PickerOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    const i = opts.choices.findIndex((c) => c.id === opts.selected);
    this.index = i < 0 ? 0 : i;
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.addChild(this.veil);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    if (this.children.length > 1) this.removeChildren(1).forEach((c) => c.destroy({ children: true }));
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    const em = clampEm(w, h);
    const strip = stripMetrics(h);

    this.closeBtn = sCloseButton(strip.height, () => this.host.closeLayer());
    this.closeBtn.position.set(w - strip.top - strip.height, strip.top);

    const titleH = Math.round(em * 3);
    this.titlePlate = new STitlePlate(this.opts.title, titleH, w - strip.height * 2 - strip.top * 4);
    const sliderW = Math.round(Math.min(620, w * 0.7));
    const sliderH = Math.round(em * 3.2);
    const plateH = Math.round(em * 3.6);
    const widest = this.opts.choices.reduce((a, c) => (c.label.length > a.length ? c.label : a), '');
    this.valuePlate = new ValuePlate(widest, plateH);
    this.slider = new SStepSlider(this.opts.choices.length, this.index, (i) => {
      this.index = i;
      this.sync();
    });
    this.slider.layout(sliderW, sliderH);
    const btnW = Math.round(Math.min(sliderW, em * 16));
    const btnH = Math.round(em * 3);
    this.confirm = new STextButton(this.opts.confirmLabel, { w: btnW, h: btnH, kind: 'accent', size: em, onTap: () => this.doConfirm() });

    // the block: title · gap · value plate · slider · gap · confirm — centred vertically
    const gapA = em * 2;
    const gapB = em * 0.5;
    const gapC = em * 2;
    const blockH = titleH + gapA + plateH + gapB + sliderH + gapC + btnH;
    let y = Math.max(strip.top + strip.height, (h - blockH) / 2);
    this.titlePlate.position.set((w - this.titlePlate.measureSize().w) / 2, y);
    y += titleH + gapA;
    const sliderX = (w - sliderW) / 2;
    this.valuePlate.y = y;
    y += plateH + gapB;
    this.slider.position.set(sliderX, y);
    y += sliderH + gapC;
    this.confirm.position.set((w - btnW) / 2, y);
    this.addChild(this.titlePlate, this.valuePlate, this.slider, this.confirm, this.closeBtn);
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
    const n = Math.max(0, Math.min(this.opts.choices.length - 1, this.index + dir));
    if (n === this.index) return;
    this.index = n;
    this.slider.setIndex(n);
    this.sync();
  }

  private doConfirm(): void {
    const c = this.opts.choices[this.index];
    if (c) this.opts.onConfirm(c.id);
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
