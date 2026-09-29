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
 *  SPIN down. The tabs lean on the left only: their right end hides under SPIN. */
export const SKEW = {
  menu: [[7, 0], [0, 0], [-7, 0], [0, 0]],
  readout: [[11, 6], [0, 0], [-11, -6], [0, 0]],
  bet: [[7, 0], [0, 1], [-7, 0], [0, -3]],
  spin: [[21, 0], [0, 5], [-21, 0], [0, -10]],
  tab: [[7, 0], [0, 0], [0, 0], [0, 0]],
} as const satisfies Record<string, Corners>;

export const SHADOW_OFFSET = 3;

/** The slab outline as a flat [x,y,…] list, clockwise from top-left. */
export function slabPoints(w: number, h: number, corners: Corners = FLAT): number[] {
  const [tl, tr, br, bl] = corners;
  return [tl[0], tl[1], w + tr[0], tr[1], w + br[0], h + br[1], bl[0], h + bl[1]];
}

export interface SlabOpts {
  face: string;
  corners?: Corners;
  /** Offset darker copy behind the face. Default true. */
  shadow?: boolean;
}

/** One skewed plate: shadow + face (repainted by `setFace`, e.g. on hover). */
export class Slab extends Container {
  readonly w: number;
  readonly h: number;
  private faceG = new Graphics();
  private points: number[];

  constructor(w: number, h: number, opts: SlabOpts) {
    super();
    this.w = Math.round(w);
    this.h = Math.round(h);
    this.points = slabPoints(this.w, this.h, opts.corners ?? FLAT);
    if (opts.shadow !== false) {
      const shadow = new Graphics().poly(this.points).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
      shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
      this.addChild(shadow);
    }
    this.addChild(this.faceG);
    this.setFace(opts.face);
  }

  setFace(color: string): void {
    this.faceG.clear().poly(this.points).fill(color);
  }
}
