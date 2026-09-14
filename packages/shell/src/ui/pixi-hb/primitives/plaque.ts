import { Graphics } from 'pixi.js';
import { BORDER, HB, RADIUS } from '../theme';

export interface PlaqueOpts {
  fill: string;
  border?: string;
  borderWidth?: number;
  radius?: number;
  /** Draw a circle (spin) instead of a rounded rect. */
  round?: boolean;
  alpha?: number;
}

/** THE Hellbuddha pattern: a face with a 3px ink border and 8px corners. Every button, panel, card,
 *  popover and modal frame is drawn by this one function, so the look has a single owner. The
 *  stroke is inset (alignment 1) so the plaque's outer edge is exactly `w × h`. */
export function plaque(g: Graphics, w: number, h: number, opts: PlaqueOpts): Graphics {
  const { fill, border = HB.ink, borderWidth = BORDER, radius = RADIUS, round = false, alpha = 1 } = opts;
  g.clear();
  if (round) g.circle(w / 2, h / 2, Math.min(w, h) / 2);
  else g.roundRect(0, 0, w, h, radius);
  g.fill({ color: fill, alpha });
  if (borderWidth > 0) g.stroke({ color: border, width: borderWidth, alignment: 1 });
  return g;
}

export function makePlaque(w: number, h: number, opts: PlaqueOpts): Graphics {
  return plaque(new Graphics(), w, h, opts);
}
