import type { ThemeConfig } from './types';
import { BRAND_ACCENT } from './colors';

const DEFAULT_ACCENT = BRAND_ACCENT; // brand purple — BUY BONUS + active states (single source: colors.ts)

// Neutral palettes for each scheme. Everything the shell paints reads from these
// tokens, so a single `scheme` flip recolours bar, icons, overlays and toggles.
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

/** CSS custom-property block for the shell root. `scheme` picks the palette;
 *  only accent and buyBonus are additionally game-overridable. */
export function buildThemeVars(theme: ThemeConfig = {}): string {
  const p = PALETTE[theme.scheme === 'light' ? 'light' : 'dark'];
  return [
    `--shell-fg: ${p.fg}`,
    `--shell-muted: ${p.muted}`,
    `--shell-icon: ${p.icon}`,
    `--shell-icon-active: ${p.iconActive}`,
    `--shell-surface: ${p.surface}`,
    `--shell-hairline: ${p.hairline}`,
    `--shell-veil: ${p.veil}`,
    `--shell-veil-strong: ${p.veilStrong}`,
    `--shell-track: ${p.track}`,
    `--shell-soft: ${p.soft}`,
    `--shell-spin: ${p.spin}`,
    `--shell-spin-fg: ${p.spinFg}`,
    `--shell-radius: 12px`,
    // Plaque tokens — the grouped dark/glass panel language shared by the control bar
    // AND the overlays. Scheme-independent (always dark, white-on-dark) so bar + overlays
    // stay visually identical regardless of the dark/light `scheme`.
    `--shell-plaque-dark: rgba(6,9,15,.76)`,
    `--shell-plaque-glass: rgba(30,36,48,.5)`,
    `--shell-plaque-glass-hover: rgba(40,48,64,.62)`,
    // Opaque surface for centred modals (confirm, bet/autoplay pickers) so they read solid,
    // not see-through, over the frosted backdrop.
    `--shell-plaque-solid: #1a2030`,
    `--shell-plaque-line: rgba(255,255,255,.22)`,
    `--shell-plaque-label: rgba(255,255,255,.6)`,
    `--shell-accent: ${theme.accent ?? DEFAULT_ACCENT}`,
    // buy-bonus tint follows the accent by default; only overridden when set explicitly
    `--shell-buybonus: ${theme.buyBonusColor ?? theme.accent ?? DEFAULT_ACCENT}`,
  ].join('; ') + ';';
}
