import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { iconSVG, type IconName } from './icons';
import type { Sizable } from './primitives/flex';

// The DOM shell renders each icon as an inline <svg> sized to 1em and recoloured via
// `currentColor`. The Pixi shell rebuilds the same 24×24 vector paths through Pixi's SVG
// parser (GraphicsContext.svg) and scales them to the requested pixel size — same shapes,
// crisp at any scale. Recolour rebuilds the geometry with the colour substituted for
// `currentColor` (recolour happens only on hover/active, so this is cheap).

const VIEWBOX = 24;

// Cache parsed contexts by `name|color` — many icons repeat across the bar at the same colour.
const cache = new Map<string, GraphicsContext>();

function context(name: IconName, color: string): GraphicsContext {
  const key = `${name}|${color}`;
  let ctx = cache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext().svg(iconSVG(name, color));
    cache.set(key, ctx);
  }
  return ctx;
}

/** A recolourable, scalable icon. Its content is centred on the local origin's box so the view's
 *  bounds are `size × size` and `rotation` spins around the glyph centre (like CSS 50% 50%). */
export class IconView extends Container implements Sizable {
  private gfx: Graphics;
  private _size: number;
  private _color: string;
  readonly iconName: IconName;

  constructor(name: IconName, size: number, color = '#ffffff') {
    super();
    this.iconName = name;
    this._size = size;
    this._color = color;
    this.gfx = new Graphics(context(name, color));
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
    if (color === this._color) return;
    this._color = color;
    this.gfx.context = context(this.iconName, color);
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
