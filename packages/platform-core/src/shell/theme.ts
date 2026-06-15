import type { ThemeConfig } from './types';

const DEFAULT_ACCENT = '#8b5cf6';   // brand purple — BUY BONUS + active states
const DEFAULT_BUYBONUS = '#8b5cf6'; // buy bonus tint (overridable per game)

/** CSS custom-property block for the shell root. Neutral system; only accent
 *  and buyBonus are game-overridable. */
export function buildThemeVars(theme: ThemeConfig = {}): string {
  return [
    `--shell-fg: #f3f5fa`,
    `--shell-muted: #9aa3b6`,
    `--shell-icon: #c7cedb`,
    `--shell-icon-bright: #e8ecf4`,
    `--shell-surface: #0c111c`,
    `--shell-hairline: rgba(255,255,255,.07)`,
    `--shell-spin: #f4f6fb`,
    `--shell-spin-fg: #141a28`,
    `--shell-radius: 12px`,
    `--shell-accent: ${theme.accent ?? DEFAULT_ACCENT}`,
    `--shell-buybonus: ${theme.buyBonusColor ?? DEFAULT_BUYBONUS}`,
  ].join('; ') + ';';
}
