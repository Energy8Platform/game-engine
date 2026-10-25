import { describe, it, expect } from 'vitest';
import { recolorPixels } from '../src/shell/recolor';
import { accentShades, parseColor, LIME } from '../src/shell/theme';
import { createBadMannersPreloader } from '../src/preloader';

const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe('accent', () => {
  it('moves lime, its shades and their blends with ink / white onto the accent; leaves ink, white and greys', () => {
    const from = accentShades(LIME);
    const to = accentShades(0xff3b8b);
    const data = px(
      [0xb6, 0xff, 0x3b, 255], // lime
      [0xc8, 0xff, 0x6a, 255], // lime hover
      [0x8f, 0xd6, 0x1f, 255], // lime press
      [0x61, 0x85, 0x23, 255], // ~half lime / half ink (an anti-aliased edge)
      [0x0b, 0x0b, 0x0b, 255], // ink
      [0xff, 0xff, 0xff, 255], // white
      [0x2b, 0x2b, 0x2b, 255], // grey700
      [0x3a, 0x3a, 0x3a, 255], // grey600
    );
    recolorPixels(data, [from.base, from.hover, from.press], [to.base, to.hover, to.press]);
    const at = (i: number) => [...data.slice(i * 4, i * 4 + 3)];
    expect(at(0)).toEqual([0xff, 0x3b, 0x8b]);
    expect(at(1)).toEqual([(to.hover >> 16) & 255, (to.hover >> 8) & 255, to.hover & 255]);
    expect(at(2)).toEqual([(to.press >> 16) & 255, (to.press >> 8) & 255, to.press & 255]);
    const mid = at(3);
    expect(mid[0]).toBeGreaterThan(mid[1]); // now pink-ish, not green
    expect(at(4)).toEqual([0x0b, 0x0b, 0x0b]);
    expect(at(5)).toEqual([0xff, 0xff, 0xff]);
    expect(at(6)).toEqual([0x2b, 0x2b, 0x2b]);
    expect(at(7)).toEqual([0x3a, 0x3a, 0x3a]);
  });

  it('parses hex / short hex / numbers', () => {
    expect(parseColor('#FF3B8B')).toBe(0xff3b8b);
    expect(parseColor('#f38')).toBe(0xff3388);
    expect(parseColor(0x123456)).toBe(0x123456);
    expect(parseColor('#zzz')).toBeUndefined();
  });

  it('the intro takes the accent: no kit lime left in its markup', () => {
    const html = createBadMannersPreloader({ accent: '#ff3b8b' }).buildContentHTML();
    expect(html).not.toMatch(/#B6FF3B/i);
    expect(html).toMatch(/#ff3b8b/i);
  });
});
