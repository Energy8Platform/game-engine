import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { iconSVG, iconStrokeSVG, type IconName } from './icons';
import type { Sizable } from './primitives/flex';

// The DOM shell renders each icon as an inline <svg> sized to 1em and recoloured via
// `currentColor`. The Pixi shell rebuilds the same 24×24 vector paths through Pixi's SVG
// parser (GraphicsContext.svg) and scales them to the requested pixel size — same shapes,
// crisp at any scale. Recolour rebuilds the geometry with the colour substituted for
// `currentColor` (recolour happens only on hover/active, so this is cheap).

const VIEWBOX = 24;

// Cache parsed contexts by `name|fill|ring|width` — many icons repeat across the bar at the same colour.
const cache = new Map<string, GraphicsContext>();

function context(name: IconName, color: string, ring?: string, ringWidth = 4): GraphicsContext {
  const key = `${name}|${color}|${ring ?? ''}|${ring ? ringWidth : 0}`;
  let ctx = cache.get(key);
  if (!ctx) {
    if (ring) {
      // Two-pass layering: stroke context first (under), then fill on top.
      // Only the outer half of the stroke shows — the paint-order:stroke CSS equivalent.
      ctx = new GraphicsContext()
        .svg(iconStrokeSVG(name, ring, ringWidth))
        .svg(iconSVG(name, color));
    } else {
      ctx = new GraphicsContext().svg(iconSVG(name, color));
    }
    cache.set(key, ctx);
  }
  return ctx;
}

/** A recolourable, scalable icon. Its content is centred on the local origin's box so the view's
 *  bounds are `size × size` and `rotation` spins around the glyph centre (like CSS 50% 50%).
 *
 *  Optional `ring` and `ringWidth` enable the outer-ring treatment (fill-on-top-of-stroke): the
 *  stroke is drawn first (underneath), then the fill path is drawn on top — only the outer half
 *  of the stroke is visible, mirroring the DOM `paint-order:stroke` technique. */
export class IconView extends Container implements Sizable {
  private gfx: Graphics;
  private _size: number;
  private _color: string;
  private _ring: string | undefined;
  private _ringWidth: number;
  readonly iconName: IconName;

  constructor(name: IconName, size: number, color = '#ffffff', ring?: string, ringWidth = 4) {
    super();
    this.iconName = name;
    this._size = size;
    this._color = color;
    this._ring = ring;
    this._ringWidth = ringWidth;
    this.gfx = new Graphics(context(name, color, ring, ringWidth));
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

  setColor(color: string): void {
    if (color === this._color && !this._ring) return;
    this._color = color;
    this._ring = undefined;
    this.gfx.context = context(this.iconName, color);
  }

  /** Update fill colour and ring colour simultaneously (ring is preserved if provided). */
  setColors(fill: string, ring?: string): void {
    if (fill === this._color && ring === this._ring) return;
    this._color = fill;
    this._ring = ring;
    this.gfx.context = context(this.iconName, fill, ring, this._ringWidth);
  }

  setSize(size: number): void {
    if (size === this._size) return;
    this._size = size;
    this.layout();
  }

  // ── Sizable: a raw icon occupies a size×size em box (the DOM's 1em <span>), positioned by that
  //    box so flex rows centre the EM box like CSS line-box centring — not the ink, which for
  //    off-centre glyphs (chevron, info) sits asymmetrically and drifts vertically.
  measureSize(): { w: number; h: number } {
    return { w: this._size, h: this._size };
  }
  setLayoutSize(): void {
    /* fixed-size glyph — no stretch */
  }

  /** Rotation around the glyph centre (radians) — used by the spinning SPIN disc. */
  set spin(r: number) {
    this.gfx.rotation = r;
  }
  get spin(): number {
    return this.gfx.rotation;
  }
}

export function makeIcon(name: IconName, size: number, color = '#ffffff'): IconView {
  return new IconView(name, size, color);
}

/** Create a ringed icon — glyph filled with `fill`, outer ring coloured `ring` (width `ringWidth`).
 *  Uses the two-pass stroke-under-fill technique to show only the outer half of the stroke. */
export function makeRingedIcon(name: IconName, size: number, fill: string, ring: string, ringWidth = 4): IconView {
  return new IconView(name, size, fill, ring, ringWidth);
}
