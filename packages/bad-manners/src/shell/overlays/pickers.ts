import { Container, Graphics, Rectangle } from 'pixi.js';
import { PillButton, Slider, pivotOnTail } from '../components';
import { uiScale, type BmCtx, type Layer } from '../context';
import { bubblePop, ease, tween } from '../motion';
import { SCRIM, SIZE, MOTION } from '../theme';
import { closeButton, titleBubble, EDGE_X, EDGE_Y } from './panel';

const SLIDER_W = 520;

interface Choice {
  id: string;
  label: string;
}

interface PickerOpts {
  title: string;
  choices: Choice[];
  selected: string;
  confirmLabel: string;
  onConfirm(id: string): void;
}

/** The choice matching `selected`, else the numerically nearest one. */
function nearest(choices: Choice[], selected: string): number {
  const exact = choices.findIndex((c) => c.id === selected);
  if (exact >= 0) return exact;
  const v = Number(selected);
  let best = 0;
  choices.forEach((c, i) => {
    if (Math.abs(Number(c.id) - v) < Math.abs(Number(choices[best].id) - v)) best = i;
  });
  return best;
}

/** §5.4 / §5.5: centred — the title bubble, a stepped slider with its value bubble, a CONFIRM / START
 *  pill; the ✕ top-right. Until the slider moves, confirm keeps the current (maybe off-list) value. */
export class Picker extends Container implements Layer {
  readonly scrim = new Graphics();
  readonly stage = new Container();
  slider!: Slider;
  confirm!: PillButton;
  private index: number;
  private moved = false;
  private laidOut = '';
  private entered = false;
  private anims: Array<() => void> = [];

  constructor(private ctx: BmCtx, private o: PickerOpts) {
    super();
    this.index = nearest(o.choices, o.selected);
    this.scrim.eventMode = 'static';
    this.addChild(this.scrim, this.stage);
    this.resize(ctx.screenW, ctx.screenH);
  }

  resize(w: number, h: number): void {
    this.scrim.clear().rect(0, 0, w, h).fill(SCRIM);
    this.scrim.hitArea = new Rectangle(0, 0, w, h);
    // a bar re-render resends the same size: never rebuild the slider under a drag
    if (this.laidOut === `${w}x${h}`) return;
    this.laidOut = `${w}x${h}`;
    this.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
    const k = uiScale(w, h);
    const dw = w / k;
    const dh = h / k;
    this.stage.scale.set(k);
    const tk = this.ctx.ticker;

    const sw = Math.min(SLIDER_W * (dw < dh ? 1.1 : 1), dw - 2 * EDGE_X - 40);
    const title = titleBubble(this.o.title, dw - 2 * EDGE_X);
    this.slider = new Slider(tk, {
      width: sw,
      steps: this.o.choices.length,
      value: this.index,
      label: (i) => this.o.choices[i]?.label ?? '',
      onChange: (i) => {
        this.index = i;
        this.moved = true;
      },
    });
    this.confirm = new PillButton(tk, { label: this.o.confirmLabel, width: 300, onTap: () => this.doConfirm() });
    const gapA = 44;
    const gapB = 48;
    const blockH = title.h + gapA + this.slider.sh + gapB + SIZE.pill.h;
    let y = (dh - blockH) / 2;
    title.position.set((dw - title.w) / 2, y);
    y += title.h + gapA;
    this.slider.position.set((dw - sw) / 2, y);
    y += this.slider.sh + gapB;
    this.confirm.position.set((dw - 300) / 2, y);
    const close = closeButton(this.ctx, () => this.ctx.closeLayer());
    close.position.set(dw - EDGE_X - SIZE.close.w, EDGE_Y);
    this.stage.addChild(title, this.slider, this.confirm, close);

    if (!this.entered) {
      this.entered = true;
      this.scrim.alpha = 0;
      this.anims.push(tween(tk, { duration: MOTION.scrimIn.dur, ease: ease.linear, onUpdate: (p) => (this.scrim.alpha = p) }));
      pivotOnTail(title);
      this.anims.push(bubblePop(tk, title, 60));
    }
  }

  private step(dir: 1 | -1): void {
    const n = Math.max(0, Math.min(this.o.choices.length - 1, this.index + dir));
    this.moved = true;
    this.index = n;
    this.slider.setValue(n);
  }

  private doConfirm(): void {
    this.o.onConfirm(this.moved ? this.o.choices[this.index].id : this.o.selected);
    this.ctx.closeLayer();
  }

  onKey(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'Equal':
      case 'NumpadAdd':
        this.step(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'Minus':
      case 'NumpadSubtract':
        this.step(-1);
        return true;
      case 'Enter':
      case 'Space':
        this.doConfirm();
        return true;
      default:
        return false;
    }
  }

  onRemove(): void {
    for (const a of this.anims) a();
  }
}

export function openBetPicker(ctx: BmCtx): Layer {
  return new Picker(ctx, {
    title: ctx.t('Bet'),
    confirmLabel: ctx.t('Confirm'),
    choices: ctx.state.availableBets.map((b) => ({ id: String(b), label: ctx.fmt(b) })),
    selected: String(ctx.state.bet),
    onConfirm: (id) => ctx.actions.setBet(Number(id)),
  });
}

/** §5.5 steps: 10 25 50 100 250 500 1000 ∞ (a `maxCount` caps them and drops ∞). */
const COUNTS = [10, 25, 50, 100, 250, 500, 1000, Infinity];

export function openAutoplayPicker(ctx: BmCtx): Layer {
  const max = ctx.config.features.autoplay?.maxCount;
  const counts = max == null ? COUNTS : COUNTS.filter((n) => Number.isFinite(n) && n <= max);
  if (max != null && !counts.includes(max)) counts.push(max);
  return new Picker(ctx, {
    title: ctx.t('Autoplay'),
    confirmLabel: ctx.t('Start'),
    choices: counts.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(ctx.state.autoplay.remaining || counts[0]),
    onConfirm: (id) => ctx.actions.startAutoplay(max != null ? Math.min(Number(id), max) : Number(id)),
  });
}
