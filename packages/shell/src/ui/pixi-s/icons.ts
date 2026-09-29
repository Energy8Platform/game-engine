import { Graphics, GraphicsContext } from 'pixi.js';

// S glyphs: 24×24 fragments with one colour slot (`currentColor`). The rest of the bar's glyphs
// (spin, stop, close, menu, minus, plus) come from HB's sheet through makeIcon.
const SVGS = {
  // The reference's mask: two eye outlines crossing in the middle, a pupil in the right eye and a
  // small wedge on each side.
  mask:
    `<path d="M19.5 6.5L9.8 17.5L7.5 17.5L5.5 15L4.5 6.5L14.2 17.5L16.5 17.5L18.5 15Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"/>` +
    `<path d="M16.6 11.5L17.5 12.4L16.6 13.3L15.7 12.4Z" fill="currentColor"/>` +
    `<path d="M0.5 9.2L2.9 8.2L2.9 11.6Z" fill="currentColor"/>` +
    `<path d="M23.5 9.2L21.1 8.2L21.1 11.6Z" fill="currentColor"/>`,
  play: `<path d="M6 3.5L20 12L6 20.5Z" fill="currentColor"/>`,
  bolt: `<path d="M14 2L5 13.5L11 13.5L9.5 22L19 9.5L13 9.5L14 2Z" fill="currentColor"/>`,
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
