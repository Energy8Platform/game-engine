import { describe, it, expect } from 'vitest';
import { buildThemeVars } from '@/shell/theme';
import { SHELL_CSS } from '@/shell/shell.css';

describe('buildThemeVars', () => {
  it('emits the neutral token set with brand defaults', () => {
    const vars = buildThemeVars();
    for (const t of ['--shell-fg', '--shell-muted', '--shell-icon', '--shell-icon-active', '--shell-veil',
      '--shell-track', '--shell-soft', '--shell-accent', '--shell-surface', '--shell-spin']) {
      expect(vars).toContain(t);
    }
  });

  it('defaults to the dark scheme; light scheme flips the palette', () => {
    expect(buildThemeVars()).toContain('--shell-surface: #0c111c');
    expect(buildThemeVars({ scheme: 'dark' })).toContain('--shell-surface: #0c111c');
    const light = buildThemeVars({ scheme: 'light' });
    expect(light).toContain('--shell-surface: #eef1f7');
    expect(light).toContain('--shell-icon-active: #0b1220');
  });

  it('only accent + buyBonus are game-overridable', () => {
    const vars = buildThemeVars({ accent: '#ff0000', buyBonusColor: '#00ff00' });
    expect(vars).toContain('--shell-accent: #ff0000');
    expect(vars).toContain('--shell-buybonus: #00ff00');
  });

  it('buyBonus tint follows accent by default, brand purple when neither is set', () => {
    expect(buildThemeVars({ accent: '#ff0000' })).toContain('--shell-buybonus: #ff0000'); // inherits accent
    expect(buildThemeVars()).toContain('--shell-buybonus: #8b5cf6'); // brand default
  });

  it('SPIN disc binds to the --shell-spin tokens so it follows the scheme (not hardcoded)', () => {
    expect(SHELL_CSS).toContain('background:var(--shell-spin)');
    expect(SHELL_CSS).toContain('color:var(--shell-spin-fg)');
    expect(SHELL_CSS).not.toContain('#f6f7fb'); // the old hardcoded disc colour is gone
  });

  it('emits the shared plaque tokens (bar + overlays), scheme-independent', () => {
    const plaque = ['--shell-plaque-dark', '--shell-plaque-glass', '--shell-plaque-glass-hover',
      '--shell-plaque-line', '--shell-plaque-label'];
    const dark = buildThemeVars({ scheme: 'dark' });
    const light = buildThemeVars({ scheme: 'light' });
    for (const t of plaque) {
      expect(dark).toContain(t);
      // always-dark plaque language: identical tone in both schemes
      expect(dark).toContain('--shell-plaque-dark: rgba(6,9,15,.86)');
      expect(light).toContain('--shell-plaque-dark: rgba(6,9,15,.86)');
    }
  });
});
