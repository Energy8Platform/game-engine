import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { S_SHEET } from './icons-sheet';
import { bonusGlyph } from '../pixi/pixi-icon';
import type { BonusIconName } from '@/core/bonusIcons';

// S glyphs: 24×24 fragments with one colour slot (`currentColor`). The sheet (icons-s.svg, generated
// into icons-sheet.ts) draws every bar glyph; `play` is hand-authored — the sheet has none.
const SVGS = {
  ...S_SHEET,
  play: `<path d="M5.5 2.5L21 12L5.5 21.5Z" fill="currentColor"/>`,
} as const;

export type SIconName = keyof typeof SVGS;
export const S_ICON_NAMES = Object.keys(SVGS) as SIconName[];

/** A standalone, parseable SVG document with the colour resolved. */
export function sIconSVG(name: SIconName, color: string): string {
  return `<svg viewBox="0 0 24 24">${SVGS[name].split('currentColor').join(color)}</svg>`;
}

const cache = new Map<string, GraphicsContext>();

/** An S glyph in a `size × size` box, drawn about its centre so `spin` turns it in place. Contexts
 *  are parsed once per name|colour and shared: the bar is rebuilt on most state changes, and
 *  `destroy({ children: true })` leaves a shared context alone. */
export class SGlyph extends Container {
  readonly iconName: SIconName;
  readonly gfx: Graphics;

  constructor(name: SIconName, size: number, color: string) {
    super();
    this.iconName = name;
    const key = `${name}|${color}`;
    let ctx = cache.get(key);
    if (!ctx) {
      ctx = new GraphicsContext().svg(sIconSVG(name, color));
      cache.set(key, ctx);
    }
    this.gfx = new Graphics(ctx);
    this.gfx.scale.set(size / 24);
    this.gfx.pivot.set(12, 12);
    this.gfx.position.set(size / 2, size / 2);
    this.addChild(this.gfx);
    this.label = 's-glyph'; // lets the no-round/no-stroke guard skip glyph geometry (SVG paths)
  }

  get spin(): number {
    return this.gfx.rotation;
  }
  set spin(r: number) {
    this.gfx.rotation = r;
  }
}

export function sIcon(name: SIconName, size: number, color: string): SGlyph {
  return new SGlyph(name, size, color);
}

/** The BUY BONUS mask: the provider's icon when one is configured (core/bonusIcons), else the sheet's. */
export function sBonusIcon(provider: BonusIconName | undefined, size: number, color: string): Container {
  return provider ? bonusGlyph(provider, size, color) : sIcon('bonus', size, color);
}
