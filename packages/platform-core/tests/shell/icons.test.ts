import { describe, it, expect } from 'vitest';
import { icon, ICON_NAMES } from '@/shell/components/icons';

describe('icon', () => {
  it('returns an inline SVG string for every name', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox');
    }
  });

  it('duotone icons reference both tone tokens', () => {
    expect(icon('menu')).toContain('var(--shell-icon)');
    expect(icon('menu')).toContain('var(--shell-icon-bright)');
  });

  it('monochrome icons use currentColor', () => {
    expect(icon('close')).toContain('currentColor');
  });
});
