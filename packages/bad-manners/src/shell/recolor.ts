// The kit paints its accent into the raster (lime pills, bubbles, the SPIN disc, the slider fill, the
// face's tongue), so a new accent recolours those pixels at load. The kit is flat: every accent
// pixel lies on a straight blend from ink (or white, or transparent) to one of the three lime shades,
// so each one is moved to the same spot on the blend to the matching new shade. Nothing else moves.

const INK = [0x0b, 0x0b, 0x0b];
const WHITE = [0xff, 0xff, 0xff];
/** How far (per channel, 0..255) a pixel may sit off a blend and still count as on it. */
const TOLERANCE = 10;

const rgb = (c: number): number[] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Recolour RGBA `data` in place: `from[i]` shades → `to[i]`. */
export function recolorPixels(data: Uint8ClampedArray, from: number[], to: number[]): void {
  const src = from.map(rgb);
  const dst = to.map(rgb);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    let best = -1;
    let bestT = 0;
    let bestAnchor = INK;
    let bestErr = TOLERANCE;
    for (let i = 0; i < src.length; i++) {
      for (const anchor of [INK, WHITE]) {
        const d0 = src[i][0] - anchor[0];
        const d1 = src[i][1] - anchor[1];
        const d2 = src[i][2] - anchor[2];
        const len = d0 * d0 + d1 * d1 + d2 * d2;
        if (!len) continue;
        const t = ((r - anchor[0]) * d0 + (g - anchor[1]) * d1 + (b - anchor[2]) * d2) / len;
        if (t < 0.04 || t > 1.02) continue; // the anchor itself (ink / white) stays put
        const err = Math.max(
          Math.abs(r - (anchor[0] + t * d0)),
          Math.abs(g - (anchor[1] + t * d1)),
          Math.abs(b - (anchor[2] + t * d2)),
        );
        if (err < bestErr) {
          bestErr = err;
          best = i;
          bestT = Math.min(1, t);
          bestAnchor = anchor;
        }
      }
    }
    if (best < 0) continue;
    const to3 = dst[best];
    data[p] = bestAnchor[0] + bestT * (to3[0] - bestAnchor[0]);
    data[p + 1] = bestAnchor[1] + bestT * (to3[1] - bestAnchor[1]);
    data[p + 2] = bestAnchor[2] + bestT * (to3[2] - bestAnchor[2]);
  }
}
