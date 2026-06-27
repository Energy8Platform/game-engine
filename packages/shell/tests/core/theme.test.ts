import { describe, it, expect } from 'vitest';
import { resolveTheme, DEFAULT_ACCENT } from '@/core/theme';

describe('resolveTheme', () => {
  it('defaults to the dark scheme palette', () => {
    const t = resolveTheme();
    expect(t.fg).toBe('#f3f5fa');
    expect(t.accent).toBe(DEFAULT_ACCENT);
  });
  it('applies a game accent override', () => {
    expect(resolveTheme({ accent: '#ff0000' }).accent).toBe('#ff0000');
  });
  it('keeps plaque tokens scheme-independent', () => {
    expect(resolveTheme({ scheme: 'dark' }).plaqueDark).toBe(resolveTheme({ scheme: 'light' }).plaqueDark);
  });
});
