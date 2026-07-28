// @vitest-environment node
import { it, expect } from 'vitest';
import { ICON_NAMES } from '@/core/icon-names';
import { icon } from '@/ui/html/icons';
import { iconSVG } from '@/ui/pixi/icons';

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

// A bad name doesn't just render empty here — SVGS[name].split(...) throws outright (SVGS[name] is
// undefined), which is exactly why MenuItem.icon must be validated against ICON_NAMES before it
// ever reaches this renderer. This is the symmetric half of the DOM loop above.
it('every shared name resolves to a non-empty Pixi glyph', () => {
  for (const n of ICON_NAMES) {
    const svg = iconSVG(n);
    expect(svg, `iconSVG(${n})`).toContain('<svg');
    expect(svg, `iconSVG(${n}) must not be empty`).not.toContain('undefined');
  }
});
