import '../pixi/setup-canvas';
import { describe, it, expect } from 'vitest';
import { GraphicsContext } from 'pixi.js';
import { HB_ICON_NAMES, iconSVG } from '@/ui/pixi-hb/icons';

describe('hb icons', () => {
  it('every glyph parses into a GraphicsContext with all colour slots resolved', () => {
    for (const name of HB_ICON_NAMES) {
      const svg = iconSVG(name, { ink: '#111111', fill: '#eeeeee', accent: '#ff7a00', stroke: 2 });
      expect(svg, name).not.toMatch(/current(Color|Fill|Accent|Stroke)/);
      expect(() => new GraphicsContext().svg(svg), name).not.toThrow();
    }
  });

  it('the autoplay triangle takes the accent slot', () => {
    expect(iconSVG('autoplay', { accent: '#abcdef' })).toContain('fill="#abcdef"');
    expect(iconSVG('spin', { accent: '#abcdef' })).not.toContain('#abcdef');
  });
});
