import { describe, it, expect } from 'vitest';
import { buildThemeVars } from '@/shell/theme';

describe('buildThemeVars', () => {
  it('emits brand defaults when no theme supplied', () => {
    const vars = buildThemeVars();
    expect(vars).toContain('--shell-accent:');
    expect(vars).toContain('--shell-buybonus:');
  });

  it('overrides only whitelisted tokens', () => {
    const vars = buildThemeVars({ accent: '#ff0000', buyBonusColor: '#00ff00' });
    expect(vars).toContain('--shell-accent: #ff0000');
    expect(vars).toContain('--shell-buybonus: #00ff00');
  });
});
