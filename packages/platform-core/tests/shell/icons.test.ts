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

  it('the whole set is monochrome (no duotone tone tokens)', () => {
    for (const name of ICON_NAMES) {
      expect(icon(name)).not.toContain('var(--shell-icon');
    }
  });

  it('control icons use currentColor', () => {
    for (const name of ['spin', 'turbo', 'turbo1', 'turbo2', 'turbo3', 'autoplay', 'stop',
      'menu', 'betUp', 'betDown', 'plus', 'minus', 'soundOn', 'soundOff', 'info', 'close'] as const) {
      expect(icon(name)).toContain('currentColor');
    }
  });
});
