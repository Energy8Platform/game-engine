import { describe, it, expect } from 'vitest';
import { buildThemeVars } from '@/shell/theme';

describe('buildThemeVars', () => {
  it('emits the neutral token set with brand defaults', () => {
    const vars = buildThemeVars();
    for (const t of ['--shell-fg', '--shell-muted', '--shell-icon', '--shell-icon-bright', '--shell-accent', '--shell-surface', '--shell-spin']) {
      expect(vars).toContain(t);
    }
  });

  it('only accent + buyBonus are game-overridable', () => {
    const vars = buildThemeVars({ accent: '#ff0000', buyBonusColor: '#00ff00' });
    expect(vars).toContain('--shell-accent: #ff0000');
    expect(vars).toContain('--shell-buybonus: #00ff00');
  });
});
