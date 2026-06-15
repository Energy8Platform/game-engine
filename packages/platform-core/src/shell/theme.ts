import type { ThemeConfig } from './types';

const DEFAULT_ACCENT = '#663BA6';   // Energy8 brand purple (see loading/logo.ts)
const DEFAULT_BUYBONUS = '#E0A12B';

/** Returns a CSS custom-property block string for the shell root element. */
export function buildThemeVars(theme: ThemeConfig = {}): string {
  return [
    `--shell-accent: ${theme.accent ?? DEFAULT_ACCENT}`,
    `--shell-buybonus: ${theme.buyBonusColor ?? DEFAULT_BUYBONUS}`,
    `--shell-bg: #0F172A`,
    `--shell-fg: #FFFFFF`,
    `--shell-radius: 12px`,
  ].join('; ') + ';';
}
