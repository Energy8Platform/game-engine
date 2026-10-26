import { Container, Graphics } from 'pixi.js';
import { S, SHADOW_ALPHA } from './theme';

// THE S pattern: a flat skewed plate with a drop shadow. Every bar element is a Slab, so the look has a
// single owner (like HB's `plaque`).

/** Per-corner offsets [dx, dy] from the w×h box, clockwise from top-left. Each points INTO the box,
 *  so the quad never leaves it. Fixed per element: the "torn" skew is identical on every render. */
export type Corners = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
];

export const FLAT: Corners = [[0, 0], [0, 0], [0, 0], [0, 0]];

/** Skew presets per element, in design px (they scale with the bar). As in the reference, every slab
 *  leans right (top edge shifted right, ~0.2 of its height); the readouts also tilt up to the right,
 *  SPIN down. */
export const SKEW = {
  menu: [[3, 0], [0, 0], [-3, 0], [0, 0]],
  readout: [[3, 0], [0, 0], [-3, 0], [0, 0]],
  bet: [[3, 0], [0, 0], [-3, 0], [0, 0]],
  spin: [[6, 0], [0, 0], [-6, 0], [0, 0]],
} as const satisfies Record<string, Corners>;

/** SPIN's slanted left edge: its x at height y on a SPIN h tall (the tabs run parallel to it). */
export function spinEdgeX(y: number, h: number): number {
  const [tl, , , bl] = SKEW.spin;
  return tl[0] + ((bl[0] - tl[0]) * (y - tl[1])) / (h + bl[1] - tl[1]);
}

export const SHADOW_OFFSET = 3;

/** The slab outline as a flat [x,y,…] list, clockwise from top-left. */
export function slabPoints(w: number, h: number, corners: Corners = FLAT, chamfer = true): number[] {
  const [tl, tr, br, bl] = corners;
  const cut = chamfer ? Math.min(12, w * .12, h * .2) : 0;
  const rightX = w + tr[0] + (br[0] - tr[0]) * cut / Math.max(1, h + br[1] - tr[1]);
  return [tl[0], tl[1], w + tr[0] - cut, tr[1], rightX, tr[1] + cut,
    w + br[0], h + br[1], bl[0], h + bl[1]];
}

export interface SlabOpts {
  face: string;
  corners?: Corners;
  /** Offset darker copy behind the face. Default true. */
  shadow?: boolean;
  shadowAlpha?: number;
  shadowOffset?: number;
  chamfer?: boolean;
  outline?: string;
  outlineWidth?: number;
  points?: number[];
}

/** One skewed plate: shadow + face (repainted by `setFace`, e.g. on hover). */
export class Slab extends Container {
  readonly w: number;
  readonly h: number;
  private faceG = new Graphics();
  /** The outline, as `slabPoints` gives it. */
  readonly points: number[];
  private _face = '';
  private outline?: string;
  private outlineWidth?: number;

  constructor(w: number, h: number, opts: SlabOpts) {
    super();
    this.w = Math.round(w);
    this.h = Math.round(h);
    this.points = opts.points ?? slabPoints(this.w, this.h, opts.corners ?? FLAT, opts.chamfer ?? true);
    this.outline = opts.outline;
    this.outlineWidth = opts.outlineWidth;
    if (opts.shadow !== false) {
      const shadow = new Graphics().poly(this.points).fill({ color: S.shadow, alpha: opts.shadowAlpha ?? SHADOW_ALPHA });
      shadow.position.set(opts.shadowOffset ?? SHADOW_OFFSET, opts.shadowOffset ?? SHADOW_OFFSET);
      this.addChild(shadow);
    }
    this.addChild(this.faceG);
    this.setFace(opts.face);
  }

  /** The colour the face is painted in right now. */
  get face(): string {
    return this._face;
  }

  setFace(color: string): void {
    this._face = color;
    this.faceG.clear().poly(this.points).fill(color);
    const width = this.outlineWidth ?? (this.outline || color === S.plate || color === S.plateHover ? 1 : 0);
    if (width > 0) {
      this.faceG.stroke({ color: this.outline ?? '#34343a', width, alignment: 1 });
    }
  }
}
