import { Container, Graphics, Rectangle } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { hbRows } from '../../pixi-hb/components/Menu';
import { Slab, SKEW } from '../slab';
import { SSlider, SToggle } from '../primitives/controls';
import { sLabel } from '../text';
import { S } from '../theme';

/** Row sizes in design px (the bar's readouts are 56 tall — the rows are "чуть покороче"). */
const WIDE_ROW = { w: 320, h: 44 };
const MOBILE_ROW = { w: 370, h: 40 };
const GAP = 6;
const PAD = 16;
/** Gap between the stack's bottom and the burger's top, and the screen margin it keeps. */
const LIFT = 8;
const MARGIN = 8;

/** The S bar menu: each row its own black slab (label + control, no icons), stacked upward from the
 *  burger, light-dismiss. Rows are HB's (`hbRows`: no separators, no master sound toggle). */
export function openSMenu(
  host: PixiComponentContext,
  getAnchor?: () => Rect | null,
  _getPlate?: () => Rect | null,
  getScale?: () => number,
): ShellLayer {
  return new SMenu(host, () => getAnchor?.() ?? null, () => getScale?.() ?? 1);
}

export class SMenu extends Container implements ShellLayer {
  readonly tag = 'menu';
  readonly dismissLayer = new Graphics();
  readonly stack = new Container();
  rows: Container[] = [];
  private host: PixiComponentContext;
  private getAnchor: () => Rect | null;
  private getScale: () => number;
  private updaters: Record<string, (v: boolean | number) => void> = {};

  constructor(host: PixiComponentContext, getAnchor: () => Rect | null, getScale: () => number) {
    super();
    this.host = host;
    this.getAnchor = getAnchor;
    this.getScale = getScale;
    this.dismissLayer.eventMode = 'static';
    this.dismissLayer.on('pointertap', () => host.closeLayer());
    this.stack.eventMode = 'static'; // its hitArea (set in resize) absorbs taps in the gaps between rows
    this.addChild(this.dismissLayer, this.stack);
    host.setMenuRefresh((id, v) => this.updaters[id]?.(v));
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.dismissLayer.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0 });
    this.dismissLayer.hitArea = new Rectangle(0, 0, w, h);

    this.stack.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.updaters = {};
    const z = this.host.layout === 'mobile' ? MOBILE_ROW : WIDE_ROW;
    this.rows = hbRows(resolveMenu(this.host)).map((row) => this.buildRow(row, z.w, z.h));
    this.rows.forEach((r, i) => {
      r.position.set(0, i * (z.h + GAP));
      this.stack.addChild(r);
    });
    const stackH = this.rows.length * z.h + Math.max(0, this.rows.length - 1) * GAP;
    this.stack.hitArea = new Rectangle(0, 0, z.w, stackH);

    // above the burger, left-aligned to it; shrink further when the room above is short
    const a = this.getAnchor();
    const s0 = this.getScale();
    const bottom = a ? a.y - LIFT * s0 : h - MARGIN;
    const left = a ? a.x : MARGIN;
    const s = Math.max(0.1, Math.min(s0, (bottom - MARGIN) / Math.max(1, stackH), (w - left - MARGIN) / z.w));
    this.stack.scale.set(s);
    this.stack.position.set(left, bottom - stackH * s);
  }

  fit(): void {
    this.resize(this.host.screenW, this.host.screenH);
  }

  private buildRow(row: MenuRow, w: number, h: number): Container {
    const node = new Container();
    if (row.kind === 'separator') return node; // filtered out by hbRows; keeps the union total
    node.label = `menu-row-${row.id}`;
    node.eventMode = 'static'; // the row body absorbs taps (else they fall through to the dismiss layer)
    node.hitArea = new Rectangle(0, 0, w, h);
    const slab = new Slab(w, h, { face: S.plate, corners: SKEW.readout });
    const label = sLabel(row.label, 13, S.fg);
    node.addChild(slab, label);
    const place = (maxW: number): void => {
      if (label.width > maxW) label.scale.set(maxW / label.width);
      label.position.set(PAD, (h - label.height) / 2);
    };

    if (row.kind === 'button') {
      place(w - PAD * 2);
      if (row.disabled) {
        node.alpha = 0.5;
        return node;
      }
      node.cursor = 'pointer';
      node.on('pointerover', () => {
        slab.setFace(S.yellow);
        label.style.fill = S.ink;
      });
      node.on('pointerout', () => {
        slab.setFace(S.plate);
        label.style.fill = S.fg;
      });
      node.on('pointertap', () => {
        this.host.closeLayer();
        row.select();
      });
      return node;
    }

    if (row.kind === 'toggle') {
      const toggle = new SToggle(row.get(), row.disabled ? () => {} : (v) => {
        row.set(v);
        toggle.setValue(v);
      });
      toggle.position.set(w - PAD - 44, (h - 24) / 2);
      place(toggle.x - 8 - PAD);
      node.addChild(toggle);
      this.updaters[row.id] = (v) => toggle.setValue(v === true);
      if (row.disabled) {
        node.alpha = 0.5;
        toggle.eventMode = 'none';
      }
      return node;
    }

    // range: label, then the slider to the right edge (0 on the slider is mute — no icons)
    const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
    const fromUnit = (u: number): number => {
      const raw = row.min + u * (row.max - row.min);
      const snapped = row.min + Math.round((raw - row.min) / row.step) * row.step;
      return Math.max(row.min, Math.min(row.max, snapped));
    };
    place(w * 0.45);
    const x = PAD + label.width + PAD;
    const slider = new SSlider(toUnit(row.get()), row.disabled ? () => {} : (u) => row.set(fromUnit(u)));
    slider.setLayoutSize(Math.max(120, w - PAD - x));
    slider.position.set(x, (h - 24) / 2);
    node.addChild(slider);
    this.updaters[row.id] = (v) => slider.setValue(toUnit(Number(v)));
    if (row.disabled) {
      node.alpha = 0.5;
      slider.eventMode = 'none';
    }
    return node;
  }
}
