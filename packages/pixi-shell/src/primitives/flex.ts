import { Container, Graphics } from 'pixi.js';

// A focused flexbox for Pixi — just the slice of CSS flex the shell's CSS actually uses:
// row/column, gap, padding, justify (start/center/end/space-between), align
// (start/center/end/stretch), per-child grow + alignSelf, an optional rounded "plaque"
// background, and fixed-or-content sizing. Enough to reproduce the DOM bar & overlays 1:1
// without pulling in a Yoga dependency.

export type FlexDir = 'row' | 'column';
export type Justify = 'start' | 'center' | 'end' | 'space-between';
export type Align = 'start' | 'center' | 'end' | 'stretch';

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface BgStyle {
  fill?: string;
  radius?: number;
  /** per-corner radii [tl, tr, br, bl] override `radius`. */
  corners?: [number, number, number, number];
  stroke?: { color: string; width: number };
}

export interface FlexOpts {
  direction?: FlexDir;
  gap?: number;
  padding?: number | Padding;
  justify?: Justify;
  align?: Align;
  background?: BgStyle;
  /** Fixed outer size; omit a dimension for content sizing. */
  width?: number;
  height?: number;
}

export interface ChildOpts {
  grow?: number;
  alignSelf?: Align;
}

interface Entry {
  node: Container;
  grow: number;
  alignSelf?: Align;
}

/** Anything that can be measured + sized by the layout (FlexBox and stretchable widgets). */
export interface Sizable {
  setLayoutSize(w: number | undefined, h: number | undefined): void;
  measureSize(): { w: number; h: number };
}

function isSizable(n: unknown): n is Sizable {
  return !!n && typeof (n as Sizable).measureSize === 'function' && typeof (n as Sizable).setLayoutSize === 'function';
}

/** Local bounds of a node, used when it isn't a Sizable. */
function rawSize(node: Container): { w: number; h: number } {
  const b = node.getLocalBounds();
  return { w: b.width, h: b.height };
}

function measureOuter(node: Container): { w: number; h: number } {
  return isSizable(node) ? node.measureSize() : rawSize(node);
}

