import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/core/format';
import { resolveTheme } from '@/core/theme';
import { effectiveAccent, contrastText, BRAND_ACCENT } from '@/core/colors';
import { socialize } from '@/core/i18n';
import { ICON_NAMES, iconSVG } from '@/ui/pixi/icons';
import { createInitialState, stepBet, nextTurbo } from '@/core/state';
import type { CurrencyConfig } from '@/core/types';

// These exercise the renderer-agnostic logic the Pixi shell shares with the DOM shell, so the
// two stay byte-identical in everything but the renderer.

describe('formatCurrency (maxDecimals + variableDecimals)', () => {
  const eur: CurrencyConfig = { symbol: '€', position: 'left' };
  it('defaults to 2 fixed decimals with , thousands / . decimal', () => {
    expect(formatCurrency(1234.5, eur)).toBe('€1,234.50');
    expect(formatCurrency(0, eur)).toBe('€0.00');
  });
  it('places the symbol on the right when configured', () => {
    expect(formatCurrency(1234.5, { symbol: '€', position: 'right' })).toBe('1,234.50 €');
  });
  it('fixed callers round at minDecimals', () => {
    const c: CurrencyConfig = { symbol: '€', position: 'left', maxDecimals: 4, minDecimals: 2 };
    expect(formatCurrency(0.0673, c)).toBe('€0.07'); // fixed → rounds at minDecimals=2
    expect(formatCurrency(0.3, c)).toBe('€0.30');
  });
  it('variable callers keep significant digits down to minDecimals', () => {
    const c: CurrencyConfig = { symbol: '€', position: 'left', maxDecimals: 4, minDecimals: 2 };
    expect(formatCurrency(0.0673, c, true)).toBe('€0.0673');
    expect(formatCurrency(0.067, c, true)).toBe('€0.067');
    expect(formatCurrency(0.3, c, true)).toBe('€0.30');
    expect(formatCurrency(0, c, true)).toBe('€0.00');
  });
});

describe('resolveTheme', () => {
  it('defaults to the dark palette + brand accent', () => {
    const t = resolveTheme();
    expect(t.accent).toBe(BRAND_ACCENT);
    expect(t.fg).toBe('#f3f5fa');
    expect(t.plaqueDark).toBe('rgba(6,9,15,.86)');
    expect(t.plaqueGlass).toBe('rgba(30,36,48,.70)');
  });
  it('switches palette on scheme and honours an accent override', () => {
    const t = resolveTheme({ scheme: 'light', accent: '#ff0000' });
    expect(t.fg).toBe('#15202e');
    expect(t.accent).toBe('#ff0000');
    // plaque tokens are scheme-independent (bar + overlays stay identical)
    expect(t.plaqueDark).toBe('rgba(6,9,15,.86)');
  });
});

describe('colors', () => {
  it('resolves type-default and override accents', () => {
    expect(effectiveAccent({ type: 'bonus' })).toBe('#8b5cf6');
    expect(effectiveAccent({ type: 'feature' })).toBe('#f0b429');
    expect(effectiveAccent({ type: 'bonus', accentColor: '#123456' })).toBe('#123456');
  });
  it('picks readable ink on an accent', () => {
    expect(contrastText('#ffffff')).toBe('#1a1205');
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('red')).toBe('#ffffff'); // non-hex → white
  });
});

describe('socialize', () => {
  it('rewrites restricted vocabulary, preserving case', () => {
    expect(socialize('BUY BONUS')).toBe('GET BONUS');
    expect(socialize('bet')).toBe('play');
    expect(socialize('Balance')).toBe('Balance'); // untouched
  });
});

describe('icons', () => {
  it('ships the shipped glyph set (icons.svg glyphs + preserved gift/ticket)', () => {
    expect(ICON_NAMES.length).toBe(19);
    expect(ICON_NAMES).toContain('spin');
    expect(ICON_NAMES).toContain('ticket');
    expect(ICON_NAMES).toContain('gift');
    // the three turbo states + the four chevrons all ship from the new sheet
    for (const name of ['turboOff', 'turbo1', 'turbo2', 'chevronUp', 'chevronDown', 'back', 'chevronRight']) {
      expect(ICON_NAMES).toContain(name);
    }
    // superseded/unused glyphs never shipped
    for (const gone of ['turbo', 'turbo3', 'betUp', 'betDown', 'star', 'lightning']) {
      expect(ICON_NAMES).not.toContain(gone);
    }
  });
  it('builds a parseable SVG with currentColor substituted', () => {
    const svg = iconSVG('menu', '#abcdef');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('#abcdef');
    expect(svg).not.toContain('currentColor');
  });
});

describe('state', () => {
  const cfg = {
    mode: 'base' as const,
    balance: 100,
    win: 0,
    currentBet: null,
    defaultBet: 1,
    availableBets: [0.5, 1, 2, 5],
  };
  it('seeds initial state from config', () => {
    const s = createInitialState(cfg as never);
    expect(s.bet).toBe(1);
    expect(s.balance).toBe(100);
    expect(s.autoplay).toEqual({ active: false, remaining: 0 });
    expect(s.activeFeature).toBeNull();
  });
  it('steps bet within range and clamps at the ends', () => {
    const s = createInitialState(cfg as never);
    expect(stepBet(s, 1)).toBe(2);
    s.bet = 5;
    expect(stepBet(s, 1)).toBe(5); // clamped
    s.bet = 0.5;
    expect(stepBet(s, -1)).toBe(0.5); // clamped
  });
  it('cycles turbo levels and wraps to 0', () => {
    expect(nextTurbo(0, 3)).toBe(1);
    expect(nextTurbo(3, 3)).toBe(0);
    expect(nextTurbo(1, 0)).toBe(0); // feature off
  });
});
