import { describe, it, expect } from 'vitest';
import { icon, ICON_NAMES } from '@/ui/html/icons';

describe('icon', () => {
  it('returns an inline SVG string for every name', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox');
    }
  });

  it('the whole set is monochrome (no duotone tone tokens)', () => {
    for (const name of ICON_NAMES) {
      expect(icon(name)).not.toContain('var(--shell-icon');
    }
  });

  it('every shipped icon uses currentColor', () => {
    for (const name of ICON_NAMES) {
      expect(icon(name)).toContain('currentColor');
    }
  });
});
