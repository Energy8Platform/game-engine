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
    const a = sIcon('mask', 48, S.ink);
    const b = sIcon('mask', 30, S.ink);
    expect(a.context).toBe(b.context);
    expect(a.scale.x).toBe(2);
    expect(sIcon('mask', 24, S.yellow).context).not.toBe(a.context);
    expect(a.getLocalBounds().width).toBeGreaterThan(20); // the mask spans most of its 24-unit box
  });
});
