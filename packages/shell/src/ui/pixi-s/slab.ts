import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { S, SHADOW_ALPHA } from './theme';

// THE S pattern: a skewed plate with a drop shadow and a halftone dot texture. Every bar element is a
// Slab, so the look has a single owner (like HB's `plaque`).

/** Per-corner offsets [dx, dy] from the w×h box, clockwise from top-left. Each points INTO the box,
 *  so the quad never leaves it. Fixed per element: the "torn" skew is identical on every render. */
export type Corners = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
];

export const FLAT: Corners = [[0, 0], [0, 0], [0, 0], [0, 0]];

/** Skew presets per element, in design px (they scale with the bar). */
export const SKEW = {
  menu: [[4, 0], [0, 3], [-2, 0], [0, -2]],
  readout: [[6, 2], [0, 0], [-4, 0], [0, -3]],
  bet: [[8, 0], [0, 3], [-2, 0], [0, -2]],
  buy: [[6, 0], [0, 4], [-4, 0], [4, 0]],
  spin: [[4, 3], [0, 0], [-6, -2], [0, 0]],
  tab: [[3, 0], [0, 2], [0, 0], [0, -2]],
} as const satisfies Record<string, Corners>;

export const DOT_STEP = 6;
export const DOT_R = 1.1;
export const SHADOW_OFFSET = 3;
/** Sawtooth: one tooth is TOOTH_W wide and hangs TOOTH_D below the body. */
export const TOOTH_W = 8;
export const TOOTH_D = 5;

/** The slab outline as a flat [x,y,…] list, clockwise from top-left. With `sawtooth` the body's bottom
 *  edge sits TOOTH_D higher and the teeth hang from it down to the box bottom, ending on the base line
 *  at the bottom-left corner. */
export function slabPoints(w: number, h: number, corners: Corners = FLAT, sawtooth = false): number[] {
  const base = sawtooth ? h - TOOTH_D : h;
  const [tl, tr, br, bl] = corners;
  const quad = [tl[0], tl[1], w + tr[0], tr[1], w + br[0], base + br[1], bl[0], base + bl[1]];
  if (!sawtooth) return quad;
  const [x1, y1, x0, y0] = [quad[4], quad[5], quad[6], quad[7]]; // bottom edge, br → bl
  // An even segment count, so the walk ends on the base line (tooth tips are the odd points).
  const n = Math.max(2, 2 * Math.round(Math.hypot(x1 - x0, y1 - y0) / TOOTH_W));
  const pts = quad.slice(0, 6); // tl, tr, br
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x0 - x1) * t;
    const y = y1 + (y0 - y1) * t;
    pts.push(x, i % 2 === 1 ? y + TOOTH_D : y);
  }
  return pts;
}

/** Even-odd point-in-polygon over a flat [x,y,…] list. */
function inside(pts: number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Halftone dot centres and radii. A dot is kept only when its four extreme points lie inside the
 *  body quad (so no mask is needed). `fade`: the radius shrinks from full at the bottom-left to
 *  nothing toward the top-right, as on the reference's black plates; otherwise every dot is DOT_R. */
export function halftone(w: number, h: number, corners: Corners, sawtooth: boolean, fade: boolean): Array<[number, number, number]> {
  const quad = slabPoints(w, sawtooth ? h - TOOTH_D : h, corners);
  const out: Array<[number, number, number]> = [];
  for (let y = DOT_STEP / 2; y < h; y += DOT_STEP) {
    for (let x = DOT_STEP / 2; x < w; x += DOT_STEP) {
      const k = fade ? Math.min(1, Math.max(0, 0.15 + (y / h) * 1.1 - (x / w) * 0.35)) : 1;
      const r = DOT_R * k;
      if (r < 0.35) continue;
      if (inside(quad, x - r, y) && inside(quad, x + r, y) && inside(quad, x, y - r) && inside(quad, x, y + r)) {
        out.push([x, y, r]);
      }
    }
  }
  return out;
}

// One context per slab size / corners / colour / fade — the bar is rebuilt on ~20 state changes per
// spin, and with whole-px sizes the cache is bounded by the number of distinct slabs.
const dotCache = new Map<string, GraphicsContext>();

function dotContext(w: number, h: number, corners: Corners, sawtooth: boolean, fade: boolean, color: string): GraphicsContext {
  const key = `${w}|${h}|${corners.flat().join(',')}|${sawtooth}|${fade}|${color}`;
  let ctx = dotCache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext();
    for (const [x, y, r] of halftone(w, h, corners, sawtooth, fade)) ctx.circle(x, y, r);
    ctx.fill(color);
    dotCache.set(key, ctx);
  }
  return ctx;
}

export interface SlabOpts {
  face: string;
  /** Halftone dot colour; omitted = a plain face. */
  dots?: string;
  /** Dots thin out toward the top-right (black plates). Default true; SPIN passes false. */
  fade?: boolean;
  corners?: Corners;
  /** Zig-zag bottom edge (SPIN / FS counter). */
  sawtooth?: boolean;
  /** Offset darker copy behind the face. Default true. */
  shadow?: boolean;
}

/** One skewed plate: shadow + face (repainted by `setFace`, e.g. on hover) + a shared dot context. */
export class Slab extends Container {
  readonly w: number;
  readonly h: number;
  private faceG = new Graphics();
  private points: number[];

  constructor(w: number, h: number, opts: SlabOpts) {
    super();
    this.w = Math.round(w);
    this.h = Math.round(h);
    const corners = opts.corners ?? FLAT;
    const sawtooth = !!opts.sawtooth;
    this.points = slabPoints(this.w, this.h, corners, sawtooth);
    if (opts.shadow !== false) {
      const shadow = new Graphics().poly(this.points).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
      shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
      this.addChild(shadow);
    }
    this.addChild(this.faceG);
    this.setFace(opts.face);
    if (opts.dots) {
      this.addChild(new Graphics(dotContext(this.w, this.h, corners, sawtooth, opts.fade !== false, opts.dots)));
    }
  }

  setFace(color: string): void {
    this.faceG.clear().poly(this.points).fill(color);
  }
}
