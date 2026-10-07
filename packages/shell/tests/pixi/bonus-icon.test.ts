import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { bonusGlyph } from '@/ui/pixi/pixi-icon';
import { BONUS_ICONS, type BonusIconName } from '@/core/bonusIcons';

describe('provider BUY BONUS icons (pixi)', () => {
  it('every icon parses through Pixi and fills its box', () => {
    for (const name of Object.keys(BONUS_ICONS) as BonusIconName[]) {
      const b = bonusGlyph(name, 48, '#000000').getLocalBounds();
      expect(b.width).toBeGreaterThan(40);
      expect(b.x + b.width).toBeLessThanOrEqual(48);
      expect(b.y + b.height).toBeLessThanOrEqual(48);
    }
  });
});
