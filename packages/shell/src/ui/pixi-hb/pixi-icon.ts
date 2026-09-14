import { Container, Graphics, GraphicsContext, GraphicsContextSystem } from 'pixi.js';
import { iconSVG, type HbIconName, type HbIconColors } from './icons';
import type { Sizable } from '../pixi/primitives/flex';
import { HB } from './theme';

// Same smoothing rationale as ui/pixi/pixi-icon.ts: the glyphs are 24-unit SVGs scaled up to
// button size, so flatten curves as finely as Pixi allows.
GraphicsContextSystem.defaultOptions.bezierSmoothness = 0.99;

type IconColors = Required<Pick<HbIconColors, 'ink' | 'fill' | 'accent' | 'stroke'>> & Pick<HbIconColors, 'boltA' | 'boltB'>;

const VIEWBOX = 24;
/** On-screen border of a glyph, in px: grows with the glyph (the sheet's strokes are ~2% of a glyph's
 *  width) but never past the brand's 3px, and never so thin it stops reading as a border. */
export function strokePx(size: number): number {
  return Math.max(1.2, Math.min(2.4, size * 0.04));
}
function strokeUnits(size: number): number {
  return (strokePx(size) * VIEWBOX) / size;
}

// Cache parsed contexts by `name|ink|fill|accent` — the bar repeats glyphs at the same colours.
const cache = new Map<string, GraphicsContext>();

function context(name: HbIconName, c: IconColors): GraphicsContext {
  const key = `${name}|${c.ink}|${c.fill}|${c.accent}|${c.boltA ?? ''}|${c.boltB ?? ''}|${c.stroke.toFixed(2)}`;
  let ctx = cache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext().svg(iconSVG(name, c));
    cache.set(key, ctx);
  }
  return ctx;
}

/** A recolourable, scalable HB icon: ink strokes, a beige face and (autoplay only) an orange accent.
 *  Content is centred on a `size × size` box so `rotation` spins around the glyph centre. */
export class IconView extends Container implements Sizable {
  private gfx: Graphics;
  private _size: number;
  private _colors: IconColors;
  private _iconName: HbIconName;

  constructor(name: HbIconName, size: number, colors: HbIconColors = {}) {
    super();
    this._iconName = name;
    this._size = size;
    this._colors = { ink: HB.ink, fill: HB.beige, accent: HB.orange, stroke: strokeUnits(size), ...colors };
    this.gfx = new Graphics(context(name, this._colors));
    this.addChild(this.gfx);
    this.layout();
  }

  private layout(): void {
    const s = this._size / VIEWBOX;
    this.gfx.scale.set(s);
    this.gfx.pivot.set(VIEWBOX / 2, VIEWBOX / 2);
    this.gfx.position.set(this._size / 2, this._size / 2);
  }

  get size(): number {
    return this._size;
  }

  get iconName(): HbIconName {
    return this._iconName;
  }

  get colors(): IconColors {
    return this._colors;
  }

  /** Recolour any subset of the slots (rebuilds from the context cache). */
  setColors(colors: HbIconColors): void {
    const next = { ...this._colors, ...colors };
    const same = (['ink', 'fill', 'accent', 'stroke', 'boltA', 'boltB'] as const).every((k) => next[k] === this._colors[k]);
    if (same) return;
    this._colors = next;
    this.gfx.context = context(this._iconName, next);
  }

  /** Back-compat with the mono renderer's API: one colour = the ink slot. */
  setColor(ink: string): void {
    this.setColors({ ink });
  }

  setIcon(name: HbIconName): void {
    if (name === this._iconName) return;
    this._iconName = name;
    this.gfx.context = context(name, this._colors);
  }

  setSize(size: number): void {
    if (size === this._size) return;
    this._size = size;
    this.layout();
    this.setColors({ stroke: strokeUnits(size) });
  }

  measureSize(): { w: number; h: number } {
    return { w: this._size, h: this._size };
  }
  setLayoutSize(): void {
    /* fixed-size glyph — no stretch */
  }

  set spin(r: number) {
    this.gfx.rotation = r;
  }
  get spin(): number {
    return this.gfx.rotation;
  }
}

export function makeIcon(name: HbIconName, size: number, colors: HbIconColors = {}): IconView {
  return new IconView(name, size, colors);
}
