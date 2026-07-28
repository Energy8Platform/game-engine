// @vitest-environment node
import { it, expect } from 'vitest';
import { ICON_NAMES } from '@/core/icon-names';
import { icon } from '@/ui/html/icons';

it('exposes the shared glyph names the menu presets rely on', () => {
  for (const n of ['menu', 'info', 'soundOn', 'soundOff', 'chevronRight', 'ticket'] as const) {
    expect(ICON_NAMES, `${n} must be a known icon`).toContain(n);
  }
});

it('every shared name resolves to a non-empty DOM glyph', () => {
  for (const n of ICON_NAMES) {
    const svg = icon(n);
    expect(svg, `icon(${n})`).toContain('<svg');
    expect(svg, `icon(${n}) must not be empty`).not.toContain('undefined');
  }
});