function pad(p: number | Padding | undefined): Required<Padding> {
  if (p == null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
}

export class FlexBox extends Container implements Sizable {
  private dir: FlexDir;
  private gap: number;
  private padding: Required<Padding>;
  private justify: Justify;
  private align: Align;
  private bgStyle?: BgStyle;
  private bg?: Graphics;
  private entries: Entry[] = [];
  private fixedW?: number;
  private fixedH?: number;
  /** last computed outer size. */
  private outW = 0;
  private outH = 0;

  constructor(opts: FlexOpts = {}) {
    super();
    this.dir = opts.direction ?? 'row';
    this.gap = opts.gap ?? 0;
    this.padding = pad(opts.padding);
    this.justify = opts.justify ?? 'start';
    this.align = opts.align ?? 'start';
    this.bgStyle = opts.background;
    this.fixedW = opts.width;
    this.fixedH = opts.height;
    if (this.bgStyle) {
      this.bg = new Graphics();
      this.addChild(this.bg);
    }
  }

  add(node: Container, opts: ChildOpts = {}): this {
    this.entries.push({ node, grow: opts.grow ?? 0, alignSelf: opts.alignSelf });
    this.addChild(node);
    return this;
  }

  addAll(nodes: Container[]): this {
    for (const n of nodes) this.add(n);
    return this;
  }

  clearChildren(): void {
    for (const e of this.entries) {
      this.removeChild(e.node);
      e.node.destroy({ children: true });
    }
    this.entries = [];
  }

  setBackground(bg: BgStyle | undefined): void {
    this.bgStyle = bg;
    if (bg && !this.bg) {
      this.bg = new Graphics();
      this.addChildAt(this.bg, 0);
    }
    if (!bg && this.bg) {
      this.bg.clear();
    }
  }

  // ── Sizable ──────────────────────────────────────────────────────────────
  setLayoutSize(w: number | undefined, h: number | undefined): void {
    this.fixedW = w;
    this.fixedH = h;
    this.layout();
  }

  measureSize(): { w: number; h: number } {
    this.layout();
    return { w: this.outW, h: this.outH };
  }

  get outerWidth(): number {
    return this.outW;
  }
  get outerHeight(): number {
    return this.outH;
  }

  /** Measure + position children. Idempotent. */
  layout(): void {
    const horizontal = this.dir === 'row';
    const px = this.padding;
    const padMainStart = horizontal ? px.left : px.top;
    const padMainEnd = horizontal ? px.right : px.bottom;
    const padCrossStart = horizontal ? px.top : px.left;
    const padCrossEnd = horizontal ? px.bottom : px.right;

    // Measure each child's outer size.
    const sizes = this.entries.map((e) => measureOuter(e.node));

    const contentMain = sizes.reduce((s, m) => s + (horizontal ? m.w : m.h), 0)
      + this.gap * Math.max(0, this.entries.length - 1);
    const contentCross = sizes.reduce((mx, m) => Math.max(mx, horizontal ? m.h : m.w), 0);

    const fixedMain = horizontal ? this.fixedW : this.fixedH;
    const fixedCross = horizontal ? this.fixedH : this.fixedW;

    const outerMain = fixedMain ?? contentMain + padMainStart + padMainEnd;
    const outerCross = fixedCross ?? contentCross + padCrossStart + padCrossEnd;
    const innerMain = outerMain - padMainStart - padMainEnd;
    const innerCross = outerCross - padCrossStart - padCrossEnd;

    // Distribute free main-space to growers (or, when none grow, to justify spacing).
    const totalGrow = this.entries.reduce((s, e) => s + e.grow, 0);
    let free = innerMain - contentMain;
    if (free < 0) free = 0;
    const growUnit = totalGrow > 0 ? free / totalGrow : 0;

    // Apply grow to child main sizes (stretch growers) and cross stretch.
    this.entries.forEach((e, i) => {
      const m = sizes[i];
      if (e.grow > 0 && growUnit > 0 && isSizable(e.node)) {
        const newMain = (horizontal ? m.w : m.h) + e.grow * growUnit;
        if (horizontal) {
          e.node.setLayoutSize(newMain, undefined);
          sizes[i] = e.node.measureSize();
        } else {
          e.node.setLayoutSize(undefined, newMain);
          sizes[i] = e.node.measureSize();
        }
      }
      const a = e.alignSelf ?? this.align;
      if (a === 'stretch' && isSizable(e.node)) {
        if (horizontal) {
          e.node.setLayoutSize(sizes[i].w, innerCross);
          sizes[i] = e.node.measureSize();
        } else {
          e.node.setLayoutSize(innerCross, sizes[i].h);
          sizes[i] = e.node.measureSize();
        }
      }
    });

    const usedMain = sizes.reduce((s, m) => s + (horizontal ? m.w : m.h), 0)
      + this.gap * Math.max(0, this.entries.length - 1);
    const leftover = innerMain - usedMain;

    // Justify: leading offset + per-item spacing.
    let cursor = (horizontal ? px.left : px.top);
    let spacing = this.gap;
    if (totalGrow === 0) {
      if (this.justify === 'center') cursor += leftover / 2;
      else if (this.justify === 'end') cursor += leftover;
      else if (this.justify === 'space-between' && this.entries.length > 1) {
        spacing = this.gap + leftover / (this.entries.length - 1);
      }
    }

    this.entries.forEach((e, i) => {
      const m = sizes[i];
      const childMain = horizontal ? m.w : m.h;
      const childCross = horizontal ? m.h : m.w;
      const a = e.alignSelf ?? this.align;
      let crossPos = padCrossStart;
      if (a === 'center') crossPos += (innerCross - childCross) / 2;
      else if (a === 'end') crossPos += innerCross - childCross;
      // Offset by the node's local-bounds origin so visible content lands on the slot.
      const b = e.node.getLocalBounds();
      if (horizontal) {
        e.node.position.set(cursor - b.x, crossPos - b.y);
      } else {
        e.node.position.set(crossPos - b.x, cursor - b.y);
      }
      cursor += childMain + spacing;
    });

    this.outW = horizontal ? outerMain : outerCross;
    this.outH = horizontal ? outerCross : outerMain;

    this.drawBackground();
  }

  private drawBackground(): void {
    if (!this.bgStyle || !this.bg) return;
    const g = this.bg;
    g.clear();
    const r = this.bgStyle.corners;
    if (r) {
      roundedPath(g, 0, 0, this.outW, this.outH, r);
    } else {
      g.roundRect(0, 0, this.outW, this.outH, this.bgStyle.radius ?? 0);
    }
    if (this.bgStyle.fill) g.fill(this.bgStyle.fill);
    if (this.bgStyle.stroke) g.stroke({ color: this.bgStyle.stroke.color, width: this.bgStyle.stroke.width });
  }
}

/** Rounded rect with independent corner radii [tl, tr, br, bl] — Pixi's roundRect is uniform. */
export function roundedPath(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): void {
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y);
  g.arcTo(x + w, y, x + w, y + tr, tr);
  g.lineTo(x + w, y + h - br);
  g.arcTo(x + w, y + h, x + w - br, y + h, br);
  g.lineTo(x + bl, y + h);
  g.arcTo(x, y + h, x, y + h - bl, bl);
  g.lineTo(x, y + tl);
  g.arcTo(x, y, x + tl, y, tl);
  g.closePath();
}
