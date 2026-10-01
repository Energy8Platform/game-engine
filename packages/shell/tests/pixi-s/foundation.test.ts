import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { parseFontFaces } from '@/core/fontface';
import { S_FONT_CSS, S_FONT_FAMILY } from '@/ui/pixi-s/fonts';
import { sIcon, sIconSVG, S_ICON_NAMES } from '@/ui/pixi-s/icons';
import { sLabel, sValue, S_FAMILY } from '@/ui/pixi-s/text';
import { S } from '@/ui/pixi-s/theme';

describe('S foundations', () => {
  it('embeds Montserrat 800 as one Latin and one Cyrillic face', () => {
    const faces = parseFontFaces(S_FONT_CSS);
    expect(faces.map((f) => f.family)).toEqual([S_FONT_FAMILY, S_FONT_FAMILY]);
    expect(faces.every((f) => f.weight === '800')).toBe(true);
    expect(faces[0].unicodeRange).toContain('U+0000-00FF');
    expect(faces[1].unicodeRange).toContain('U+0400-045F');
    expect(faces.every((f) => f.b64.length > 10_000)).toBe(true);
  });

  it('labels are uppercase yellow in the S family; values keep their case', () => {
    const label = sLabel('Balance', 14);
    expect(label.text).toBe('BALANCE');
    expect(label.style.fill).toBe(S.yellow);
    expect(label.style.fontFamily).toBe(S_FAMILY);
    expect(label.style.fontWeight).toBe('800');
    const value = sValue('€1,000.00', 24);
    expect(value.text).toBe('€1,000.00');
    expect(value.style.fill).toBe(S.fg);
  });

  it('glyphs: the colour is substituted, the box scales to size, contexts are shared', () => {
    for (const n of S_ICON_NAMES) expect(sIconSVG(n, '#123456')).not.toContain('currentColor');
    const a = sIcon('bonus', 48, S.ink);
    const b = sIcon('bonus', 30, S.ink);
    expect(a.gfx.context).toBe(b.gfx.context);
    expect(a.gfx.scale.x).toBe(2);
    expect(sIcon('bonus', 24, S.yellow).gfx.context).not.toBe(a.gfx.context);
    // every glyph fills most of its box, centred in it
    for (const n of S_ICON_NAMES) {
      const k = sIcon(n, 24, S.ink).getLocalBounds();
      expect(Math.max(k.width, k.height), n).toBeGreaterThan(18);
      expect(Math.abs(k.x + k.width / 2 - 12), n).toBeLessThan(1.5);
      expect(Math.abs(k.y + k.height / 2 - 12), n).toBeLessThan(1.5);
    }
  });

  it('the bonus mask\'s details are holes, so the button face shows through on hover and when disabled', () => {
    const fills = sIcon('bonus', 48, S.ink).gfx.context.instructions.filter((i) => i.action === 'fill');
    expect(fills.some((i) => (i.data as { hole?: unknown }).hole)).toBe(true);
  });

  it('spin turns a glyph about its own centre', () => {
    const g = sIcon('spin', 40, S.ink);
    const c = (k: { x: number; y: number; width: number; height: number }) => [k.x + k.width / 2, k.y + k.height / 2];
    const [x0, y0] = c(g.getLocalBounds());
    // an off-centre point of the glyph (its top-left box corner), in the glyph's own space
    const corner = () => g.toLocal(g.gfx.toGlobal({ x: 0, y: 0 }));
    const p0 = corner();
    g.spin = Math.PI / 2;
    expect(g.gfx.rotation).toBe(Math.PI / 2);
    const [x1, y1] = c(g.getLocalBounds());
    expect(Math.abs(x1 - x0)).toBeLessThan(1);
    expect(Math.abs(y1 - y0)).toBeLessThan(1);
    // a quarter turn about the centre (20, 20) takes the top-left corner to the top-right
    const p1 = corner();
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeGreaterThan(20);
    expect(p1.x).toBeCloseTo(40, 5);
    expect(p1.y).toBeCloseTo(0, 5);
  });

  it('panels are one step lighter than the black plates, so plates keep their shape inside panels', () => {
    expect(S.panel).not.toBe(S.plate);
  });
});
