import type { ShellTokens } from '@/core/theme';

/** Emit the shell root's CSS custom-property block from resolved tokens — the DOM renderer's
 *  applyTheme. Property names/values must match platform-core's buildThemeVars byte-for-byte. */
export function buildThemeVars(t: ShellTokens): string {
  return [
    `--shell-fg: ${t.fg}`, `--shell-muted: ${t.muted}`, `--shell-icon: ${t.icon}`,
    `--shell-icon-active: ${t.iconActive}`, `--shell-surface: ${t.surface}`,
    `--shell-hairline: ${t.hairline}`, `--shell-veil: ${t.veil}`, `--shell-veil-strong: ${t.veilStrong}`,
    `--shell-track: ${t.track}`, `--shell-soft: ${t.soft}`, `--shell-spin: ${t.spin}`, `--shell-spin-fg: ${t.spinFg}`,
    `--shell-radius: 12px`,
    `--shell-plaque-dark: ${t.plaqueDark}`, `--shell-plaque-glass: ${t.plaqueGlass}`,
    `--shell-plaque-glass-hover: ${t.plaqueGlassHover}`,
    // The desktop control bar is one continuous, slightly-darker surface (vs the lighter plaque
    // panels). Buttons sitting on it are white discs with black icons (see .ge-bar-panel CSS).
    `--shell-bar: ${t.bar}`, `--shell-btn: ${t.btn}`, `--shell-btn-ink: ${t.btnInk}`,
    `--shell-plaque-solid: ${t.plaqueSolid}`,
    `--shell-plaque-line: ${t.plaqueLine}`, `--shell-plaque-label: ${t.plaqueLabel}`,
    `--shell-accent: ${t.accent}`,
  ].join('; ') + ';';
}
