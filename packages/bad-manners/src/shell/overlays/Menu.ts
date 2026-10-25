import { Container, Graphics, Rectangle } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@energy8platform/shell';
import { Bubble, IconButton, Slider } from '../components';
import { uiScale, type BmCtx, type Layer } from '../context';
import { ease, tween } from '../motion';
import { display, fitWidth } from '../text';
import { C, MOTION } from '../theme';

const W = 520;
const ROW_H = 84;
const GAP = 14;
const PAD = 28;
const EDGE = 24;
const LABEL = 30;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rows the menu draws: no separators and no master sound toggle (MUSIC / SFX cover it). */
function rows(ctx: BmCtx): MenuRow[] {
  return resolveMenu(ctx).filter((r) => r.kind !== 'separator' && !(r.kind === 'toggle' && r.id === 'sound'));
}

/** §5.6: a column of bubbles (MUSIC / SFX sliders, GAME INFO, custom rows) stacked upward from the
 *  burger, sliding in from the left over the live game. The burger itself turns into the ✕; a tap
 *  outside the column closes it. `anchor` reads the burger's current screen rect. */
export function openMenu(ctx: BmCtx, anchor: () => Rect | null): Layer {
  return new BmMenu(ctx, anchor);
}

export class BmMenu extends Container implements Layer {
  readonly dismiss = new Graphics();
  readonly column = new Container();
  private updaters: Record<string, (v: boolean | number) => void> = {};
  private slide?: () => void;
  private entered = false;

  constructor(
    private ctx: BmCtx,
    private anchor: () => Rect | null,
  ) {
    super();
    this.dismiss.eventMode = 'static';
    this.dismiss.on('pointertap', () => ctx.closeLayer());
    this.column.eventMode = 'static';
    this.addChild(this.dismiss, this.column);
    ctx.setMenuRefresh((id, v) => this.updaters[id]?.(v));
    this.resize(ctx.screenW, ctx.screenH);
  }

  resize(w: number, h: number): void {
    this.dismiss.clear().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
    this.dismiss.hitArea = new Rectangle(0, 0, w, h);
    this.column.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.updaters = {};
    const k = uiScale(w, h);
    const portrait = this.ctx.layout === 'mobile';
    const cw = portrait ? Math.min(W, w / k - 2 * EDGE) : W;
    let y = 0;
    for (const r of rows(this.ctx)) {
      const n = this.row(r, cw);
      n.y = y;
      this.column.addChild(n);
      y += ROW_H + GAP;
    }
    const colH = Math.max(0, y - GAP);
    this.column.hitArea = new Rectangle(0, 0, cw, colH);
    // above the burger, left-aligned to it; shrinks when the room above is short
    const a = this.anchor();
    const bottom = a ? a.y - GAP * k : h - EDGE * k;
    const x = a ? a.x : EDGE * k;
    const s = Math.max(0.1, Math.min(k, (bottom - EDGE * k) / Math.max(1, colH), (w - x - EDGE * k) / cw));
    this.column.scale.set(s);
    this.column.position.set(x, bottom - colH * s);
    if (!this.entered) {
      this.entered = true;
      const from = -(cw * s);
      this.column.x = from;
      this.slide = tween(this.ctx.ticker, {
        duration: MOTION.menuIn.dur,
        ease: ease.power3Out,
        onUpdate: (p) => {
          if (!this.column.destroyed) this.column.x = from + (x - from) * p;
        },
      });
    }
  }

  private row(r: MenuRow, w: number): Container {
    const node = new Container();
    if (r.kind === 'separator') return node;
    node.label = `menu-row-${r.id}`;
    node.eventMode = 'static';
    const bubble = new Bubble({ variant: 'ink', width: w, height: ROW_H });
    const body = bubble.bodyH;
    const label = display(r.label, LABEL);
    node.addChild(bubble, label);
    const place = (maxW: number): void => {
      fitWidth(label, maxW);
      label.position.set(PAD, (body - label.height) / 2);
    };
    if (r.disabled) node.alpha = 0.5;

    if (r.kind === 'button') {
      place(w - 2 * PAD);
      if (r.disabled) return node;
      node.cursor = 'pointer';
      node.on('pointerover', () => (label.tint = C.lime));
      node.on('pointerout', () => (label.tint = C.paper));
      node.on('pointertap', () => {
        this.ctx.closeLayer();
        r.select();
      });
      return node;
    }

    if (r.kind === 'toggle') {
      const make = (on: boolean) =>
        new IconButton(this.ctx.ticker, {
          icon: on ? 'check' : 'close',
          shape: 'pill',
          width: 64,
          height: 48,
          on,
          onTap: () => {
            if (!r.disabled) r.set(!r.get());
          },
        });
      let btn = make(r.get());
      btn.position.set(w - PAD - 64, (body - 48) / 2);
      place(btn.x - 2 * PAD);
      node.addChild(btn);
      this.updaters[r.id] = (v) => {
        const nb = make(v === true);
        nb.position.copyFrom(btn.position);
        node.addChild(nb);
        btn.destroy({ children: true });
        btn = nb;
      };
      return node;
    }

    // range: the label, then a slider (no value bubble) to the row's right edge
    const toUnit = (v: number) => (r.max === r.min ? 0 : (v - r.min) / (r.max - r.min));
    const fromUnit = (u: number) => {
      const raw = r.min + u * (r.max - r.min);
      return Math.max(r.min, Math.min(r.max, r.min + Math.round((raw - r.min) / r.step) * r.step));
    };
    const sx = Math.max(PAD + label.width + 24, w * 0.4);
    const knob = 50;
    const slider = new Slider(this.ctx.ticker, {
      width: w - sx - PAD - knob / 2,
      value: toUnit(r.get()),
      knob,
      onChange: (u) => {
        if (!r.disabled) r.set(fromUnit(u));
      },
    });
    slider.position.set(sx, body / 2 - slider.trackY);
    place(sx - PAD - 16);
    if (r.disabled) slider.eventMode = 'none';
    node.addChild(slider);
    this.updaters[r.id] = (v) => slider.setValue(toUnit(Number(v)));
    return node;
  }

  onRemove(): void {
    this.slide?.();
    this.ctx.setMenuRefresh(null);
  }
}
