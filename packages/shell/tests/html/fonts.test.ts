import { describe, it, expect } from 'vitest';
import { SHELL_FONT_CSS, SHELL_FONT_FAMILY } from '@/core/fonts';
import { SHELL_CSS } from '@/ui/html/shell.css';

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

  it('is bundled into SHELL_CSS with Inter leading the font stack', () => {
    expect(SHELL_CSS).toContain(SHELL_FONT_CSS);
    expect(SHELL_CSS).toMatch(/font-family: 'Inter', -apple-system/);
  });
});
