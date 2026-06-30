import type { ThemeConfig } from './types';
import { BRAND_ACCENT } from './colors';

// Ported 1:1 from platform-core/src/shell/theme.ts. The DOM shell emits these as CSS custom
// properties; the Pixi shell resolves them to plain colour strings (Pixi's Color accepts hex
// AND rgba()/rgb() strings) so every surface paints with the exact same value.

const DEFAULT_ACCENT = BRAND_ACCENT; // brand purple — BUY BONUS + active states (single source: colors.ts)

const PALETTE = {
  dark: {
    fg: '#f3f5fa', muted: '#9aa3b6', icon: '#c7cedb', iconActive: '#ffffff',
    surface: '#0c111c', hairline: 'rgba(255,255,255,.07)',
    veil: 'rgba(255,255,255,.05)', veilStrong: 'rgba(255,255,255,.1)', track: 'rgba(255,255,255,.16)',
    soft: '#dfe4ee', spin: '#f4f6fb', spinFg: '#141a28',
  },
  light: {
    fg: '#15202e', muted: '#5a6678', icon: '#3c4658', iconActive: '#0b1220',
    surface: '#eef1f7', hairline: 'rgba(15,23,42,.12)',
    veil: 'rgba(15,23,42,.05)', veilStrong: 'rgba(15,23,42,.09)', track: 'rgba(15,23,42,.22)',
    soft: '#3a4453', spin: '#1c2434', spinFg: '#f3f6fb',
  },
} as const;

/** Resolved colour tokens for the Pixi shell — scheme palette + the scheme-independent
 *  "plaque" language shared by the control bar and overlays, plus the game-overridable accent. */
export interface ShellTokens {
  fg: string;
  muted: string;
  icon: string;
  iconActive: string;
  surface: string;
  hairline: string;
  veil: string;
  veilStrong: string;
  track: string;
  soft: string;
  spin: string;
  spinFg: string;
  // Plaque tokens (always dark, white-on-dark) — identical in both schemes so the bar +
  // overlays stay visually identical regardless of the dark/light scheme.
  plaqueDark: string;
  plaqueGlass: string;
  plaqueGlassHover: string;
  plaqueSolid: string;
  plaqueLine: string;
  plaqueLabel: string;
  // The continuous desktop control-bar surface + the white-disc buttons that sit on it.
  bar: string;
  btn: string;
  btnInk: string;
  accent: string;
  // Fixed chrome colours used inline by the CSS (frosted backdrop tint, ways win/lose ticks).
  backdrop: string;
  white: string;
  winOk: string;
  winNo: string;
}

export function resolveTheme(theme: ThemeConfig = {}): ShellTokens {
  const p = PALETTE[theme.scheme === 'light' ? 'light' : 'dark'];
  return {
    ...p,
    plaqueDark: 'rgba(6,9,15,.86)',
    plaqueGlass: 'rgba(30,36,48,.70)',
    plaqueGlassHover: 'rgba(40,48,64,.86)',
    plaqueSolid: '#1a2030',
    plaqueLine: 'rgba(255,255,255,.22)',
    plaqueLabel: 'rgba(255,255,255,.6)',
    bar: 'rgba(6,9,15,.86)',
    btn: '#f4f6fb',
    btnInk: '#0b0e16',
    accent: theme.accent ?? DEFAULT_ACCENT,
    backdrop: 'rgba(12,17,28,.5)',
    white: '#ffffff',
    winOk: '#4ade80',
    winNo: '#f87171',
  };
}
