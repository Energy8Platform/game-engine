import { Graphics, GraphicsContext } from 'pixi.js';

// S glyphs: 24×24 fragments with one colour slot (`currentColor`). The rest of the bar's glyphs
// (spin, stop, close, menu, minus, plus) come from HB's sheet through makeIcon.
const SVGS = {
  // The reference's mask (traced from it): two wide eyes pointed at the outer top corners, meeting in
  // the middle — the left one open at the bottom-right (a C), the right one closed around a pupil —
  // and a small wedge on each side. The miter joins make the pointed tips.
  mask:
    `<path d="M10.3 14.7L9.55 15.95L7 15.95L5.4 13.8L4.75 8.9L11.25 12.95L12.1 14.25L13.4 15.95L16.8 15.95L18.1 14.25L18.4 11.7L19.25 8.9L12.1 12.95" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter"/>` +
    `<path d="M15.95 12.45L16.8 13.3L15.95 14.15L15.1 13.3Z" fill="currentColor"/>` +
    `<path d="M0.6 10.2L2.3 9.2L3.1 11.9Z" fill="currentColor"/>` +
    `<path d="M23.4 10.2L21.7 9.2L20.9 11.9Z" fill="currentColor"/>`,
  play: `<path d="M5.5 2.5L21 12L5.5 21.5Z" fill="currentColor"/>`,
  bolt: `<path d="M13.75 3.2L5.85 13.3L11.1 13.3L9.8 20.8L18.15 9.8L12.9 9.8L13.75 3.2Z" fill="currentColor"/>`,
} as const;

export type SIconName = keyof typeof SVGS;
export const S_ICON_NAMES = Object.keys(SVGS) as SIconName[];

/** A standalone, parseable SVG document with the colour resolved. */
export function sIconSVG(name: SIconName, color: string): string {
  return `<svg viewBox="0 0 24 24">${SVGS[name].split('currentColor').join(color)}</svg>`;
}

const cache = new Map<string, GraphicsContext>();

/** An S glyph as a `size × size` box. Contexts are parsed once per name|colour and shared: the bar
 *  is rebuilt on most state changes, and `destroy({ children: true })` leaves a shared context alone. */
export function sIcon(name: SIconName, size: number, color: string): Graphics {
  const key = `${name}|${color}`;
  let ctx = cache.get(key);
  if (!ctx) {
    ctx = new GraphicsContext().svg(sIconSVG(name, color));
    cache.set(key, ctx);
  }
  const g = new Graphics(ctx);
  g.scale.set(size / 24);
  return g;
}
