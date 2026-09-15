import { describe, it, expect } from 'vitest';
import { SHELL_FONT_CSS, SHELL_FONT_FAMILY } from '@/core/fonts';
import { SHELL_CSS, SHELL_FONT_FACES } from '@/ui/html/shell.css';
import { parseFontFaces } from '@/core/fontface';

describe('shell bundled font (Inter)', () => {
  it('embeds two base64 woff2 @font-face faces (latin + cyrillic)', () => {
    expect(SHELL_FONT_FAMILY).toBe('Inter');
    const faces = SHELL_FONT_CSS.match(/@font-face\{/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(SHELL_FONT_CSS).toContain("font-family:'Inter'");
    // self-contained: glyph data inlined, no external url()
    expect(SHELL_FONT_CSS).toContain('src:url(data:font/woff2;base64,');
    expect(SHELL_FONT_CSS).not.toContain('http');
  });

  it('declares the full variable weight axis so 800-weight elements stay ExtraBold', () => {
    expect(SHELL_FONT_CSS).toContain('font-weight:100 900');
  });

  it('covers Latin (EN/ES/FR) and Cyrillic ranges', () => {
    expect(SHELL_FONT_CSS).toContain('U+0000-00FF'); // Latin-1 incl. ES/FR accents
    expect(SHELL_FONT_CSS).toContain('U+0400-045F'); // Cyrillic
  });

  it('leads the SHELL_CSS font stack, with the faces kept OUT of the stylesheet', () => {
    // A `data:` font url inside a <style> is blocked by Stake's `font-src 'self'` CSP — the faces
    // go through FontFace-from-bytes (installFontFaces) instead, so the stylesheet must not carry them.
    expect(SHELL_CSS).not.toContain('@font-face');
    expect(SHELL_FONT_FACES).toContain(SHELL_FONT_CSS);
    expect(SHELL_CSS).toMatch(/font-family: 'Inter', -apple-system/);
  });

  it('parses into FontFace descriptors: family, weight axis, unicode ranges', () => {
    const faces = parseFontFaces(SHELL_FONT_FACES);
    const inter = faces.filter((f) => f.family === 'Inter');
    expect(inter).toHaveLength(2);
    expect(inter[0].weight).toBe('100 900');
    expect(inter.map((f) => f.unicodeRange)).toEqual([expect.stringContaining('U+0000-00FF'), expect.stringContaining('U+0400-045F')]);
    expect(faces.find((f) => f.family === 'OswaldNum')).toBeDefined();
  });
});
