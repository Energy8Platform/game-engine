import { describe, it, expect } from 'vitest';
import { SHELL_CSS } from '@/shell/shell.css';

// Regression: SPIN and BUY BONUS use position:relative; z-index:3 to overlap their
// plaques. The overlay must stack ABOVE them or those two buttons poke through it.
describe('overlay stacking', () => {
  const zOf = (selectorFragment: string): number => {
    const rule = SHELL_CSS.split('}').find((r) => r.includes(selectorFragment) && r.includes('z-index'));
    const m = rule?.match(/z-index\s*:\s*(\d+)/);
    return m ? Number(m[1]) : NaN;
  };

  it('overlay z-index sits above the bar buttons (buybonus/spin z-index:3)', () => {
    const overlay = zOf('.ge-shell-overlay');
    expect(overlay).toBeGreaterThan(zOf('.ge-shell-buybonus'));
    expect(overlay).toBeGreaterThan(zOf('.ge-shell-spin'));
  });
});
